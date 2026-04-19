# Cost Estimate Accuracy Analysis Progress

## Phase 1 — Stale-trigger invariant (verified, no migration needed)
### Work Done
- Verified `mark_elo_metrics_stale` (migration `20260328000002`) uses explicit per-entity
  allowlists. Run-level cost metrics are NOT in any allowlist → correctly excluded.
- Added `src/__tests__/integration/evolution-stale-trigger-cost-invariant.integration.test.ts`
  guarding the invariant for both existing and newly added cost-estimation metric names.

### Issues Encountered
- Phase 1 originally planned a migration to scope the trigger to elo-only; turned out to
  be a no-op because the trigger already filters by name allowlists, not category.

### Pre-existing follow-up (out of scope)
- Strategy/experiment-level `total_cost` / `avg_cost_per_run` ARE in the trigger's
  allowlist at the parent level (lines 32-43 of the trigger SQL). Arena matches that
  change variant `mu`/`sigma` falsely invalidate aggregate cost rollups too. Not fixed
  in this project; tracked here for a future follow-up to either remove cost metrics
  from the parent allowlist or add an explicit `category` filter.

## Phase 2 — Metric registry + run-summary V3 additions
### Work Done
- 11 new run-level finalization metrics added to `METRIC_CATALOG` and mirrored in
  `RunEntity.metrics.atFinalization`.
- 11 propagated entries added to both `StrategyEntity` and `ExperimentEntity` via
  `aggregateAvg` / `aggregateSum`.
- `EvolutionRunSummaryV3Schema` extended with optional `budgetFloorConfig` field
  (additive, V3 backward-compatible — no V4 bump needed).
- `runIterationLoop.ts` captures `parallelDispatched`, `sequentialDispatched`, and
  `actualAvgCostPerAgent` and surfaces them via `EvolutionResult.budgetFloorObservables`
  and `EvolutionResult.budgetFloorConfig` to finalization.
- `persistRunResults.ts` reordered so `invocationDetails` + `budgetFloorObservables`
  populate the `FinalizationContext` BEFORE the run-level compute loop runs (was a
  latent bug — `cost_estimation_error_pct` was registered but never actually written
  because finCtx had no invocationDetails at compute time).

## Phase 3 — Server actions
### Work Done
- `evolution/src/services/costEstimationActions.ts` with `getRunCostEstimatesAction`
  + `getStrategyCostEstimatesAction` (admin-action factory).
- `evolution/src/lib/pipeline/loop/projectDispatchCount.ts` extracted the dispatch-count
  math used by both the runtime loop and the projected-vs-actual computation.
- `COST_ERROR_HISTOGRAM_BUCKETS` exported as a constant so UI labels can't drift.
- Server-side projected-vs-actual math reuses `resolveParallelFloor` /
  `resolveSequentialFloor` from `budgetFloorResolvers.ts`.

## Phase 4 — CostEstimatesTab component
### Work Done
- Shared `CostEstimatesTab.tsx` with `entityType: 'run' | 'strategy'` prop.
- Run sections: Summary MetricGrid, Cost by Agent, Budget Floor Sensitivity (conditional),
  Error Histogram (inline SVG), Cost per Invocation table.
- Strategy sections: Summary MetricGrid, Slice Breakdown (capped at 50 rows),
  Error Histogram, Runs table with drill-down to `?tab=cost-estimates`.
- All edge variants implemented: pre-instrumentation badge, accurate-estimate, ceiling-binding.
- Sensitivity hidden when `applicable: false` regardless of reason.

## Phase 5 — Tabs wired
### Work Done
- `cost-estimates` tab added to run + strategy detail page TAB_DEFS.
- Server actions consumed via the standard `useEffect` + state pattern.

## Phase 6 — Calibration table (shadow-deploy)
### Work Done
- Migration `20260414000001_evolution_cost_calibration.sql` with full RLS.
- `evolution/scripts/refreshCostCalibration.ts` (CLI; daily cron not yet wired).
- `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts` with promise coalescing,
  TTL, kill switch, sentinel-widening lookup.
- `estimateCosts.ts` + `createEvolutionLLMClient.ts` consult the loader; hardcoded
  constants remain authoritative when `COST_CALIBRATION_ENABLED=false` (default).

### Issues Encountered
- Initially used `import 'server-only'` in the loader; broke `npm run build` because the
  loader is transitively imported via `EntityMetricsTab` → `entityRegistry` → ... .
  Resolved by switching to `console.{warn,debug}` (universal logger) and removing the
  `server-only` import.

## Phase 7 — Documentation + recommendations report
### Work Done
- `metrics.md`, `cost_optimization.md`, `visualization.md`, `data_model.md`,
  `reference.md`, `architecture.md` updated.
- Pre-existing strategy-level stale-cascade issue noted above.

### Deferred (intentional)
- Daily cron wiring for `refreshCostCalibration.ts` (operational; minicomputer
  systemd unit).
- 2-week post-ship recommendations report — to be filled out after the calibration
  table populates and the Cost Estimates tab has accumulated signal.
