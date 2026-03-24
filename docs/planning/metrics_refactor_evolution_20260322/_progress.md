# Metrics Refactor Evolution Progress

## Phase 1: Schema & Core Infrastructure ✅
### Work Done
- Created `supabase/migrations/20260323000002_evolution_metrics_table.sql` — EAV table with indexes, RLS, and stale-flag trigger
- Created `evolution/src/lib/metrics/types.ts` — EntityType, MetricName, MetricRow (Zod), contexts, conversions
- Created `evolution/src/lib/metrics/computations/execution.ts` — computeRunCost, computeAgentCost
- Created `evolution/src/lib/metrics/computations/finalization.ts` — computeWinnerElo, computeMedianElo, computeP90Elo, computeMaxElo, computeTotalMatches, computeDecisiveRate, computeVariantCount
- Created `evolution/src/lib/metrics/computations/finalizationInvocation.ts` — computeBestVariantElo, computeAvgVariantElo, computeInvocationVariantCount
- Created `evolution/src/lib/metrics/computations/propagation.ts` — aggregateSum, aggregateAvg, aggregateMax, aggregateMin, aggregateCount, aggregateBootstrapMean
- Created `evolution/src/lib/metrics/registry.ts` — METRIC_REGISTRY with validateRegistry(), helpers, FORMATTERS
- Created `evolution/src/lib/metrics/writeMetrics.ts` — UPSERT with timing validation
- Created `evolution/src/lib/metrics/readMetrics.ts` — getEntityMetrics, getMetric, getMetricsForEntities (chunked)
- Created `evolution/src/lib/metrics/recomputeMetrics.ts` — recomputeStaleMetrics with SKIP LOCKED
- Created `evolution/src/lib/metrics/index.ts` — barrel exports
- 60 unit tests passing

## Phase 2: Write Metrics During Execution & Finalization ✅
### Work Done
- Modified `runIterationLoop.ts` — registry-driven execution metrics after each iteration
- Modified `persistRunResults.ts` — run/invocation/variant finalization metrics + propagation to strategy/experiment
- Created `propagateMetrics()` generic function in persistRunResults.ts

## Phase 3: Lazy Recompute ✅
### Work Done
- Created `evolution/src/services/metricsActions.ts` — getEntityMetricsAction with stale detection and recompute on read

## Phase 4: EntityMetricsTab ✅
### Work Done
- Created `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx` — generic metrics tab with category grouping
- Added Metrics tab to all 7 entity detail pages (run, experiment, strategy, variant, invocation, prompt, arena)
- Updated barrel exports in `evolution/src/components/evolution/index.ts`
- 5 component tests passing

## Phase 5: List View Metric Columns ✅
### Work Done
- Created `evolution/src/lib/metrics/metricColumns.tsx` — createMetricColumns and createRunsMetricColumns helpers
- Added getBatchMetricsAction to metricsActions.ts
- Updated runs list page with metric columns + batch fetch
- Updated strategies list page with metric column placeholders

## Phase 6: Legacy Cleanup & Renames ✅
### Work Done
- Renamed experimentActionsV2 → experimentActions (4 files, 18 import updates)
- Renamed strategyRegistryActionsV2 → strategyRegistryActions (4 files, 4 import updates)
- Created `supabase/migrations/20260323000003_drop_legacy_metrics.sql` — drops legacy VIEWs, RPCs, strategy columns
- Updated all test assertions for tab renames (overview → metrics)
- All 254 test suites pass, 4262 tests pass
