# Investigation Formal Verification Evolution Research

## Problem Statement
Explore using formal verification to solidify the evolution pipeline code. The evolution system is a complex pipeline with multiple interacting components (generate, rank, evolve loop, budget tracking, arena sync, metrics propagation) that would benefit from formal guarantees about correctness invariants.

## Requirements (from GH Issue #872)
Give me a proposal based on research — detailed requirements derived from 3 rounds of 12 parallel research agents.

## High Level Summary

The evolution pipeline is an **excellent candidate for formal verification** due to:
- **30%+ pure function density** (rating math, format validation, metrics) — ideal for property-based testing
- **4 discrete state machines** (run lifecycle, experiment lifecycle, budget tracker, convergence counter) — amenable to model checking
- **Critical invariants** enforced only by convention, not structure (pool append-only, winner selection, budget safety)
- **Zero property-based testing** despite 1,145 existing example-based tests and 49+ test files
- **Missing DB constraints** (status enums, config_hash uniqueness) creating TS-DB schema divergence

Research identified **11 concrete verification approaches** ranked by effort vs. impact, with a recommended phased rollout starting from quick wins (fast-check, selectWinner extraction) through medium-term structural improvements (branded types, DB constraints) to long-term formal methods (TLA+ models).

## Key Findings

### 1. Existing Invariant Catalog (90+ invariants found)

| Category | Count | Enforcement | Compile-Time? |
|----------|-------|------------|---------------|
| Zod schemas | 15+ | `.parse()` / `.safeParse()` | Yes (types) + runtime |
| Config validation | 7 | `validateConfig()` | Runtime only |
| Budget tracking | 5 | Cost tracker logic | Runtime only |
| Format rules | 6 | `validateFormat()` | Runtime only |
| Ranking (pool/triage/Swiss) | 25+ | Conditional branches | Runtime only |
| Generation | 4 | Format + budget checks | Runtime only |
| Agent base class | 5 | Detail schema + cost | Partial |
| Finalization | 6 | Schema + upsert safety | Yes (schemas) |
| Metrics | 3 | Phase registry lookup | Runtime only |
| Control flow | 3 | Signal/kill/deadline | Runtime only |

### 2. Critical Correctness Paths

**6 paths with highest verification value:**

| Path | Invariant | Current Enforcement | FV Amenability |
|------|-----------|-------------------|----------------|
| Rating system | σ always decreases; μ bounded | OpenSkill library trust | VERY HIGH |
| Budget tracking | totalSpent + reserved ≤ budget | Synchronous reserve() | VERY HIGH |
| Pool append-only | No removal, immutability | Convention (array.push) | MODERATE |
| Arena sync | No duplicates, idempotent | RPC ON CONFLICT | MODERATE |
| Convergence | 2 consecutive converged rounds | Counter + reset | HIGH |
| Winner selection | max(μ), tiebreak min(σ) | **DUPLICATED** code, divergent semantics | VERY HIGH |

### 3. Winner Selection Duplication (Critical Finding)

Winner determination appears in **two places** with **divergent semantics**:

- **runIterationLoop.ts:250-264**: `if (!r) continue;` — SKIPS unrated variants entirely
- **persistRunResults.ts:156-172**: `r?.mu ?? -Infinity` — TREATS unrated as worst possible

This means the winner during the loop can differ from the winner at finalization if any variants lack ratings. Must extract to shared `selectWinner()` function.

### 4. State Machines Identified

| Machine | States | Concurrent Actors | Recommended Tool |
|---------|--------|-------------------|-----------------|
| Run lifecycle | 5 (pending→claimed→running→completed/failed) | Multiple runners | TLA+ |
| Experiment lifecycle | 4 (draft→running→completed/cancelled) | Multiple runs + admin | Alloy or TLA+ |
| Budget tracker | (spent, reserved, budget) tuple | Single (Node.js guarantee) | Assertions + fast-check |
| Convergence counter | (streak, comparisons, exitReason) | Sequential | Assertions only |

### 5. Property-Based Testing Opportunities (24 properties identified)

| File | Properties | Priority |
|------|-----------|----------|
| `computeRatings.ts` (rating functions) | 10 (sigma decrease, mu ordering, symmetry, monotonicity, bounds) | P0 |
| `computeRatings.ts` (comparison/parsing) | 7 (exhaustive coverage, confidence levels, symmetry) | P1 |
| `trackBudget.ts` | 6 (core invariant, margin, reserve-spend matching, accumulation) | P0 |
| `enforceVariantFormat.ts` | 8 (idempotency, mode bypass, detection, partitioning) | P1 |

**fast-check integration is trivial**: zero Jest config changes, single `npm install`, full TS strict mode support, ~75 min for pilot.

### 6. Branded Type Opportunities (5 domains)

| Current Type | Gap | Branded Type |
|-------------|-----|-------------|
| `Variant.text: string` | No proof validation occurred | `ValidatedArticle` |
| `Map<string, Rating>` | `.get()` returns undefined | `RatedVariant` with guaranteed rating |
| `fromArena?: boolean` | Optional flag, easy to miss | `LocalVariant | ArenaVariant` discriminated union |
| `status: string enum` | State-dependent fields untyped | `PendingRun | ClaimedRun | RunningRun | ...` |
| `timing: string` | Validated at runtime only | `DuringExecutionMetric<T>` per phase |

### 7. Database Constraint Gaps

| Table | Missing Constraint | Risk |
|-------|-------------------|------|
| `evolution_runs` | CHECK on status enum (5 values) | Invalid status persists |
| `evolution_experiments` | CHECK on status enum (4 values) | Invalid status persists |
| `evolution_prompts` | CHECK on status enum (2 values) | Invalid status persists |
| `evolution_strategies` | CHECK on status enum (2 values) | Invalid status persists |
| `evolution_strategies` | UNIQUE on config_hash | Duplicate configs bypass dedup |
| `evolution_variants` | FK on run_id → evolution_runs | Orphaned variants possible |

Claim RPC (`claim_evolution_run`) was simplified in a recent migration — advisory lock and stale expiry were **removed**, leaving concurrent limit enforcement to TypeScript only.

### 8. ROI Analysis (from commit history)

Bug-related commit categories from ~352 recent evolution commits (methodology: git log keyword search for "fix" in commits touching `evolution/` files, categorized by subsystem touched — these are **approximate counts of fix-related commits, not deduplicated verified bugs**; useful for relative prioritization, not as precise metrics):
- **Rating/comparison logic**: ~80 fix-related commits (highest concentration)
- **State/finalization**: ~70 fix-related commits
- **Error handling**: ~55 fix-related commits
- **Budget tracking**: ~45 fix-related commits
- **Format validation**: ~35 fix-related commits

## Proposed Verification Approaches (Ranked by ROI)

### Phase 1: Quick Wins (1-2 days, highest ROI)

| Approach | Effort | Bugs Prevented | Files |
|----------|--------|---------------|-------|
| fast-check for rating functions | 2-3h | ~80 class | `computeRatings.propertyBased.test.ts` |
| fast-check for budget tracker | 2-3h | ~45 class | `trackBudget.propertyBased.test.ts` |
| selectWinner extraction | 2-3h | divergence bugs | new `selectWinner.ts` + 2 call sites |
| DB CHECK constraints | 1-2h | data corruption | 1 migration file |

### Phase 2: Structural Improvements (3-5 days)

| Approach | Effort | Bugs Prevented | Files |
|----------|--------|---------------|-------|
| fast-check for format validator | 2-3h | ~35 class | `enforceVariantFormat.propertyBased.test.ts` |
| ValidatedArticle branded type | 3-4h | ~35 class | types.ts + generation + finalize |
| RatedVariant branded type | 3-4h | ~80 class | types.ts + ranking + finalize |
| Budget postcondition assertions | 2-3h | ~20 class | trackBudget.ts |
| AppendOnlyPool wrapper | 3-4h | future bugs | new class + runIterationLoop.ts |

### Phase 3: Long-Term (5-10 days)

| Approach | Effort | Value | Files |
|----------|--------|-------|-------|
| Run status discriminated union | 2-3 days | 70 bug class | schemas.ts + all status consumers |
| TLA+ run lifecycle model | 3-5 days | discovery (race conditions) | new .tla spec files |
| Metric timing branded types | 1-2 days | phase mismatch prevention | metrics/types.ts + writeMetrics.ts |

## Open Questions

1. Should property-based tests live in separate files (`.propertyBased.test.ts`) or alongside existing tests?
2. For branded types: adopt gradually per-module or big-bang refactor?
3. TLA+ models: worth the investment given the codebase is single-threaded Node.js (except DB concurrent claims)?
4. Should the assertion framework be production-enabled (with env var toggle) or dev/test only?
5. DB constraints: deploy to staging first or straight to prod given existing data appears clean?

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (all 15 evolution docs)
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/agents/overview.md
- evolution/docs/arena.md
- evolution/docs/cost_optimization.md
- evolution/docs/curriculum.md
- evolution/docs/entities.md
- evolution/docs/logging.md
- evolution/docs/metrics.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/README.md
- evolution/docs/reference.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/visualization.md

## Code Files Read

### Pipeline Core
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — main loop, config validation, winner determination (Location A)
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — finalization, winner determination (Location B), arena sync
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — claim mechanism, heartbeat, run lifecycle transitions
- `evolution/src/lib/pipeline/loop/rankVariants.ts` — triage, Swiss fine-ranking, convergence detection, eligibility
- `evolution/src/lib/pipeline/loop/generateVariants.ts` — generation phase, format validation, budget error handling
- `evolution/src/lib/pipeline/infra/trackBudget.ts` — reserve-before-spend pattern, budget invariant
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — arena loading, strategy config parsing
- `evolution/src/lib/pipeline/experiments.ts` — experiment lifecycle, auto-completion

### Shared Utilities
- `evolution/src/lib/shared/computeRatings.ts` — OpenSkill rating, parseWinner, aggregateWinners, toEloScale
- `evolution/src/lib/shared/enforceVariantFormat.ts` — format validation rules, stripCodeBlocks
- `evolution/src/lib/shared/validation.ts` — state contracts (if exists)
- `evolution/src/lib/core/Agent.ts` — agent base class, budget error handling order

### Schemas & Types
- `evolution/src/lib/schemas.ts` — Zod schemas, run summary V3, execution detail union
- `evolution/src/lib/types.ts` — Variant, Rating, EvolutionConfig, error classes

### Metrics
- `evolution/src/lib/metrics/writeMetrics.ts` — timing validation, upsert logic
- `evolution/src/lib/metrics/types.ts` — metric timing phases

### Tests
- `evolution/src/lib/shared/computeRatings.test.ts` — existing rating test patterns

### Database
- `supabase/migrations/20260322000006_evolution_fresh_schema.sql` — RLS, RPCs
- `supabase/migrations/20260322000007_evolution_prod_convergence.sql` — FKs, renames
- `supabase/migrations/20260323000002_fix_stale_claim_expiry.sql` — stale handling (later reverted)
- `supabase/migrations/20260323000003_evolution_metrics_table.sql` — metrics schema
- `supabase/migrations/20260326000003_expand_stale_trigger.sql` — metric staleness cascade

### Config
- `jest.config.js` — test runner config (Jest + ts-jest)
- `tsconfig.json` — strict mode, ESM, path aliases
- `package.json` — dependencies (no fast-check currently)
