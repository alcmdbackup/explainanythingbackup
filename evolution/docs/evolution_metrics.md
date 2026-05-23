# Evolution Metrics

## Overview
[To be filled during implementation]

## Key Files
- `evolution/src/experiments/evolution/experimentMetrics.ts` - Core metrics computation, bootstrap CIs, aggregation
- `evolution/src/components/evolution/tabs/MetricsTab.tsx` - Run metrics display component

## Ranking Agent Execution Details

The `RankingAgent` records a `RankingExecutionDetail` object in its invocation's `execution_detail` JSONB field. Notable fields:

| Field | Type | Description |
|-------|------|-------------|
| `triageMatchCount` | number | Total triage matches this invocation |
| `swissMatchCount` | number | Total Swiss fine-ranking matches |
| `eliminatedCount` | number | Variants eliminated during triage |
| `low_sigma_opponents_count` | number (optional) | Number of triage opponents that were low-sigma anchors (sigma in bottom 25th percentile). Useful for measuring how effectively anchor-based calibration is being used. |

## Reflection cost metrics

`ReflectAndGenerateFromPreviousArticleAgent` (Shape A: `agentType: 'reflect_and_generate'`
sits alongside `'generate'` and `'swiss'` at the top of the iteration enum) makes one
reflection LLM call up front to pick a tactic, then delegates to GFPA. Its cost surfaces
through three metric rows that mirror the existing `generation_cost` / `ranking_cost`
pattern:

| Metric | Entity | Aggregation | Description |
|--------|--------|-------------|-------------|
| `reflection_cost` | run | (live write) | Sum of `'reflection'`-labeled LLM spend in the run, written incrementally via `writeMetricMax` after each call (same Postgres `GREATEST` upsert path used by `generation_cost` / `ranking_cost`). Defined in `evolution/src/lib/metrics/registry.ts`. |
| `total_reflection_cost` | strategy / experiment | sum | Cumulative reflection spend across all runs in the strategy/experiment. |
| `avg_reflection_cost_per_run` | strategy / experiment | avg | Mean reflection spend per run. |

The propagation defs live in `SHARED_PROPAGATION_DEFS` (registry.ts) and are wired identically to the
`total_generation_cost` / `avg_generation_cost_per_run` and `total_ranking_cost` /
`avg_ranking_cost_per_run` pairs — so a strategy that mixes `generate` and
`reflect_and_generate` iterations will surface all three cost streams as separate
columns. Per-invocation totals are also written to the wrapper's `execution_detail`
(`reflection.cost`, `generation.cost`, `ranking.cost`, and `totalCost = reflection.cost
+ GFPA.totalCost`) for run-level drill-down.

The label-to-metric mapping (`'reflection' → 'reflection_cost'`) lives in
`COST_METRIC_BY_AGENT` at `evolution/src/lib/core/agentNames.ts`; the same lookup
governs how every per-call cost is bucketed into a metric row.

## Iterative editing cost metrics

`IterativeEditingAgent` (`agentType: 'iterative_editing'`) makes 2-3 LLM calls per cycle
across up to 5 cycles per parent. Per Decisions §13 invariant I2, all three per-LLM-call
labels (`iterative_edit_propose`, `iterative_edit_review`, `iterative_edit_drift_recovery`)
collapse into ONE consolidated cost metric — per-purpose split is tracked in
`execution_detail.cycles[i].{proposeCostUsd, approveCostUsd, driftRecoveryCostUsd}` for
drill-down rather than as separate metric rows.

| Metric | Entity | Aggregation | Description |
|--------|--------|-------------|-------------|
| `iterative_edit_cost` | run | (live write) | Sum of all `iterative_edit_*`-labeled LLM spend (proposer + approver + drift recovery, all cycles, all parents). Written incrementally via `writeMetricMax`. |
| `total_iterative_edit_cost` | strategy / experiment | sum | Cumulative editing spend across all runs in the strategy/experiment. |
| `avg_iterative_edit_cost_per_run` | strategy / experiment | avg | Mean editing spend per run. |

Plus three operational health metrics with env-tunable alert thresholds (run-detail dashboard
alert-colors out-of-band values red):

| Metric | Default Alert | Env Var | Description |
|--------|---------------|---------|-------------|
| `iterative_edit_drift_rate` | > 0.30 | `EVOLUTION_EDITING_DRIFT_RATE_ALERT_THRESHOLD` | Fraction of cycles whose Proposer output drifted from the source (strip-markup mismatch). Persistent high value indicates Proposer prompt-engineering needed. |
| `iterative_edit_recovery_success_rate` | < 0.70 | `EVOLUTION_EDITING_RECOVERY_SUCCESS_RATE_ALERT_THRESHOLD` | Fraction of drift events resolved by the recovery LLM call. Persistent low value indicates recovery model needs upgrading. |
| `iterative_edit_accept_rate` | > 0.95 | `EVOLUTION_EDITING_ACCEPT_RATE_ALERT_THRESHOLD` | Fraction of atomic edits accepted by Approver. Persistent high value is a rubber-stamping signal (Decisions §16) — choose distinct `editingModel` and `approverModel`. |

**Cost estimation**: `estimateIterativeEditingCost(seedChars, editingModel, approverModel,
driftRecoveryModel, judgeModel, maxCycles)` returns `{ expected, upperBound }`. `expected` is
`maxCycles × (proposeCallCost + reviewCallCost)`. `upperBound` accounts for 1.5×-per-cycle
article growth (Decisions §17 hard cap), proposer markup factor 1.4×, plus one drift recovery,
plus 30% safety margin. Used by `V2CostTracker.reserve()` for per-iteration budget reservation.

`EstPerAgentValue.editing` field surfaces per-agent editing cost in the dispatch plan preview
(mirrors PR #1017's `reflection` field).

## Evaluation cost metrics

`EvaluateCriteriaThenGenerateFromPreviousArticleAgent` (Shape A: `agentType: 'criteria_and_generate'`) makes ONE combined LLM call labeled `'evaluate_and_suggest'` that scores the parent article against user-defined `evolution_criteria` rows AND drafts fix suggestions for the K weakest criteria in the same response, then delegates to GFPA. Its cost surfaces through metric rows that mirror the reflection/generation/ranking pattern:

| Metric | Entity | Aggregation | Description |
|--------|--------|-------------|-------------|
| `evaluation_cost` | run | (live write) | Sum of `'evaluate_and_suggest'`-labeled LLM spend in the run, written incrementally via `writeMetricMax`. |
| `total_evaluation_cost` | strategy / experiment / criteria | sum | Cumulative evaluation spend (criteria-level: only invocations that scored this criterion). |
| `avg_evaluation_cost_per_run` | strategy / experiment | avg | Mean evaluation spend per run. |

The label-to-metric mapping (`'evaluate_and_suggest' → 'evaluation_cost'`) is registered in `COST_METRIC_BY_AGENT` at `evolution/src/lib/core/agentNames.ts`. Per-invocation totals are also written to the wrapper's `execution_detail.evaluateAndSuggest` sub-object (criteriaScored + suggestions + droppedSuggestions + evaluationCost) plus a recomputed `totalCost = evaluation.cost + GFPA.totalCost` for run-level drill-down.

In addition, criteria-level metrics are computed at finalization by `computeCriteriaMetricsForRun()` in `evolution/src/lib/metrics/computations/criteriaMetrics.ts`: `avg_score`, `frequency_as_weakest`, `total_variants_focused`, `avg_elo_delta_when_focused`, and `total_evaluation_cost`. Staleness cascades from variant `mu`/`sigma` changes via the trigger extension in migration `20260502120003`.

## Per-Iteration Cost Display

The **Cost Estimates tab** on run detail pages now includes per-iteration cost display.
Each iteration from `iterationConfigs[]` is shown with its allocated budget
(`budgetPercent / 100 * totalBudget`) and actual spend, enabling identification of
which iterations consumed the most budget. The iteration filter on the Cost-per-Invocation
table allows drilling into costs for a specific iteration.

Per-iteration results (`IterationResult`) include `budgetAllocated`, `budgetSpent`,
`variantsCreated`, and `matchesCompleted`, which feed into the Timeline tab's iteration
cards and the Cost Estimates tab's breakdown view.

## Dispatch Prediction (projectDispatchPlan)

`evolution/src/lib/pipeline/loop/projectDispatchPlan.ts` is the single source of truth for
"given this strategy config + arena context, how many agents will dispatch per iteration?".
It's consumed by the wizard preview (via `getStrategyDispatchPreviewAction`), the runtime
loop (via matching inline math), and the cost-sensitivity analysis. The unified shape:

```typescript
interface IterationPlanEntry {
  iterIdx: number;
  agentType: 'generate' | 'swiss';
  iterBudgetUsd: number;
  tactic: string;
  estPerAgent: {
    expected: { gen: number; rank: number; total: number };   // display value
    upperBound: { gen: number; rank: number; total: number }; // reservation-safe
  };
  maxAffordable: { atExpected: number; atUpperBound: number };
  dispatchCount: number;          // uses upperBound
  effectiveCap: 'budget' | 'safety_cap' | 'floor' | 'swiss';
  poolSizeAtStart: number;        // models pool growth iter-to-iter
  parallelFloorUsd: number;
}
```

The `projected_dispatched` / `actual_dispatched` distinction on the Cost Estimates tab
comes from the same function: `projected` runs the plan at `upperBound` cost, `actual`
runs it at observed `actualAvgCostPerAgent` (the "what if we'd known actuals from the
start?" counterfactual). Both scenarios use identical math — no drift risk.

Display heuristic constants (in `projectDispatchPlan.ts`):
- `EXPECTED_GEN_RATIO = 0.7` — expected gen cost / upperBound gen cost (placeholder; Phase 6a
  planned to re-sample from 50 staging runs once Phase 5 attribution data is clean).
- `EXPECTED_RANK_COMPARISONS_RATIO = 0.5` — expected binary-search comparisons / max cap.
- `DEFAULT_SEED_CHARS = 8000` — wizard preview default seed length.
- `DISPATCH_SAFETY_CAP = 100` — defense-in-depth cap on dispatchCount per iteration.

## Implementation
`evolution/src/components/evolution/DispatchPlanView.tsx` renders the plan across all
three surfaces (wizard / run detail / strategy detail) with consistent formatting:
cost-range via `formatCostRange`, effective-cap badges, optional projected-vs-actual
delta columns + realization ratio, and warning banners for ranking-cost saturation,
budget-insufficient iterations, and safety-cap binding.

### Top-up projection (`expectedTotalDispatch`, `expectedTopUpDispatch`)

`projectDispatchPlan` also models the within-iteration top-up loop (Phase 7b in
`runIterationLoop.ts`) so the wizard preview reflects the realistic dispatch count, not
just the conservative parallel-batch size. Per `IterationPlanEntry`:

- **`expectedTotalDispatch`** — `parallel batch + projected top-up agents`. Computed via
  `floor((iterBudget - sequentialFloor) / expected.total)` (algebraically equivalent to
  the runtime's iterative gate `while (remaining - actualAvgCost >= sequentialFloor)`
  with `parallelSpend = parallel × actualAvgCost` cancelling). Capped at
  `DISPATCH_SAFETY_CAP`. Always `>= dispatchCount`.
- **`expectedTopUpDispatch`** — `expectedTotalDispatch - dispatchCount`. Zero when
  parallel batch already saturates expected, when top-up is disabled, or when
  the iter is swiss.

Pool growth between iterations now uses `expectedTotalDispatch` instead of `dispatchCount`
to match the post-top-up pool the runtime grows.

The function takes a third optional argument `opts: DispatchPlanOptions` with
`topUpEnabled` and `reflectionEnabled` booleans, mirroring the
`EVOLUTION_TOPUP_ENABLED` / `EVOLUTION_REFLECTION_ENABLED` runtime kill-switches.
Callers (runtime, wizard server-action, cost-sensitivity) resolve env at their own
boundary and pass explicit booleans so the function stays pure and reproducible. The
wizard's `DispatchPlanView` surfaces `expectedTotalDispatch` in a "Likely total" column
between Dispatch and $/Agent, with a sub-line `N parallel + M top-up` when top-up adds
agents beyond the parallel batch.
