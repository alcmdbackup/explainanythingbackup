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

## Phase Walkthrough (Detailed Threat Analysis)

### Phase 1: selectWinner extraction + property-based tests

**selectWinner divergence:** Winner determination exists in two places with divergent semantics for unrated variants:
- `runIterationLoop.ts:250` — `if (!r) continue` — SKIPS unrated
- `persistRunResults.ts:156` — `r?.mu ?? -Infinity` — INCLUDES as worst

In normal operation both produce the same winner. But if any variant lacks a rating, the loop winner can differ from the finalization winner. The DB stores a different winner than what the loop used for further evolution. Silent correctness bug, no error thrown.

**Rating property tests protect against:**
- Sigma not decreasing (convergence detection fails, loop never terminates via convergence)
- NaN/Infinity outputs (propagates through entire pool, corrupts all ratings)
- Draw asymmetry (position bias leaks into rating system)
- Elo scale non-monotonicity (leaderboard display contradicts internal ranking)

**Budget property tests protect against:**
- Core invariant violation (`totalSpent + totalReserved > budgetUsd`) allowing overspend
- Reserve margin drift (constant changed, under/over-budgeting)
- Reserve-spend accounting mismatch (available budget diverges from reality)

### Phase 2: DB constraints

**Status enum CHECKs protect against:**
- Direct DB writes bypassing Zod (batch runner, RPCs, migrations)
- RPC-level typos (`'completd'` accepted, run becomes invisible to claim system)
- Migration accidents writing cross-table status values (`'archived'` on runs)

**config_hash UNIQUE protects against:**
- `ON CONFLICT` upsert degrading to plain INSERT (no actual unique index to detect conflict)
- Duplicate strategy rows splitting aggregate metrics
- Experiment comparison becoming meaningless

### Phase 3: Format validator tests + budget assertions

**Format property tests protect against:**
- `stripCodeBlocks` leaving partial fence markers (validator sees different text than pool)
- Over-aggressive regex stripping legitimate content
- Bullet detection regression (LLM outputs with bullets enter pool, render broken on frontend)
- `extractParagraphs` leaking headings into sentence count (false rejections of good variants)

**Budget assertions protect against:**
- `totalReserved` going negative from double-release (silent, available budget wrong)
- `totalSpent` becoming NaN from malformed API response (budget check stops working entirely, unbounded spend until global gate catches it)
- Reserve-spend mismatch from caller storing wrong value (accounting drift across iterations)

### Phase 4: Branded types (optional)

**ValidatedArticle protects against:**
- New code paths that skip validation (compiler refuses to build)
- Refactoring that moves validation after pool insertion (compilation fails)

**RatedVariant protects against:**
- Unrated variants reaching finalization with phantom DEFAULT_MU ratings
- Arena entries synced with uncalibrated defaults (Elo 1200 imposters)
- Median/p90 metrics skewed by phantom fallback values
- Inconsistent unrated-handling policy across ~20 call sites

## Validation Audit: Top 10 Highest-Risk Gaps

Verified against actual code. Risk = Likelihood × Impact × (1/Detectability).

| Rank | Gap | Location | Likelihood | Impact | Detectability | Description |
|------|-----|----------|-----------|--------|---------------|-------------|
| 1 | execution_detail from DB unvalidated | `persistRunResults.ts:235` | LIKELY | CRITICAL | VERY LOW | Loaded as `unknown`, passed to metrics compute without safeParse. Wrong metric values cascade to strategy/experiment aggregations permanently. |
| 2 | RPC response casting | `claimAndExecuteRun.ts:112` | CERTAIN | CRITICAL | EVENTUAL | `as unknown as ClaimedRun[]` — zero validation. If RPC shape changes, `budget_cap_usd` becomes NaN, fallback `|| 1.0` fires → wrong budget. |
| 3 | Arena entry mu/sigma unvalidated | `buildRunContext.ts:53-69` | LIKELY | HIGH | EVENTUAL | `entry.mu ?? DEFAULT_MU` — `??` doesn't catch NaN (NaN is not nullish). NaN enters ratings map → all ranking is garbage. |
| 4 | resolveContent `as string` cast | `buildRunContext.ts:111-112` | LIKELY | HIGH | HIGH | If DB column is null, JS produces string `"null"` — LLM generates article about the word "null", burning budget. |
| 5 | Agent detail validation warn-only | `Agent.ts:36-42` | LIKELY (on refactor) | MEDIUM | LOW | `safeParse` fails → logs warning → continues writing invalid detail to DB → feeds gap #1. |
| 6 | syncToArena trusts pool/ratings | `persistRunResults.ts:429-435` | POSSIBLE | MEDIUM-HIGH | MEDIUM | Corrupt data from gaps #3/#5 written atomically to arena — persists across runs. |
| 7 | createCostTracker accepts negative budget | `trackBudget.ts:27` | POSSIBLE | MEDIUM | EVENTUAL | No check `budgetUsd > 0`. If gap #2 produces NaN → `reserve()` never throws → no budget limit. |
| 8 | writeMetric accepts NaN/Infinity | `writeMetrics.ts:100` | POSSIBLE | MEDIUM | MEDIUM | NaN persists to `evolution_metrics` → breaks aggregate queries and admin UI. |
| 9 | rankPool no variant structure check | `rankVariants.ts:651` | UNLIKELY | HIGH | IMMEDIATE | Low likelihood (pool built internally), but crash is actually the best failure mode (loud). |
| 10 | config_hash no UNIQUE constraint | DB schema | POSSIBLE | LOW | HIGH | `ON CONFLICT` upsert needs unique index. Without it, duplicates accumulate. Cosmetic impact. |

**Cascade chains identified:**
- Gaps #2 → #7: Corrupt RPC → bad budget → unlimited spend
- Gaps #3 → #6: Corrupt arena mu → NaN ratings → corrupt arena sync
- Gaps #5 → #1: Invalid agent detail → corrupt DB detail → wrong metrics

### Systemic Patterns

**DB reads are not validated:** 23 unvalidated Supabase `.select()` responses found across pipeline, metrics, core, and service layers. Common patterns:
- `as string` casts on DB fields (8 critical instances in `evolutionActions.ts`, `buildRunContext.ts`)
- `as unknown as Type[]` double casts bypassing type safety (`Entity.ts:185,238`, `claimAndExecuteRun.ts:112`)
- `?? DEFAULT` fallbacks that hide missing/null columns (`loadArenaEntries`, `recomputeMetrics.ts`)
- RPC response shapes assumed without schema validation (5 RPC calls in `persistRunResults.ts`)
- Only 3 places follow the good pattern: `run_summary` safeParse, strategy config safeParse, variant insert `.parse()`

**Pure functions are TS-only:** Rating math, format helpers, budget operations — all rely purely on TypeScript types. No runtime input checks. Fine for internal calls, but a bug in the caller propagates silently through the entire computation chain.

**LLM outputs are partially validated:**
- Generated/evolved variant text → `validateFormat()` ✅
- Seed article content → **NOT validated** ❌ (critical gap: all evolution iterations build on potentially malformed seed)
- Judge comparison responses → `parseWinner()` degrades gracefully (returns null/TIE, low confidence)
- LLM client returns raw `string` with zero shape validation

### Systemic `??` vs NaN Problem (New Finding)

The arena mu/sigma gap (#3) is one instance of a systemic pattern. JavaScript's `??` (nullish coalescing) only catches `null`/`undefined`, NOT `NaN`. Every `?? DEFAULT` fallback on a numeric DB field is a potential NaN passthrough. Confirmed instances:
- `buildRunContext.ts:53-69` — `entry.mu ?? DEFAULT_MU` (arena entries)
- `recomputeMetrics.ts:63` — `v.mu ?? DEFAULT_MU`, `v.sigma ?? DEFAULT_MU / 3` (stale recompute)
- `manageExperiments.ts:133` — `variants?.[0]?.elo_score ?? null` (experiment metrics)
- `evolutionActions.ts:324` — `Number(r.cost_usd ?? 0)` (cost aggregation)

If any of these DB columns contain `NaN` (from upstream corruption), the fallback doesn't fire and NaN propagates into rating math, metrics, or cost totals.

### Entity.ts Double-Cast Pattern (New Finding)

`Entity.ts` lines 185 and 238 use `as unknown as Record<string, unknown>` — a double cast that completely bypasses TypeScript's type system. This is the generic CRUD layer used by all 6 entity subclasses (Run, Strategy, Experiment, Variant, Invocation, Prompt). Every entity list and detail page in the admin UI flows through this path. If any entity table's schema drifts from the TS type (column renamed in migration), the failure is silent — the UI renders `undefined` or blank fields with no error.

### LLM Client Returns Unvalidated Strings (New Finding)

`createLLMClient.ts` returns `Promise<string>` with no validation that the response is non-empty, doesn't contain error messages, or isn't truncated. Every LLM interaction (generation, comparison, seed) receives this raw string. Downstream consumers handle garbage gracefully:
- `validateFormat()` rejects malformed generation output
- `parseWinner()` returns null for unparseable comparison responses
- `aggregateWinners()` degrades to low confidence

But there's no early detection point. A completely broken LLM response (empty string, HTML error page, API error message in the response body) flows through the entire pipeline before being silently discarded or producing a 0-confidence comparison. Adding a basic non-empty + no-HTML guard at the client boundary would catch these immediately.

### Seed Article Validation Gap (New Finding)

`generateSeedArticle.ts:110` — after LLM generates article content, it is concatenated into the seed variant as `# ${title}\n\n${articleContent}` without calling `validateFormat()`. Every other LLM text output goes through format validation, but the seed (the starting point for the entire run) skips it. A malformed seed (e.g., containing bullets, no section headings) propagates through all iterations as the baseline variant.

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
