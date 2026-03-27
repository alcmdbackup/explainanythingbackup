# Strategy Metrics Evolution Research

## Problem Statement
The evolution pipeline's `persistRunResults` finalization step does not propagate metrics (run_count, total_cost, avg_final_elo, best_final_elo) to the parent strategy entity after a run completes. The E2E test `admin-evolution-run-pipeline.spec.ts:237` ("strategy metrics were propagated") consistently fails in CI. The run completes successfully, variants are created, invocations recorded, and run-level metrics are computed, but `evolution_metrics` for entity_type='strategy' is empty. Additionally, the arena leaderboard shows raw mu and sigma values which are hard to interpret without knowing the Elo conversion factor.

## Requirements (from GH Issue #848)
1. Fix `persistRunResults.ts` to call `propagateMetricsToParents()` after writing run-level metrics, cascading to parent strategy and experiment entities
2. Ensure the E2E test at `admin-evolution-run-pipeline.spec.ts:237` ("strategy metrics were propagated") passes
3. Update the arena leaderboard UI to show Elo uncertainty range (e.g. "1200 ± 45") instead of raw mu and sigma columns, which are hard to interpret without knowing the conversion factor

## High Level Summary

### Metrics Propagation Issue — ROOT CAUSE CONFIRMED

**Two bugs working together:**

**Bug 1: `cost` metric not written when iteration loop breaks early** (`runIterationLoop.ts:208-221`)
- The `cost` metric (duringExecution) is written at line 208-213, AFTER the generate/rank/evolve phases
- If the loop `break`s due to `budget_exceeded` (line 167, 205) or `converged` (line 201), the cost metric write is SKIPPED
- For 1-iteration runs (like the E2E test with $0.02 budget), this is very likely to happen

**Bug 2: `propagateMetrics()` silently skips metrics when source data is missing** (`persistRunResults.ts:333`)
- `run_count`, `total_cost`, `avg_cost_per_run` all use `sourceMetric: 'cost'`
- When the cost metric was never written (Bug 1), `sourceRows.length === 0` → `continue` → these 3 metrics are silently skipped
- The E2E test checks for `run_count` and `total_cost` — both are missing → test fails

**Evidence from staging DB (queried 2026-03-27):**
- 848 run metrics, 142 invocation metrics, 10 strategy metrics total
- Only 1 strategy has propagated metrics — and it's MISSING `run_count`, `total_cost`, `avg_cost_per_run` (the 3 cost-dependent metrics)
- It HAS `avg_final_elo`, `best_final_elo`, etc. (from `winner_elo` which IS written at finalization)
- Recent completed runs have `completed_at: null` and NO run_summary — they were marked completed externally, not via `finalizeRun()`

**Fix approach:** Write the `cost` metric at finalization time (in `persistRunResults.ts`) in addition to during execution, ensuring it always exists before propagation runs.

### Arena Leaderboard
The arena leaderboard already has a "95% CI" column using `formatEloCIRange()` that shows `[lo, hi]` format. Raw Mu and Sigma columns exist as separate columns. The user wants these replaced with a more readable "Elo ± uncertainty" format.

## Key Findings

### 1. Propagation Code Path (persistRunResults.ts)
- **Lines 208-267**: Single try-catch wraps ALL metric operations
- **Lines 217-223**: Run finalization metrics computed and written
- **Lines 225-256**: Invocation and variant metrics written
- **Lines 258-264**: `propagateMetrics()` called for strategy and experiment
- **Lines 265-267**: Catch block only logs warning, does NOT rethrow
- **Lines 309-342**: Local `propagateMetrics()` function queries completed child runs, fetches their metrics, aggregates, and writes parent metrics

### 2. Propagation Logic
- Queries `evolution_runs` for `status='completed'` children of the parent entity
- Fetches source metrics via `getMetricsForEntities(db, 'run', childRunIds, sourceMetricNames)`
- For each propagation definition, aggregates source rows and writes to parent
- **Silent early returns**: returns if no completed runs (line 322) or no propagation defs (line 325)
- **Silent skips**: continues if no source rows for a metric (line 333)

### 3. Entity.propagateMetricsToParents() (Entity.ts:178-221)
- Exists as an alternative propagation mechanism but is **NEVER called** anywhere in the codebase
- The local `propagateMetrics()` in persistRunResults.ts implements equivalent logic inline
- The GH issue's suggested fix to call this method is valid but the local function already does the same thing

### 4. Metric Registry Alignment
- **Run finalization metrics**: cost, winner_elo, median_elo, p90_elo, max_elo, total_matches, decisive_rate, variant_count
- **Strategy/Experiment propagation metrics** (14 total): run_count, total_cost, avg_cost_per_run, avg_final_elo, best_final_elo, worst_final_elo, avg_median_elo, avg_p90_elo, best_max_elo, total_matches, avg_matches_per_run, avg_decisive_rate, total_variant_count, avg_variant_count
- **Source metric names match correctly** — validated at build time by registry.ts (lines 137-150)
- `run_count` uses `aggregateCount` on `cost` metric rows → returns `rows.length` (count of runs with a cost metric)

### 5. Aggregation Functions (propagation.ts)
- `aggregateSum/Avg/Max/Min/Count` — simple, return MetricValue with null CI
- `aggregateBootstrapMean` — handles n=1 gracefully (returns value with null CI), handles n=0 (returns value=0)
- All functions properly return `{ value, sigma, ci, n }` MetricValue objects

### 6. Write Path (writeMetrics.ts)
- **Timing validation is STRICT**: checks metric_name belongs to the correct phase in the registry
- Timing='at_propagation' is correctly validated against entity's atPropagation definitions
- Uses ON CONFLICT (entity_type, entity_id, metric_name) upsert
- RLS: service_role has full access — no blocking

### 7. E2E Test (admin-evolution-run-pipeline.spec.ts)
- **Test setup**: Creates strategy, prompt, experiment, run with $0.02 budget, 1 iteration, gpt-4.1-nano
- **Triggers pipeline** via POST `/api/evolution/run`, polls for completion (120s timeout)
- **Strategy metrics assertion** (lines 237-257): Expects run_count=1, total_cost>0, avg_final_elo present, best_final_elo present
- **Experiment metrics assertion** (lines 259-288): Same + total_matches
- **UI assertions** (lines 302-345): Strategy/experiment detail pages render metric-total-cost and metric-runs

### 8. Arena Leaderboard UI (arena/[topicId]/page.tsx)
**Current columns**: Rank, Content, Elo, 95% CI, Mu, Sigma, Matches, Method, Cost
- **Elo**: `formatElo(entry.elo_score)` — rounded integer
- **95% CI**: `formatEloCIRange(entry.elo_score, entry.sigma * ELO_SIGMA_SCALE)` → `[lo, hi]` format
- **Mu**: `mu.toFixed(1)` — raw OpenSkill value
- **Sigma**: `sigma.toFixed(1)` — raw OpenSkill value
- **ELO_SIGMA_SCALE**: `400 / 25 = 16` (converts OpenSkill sigma to Elo-scale sigma)
- **formatEloCIRange**: `elo95CI(sigma) = Math.round(1.96 * sigma)`, formatted as `[elo-half, elo+half]`
- **No ± format** exists anywhere in the codebase currently

## Open Questions
1. What specific error (if any) is thrown during metrics writing that the catch block swallows? Need to run the pipeline locally to capture it.
2. Is the issue that run metrics fail to write (so propagation has no source data), or that propagation itself fails?
3. Should we improve the error handling to surface the actual failure, or is it safe to just ensure the happy path works?

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/architecture.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/entities.md
- evolution/docs/metrics.md
- evolution/docs/data_model.md
- evolution/docs/arena.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/cost_optimization.md
- evolution/docs/curriculum.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/logging.md
- evolution/docs/visualization.md
- evolution/docs/reference.md
- evolution/docs/README.md
- evolution/docs/agents/overview.md

## Code Files Read
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — finalization + propagation logic (426 lines)
- `evolution/src/lib/core/Entity.ts` — abstract entity with propagateMetricsToParents (242 lines)
- `evolution/src/lib/core/entities/RunEntity.ts` — run entity (parents: strategy, experiment, prompt)
- `evolution/src/lib/core/entities/StrategyEntity.ts` — strategy entity (14 atPropagation metrics)
- `evolution/src/lib/core/entities/ExperimentEntity.ts` — experiment entity (identical propagation)
- `evolution/src/lib/core/entityRegistry.ts` — entity registry (strategy and experiment registered)
- `evolution/src/lib/metrics/registry.ts` — declarative metric registry with build-time validation
- `evolution/src/lib/metrics/writeMetrics.ts` — upsert with strict timing validation
- `evolution/src/lib/metrics/readMetrics.ts` — chunked batch reads
- `evolution/src/lib/metrics/computations/propagation.ts` — 6 aggregation functions
- `evolution/src/lib/metrics/computations/finalization.ts` — 6 finalization compute functions
- `evolution/src/lib/metrics/types.ts` — MetricRow, MetricName, EntityType
- `evolution/src/lib/core/metricCatalog.ts` — central metric catalog (25 metrics)
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — orchestrator calling finalizeRun
- `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` — E2E test
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — arena leaderboard page
- `src/app/admin/evolution/arena/[topicId]/arenaCutoff.ts` — cutoff logic
- `evolution/src/lib/utils/formatters.ts` — formatEloCIRange, elo95CI, formatElo
- `evolution/src/lib/shared/computeRatings.ts` — toEloScale, ELO_SIGMA_SCALE
- `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx` — metrics display tab
- `evolution/src/components/evolution/primitives/MetricGrid.tsx` — metric grid with CI support
- `evolution/src/components/evolution/tabs/MetricsTab.tsx` — run metrics tab
- `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx` — variant detail
