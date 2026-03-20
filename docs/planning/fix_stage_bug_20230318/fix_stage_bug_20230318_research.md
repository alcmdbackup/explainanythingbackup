# Fix Stage Bug Research

## Problem Statement
The evolution V2 migration (20260315000001_evolution_v2.sql) was applied to the staging environment, but it recreated tables without all required columns and dropped tables that production code still references. The most visible error is `column evolution_variants.elo_attribution does not exist`, but there are additional broken references to dropped V1 tables throughout the codebase.

## Requirements (from GH Issue #734)
- Fix: `evolution_variants.elo_attribution` column does not exist in staging
- Fix: Code references to tables dropped by V2 migration:
  - `evolution_checkpoints` — referenced in test helpers and E2E specs
  - `evolution_agent_cost_baselines` — queried by `costEstimator.ts`
  - `evolution_run_agent_metrics` — queried by `experimentActions.ts`
  - `evolution_budget_events` — referenced in E2E test specs
- Full V2 cleanup: remove any other stale V1 references from codebase

## High Level Summary

The V2 migration is a **clean-slate rewrite** — it drops ALL 16 V1 tables and creates 10 new tables with simplified schema. The V2 pipeline (`evolution/src/lib/v2/`) is the **only active pipeline** — all 3 execution entry points (admin trigger, batch runner, minicomputer runner) use `executeV2Run()`. No V1 pipeline code runs in production.

The core issue is that **V1 admin UI and server action code** still reads from these tables and expects V1 columns that don't exist in V2. There are **two categories of fixes needed**:

1. **Schema fixes** — Add missing columns to V2 tables via new migration (columns that V1 UI code reads but V2 migration didn't include)
2. **Code fixes** — Update V1 server actions, test helpers, and UI code to work with V2 schema OR remove stale V1 code paths entirely

## Key Findings

### 1. V2 Migration Inventory (20260315000001_evolution_v2.sql)

**16 V1 tables DROPPED:** evolution_checkpoints, evolution_budget_events, evolution_agent_cost_baselines, evolution_run_agent_metrics, evolution_experiment_rounds, evolution_arena_comparisons, evolution_arena_elo, evolution_arena_entries, evolution_arena_topics, evolution_run_logs, evolution_agent_invocations, evolution_variants, evolution_batch_runs, evolution_experiments, evolution_runs, evolution_strategy_configs

**10 V2 tables CREATED:** evolution_strategy_configs, evolution_arena_topics, evolution_experiments, evolution_runs, evolution_variants, evolution_agent_invocations, evolution_run_logs, evolution_arena_entries, evolution_arena_comparisons, evolution_arena_batch_runs

**4 RPCs CREATED:** claim_evolution_run, update_strategy_aggregates, sync_to_arena, cancel_experiment

**RPCs from separate migrations (may be dropped by V2 CASCADE):** get_non_archived_runs, archive_experiment, unarchive_experiment, compute_run_variant_stats

### 2. Missing Columns — evolution_variants

| Column | Type | Added By | Used By | Impact |
|--------|------|----------|---------|--------|
| `elo_attribution` | JSONB | 20260226000001 | evolutionActions.ts:639, variantDetailActions.ts:88, VariantsTab.tsx, AttributionBadge.tsx, variants/page.tsx | **CRITICAL** — SELECT queries fail |
| `cost_usd` | NUMERIC | 20260205000002 | Cost attribution code | Column absent |

### 3. Missing Columns — evolution_agent_invocations

| Column | Type | Added By | Used By | Impact |
|--------|------|----------|---------|--------|
| `agent_attribution` | JSONB | 20260226000001 | evolutionVisualizationActions.ts:339,966 | **CRITICAL** — Timeline/invocation detail fail |
| UNIQUE(run_id, iteration, agent_name) | Constraint | V1 schema | Data integrity | Missing in V2 |

### 4. Missing Columns — evolution_runs

| Column | Type | Used By | Impact |
|--------|------|---------|--------|
| `phase` | TEXT | RunsTable.tsx:115, visualizationActions.ts:968 | **CRITICAL** — UI crash |
| `current_iteration` | INT | RunsTable.tsx:127, eloBudgetActions.ts:130 | **CRITICAL** — UI crash |
| `continuation_count` | INT | evolutionRunnerCore.ts:70 | **CRITICAL** — resume detection fails |
| `total_cost_usd` | NUMERIC | experimentActions.ts, eloBudgetActions.ts | Cost display broken |
| `estimated_cost_usd` | NUMERIC | costAnalyticsActions.ts:23 | Cost accuracy broken |
| `cost_estimate_detail` | JSONB | visualizationActions.ts:539 | Budget tab broken |
| `cost_prediction` | JSONB | visualizationActions.ts:539 | Budget tab broken |
| `source` | TEXT | Run origin tracking | Missing |
| `evolution_explanation_id` | UUID | Decoupled seed content | Missing |
| Status `paused` | CHECK | EvolutionStatusBadge.tsx, visualizationActions.ts | Status filtering broken |
| Status `continuation_pending` | CHECK | EvolutionStatusBadge.tsx, evolutionActions.ts:605 | Status filtering broken |

### 5. Missing Columns — evolution_experiments

| Column | Type | Used By | Impact |
|--------|------|---------|--------|
| `total_budget_usd` | NUMERIC | experimentActions.ts:123,155,390 | **CRITICAL** — experiment creation/display fails |
| `spent_usd` | NUMERIC | experimentActions.ts:124,155 | Budget tracking broken |
| `optimization_target` | TEXT | experimentActions.ts:122,389 | Experiment creation fails |
| `convergence_threshold` | NUMERIC | experimentActions.ts:125 | Display broken |
| `factor_definitions` | JSONB | experimentActions.ts:126,391, experimentReportPrompt.ts:31 | Creation/report fails |
| `design` | TEXT | experimentActions.ts:132,393 | Manual experiment flag missing |
| `results_summary` | JSONB | experimentActions.ts:129,317,334,337 | Report generation fails |
| `analysis_results` | JSONB | experimentActions.ts:133, experimentReportPrompt.ts:41-58 | Analysis display fails |
| `pre_archive_status` | TEXT | archive/unarchive RPCs | Unarchive broken |
| `error_message` | TEXT | experimentActions.ts | Error display broken |
| `completed_at` | TIMESTAMPTZ | E2E tests | Timing display broken |
| Status `pending` | CHECK | experimentActions.ts:27,388,432 | Status transitions fail |
| Status `failed` | CHECK | experimentActions.ts:27,112,191 | Status transitions fail |
| Status `analyzing` | CHECK | ExperimentDetailContent.tsx:14 | UI badge broken |

### 6. Missing Columns — evolution_strategy_configs

| Column | Type | Used By | Impact |
|--------|------|---------|--------|
| `elo_sum_sq_diff` | NUMERIC | update_strategy_aggregates RPC (Welford's algorithm) | stddev computation broken |

### 7. Dropped Tables Still Referenced in Code

| Table | Reference Location | Type | Graceful? |
|-------|-------------------|------|-----------|
| `evolution_agent_cost_baselines` | costEstimator.ts:97,382 | Production | YES — returns null, falls back to heuristic |
| `evolution_agent_cost_baselines` | llmClient.ts:27-37 | Production | YES — Promise.allSettled swallows errors |
| `evolution_run_agent_metrics` | experimentActions.ts:306-311 | Production | **NO** — unhandled error |
| `evolution_checkpoints` | evolution-test-helpers.ts:100,321-368 | Test | NO — cleanup/factory fail |
| `evolution_checkpoints` | admin-evolution-visualization.spec.ts:83,114 | E2E Test | NO — insert/delete fail |
| `evolution_checkpoints` | arena-actions.integration.test.ts:101 | Integration Test | NO — cleanup fails |
| `evolution_budget_events` | admin-budget-events.spec.ts:52,112,125 | E2E Test | PARTIAL — has if check |

### 8. Broken Server Action Queries (14 total)

| File | Action | Missing Column(s) |
|------|--------|-------------------|
| evolutionActions.ts:639 | listVariantsAction | `elo_attribution` |
| evolutionActions.ts:571 | getEvolutionRunLogsAction | Uses evolution_run_logs (exists in V2 ✓) |
| experimentActions.ts:99 | getExperimentStatusAction | `optimization_target`, `total_budget_usd`, `spent_usd`, `convergence_threshold`, `factor_definitions`, `results_summary`, `design`, `analysis_results` |
| experimentActions.ts:259 | getExperimentRunsAction | `total_cost_usd` |
| experimentActions.ts:302 | regenerateExperimentReportAction | `total_cost_usd`, queries `evolution_run_agent_metrics` |
| experimentActions.ts:563 | getExperimentMetricsAction | `total_cost_usd` |
| eloBudgetActions.ts:84 | getStrategyRunsAction | `total_cost_usd`, `current_iteration` |
| costAnalyticsActions.ts:23 | getStrategyAccuracyAction | `estimated_cost_usd`, `total_cost_usd` |
| visualizationActions.ts:539 | getEvolutionRunBudgetAction | `cost_estimate_detail`, `cost_prediction` |
| visualizationActions.ts:968 | getInvocationFullDetailAction | `phase` |
| arenaActions.ts:267+ | Multiple arena actions | Column names mostly match but some miss `total_cost_usd` |

### 9. V2 Pipeline Architecture

V2 is a clean rewrite in `evolution/src/lib/v2/` (33 files). Key differences from V1:
- **No checkpoint system** — runs are non-resumable, all pool in-memory
- **No elo attribution** — only final mu/sigma tracked, no per-variant creator attribution
- **No cost baselines** — hardcoded MODEL_PRICING dict in llm-client.ts
- **No budget events** — only total per-invocation cost tracking
- **Simplified phases** — no EXPANSION/COMPETITION distinction
- **V1 core utilities still reused**: rating.ts, comparison.ts, comparisonCache.ts, formatValidator.ts, textVariationFactory.ts

### 10. Stale V1 References (Low Priority)

| Reference | Status | Notes |
|-----------|--------|-------|
| `hall_of_fame` | Cleaned | Only in migrations |
| `content_evolution_` | Cleaned | Only in migrations |
| `calibration`/`tournament` agent names | Stale | Kept in AgentName type + UI detail components for historical run rendering |
| `budgetCaps` config field | Deprecated | @deprecated annotation, ignored at runtime |
| Checkpoint types in types.ts | Kept | Backward compat stubs with comments |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/entity_diagram.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/experimental_framework.md
- evolution/docs/evolution/curriculum.md
- evolution/docs/evolution/minicomputer_deployment.md
- evolution/docs/evolution/reference.md

## Code Files Read
- supabase/migrations/20260315000001_evolution_v2.sql — V2 migration (drops 16 tables, creates 10)
- supabase/migrations/20260318000001_evolution_readonly_select_policy.sql — RLS policies
- supabase/migrations/20260226000001_elo_attribution_columns.sql — Added elo_attribution/agent_attribution
- evolution/src/lib/v2/*.ts — All 33 V2 pipeline files
- evolution/src/services/evolutionActions.ts — Server actions with stale queries
- evolution/src/services/evolutionVisualizationActions.ts — Visualization actions with stale queries
- evolution/src/services/experimentActions.ts — Experiment actions with stale queries
- evolution/src/services/variantDetailActions.ts — Variant detail actions
- evolution/src/services/eloBudgetActions.ts — Strategy/budget actions
- evolution/src/services/costAnalyticsActions.ts — Cost analytics
- evolution/src/services/arenaActions.ts — Arena actions
- evolution/src/services/evolutionRunnerCore.ts — Runner core (uses V2 only)
- evolution/src/lib/core/costEstimator.ts — Cost estimation (references dropped baselines table)
- evolution/src/lib/core/llmClient.ts — LLM client (preloadOutputRatios)
- evolution/src/testing/evolution-test-helpers.ts — Test helpers with stale references
- evolution/src/experiments/evolution/experimentMetrics.ts — V2 metrics computation
- evolution/scripts/evolution-runner.ts — Batch runner (V2 only)
- src/app/api/evolution/run/route.ts — Admin trigger (V2 only)

## Open Questions
1. Should we add missing columns back to V2 schema (new migration) or update V1 UI code to not reference them?
2. For experiments: should the V1 experimentActions.ts be replaced entirely by the V2 experimentActionsV2.ts?
3. Which V1 server actions are still needed for the admin UI vs which have V2 replacements?
4. Should RPCs from separate migrations (get_non_archived_runs, archive_experiment, etc.) be re-created in a post-V2 migration?
