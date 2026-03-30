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

## Implementation
[To be filled during implementation]
