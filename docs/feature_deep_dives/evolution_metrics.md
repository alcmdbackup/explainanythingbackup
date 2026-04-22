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
