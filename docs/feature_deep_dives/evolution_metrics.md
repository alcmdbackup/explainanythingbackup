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

## Implementation
[To be filled during implementation]
