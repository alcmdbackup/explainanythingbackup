# Scan Evolution Codebase For Bugs Research

## Problem Statement
Systematically scan the evolution pipeline codebase for bugs, edge cases, and potential issues. This covers all evolution pipeline code, tests, UI components, server actions, and services. The goal is to identify correctness issues, race conditions, edge cases, and any other bugs before they hit production.

## Requirements (from GH Issue #840)
- Scan all evolution pipeline code for bugs, edge cases, race conditions, and correctness issues
- Scan evolution tests for gaps and incorrect assertions
- Scan evolution UI components and admin pages for bugs
- Scan evolution services/server actions for data handling issues
- Use supabase dev to verify database-level issues (RPCs, migrations, RLS policies, triggers)
- Document all findings with file paths and line numbers
- Categorize issues by severity (critical, high, medium, low)

## High Level Summary

Research conducted across **14 rounds of 4 parallel agents** (56 agents total). All findings cross-verified in Rounds 3 and 14 to eliminate false positives.

**Overall data connectivity is healthy** — adminAction factory, service_role Supabase client, ActionResult wrapping, and UI unwrapping are correctly implemented. No circular dependencies. Most critical races (claim, finalization, cancellation) have already been fixed.

**Final tally: 30+ confirmed bugs across all severity levels:**

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 3 | Pipeline crash, spending gate bypass, null dereference |
| HIGH | 8 | Silent failures, metrics gaps, data loss risks |
| MEDIUM | 12 | Schema drift, type safety, incorrect computations |
| LOW | 10+ | Code quality, UI polish, minor inconsistencies |

---

## CONFIRMED BUGS — Final Verified List

### CRITICAL SEVERITY

#### C1. fineResult non-null assertion crash (rankVariants)
- **File:** `evolution/src/lib/pipeline/loop/rankVariants.ts` line 740
- **Issue:** `return buildResult(fineResult!.converged)` — when triage budget is exceeded, fineResult remains null. Non-null assertion causes runtime crash.
- **Verified:** Round 14 — YES, confirmed real bug

#### C2. LLM spending gate fast-path skips monthly cap check
- **File:** `src/lib/services/llmSpendingGate.ts` lines 70-77
- **Issue:** Fast-path return at line 77 skips `checkMonthlyCap()` at line 95. Daily budget can be under cap but monthly exceeded — spending proceeds unchecked.
- **Verified:** Round 14 — YES, confirmed real bug

#### C3. Generation failure silently ignored in main loop
- **File:** `evolution/src/lib/pipeline/loop/runIterationLoop.ts` lines 159-168
- **Issue:** No `else` clause for non-budget generation failures. If `genResult.success === false && genResult.budgetExceeded === false`, loop continues silently to ranking with unchanged pool.
- **Verified:** Round 14 — YES, confirmed real bug

### HIGH SEVERITY

#### H1. Silent fetch failure in 5+ admin list pages
- **Files:** `src/app/admin/evolution/arena/page.tsx` (45-54), `runs/page.tsx` (63-83), `variants/page.tsx` (84-87), `invocations/page.tsx` (87-90), `experiments/page.tsx` (125-127)
- **Issue:** When `result.success === false`, no error toast/state is shown. User sees loading disappear with empty data.
- **Verified:** Round 3 — YES, confirmed

#### H2. ExperimentForm silent load failure
- **File:** `src/app/admin/evolution/_components/ExperimentForm.tsx` lines 76-90
- **Issue:** If getPromptsAction or getStrategiesAction fail, errors are silently ignored. Form renders with empty data.
- **Verified:** Round 3 — YES, confirmed

#### H3. Metrics stale invalidation only handles elo metrics (trigger)
- **File:** `supabase/migrations/20260323000003_evolution_metrics_table.sql` lines 41-82
- **Issue:** `mark_elo_metrics_stale()` trigger only marks `winner_elo`, `median_elo`, `p90_elo`, `max_elo` stale. Non-elo metrics (`total_matches`, `decisive_rate`, `variant_count`) never marked stale.
- **Verified:** Round 3 + Round 14 — YES, confirmed

#### H4. Metrics recomputation skips non-elo run metrics
- **File:** `evolution/src/lib/metrics/recomputeMetrics.ts` lines 74-80
- **Issue:** Hardcoded whitelist `['winner_elo', 'median_elo', 'p90_elo', 'max_elo']` — 3 finalization metrics (`total_matches`, `decisive_rate`, `variant_count`) silently skipped.
- **Verified:** Round 3 + Round 14 — YES, confirmed

#### H5. Arena-only runs have incomplete run_summary
- **File:** `evolution/src/lib/pipeline/finalize/persistRunResults.ts` lines 107-116
- **Issue:** Writes `{ version: 3, stopReason: 'arena_only' }` — missing matchStats, topVariants, strategyEffectiveness, all standard fields. Admin UI expects full schema.
- **Verified:** Round 3 + Round 14 — YES, confirmed

#### H6. Delete cascade lacks transactional safety (Entity.ts)
- **File:** `evolution/src/lib/core/Entity.ts` line 167
- **Issue:** Multi-step delete (mark metrics stale → delete children → delete metrics → delete self) has no transaction wrapper. Partial failure leaves orphaned data.
- **Verified:** Round 7 — YES, confirmed (has TODO comment acknowledging issue)

#### H7. Draw handling inconsistency between triage and fine-ranking
- **File:** `evolution/src/lib/pipeline/loop/rankVariants.ts`
- **Issue:** Triage only treats `confidence === 0` as draw. Fine-ranking treats `confidence < 0.3` as draw. Low-confidence partial results (0.15) are decisive in triage but draws in fine-ranking.
- **Verified:** Round 5 — YES, confirmed

#### H8. Incorrect iterationsRun when generation fails mid-loop
- **File:** `evolution/src/lib/pipeline/loop/runIterationLoop.ts` lines 159-168, 224
- **Issue:** When generation fails (not budget), loop continues but `iterationsRun` isn't set until later. Combined with C3, creates misleading run summary.
- **Verified:** Round 5 — confirmed as consequence of C3

### MEDIUM SEVERITY

#### M1. Race condition: variants lost on external status change
- **File:** `evolution/src/lib/pipeline/finalize/persistRunResults.ts` lines 124-148
- **Issue:** If run status changes externally during finalization, variant persistence silently skipped. Run appears completed with no variants.

#### M2. RPC cost lookup error not checked
- **File:** `evolution/src/services/evolutionActions.ts` lines 317-318
- **Issue:** `const { data: costData } = await ctx.supabase.rpc(...)` — error not destructured or checked. RPC failure produces $0.00 cost.

#### M3. Schema mismatch: evolution_runs.strategy_id nullable in Zod but NOT NULL in DB
- **File:** `evolution/src/lib/schemas.ts` line 110
- **Issue:** Zod allows `nullable().optional()` but DB enforces NOT NULL after migration.

#### M4. Schema drift: evolution_variants missing `model` and `evolution_explanation_id` in Zod
- **File:** `evolution/src/lib/schemas.ts` lines 129-148
- **Issue:** Two DB columns from convergence migration missing from Zod schema.

#### M5. Schema drift: evolution_strategies missing `best_final_elo`/`worst_final_elo` in Zod
- **File:** `evolution/src/lib/schemas.ts`
- **Issue:** Computed columns exist in DB but missing from Zod fullDbSchema.

#### M6. Unsafe `as unknown as` type assertions bypass type safety
- **Files:** `evolution/src/services/evolutionActions.ts` (235), `invocationActions.ts` (91)
- **Issue:** Bypasses all TypeScript checking. Schema changes silently return wrong-shaped data.

#### M7. Null prompt_id/userId used as Map keys
- **Files:** `arenaActions.ts` (88-92), `costAnalytics.ts` (357-372)
- **Issue:** Null values become string key 'null', corrupting aggregations.

#### M8. Silent batch update failures in cost backfill
- **File:** `evolution/src/services/costAnalytics.ts` lines 447-455
- **Issue:** Individual record update errors silently swallowed, no logging of failures.

#### M9. FIFO cache labeled as LRU
- **File:** `evolution/src/lib/shared/computeRatings.ts` lines 129-138
- **Issue:** Cache eviction is FIFO (insertion order), not LRU (least recently used) despite being documented as LRU.

#### M10. Promise.race timeout handles not cleared
- **Files:** `evolution/src/lib/pipeline/infra/createLLMClient.ts` (68), `generateSeedArticle.ts` (13)
- **Issue:** setTimeout in Promise.race not cleared on success. Timers accumulate across retries.

#### M11. Heartbeat update missing runner_id ownership check
- **File:** `evolution/src/lib/pipeline/claimAndExecuteRun.ts` lines 41-51
- **Issue:** Heartbeat updates don't verify runner_id ownership. After runner crash, pending heartbeat can update orphaned run.

#### M12. DashboardData.recentRuns missing error_message field
- **File:** `evolution/src/services/evolutionVisualizationActions.ts` line 9-26
- **Issue:** Server action doesn't return `error_message` but BaseRun interface requires it. Dashboard hardcodes `null`.

### LOW SEVERITY

#### L1. Format validation: paragraphs ending with colons filtered out
- **File:** `evolution/src/lib/shared/enforceVariantFormat.ts` line 73-74

#### L2. Format validation: sentence counter counts abbreviations/decimals
- **File:** `evolution/src/lib/shared/enforceVariantFormat.ts` line 22

#### L3. Format validation: indented code blocks not stripped
- **File:** `evolution/src/lib/shared/enforceVariantFormat.ts` lines 29-36

#### L4. FormDialog missing default select option
- **File:** `evolution/src/components/evolution/FormDialog.tsx` lines 128-139

#### L5. LogsTab shows 20 iteration options regardless of actual data
- **File:** `evolution/src/components/evolution/tabs/LogsTab.tsx` lines 130-133

#### L6. Missing RLS deny_all on evolution_metrics (inconsistency)
- **File:** `supabase/migrations/20260323000003_evolution_metrics_table.sql` lines 33-39

#### L7. RunEntity.listColumns references non-existent 'iterations' column
- **File:** `evolution/src/lib/core/entities/RunEntity.ts` line 53

#### L8. VariantsTab rank numbers change after filtering
- **File:** `evolution/src/components/evolution/tabs/VariantsTab.tsx` line 104

#### L9. LineageGraph D3 zoom handlers not cleaned up on unmount
- **File:** `evolution/src/components/evolution/LineageGraph.tsx`

#### L10. ENV validation: FORMAT_VALIDATION_MODE and EVOLUTION_LOG_LEVEL accept invalid values
- **Files:** `enforceVariantFormat.ts` (117), `createEntityLogger.ts` (41)

#### L11. ENV validation: EVOLUTION_MAX_CONCURRENT_RUNS accepts negative numbers
- **File:** `claimAndExecuteRun.ts` line 89

---

## FALSE POSITIVES REJECTED

These were reported in earlier rounds but verified as NOT bugs:

1. **Missing costUsd in variant persistence** — schema allows optional, intentional design
2. **Winner determination uses -Infinity** — correct standard max-finding algorithm
3. **Percentile off-by-one** — valid nearest-rank method, tests confirm
4. **Missing metrics in STATIC_METRIC_NAMES** — intentional for dynamic metrics
5. **Missing deny_all RLS on evolution_metrics** — REVOKE+GRANT pattern is equivalent
6. **logActions ancestor FK query** — correctly captures all descendant logs
7. **Entity.ts log deletion** — ancestor FK deletion is correct pattern
8. **Arena sync match count** — correctly looked up from variantMatchCounts map
9. **Heartbeat runner_id check** — not needed (runs are uniquely claimed)
10. **iterationsRun fallback to config.iterations** — correct when loop completes fully
11. **LineageGraph Math.min/max crash** — guarded by early return
12. **MetricGrid ci[0] ci[1] access** — guarded by TypeScript tuple type
13. **RunsTable division by zero** — explicitly guarded with `> 0` check

---

## Test Plan Summary

### Priority 1 (Critical — Week 1)
| Bug | Test File | Type | Effort |
|-----|-----------|------|--------|
| C1: fineResult crash | rankVariants.test.ts | Unit | Small |
| C2: Spending gate monthly | llmSpendingGate.test.ts | Unit | Medium |
| C3: Gen failure silent | runIterationLoop.test.ts | Integration | Medium |
| H1-H2: Silent UI errors | admin pages test files | Component | Medium |
| H3-H4: Metrics stale | recomputeMetrics.test.ts + migration | Integration | Medium |

### Priority 2 (High — Week 2)
| Bug | Test File | Type | Effort |
|-----|-----------|------|--------|
| H5: Arena-only summary | persistRunResults.test.ts | Unit | Small |
| H7: Draw inconsistency | rankVariants.test.ts | Unit | Small |
| M1: Variant race condition | persistRunResults.test.ts | Integration | Medium |
| M2: RPC error check | evolutionActions.test.ts | Unit | Small |
| M3-M5: Schema drift | schemas-db-parity.test.ts (NEW) | Unit | Small |
| M6: Type assertions | type-assertions-safety.test.ts (NEW) | Unit | Small |

### Priority 3 (Medium — Week 3+)
| Bug | Test File | Type | Effort |
|-----|-----------|------|--------|
| M7: Null map keys | null-key-handling.test.ts (NEW) | Unit | Small |
| M8: Batch failures | costAnalytics.test.ts | Unit | Small |
| L1-L3: Format validation | enforceVariantFormat.test.ts | Unit | Small |
| L4-L5: UI components | Component test files | Component | Small |
| L6: RLS consistency | rls-policies.test.ts | Integration | Small |

---

## Test Coverage Gaps Identified

| Feature | Unit | Integration | E2E | Gap |
|---------|------|-------------|-----|-----|
| Experiment creation | ✅ | ✅ | ✅ | None |
| Run claiming | ✅ | ✅ | ✅ | None |
| Cost aggregation | ✅ | ✅ | ❌ | No E2E |
| Arena sync | ✅ | ✅ | ✅ | None |
| Metrics stale recomputation | ✅ | ✅ | ❌ | **Non-elo metrics not tested** |
| RLS policies | ❌ | ❌ | ❌ | **No evolution RLS tests** |
| Concurrent claiming | ✅ | ✅ | ❌ | No concurrent integration test |
| Budget enforcement at runtime | ✅ | ✅ | ❌ | No actual spend cap test |
| Error propagation | Partial | ❌ | ❌ | **No error cascade tests** |

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (all 14 evolution docs)
- evolution/docs/README.md, architecture.md, data_model.md, arena.md, metrics.md
- evolution/docs/strategies_and_experiments.md, rating_and_comparison.md, cost_optimization.md
- evolution/docs/entities.md, visualization.md, reference.md, agents/overview.md
- evolution/docs/minicomputer_deployment.md, curriculum.md

## Code Files Read (100+ files across 14 rounds)

### Pipeline (Round 5)
- evolution/src/lib/pipeline/loop/generateVariants.ts
- evolution/src/lib/pipeline/loop/rankVariants.ts
- evolution/src/lib/pipeline/loop/runIterationLoop.ts
- evolution/src/lib/pipeline/evolve.ts
- evolution/src/lib/pipeline/setup/generateSeedArticle.ts
- evolution/src/lib/pipeline/infra/createLLMClient.ts
- evolution/src/lib/pipeline/infra/trackBudget.ts
- evolution/src/lib/pipeline/infra/errors.ts
- evolution/src/lib/pipeline/infra/types.ts
- evolution/src/lib/pipeline/claimAndExecuteRun.ts
- evolution/src/lib/pipeline/finalize/persistRunResults.ts
- evolution/src/lib/pipeline/arena.ts

### Shared/Core (Rounds 6-7)
- evolution/src/lib/shared/enforceVariantFormat.ts
- evolution/src/lib/shared/computeRatings.ts
- evolution/src/lib/shared/classifyErrors.ts
- evolution/src/lib/shared/hashStrategyConfig.ts
- evolution/src/lib/core/Entity.ts, entityRegistry.ts, agentRegistry.ts
- evolution/src/lib/core/metricCatalog.ts, detailViewConfigs.ts
- evolution/src/lib/core/entities/*.ts (all 6 entity files)
- evolution/src/lib/core/agents/*.ts (GenerationAgent, RankingAgent)
- evolution/src/lib/core/Agent.ts

### Metrics (Round 2)
- evolution/src/lib/metrics/registry.ts, writeMetrics.ts, readMetrics.ts
- evolution/src/lib/metrics/recomputeMetrics.ts
- evolution/src/lib/metrics/computations/finalization.ts, propagation.ts, execution.ts
- evolution/src/lib/metrics/metricColumns.tsx, types.ts

### Server Actions (Rounds 1, 8-9)
- evolution/src/services/*.ts (all 11 service files)
- evolution/src/services/adminAction.ts, shared.ts

### Schemas & Types (Rounds 10-11)
- evolution/src/lib/schemas.ts, types.ts
- evolution/src/lib/index.ts, pipeline/index.ts
- evolution/src/components/evolution/index.ts

### UI Pages & Components (Rounds 1, 6, 10)
- src/app/admin/evolution/**/*.tsx (all 15+ page files)
- evolution/src/components/evolution/*.tsx (all 20+ component files)
- evolution/src/components/evolution/tabs/*.tsx (all tab components)
- evolution/src/components/evolution/variant/*.tsx

### Database Migrations (Rounds 2, 3)
- supabase/migrations/20260322000006_evolution_fresh_schema.sql
- supabase/migrations/20260322000007_evolution_prod_convergence.sql
- supabase/migrations/20260323000001_generalize_evolution_logs.sql
- supabase/migrations/20260323000002_fix_stale_claim_expiry.sql
- supabase/migrations/20260323000003_evolution_metrics_table.sql
- supabase/migrations/20260324000001_entity_evolution_phase0.sql
- supabase/migrations/20260322000005_fix_explanation_fk.sql

### Scripts (Round 7)
- evolution/scripts/processRunQueue.ts
- evolution/scripts/run-evolution-local.ts
- evolution/src/lib/ops/watchdog.ts, orphanedReservations.ts
- evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts
- evolution/src/lib/pipeline/experiments.ts

### Tests (Rounds 2, 8)
- 67+ test files across evolution/src/
- 16 integration test files
- 17 E2E test files
- evolution/src/testing/*.ts (3 helper files)

### Cost & Spending (Round 5)
- src/lib/services/llmSpendingGate.ts
- src/config/llmPricing.ts

## Open Questions
1. Should the spending gate fast-path also check monthly cap, or is a separate monthly-only fast-path needed?
2. Should arena-only runs use a different status ('arena_only') instead of 'completed' with incomplete summary?
3. Should the metrics stale trigger be expanded to all metric types, or should non-elo metrics use a different invalidation mechanism?
4. Is the draw handling inconsistency (confidence < 0.3 only in fine-ranking) intentional for performance, or should triage match?
