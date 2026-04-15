# Cost Estimate Accuracy Analysis Research

## Problem Statement
Help me systematically estimate the accuracy of my cost estimates, since these feed into our "budget floor" parameters that control sequential vs. parallel generation. Help suggest areas for improvement if needed.

## Requirements (from GH Issue #973)
- Make sure in run level UI in evolution admin dashboard, there is a cost estimates tab that systematically lets me evaluate cost estimation accuracy for a run. Also add this tab at the strategies entity in evolution admin dashboard. Use standard metrics plumbing @evolution/docs/metrics.md to see how to implement and @evolution/docs/visualization.md also

## High Level Summary

The evolution pipeline already has meaningful but partial cost-estimation instrumentation (landed ~Apr 11, 2026 in the `better_cost_estimation_reservation` project). `generateFromSeedArticle` invocations record `generation.estimatedCost`, `ranking.estimatedCost`, `estimatedTotalCost`, and `estimationErrorPct` in `execution_detail` JSONB; a run-level `cost_estimation_error_pct` metric aggregates those into `evolution_metrics`. **Nothing surfaces this in the admin UI today.** No strategy/experiment propagation exists, and Swiss/Merge/Seed agents record no estimate data at all.

Budget-floor parameters (`minBudgetAfter{Parallel,Sequential}{Fraction,AgentMultiple}`) derive dispatch counts directly from `estimateAgentCost()`. AgentMultiple mode is most sensitive to estimation drift — miscalibration multiplies into sequential-vs-parallel decisions.

Proposed scope: (1) add run-level + propagated strategy metrics for estimate totals, absolute error, and per-phase error; (2) build a reusable `CostEstimatesTab` component wired into the run and strategy detail pages; (3) ship calibration recommendations based on observed drift.

## Key Findings

### Estimation code paths
- `evolution/src/lib/pipeline/infra/estimateCosts.ts:10-97` — empirical per-strategy output chars (`EMPIRICAL_OUTPUT_CHARS`: `grounding_enhance` 11799, `structural_transform` 9956, `lexical_simplify` 5836, default 9197). Covers only 3 of 8 strategies; 5 extended strategies use default.
- `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts:32-35` — `OUTPUT_TOKEN_ESTIMATES` = {generation: 1000, ranking: 100}, fixed, model-agnostic; 4 chars/token.
- `evolution/src/lib/pipeline/infra/trackBudget.ts:54` — `RESERVE_MARGIN` = 1.3 (hardcoded).
- Callers: `generateFromSeedArticle.ts:253-289` (records `estimationErrorPct`), `runIterationLoop.ts:248-289,395-422` (parallel/sequential dispatch), `strategyPreviewActions.ts:42-81` (UI preview).

### Actual-cost recording paths
- `evolution_agent_invocations.cost_usd` — per-invocation ground truth, written by `Agent.run()` via `updateInvocation()`.
- `evolution_metrics` rows with `metric_name ∈ {cost, generation_cost, ranking_cost, seed_cost}` — live, via `writeMetricMax` after every LLM call in `createEvolutionLLMClient.ts`.
- `execution_detail` JSONB for GFSA: `generation.cost`, `ranking.cost`, `estimatedTotalCost`, `estimationErrorPct` (`evolution/src/lib/schemas.ts:840-872`).
- Swiss/Merge agents: actual cost only, no estimate fields in their execution_detail schemas.
- `CreateSeedArticleAgent`: no pre-call estimate; seed-label LLM calls fall back to generic 1000-token reservation.

### Existing finalization metric
- `cost_estimation_error_pct` registered at `registry.ts:112-113` (category `cost`, timing `atFinalization`, formatter `percent`).
- `computeCostEstimationErrorPct()` at `finalization.ts:90-101` returns a bare mean of `estimationErrorPct` across GFSA invocations. No CI/uncertainty populated, `listView` defaults to false.
- Not in `SHARED_PROPAGATION_DEFS` → no strategy/experiment rollup.
- No UI surface today: `detailViewConfigs.ts` renders only actual costs; no "Cost" or "Estimates" tab exists.

### Budget-floor sensitivity
- Schema + resolvers: `schemas.ts:320-422`, `pipeline/loop/budgetFloorResolvers.ts`, `runIterationLoop.ts:254-289,395-422`.
- Two unit modes per phase: `*Fraction` (fraction of budget) and `*AgentMultiple` (multiple of `estimateAgentCost`).
- AgentMultiple is the high-risk mode: +/-20% estimation drift → +/-20% dispatch-count drift after the 1.3× margin compounds.
- Sequential phase self-heals via `actualAvgCostPerAgent` feedback from the parallel batch (`runIterationLoop.ts:494-505`), but this runtime value is never persisted — so post-hoc analysis can't see it.

### Metrics + UI plumbing
- Adding a metric: declare in `METRIC_REGISTRY` (`registry.ts`), add compute fn in `metrics/computations/{execution,finalization,propagation}.ts`, optionally add propagation entry in `SHARED_PROPAGATION_DEFS`, keep `entityRegistry.ts` in sync (dual registry note in `metrics.md`), add test in `*.test.ts`.
- Writers: `writeMetric` (normal upsert) vs `writeMetricMax` (GREATEST for race-safe monotonic cost writes).
- Run detail tabs declared in `src/app/admin/evolution/runs/[runId]/page.tsx:28-36` (Timeline, Metrics, Elo, Lineage, Variants, Snapshots, Logs) via `TABS: TabDef[]` + `useTabState` + `EntityDetailTabs`.
- Strategy detail tabs: `src/app/admin/evolution/strategies/[strategyId]/page.tsx:51-56` (Metrics, Runs, Configuration, Logs).
- Reusable pieces: `EntityMetricsTab.tsx` (generic), `MetricGrid`, `SnapshotsTab.tsx` (good precedent for mixed summary+table tab).
- Existing cost service: `evolution/src/services/costAnalytics.ts` — global LLM cost dashboard (queries `llmCallTracking`, not evolution-specific). Recommend **extend** (not fork) or create a sibling `costEstimationActions.ts` colocated alongside it.

### Historical data availability
- Instrumentation landed 2026-04-11 (`generation.estimatedCost` etc. added to schema). Today is 2026-04-14 → ~3 days of signal.
- Pre-Apr-11 runs: `cost_estimation_error_pct` metric absent (not `stale`, simply not written).
- No backfill script.
- Recommendation: start surfacing today's signal; plan to re-evaluate calibration after ~14 days of accumulated runs.

### Edge cases
1. **Partial runs** (budget-exceeded mid-phase): generation recorded but ranking missing → `estimationErrorPct` null. Tab must distinguish "partial" from "on-target".
2. **Pre-instrumentation runs**: metric row absent. Tab: render "No data (pre-instrumentation)" badge.
3. **Small samples**: `bootstrapMeanCI` needs n ≥ 2; with n=1 show value only, no bounds.
4. **Swiss/Merge-only iterations**: never have GFSA invocations → metric null. Tab: "Not applicable (ranking-only)".
5. **Zero estimate**: `generateFromSeedArticle.ts:262-264` guards with ternary (returns 0 if est=0). Asymmetry: can't detect overrun when estimate was 0.
6. **Stale cascade**: `mark_elo_metrics_stale` trigger fires on variant `mu`/`sigma` change — verify trigger doesn't false-positive on cost metrics (they depend only on invocation `execution_detail`, not variant ratings).
7. **Legacy `execution_detail` shapes**: schema marks `estimatedCost` optional; `safeParse` tolerates missing fields; compute fn already guards `typeof === 'number' && isFinite()`.

### Proposed tab layout

**Run detail → Cost Estimates tab**:
1. Summary `MetricGrid` card: Total Cost | Generation Cost | Ranking Cost | Seed Cost | Estimation Error % (color-coded).
2. Per-invocation table: Agent, Iteration, Gen Est, Gen Actual, Gen Error%, Rank Est, Rank Actual, Rank Error%, Total — sortable by |error%|.
3. Error distribution histogram (buckets: <-25%, -25–-5%, -5–+5%, +5–+25%, >+25%).
4. Budget-floor impact card: show resolved `parallelFloor` / `sequentialFloor`, `actualAvgCostPerAgent` if captured, and what dispatch count the floor reserved vs. what was used.

**Strategy detail → Cost Estimates tab**:
1. Aggregate card: runs count, `avg_cost_estimation_error_pct` (propagated, bootstrap CI), avg per-phase costs.
2. Per-strategy-slice breakdown: rows per `generationModel` × `judgeModel` × strategy-label combination from invocation history.
3. Error histogram across all runs using this strategy.
4. Per-run table with drill-down links to `/admin/evolution/runs/{id}?tab=cost-estimates`.

### Proposed new metrics
- Run-level (finalization): `estimated_cost` (sum of `estimatedTotalCost` across GFSA invocations), `generation_estimation_error_pct`, `ranking_estimation_error_pct`, `estimation_abs_error_usd`.
- Propagation (strategy + experiment, via `SHARED_PROPAGATION_DEFS`): `avg_cost_estimation_error_pct` (bootstrap_mean), `avg_estimated_cost` (avg), plus per-phase variants.
- `cost_estimation_error_pct` already exists — add it to `SHARED_PROPAGATION_DEFS` with `aggregateBootstrapMean` so strategy/experiment pages can show aggregated accuracy with CI.

### New server actions (proposed)
- `getRunCostEstimatesAction(runId)` — reads `evolution_agent_invocations` JSONB + run metrics; returns summary + per-invocation rows.
- `getStrategyCostEstimatesAction(strategyId)` — reads propagated metrics + child run list; returns aggregate + histogram + per-run rows.
- Naming: colocate in a new `evolution/src/services/costEstimationActions.ts` (parallel to `costAnalytics.ts`); follows `adminAction` factory pattern.

### Calibration improvement recommendations (ranked by value/effort)

| Rank | Change | Impact | Effort | Confirmation |
|------|--------|--------|--------|--------------|
| 1 | Expand `EMPIRICAL_OUTPUT_CHARS` to all 8 strategies (or DB-backed, weekly refresh) | 5 of 8 strategies today use DEFAULT → 10–15% per-strategy drift | Low (aggregate query over `execution_detail`) | Per-strategy `avg_cost_estimation_error_pct` drops ≥25% |
| 2 | Add estimation for `CreateSeedArticleAgent` (seed_title + seed_article) | Seed-phase cost is blind today; generic 1000-token fallback | Low (mirror `estimateGenerationCost`) | `seed_cost` forecast error <10% |
| 3 | Make `OUTPUT_TOKEN_ESTIMATES` strategy- AND model-aware | Fixes per-call reservation drift driving BudgetExceeded warnings | Medium (schema + lookup table) | Overrun log frequency drops; reserved-vs-actual ratio improves |
| 4 | Per-(strategy × model) calibration table refreshed nightly from `execution_detail` | Continuous self-improvement; closes loop | Medium (cron + cached lookup) | Mean per-slice error <5% |
| 5 | Dynamic `RESERVE_MARGIN` per model (raise on overrun, lower on consistently low actual) | Reduces over-reservation waste | Medium | Reserved-vs-actual ratio rises from ~0.7 to ~0.85 |
| 6 | EMA feedback of `estimationErrorPct` into future estimates (α=0.1) | Soft self-correction | Medium | Error variance drops 20–30% |
| 7 | Model-specific tokenizer (replace 4 chars/token) | 5–8% token-count accuracy | High (new dep: tiktoken etc.) | Token estimate error <2% |

Prior project `better_cost_estimation_reservation_20260409` established the empirical-chars foundation and deliberately left calibration-refinement/feedback-loop UI for a follow-up (this project).

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/cost_optimization.md
- evolution/docs/metrics.md
- evolution/docs/arena.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/entities.md
- evolution/docs/logging.md
- evolution/docs/visualization.md
- evolution/docs/reference.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/curriculum.md
- evolution/docs/agents/overview.md
- docs/planning/better_cost_estimation_reservation_20260409/*.md (prior project context)

## Code Files Read
- evolution/src/lib/pipeline/infra/estimateCosts.ts
- evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts
- evolution/src/lib/pipeline/infra/trackBudget.ts
- evolution/src/lib/pipeline/loop/runIterationLoop.ts
- evolution/src/lib/pipeline/loop/budgetFloorResolvers.ts
- evolution/src/lib/pipeline/setup/generateSeedArticle.ts
- evolution/src/lib/pipeline/finalize/persistRunResults.ts
- evolution/src/lib/core/Agent.ts
- evolution/src/lib/core/agentNames.ts
- evolution/src/lib/core/agents/generateFromSeedArticle.ts
- evolution/src/lib/core/agents/createSeedArticle.ts
- evolution/src/lib/core/agents/SwissRankingAgent.ts
- evolution/src/lib/core/agents/MergeRatingsAgent.ts
- evolution/src/lib/core/detailViewConfigs.ts
- evolution/src/lib/core/entityRegistry.ts
- evolution/src/lib/metrics/registry.ts
- evolution/src/lib/metrics/writeMetrics.ts
- evolution/src/lib/metrics/readMetrics.ts
- evolution/src/lib/metrics/recomputeMetrics.ts
- evolution/src/lib/metrics/computations/execution.ts
- evolution/src/lib/metrics/computations/finalization.ts
- evolution/src/lib/metrics/computations/propagation.ts
- evolution/src/lib/metrics/metricColumns.tsx
- evolution/src/lib/schemas.ts
- evolution/src/lib/types.ts
- evolution/src/services/costAnalytics.ts
- evolution/src/services/invocationActions.ts
- evolution/src/services/strategyPreviewActions.ts
- evolution/src/services/evolutionVisualizationActions.ts
- evolution/src/services/logActions.ts
- evolution/src/services/adminAction.ts
- evolution/src/components/evolution/sections/EntityDetailTabs.tsx
- evolution/src/components/evolution/tabs/EntityMetricsTab.tsx
- evolution/src/components/evolution/tabs/SnapshotsTab.tsx
- evolution/src/components/evolution/tabs/LogsTab.tsx
- src/app/admin/evolution/runs/[runId]/page.tsx
- src/app/admin/evolution/strategies/[strategyId]/page.tsx
- src/app/admin/costs/page.tsx
- src/config/llmPricing.ts
- jest.setup.js, jest.config.js
- evolution/src/lib/metrics/writeMetrics.test.ts
- evolution/src/lib/metrics/computations/finalization.test.ts
- evolution/src/components/evolution/tabs/EntityMetricsTab.test.tsx
- src/__tests__/e2e/specs/09-admin/admin-evolution-strategy-detail.spec.ts
- src/__tests__/integration/budget-floor-migration.integration.test.ts
- src/__tests__/integration/__fixtures__/staging-strategies-2026-04-13.json

## Resolved Decisions (from user review 2026-04-14)

1. **Stale trigger scope** — CONFIRMED AS AN ISSUE. Verify + fix the `mark_elo_metrics_stale` trigger so cost-category metrics are not marked stale on variant `mu`/`sigma` changes. Add migration to scope the trigger by `metric_name` or `category`.
2. **Propagation aggregation** — use `aggregateAvg` for `avg_cost_estimation_error_pct` and related propagated cost metrics. Bootstrap CI is reserved for elo/quality metrics.
3. **Historical backfill** — NOT NEEDED. Pre-Apr-11 runs will render "No data (pre-instrumentation)" in the tab; no backfill script.
4. **Calibration table** — in scope. Nightly refresh job rebuilds per-(strategy × generation_model × judge_model × phase) table from `evolution_agent_invocations.execution_detail`; in-memory loader with ~5-min refresh serves the hot path. Replaces hardcoded `EMPIRICAL_OUTPUT_CHARS` and `OUTPUT_TOKEN_ESTIMATES` lookups in `estimateCosts.ts` and `createEvolutionLLMClient.ts`. Consolidates recommendations #1, #2, #4, #6 into one mechanism.
5. **Improvement suggestions** — deliver as a markdown recommendations report in `_progress.md` after the tab is live and has accumulated signal. No in-UI "Tuning Recommendations" panel.
