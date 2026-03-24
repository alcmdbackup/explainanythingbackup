# Ensure Detailed Logging Evolution Research

## Problem Statement
Ensure that all evolution entities — experiments, strategies, runs, and invocations — have as detailed logs as possible. PR #792 (evolution_logs_refactor_20260322) established the entity logger infrastructure, LogsTab UI, and denormalized evolution_logs table. This project builds on that foundation to maximize logging coverage and detail across the entire pipeline.

## Requirements (from GH Issue #798)
- Ensure all entities (experiments, strategies, runs, invocations) have maximally detailed logs
- Build on PR #792's EntityLogger infrastructure and evolution_logs table
- Cover all lifecycle events, state transitions, errors, and performance metrics at every entity level

## High Level Summary

12 research agents analyzed the entire evolution pipeline across 3 rounds. Current state: **52 structured EntityLogger calls**. Gaps: **~100+ missing log points** across 4 entity types, with the evolve phase having zero logging infrastructure.

### Current Logging Baseline (52 calls)

| File | info | warn | error | debug | Total |
|------|------|------|-------|-------|-------|
| claimAndExecuteRun.ts | 2 | 1 | 3 | 0 | 6 |
| buildRunContext.ts | 1 | 1 | 0 | 0 | 2 |
| runIterationLoop.ts | 1 | 2 | 0 | 0 | 3 |
| generateVariants.ts | 1 | 1 | 0 | 1 | 3 |
| rankVariants.ts | 3 | 0 | 0 | 0 | 3 |
| persistRunResults.ts | 1 | 5 | 1 | 0 | 7 |
| evolutionActions.ts | 1 | 1 | 0 | 0 | 2 |
| experimentActionsV2.ts | 2 | 1 | 0 | 0 | 3 |
| strategyRegistryActionsV2.ts | 3 | 0 | 0 | 0 | 3 |
| run-evolution-local.ts | 5 | 2 | 1 | 2 | 10 |
| costAnalytics.ts | 1 | 0 | 4 | 1 | 6 |
| Other (serverLogger, console) | 1 | 7+ | 1 | 0 | 9+ |

### Gap Analysis by Entity Type

#### RUN-LEVEL GAPS (~25 missing)
- **Status transitions**: `running` status set at line 170 of claimAndExecuteRun.ts — NOT logged
- **Config validation**: 7 validation errors in runIterationLoop.ts (lines 21-43) thrown with NO entity logging
- **Pool initialization**: Baseline variant creation and arena entry prepend — NOT logged
- **Per-iteration metrics**: Generated variant count, rating update count, match count delta, pool size — NOT logged
- **Winner selection**: mu/sigma values, tie-breaking decisions — NOT logged
- **Stop reasons**: Kill detected, convergence, budget exceeded — only set in stopReason, never logged
- **Claim phase**: Concurrent limit hit returns silently with no log

#### INVOCATION-LEVEL GAPS (~30+ missing) — CRITICAL
- **Generation phase**: Only 1 aggregated invocation per iteration for all 3 strategies; per-strategy LLM call details (prompt size, response quality, token counts, model) NOT logged
- **Ranking phase**: Only 1 aggregated invocation per iteration; individual comparisons (10-50+ per iteration) NOT logged; position bias detection, confidence scores, winner decisions invisible
- **Seed generation**: 2 LLM calls (title + article) in generateSeedArticle.ts have ZERO logging — no invocation records, no EntityLogger, no cost tracking
- **Evolve phase**: extractFeedback.ts has ZERO logging infrastructure — no logger parameter, no EntityLogger creation, no log calls whatsoever; 3-4 LLM calls per iteration completely invisible

#### EXPERIMENT-LEVEL GAPS (~10 missing)
- **Run linking**: addRunToExperimentAction has NO logging; addRunToExperiment in manageExperiments.ts creates runs silently
- **Status transitions**: Draft→Running transition (line 75-81 manageExperiments.ts) happens silently
- **Auto-completion**: Log says "checked" not "completed"; actual success/failure of RPC not logged
- **Batch creation**: Rollback on failure (lines 176-182 experimentActionsV2.ts) NOT logged
- **Config details**: Experiment creation logs generic "Experiment created" without name, promptId, or initial status

#### STRATEGY-LEVEL GAPS (~15 missing)
- **Config loading**: Strategy config fetch/validation in buildRunContext.ts uses console.warn instead of EntityLogger
- **Per-strategy performance**: strategyEffectiveness computed in persistRunResults.ts (lines 65-75) but NEVER logged
- **Winner attribution**: Winner variant's strategy NOT logged at finalization
- **Update/delete operations**: updateStrategyAction and deleteStrategyAction have NO logging
- **Per-strategy ranking**: Triage elimination/survival not broken down by strategy

### Cross-Cutting Gaps

#### Cost/Budget (CRITICAL)
- ZERO EntityLogger calls for reserve/spend/release events
- Budget overrun detection uses console.error only (trackBudget.ts:49-51)
- `evolution_budget_events` table was dropped in V2 migration, never recreated
- Invocation `execution_detail` JSONB column always null — could store cost breakdown
- No iteration-boundary budget snapshots

#### Arena/Comparisons
- Individual match results never logged (winner, confidence, position bias)
- Failed comparisons (confidence=0) silently discarded
- Arena sync decisions (which variants synced, match filtering) invisible
- Bias mitigation forward/reverse agreement never recorded
- Rating update deltas (old→new mu/sigma) not tracked

#### Error Paths (47 total found)
- 8 paths use EntityLogger ✅
- 11 paths use server logger only (not entity-aware) ⚠️
- 7 paths use console.warn/error only ❌
- 16 paths have NO logging at all ❌
- 5 paths have conditional/optional logging ⚠️

### Logger Threading Map

```
claimAndExecuteRun()
  → executePipeline()
    → buildRunContext() [CREATES run logger]
    → evolveArticle(options: { logger: runLogger })
      → createInvocation() [CREATES invocation ID]
      → createEntityLogger() [CREATES invocation logger]
      → generateVariants(logger?: invocationLogger)     ← receives logger
      → rankPool(logger?: invocationLogger)              ← receives logger
      → evolveVariants()                                 ← NO LOGGER PARAM
    → finalizeRun(logger?: runLogger)
      → createEntityLogger() [CREATES strategy logger]
      → createEntityLogger() [CREATES experiment logger]
      → syncToArena()                                    ← NO LOGGER (uses serverLogger)
```

**Functions needing logger param added:**
- `evolveVariants()` in extractFeedback.ts
- `generateSeedArticle()` in generateSeedArticle.ts
- `executeTriage()` in rankVariants.ts (internal)
- `executeFineRanking()` in rankVariants.ts (internal)
- `syncToArena()` in persistRunResults.ts
- `createCostTracker()` in trackBudget.ts (or log at call sites)

### Schema & UI Findings

**DB Schema**: No migration needed for basic logging — evolution_logs table supports all entity types, has JSONB context column, and indexes on all ancestor FKs.

**LogsTab UI gaps**:
- Missing filters: iteration, variantId, message text search, date range
- Backend (logActions.ts) already supports iteration filter but UI doesn't expose it
- Large context objects could cause performance issues with 10x more logs
- No virtual scrolling for large result sets

**Potential new dedicated columns** (optional optimization):
- `cost_usd` — denormalize from invocation for log-level cost analysis
- `pool_size` — INT for variant pool cardinality snapshots

## Round 2: Deep Dive Findings (16 additional agents)

### Function Signature Changes Required (13 functions verified)

| Function | File | Current Params | Add | Call Sites (main/test) |
|----------|------|---------------|-----|----------------------|
| evolveVariants() | extractFeedback.ts | pool, ratings, iteration, llm, config, options? | logger?: EntityLogger | 0/11 |
| generateSeedArticle() | generateSeedArticle.ts | promptText, llm | logger?: EntityLogger | 1/6 |
| executeTriage() | rankVariants.ts | pool, ratings, matchCounts, newEntrantIds, config, callLLM, cache? | logger?: EntityLogger | 1/0 (internal) |
| executeFineRanking() | rankVariants.ts | pool, ratings, matchCounts, eliminatedIds, config, callLLM, maxComparisons, cache? | logger?: EntityLogger | 1/0 (internal) |
| makeCompareCallback() | rankVariants.ts | llm, config, errorCounter? | logger?: EntityLogger | 1/0 (internal) |
| runComparison() | rankVariants.ts | textA, textB, idA, idB, callLLM, config, cache? | logger?: EntityLogger | 2/0 (internal) |
| compareWithBiasMitigation() | computeRatings.ts | textA, textB, callLLM, cache? | logger?: EntityLogger | 1/17 |
| createCostTracker() | trackBudget.ts | budgetUsd | logger?: EntityLogger | 1/26 |
| createV2LLMClient() | createLLMClient.ts | rawProvider, costTracker, defaultModel | logger?: EntityLogger | 1/12 |
| createInvocation() | trackInvocations.ts | db, runId, iteration, phaseName, executionOrder | logger?: EntityLogger | 2/2 |
| updateInvocation() | trackInvocations.ts | db, id, updates | logger?: EntityLogger | 3/4 |
| syncToArena() | persistRunResults.ts | runId, promptId, pool, ratings, matchHistory, supabase | logger?: EntityLogger | 1/8 |
| resolveContent() | buildRunContext.ts | run, db, llm | logger?: EntityLogger | 1/0 (internal) |

### Log Volume Analysis (5-iteration run, 3 strategies)

| Category | Current | Proposed | Level |
|----------|---------|----------|-------|
| Iteration lifecycle | 5 | 5 | info |
| Generation details | 20 | 50 | info/debug |
| Triage comparisons | 0 | 75 | debug |
| Fine-ranking comparisons | 0 | 125 | debug |
| Rating updates | 0 | 60 | debug |
| Budget/cost tracking | 0 | 15 | info/debug |
| Convergence/pool stats | 0 | 10 | debug |
| Error/retry | ~1 | 3 | warn/error |
| Invocation tracking | 0 | 20 | info/debug |
| Finalization | 7 | 7 | mixed |
| **TOTAL** | **~52** | **~370** | **7.1× increase** |

- DB writes: ~57 KB/run → ~407 KB/run (well within limits)
- Pipeline latency overhead: <0.2 ms (negligible)
- Storage: ~101 MB/day at 10 runs/day

### Optional Batching Design

A `BatchEntityLogger` can buffer logs and flush every 5s or 50 items. Uses Supabase `.insert([...rows])` (confirmed supported). Backward-compatible via optional `flush?()` method on EntityLogger interface. Recommended only if >10 parallel runs expected.

### Migration Assessment

- **No new columns needed** — cost_usd, pool_size, confidence stay in context JSONB
- **3 new indexes recommended**: idx_logs_experiment_iteration, idx_logs_strategy_iteration, idx_logs_entity_level
- **Zod schema update needed**: Add entity_type, entity_id, experiment_id, strategy_id to evolutionRunLogInsertSchema

### UI Filter Additions (LogsTab.tsx)

- Add iteration dropdown (1-20)
- Add phase name dropdown (generation, ranking, finalize, arena, setup, evolution, compare)
- Add message text search (debounced)
- Add variantId filter (1 line server change + text input)
- Layout: 2-row filter bar (existing flex-wrap handles responsiveness)

### Test Coverage Assessment

- **Phase-level logging**: 0% coverage (CRITICAL gap)
- **Logger parameter propagation**: 0% (tests never pass logger to generateVariants/rankPool)
- **Integration (full pipeline logging)**: 0%
- **Message content verification**: 0%
- **New tests needed**: ~54 test cases across 14 test files
- **Mock helper needed**: createMockEntityLogger() with call capture in evolution-test-helpers.ts

### Additional Gaps Found (Final Sweep)

| Gap | File | Line(s) | Severity |
|-----|------|---------|----------|
| LLM errors silently swallowed in compare callback | rankVariants.ts | 166-170 | HIGH |
| Promise rejections silently dropped in generation | generateVariants.ts | 87-89 | MEDIUM |
| Heartbeat lifecycle (create/clear) not logged | claimAndExecuteRun.ts | 38-49, 147 | LOW |
| Retry delay not logged before arena sync retry | persistRunResults.ts | 310 | LOW |
| get_run_total_cost RPC call not logged | evolutionActions.ts | 285 | LOW |

### Documentation Gaps

- **data_model.md**: Table schema OUTDATED — missing entity_type, entity_id, experiment_id, strategy_id columns; run_id shown as NOT NULL but is now NULLABLE
- **architecture.md**: phaseName→agent_name column mapping not explained
- **evolution_logging.md**: Missing actual phaseName values used, missing complete table schema

## Implementation Scope Summary

| Phase | Files | Logger Calls | Sig Changes | Tests | LOC |
|-------|-------|-------------|-------------|-------|-----|
| 1: Run-level logging | 2 | ~15 | 0 | +5 | 80-100 |
| 2: Invocation-level (gen+rank internals) | 4 | ~35 | 4 | +23 | 150-200 |
| 3: Experiment + Strategy services | 3 | ~25 | 0 | +8 | 100-120 |
| 4: Cost tracker + LLM client | 3 | ~20 | 1 | +8 | 100-120 |
| 5: UI filters + migration | 2 | 0 | 0 | +2 | 100-150 |
| 6: Optional batching | 1 | 0 | 0 | +8 | 100-150 |
| **TOTAL** | **~17** | **~100+** | **6** | **~54** | **~630-840** |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/reference.md

### PR #792 Context
- PR files: 36 changed files establishing EntityLogger, LogsTab, logActions, denormalized evolution_logs

## Code Files Read

### Pipeline Core
- evolution/src/lib/pipeline/claimAndExecuteRun.ts
- evolution/src/lib/pipeline/setup/buildRunContext.ts
- evolution/src/lib/pipeline/setup/generateSeedArticle.ts
- evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts
- evolution/src/lib/pipeline/loop/runIterationLoop.ts
- evolution/src/lib/pipeline/loop/generateVariants.ts
- evolution/src/lib/pipeline/loop/rankVariants.ts
- evolution/src/lib/pipeline/loop/extractFeedback.ts
- evolution/src/lib/pipeline/loop/buildPrompts.ts
- evolution/src/lib/pipeline/finalize/persistRunResults.ts

### Infrastructure
- evolution/src/lib/pipeline/infra/createEntityLogger.ts
- evolution/src/lib/pipeline/infra/trackInvocations.ts
- evolution/src/lib/pipeline/infra/trackBudget.ts
- evolution/src/lib/pipeline/infra/createLLMClient.ts
- evolution/src/lib/pipeline/infra/types.ts
- evolution/src/lib/pipeline/infra/errors.ts
- evolution/src/lib/pipeline/manageExperiments.ts

### Shared
- evolution/src/lib/shared/computeRatings.ts

### Services
- evolution/src/services/evolutionActions.ts
- evolution/src/services/experimentActionsV2.ts
- evolution/src/services/strategyRegistryActionsV2.ts
- evolution/src/services/arenaActions.ts
- evolution/src/services/logActions.ts
- evolution/src/services/costAnalytics.ts

### UI
- evolution/src/components/evolution/tabs/LogsTab.tsx

### Tests
- evolution/src/lib/pipeline/infra/createEntityLogger.test.ts
- evolution/src/services/logActions.test.ts
- evolution/src/lib/pipeline/loop/runIterationLoop.test.ts
- evolution/src/components/evolution/tabs/LogsTab.test.ts
- evolution/src/lib/pipeline/loop/generateVariants.test.ts
- evolution/src/lib/pipeline/loop/rankVariants.test.ts
- evolution/src/lib/pipeline/loop/extractFeedback.test.ts
- evolution/src/lib/pipeline/infra/trackBudget.test.ts
- evolution/src/lib/pipeline/infra/createLLMClient.test.ts
- evolution/src/lib/pipeline/infra/trackInvocations.test.ts
- evolution/src/lib/pipeline/finalize/persistRunResults.test.ts
- evolution/src/lib/shared/computeRatings.comparison.test.ts
- evolution/src/testing/evolution-test-helpers.ts

### Schema & Migrations
- evolution/src/lib/schemas.ts
- supabase/migrations/20260323000001_generalize_evolution_logs.sql
- supabase/migrations/20260322000006_evolution_fresh_schema.sql
- supabase/migrations/20260322000007_evolution_prod_convergence.sql

## Open Questions
1. Should per-comparison logs (200+ per run) use `debug` level exclusively, or should some high-value comparisons (triage eliminations, convergence signals) be `info`?
2. Should we implement batching from day 1, or start with fire-and-forget and add batching later if needed?
3. How aggressive should budget threshold logging be? (50%/80% thresholds, or just on exceeded?)
4. Should the LogsTab show iteration and variant_id as visible columns in the table, or only as filters?
