# Experimental Framework

Per-run distribution metrics (median/p90/max Elo), per-agent cost breakdowns, and bootstrap confidence intervals for the evolution pipeline. Replaces the unimplemented L8 factorial design with a metrics layer on top of manual experiments.

## Overview

The framework computes variant-level distribution metrics for each evolution run and aggregates them across runs within a strategy using bootstrap CIs. It propagates within-run uncertainty (OpenSkill sigma) into cross-run confidence intervals.

**Per-run metrics:** total variants, median Elo, 90th percentile Elo, max Elo (with sigma), total cost, Elo/$, and per-agent cost breakdown.

**Aggregated metrics:** Mean of per-run values with 95% bootstrap CIs. Percentile metrics (median/p90 Elo) use uncertainty-propagating bootstrap that resamples variant ratings from Normal(mu, sigma).

## Key Files

| File | Purpose |
|------|---------|
| `evolution/src/experiments/evolution/experimentMetrics.ts` | Core metrics computation, bootstrap CIs, aggregation |
| `evolution/src/experiments/evolution/experimentMetrics.test.ts` | Unit tests (31 tests) |
| `supabase/migrations/20260306000002_compute_run_variant_stats.sql` | Postgres RPC for PERCENTILE_CONT |
| `evolution/src/services/experimentActions.ts` | Server actions: `getExperimentMetricsAction`, `getStrategyMetricsAction` |
| `src/app/api/cron/experiment-driver/route.ts` | Cron writes `metrics_v2` key to `analysis_results` |
| `src/app/admin/evolution/experiments/[experimentId]/ExperimentAnalysisCard.tsx` | Experiment detail metrics UI |
| `src/app/admin/evolution/strategies/[strategyId]/StrategyMetricsSection.tsx` | Strategy aggregate metrics UI |
| `evolution/scripts/backfill-experiment-metrics.ts` | Backfill script for historical experiments |

## Metrics

| Metric | Bootstrap Type | Uncertainty Source |
|--------|---------------|-------------------|
| Max Elo | `bootstrapMeanCI` (sigma-aware) | Top variant's OpenSkill sigma |
| Median Elo | `bootstrapPercentileCI` | Resamples all variant ratings per run |
| 90p Elo | `bootstrapPercentileCI` | Same, different percentile |
| Cost | `bootstrapMeanCI` (plain) | No uncertainty |
| Elo/$ | `bootstrapMeanCI` (plain) | Derived metric |
| Agent costs | `bootstrapMeanCI` (plain) | No uncertainty |

## Scale Consistency

Per-run Elo values use the conservative ordinal (`mu - 3*sigma`) via `elo_score` in the DB. Aggregated Elo values use posterior mean (`mu`) for unbiased estimates. Aggregated values will be higher than per-run averages — this is expected and correct.

## Backfill

```bash
# Preview what would be computed (default: dry-run)
npx tsx evolution/scripts/backfill-experiment-metrics.ts

# Write to DB
npx tsx evolution/scripts/backfill-experiment-metrics.ts --run
```

Stores results under `analysis_results.metrics_v2` key. Existing `analysis_results` data is preserved.
