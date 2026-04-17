# Metrics System

The evolution pipeline uses a centralized metrics system stored in a single `evolution_metrics` EAV (entity-attribute-value) table. Metrics are computed at three lifecycle stages, support lazy recomputation via stale flags, and propagate from child entities (runs) to parent entities (strategies, experiments) using configurable aggregation.

> **Per-purpose cost split (live):** Two run-level metrics — `generation_cost` and
> `ranking_cost` — track LLM spend per purpose. They are written **live** by
> `createLLMClient.ts` after every LLM call via `writeMetricMax` (a Postgres RPC using
> `ON CONFLICT DO UPDATE SET value = GREATEST(...)`) so concurrent out-of-order writes
> can never overwrite a larger value with a smaller one. The agent label (`'generation'`
> or `'ranking'`) is a typed `AgentName` constant passed at the call site — typos are
> compile errors. The mapping from `AgentName` to its cost metric lives at
> `evolution/src/lib/core/agentNames.ts` (`COST_METRIC_BY_AGENT`).
>
> Strategy/experiment-level totals (`total_generation_cost`, `avg_generation_cost_per_run`,
> `total_ranking_cost`, `avg_ranking_cost_per_run`) propagate from these run-level rows
> via `SHARED_PROPAGATION_DEFS` in `evolution/src/lib/metrics/registry.ts`. They mirror
> the existing `total_cost` / `avg_cost_per_run` pattern.
>
> **Three-way cost split (`generation_cost` / `ranking_cost` / `seed_cost`):** A third
> metric, `seed_cost`, tracks LLM spend by `CreateSeedArticleAgent` (the two calls that
> generate a seed article title and body for prompt-based runs). Seed costs were
> previously invisible — they occurred inside `buildRunContext` via the legacy V1
> `callLLM` path before the V2CostTracker existed. After the Phase 4 refactor, seed
> generation runs inside `runIterationLoop` where the cost tracker is live, and spend is
> attributed to `seed_cost` via the same `COST_METRIC_BY_AGENT` mapping. For
> explanation-based runs, `seed_cost` is always 0.
>
> **Run cost rows are written exactly once per run** via the live `writeMetricMax` path
> during execution. Stale runs become `status='failed'` (per
> `supabase/migrations/20260323000002_fix_stale_claim_expiry.sql`) and are never
> re-claimed by `claim_evolution_run` (which selects only `status='pending'`), so no row
> reset is needed at run start. To handle runs that fail before any LLM call, the
> orchestrator zero-inits `cost`, `generation_cost`, `ranking_cost`, and `seed_cost` at
> run start; `GREATEST` ensures the zeros never overwrite real values written later.
>
> The `format_rejection_rate` and `total_comparisons` invocation metrics handle both
> legacy and new execution-detail shapes via `detailType` discrimination.
>
> **Note: dual registry.** Both `evolution/src/lib/metrics/registry.ts` (flat
> `METRIC_REGISTRY`) and `evolution/src/lib/core/entityRegistry.ts` (Entity-class-based)
> exist in parallel. They must be kept in sync manually until consolidated in a
> follow-up project.

For how metrics feed into strategy comparison, see [Strategies & Experiments](./strategies_and_experiments.md). For the database schema of the metrics table, see [Data Model](./data_model.md).

---

## Architecture

```
Pipeline Execution                    Finalization                      Propagation
─────────────────                    ────────────                      ───────────
  Phase completes                    Run completes                    After finalization
       │                                  │                                │
       ▼                                  ▼                                ▼
  writeMetric()                    persistRunMetrics()              propagateMetrics()
  (cost per phase)                 (elo, matches, variants)         (strategy + experiment aggregates)
       │                                  │                                │
       └──────────────────────────────────┴────────────────────────────────┘
                                          │
                                          ▼
                              evolution_metrics table
                         (entity_type, entity_id, metric_name, value, ...)
```

### Three Timing Phases

| Timing | When | What |
|--------|------|------|
| `during_execution` | After each pipeline phase | Cost tracking — updated incrementally so in-progress runs have current costs |
| `at_finalization` | When run completes | Rating metrics (elo), match stats, variant counts — computed from final pool state |
| `at_propagation` | After finalization | Strategy and experiment aggregates — computed from child run metrics |

---

## Metric Registry

**File:** `evolution/src/lib/metrics/registry.ts`

All metrics are declared in a typed registry keyed by entity type. Each definition specifies the metric name, display label, category, formatter, and compute function. The registry is validated at module load time — duplicate names and broken source references throw immediately.

### Run Metrics

| Name | Category | Timing | Description |
|------|----------|--------|-------------|
| `cost` | cost | during_execution | Total USD spent (from cost tracker). Written via `writeMetricMax` after every LLM call. `listView: true`. |
| `generation_cost` | cost | during_execution | LLM spend on generation calls in this run. Written via `writeMetricMax` after every `'generation'`-labeled LLM call. `listView: true`. |
| `ranking_cost` | cost | during_execution | LLM spend on ranking calls in this run (incl. SwissRankingAgent + binary-search comparisons). Written via `writeMetricMax` after every `'ranking'`-labeled LLM call. `listView: true`. |
| `seed_cost` | cost | during_execution | LLM spend on seed article generation (`CreateSeedArticleAgent`). Only non-zero for prompt-based runs. Written via `writeMetricMax` after every `'seed_title'`- or `'seed_article'`-labeled LLM call. `listView: true`. |
| `winner_elo` | rating | at_finalization | Elo of the highest-`elo` variant. Includes `uncertainty` (Elo-scale) and 95% CI = elo ± 1.96 × uncertainty. |
| `median_elo` | rating | at_finalization | 50th percentile Elo across all variants |
| `p90_elo` | rating | at_finalization | 90th percentile Elo |
| `max_elo` | rating | at_finalization | Highest Elo in the pool |
| `total_matches` | match | at_finalization | Total pairwise comparisons |
| `decisive_rate` | match | at_finalization | Fraction of matches with confidence > 0.6 |
| `variant_count` | count | at_finalization | Number of variants in the final pool |
| `agentCost:<name>` | cost | during_execution | Per-phase cost breakdown (dynamic key). **Filtered from UI display** — `EntityMetricsTab` excludes `agentCost:*` metrics; use `total_generation_cost`/`total_ranking_cost` for UI display instead. |

### Invocation Metrics

| Name | Category | Timing | Description |
|------|----------|--------|-------------|
| `best_variant_elo` | rating | at_finalization | Highest elo among variants produced by this invocation. Also marked stale by the trigger when a variant's DB `mu`/`sigma` columns (backing `Rating`) change. |
| `avg_variant_elo` | rating | at_finalization | Average elo of variants from this invocation. Also marked stale by the trigger when a variant's DB `mu`/`sigma` columns change. |
| `variant_count` | count | at_finalization | Number of variants created by this invocation |

### Variant Metrics

| Name | Category | Timing | Description |
|------|----------|--------|-------------|
| `cost` | cost | at_finalization | Generation cost (from native `cost_usd` column) |

### Strategy & Experiment Metrics (Propagated)

Both entity types share the same propagation definitions — they aggregate from child runs.

| Name | Source Metric | Aggregation | Description |
|------|-------------|-------------|-------------|
| `run_count` | `cost` | count | Total completed runs |
| `total_cost` | `cost` | sum | Cumulative cost |
| `avg_cost_per_run` | `cost` | avg | Mean cost per run |
| `total_generation_cost` | `generation_cost` | sum | Cumulative generation spend across runs (`listView: true`) |
| `avg_generation_cost_per_run` | `generation_cost` | avg | Mean generation spend per run |
| `total_ranking_cost` | `ranking_cost` | sum | Cumulative ranking spend across runs (`listView: true`) |
| `avg_ranking_cost_per_run` | `ranking_cost` | avg | Mean ranking spend per run |
| `total_seed_cost` | `seed_cost` | sum | Cumulative seed generation spend across runs (`listView: true`) |
| `avg_seed_cost_per_run` | `seed_cost` | avg | Mean seed spend per run |
| `avg_final_elo` | `winner_elo` | bootstrap_mean | Mean winner Elo with 95% CI |
| `best_final_elo` | `winner_elo` | max | Highest winner Elo |
| `worst_final_elo` | `winner_elo` | min | Lowest winner Elo |
| `avg_median_elo` | `median_elo` | bootstrap_mean | Mean of run median Elos |
| `avg_p90_elo` | `p90_elo` | bootstrap_mean | Mean of run P90 Elos |
| `best_max_elo` | `max_elo` | max | Highest max Elo |
| `total_matches` | `total_matches` | sum | Total comparisons across all runs |
| `avg_matches_per_run` | `total_matches` | avg | Mean comparisons per run |
| `avg_decisive_rate` | `decisive_rate` | bootstrap_mean | Mean decisive rate with CI |
| `total_variant_count` | `variant_count` | sum | Total variants across all runs |
| `avg_variant_count` | `variant_count` | avg | Mean variants per run |
| `avg_cost_estimation_error_pct` | `cost_estimation_error_pct` | avg | Mean estimation error % across runs (`listView: true`) |
| `avg_generation_estimation_error_pct` | `generation_estimation_error_pct` | avg | Mean generation-phase estimation error % |
| `avg_ranking_estimation_error_pct` | `ranking_estimation_error_pct` | avg | Mean ranking-phase estimation error % |
| `avg_estimation_abs_error_usd` | `estimation_abs_error_usd` | avg | Mean absolute estimation error (USD) |
| `total_estimated_cost` | `estimated_cost` | sum | Cumulative estimated cost across runs |
| `avg_estimated_cost` | `estimated_cost` | avg | Mean estimated cost per run |
| `avg_agent_cost_projected` | `agent_cost_projected` | avg | Mean pre-dispatch projected agent cost |
| `avg_agent_cost_actual` | `agent_cost_actual` | avg | Mean runtime-measured actual agent cost |
| `avg_parallel_dispatched` | `parallel_dispatched` | avg | Mean parallel GFSA dispatches per run |
| `avg_sequential_dispatched` | `sequential_dispatched` | avg | Mean sequential GFSA dispatches per run |
| `avg_median_sequential_gfsa_duration_ms` | `median_sequential_gfsa_duration_ms` | avg | Mean median sequential GFSA duration (ms) |

> **Cost estimate-accuracy propagation uses `aggregateAvg`, not `aggregateBootstrapMean`.**
> Bootstrap CI is reserved for elo/quality metrics. If CI rendering is added later for
> cost metrics, add a separate `*_ci` metric rather than flipping the aggregator — this
> keeps propagation semantics stable. See
> `docs/planning/cost_estimate_accuracy_analysis_20260414/` for the decision rationale.

### Per-Iteration Metrics in Snapshots

Each iteration records an `IterationResult` in `EvolutionResult.iterationResults[]`:

| Field | Type | Description |
|-------|------|-------------|
| `iteration` | number | Index into `iterationConfigs[]` |
| `agentType` | `'generate' \| 'swiss'` | Agent type from the config |
| `stopReason` | `IterationStopReason` | `'iteration_complete'`, `'iteration_budget_exceeded'`, `'iteration_converged'`, or `'iteration_no_pairs'` |
| `budgetAllocated` | number | Dollar budget for this iteration (`budgetPercent / 100 * totalBudget`) |
| `budgetSpent` | number | Actual USD spent during this iteration |
| `variantsCreated` | number | Number of new variants produced |
| `matchesCompleted` | number | Number of pairwise comparisons completed |

These per-iteration results are available on the `EvolutionResult` returned by
`evolveArticle()`. They are persisted in the run summary and used by the Timeline tab
to render iteration cards with budget bars showing allocated vs. spent for each iteration.

### Run-level cost-estimation metrics (cost_estimate_accuracy_analysis_20260414)

Computed at finalization from GFSA `execution_detail` JSONB plus budget-floor
observables passed through `FinalizationContext.budgetFloorObservables`:

| Name | Source | Description |
|------|--------|-------------|
| `cost_estimation_error_pct` | `execution_detail.estimationErrorPct` | Mean per-invocation estimation error %. `listView: true`. |
| `estimated_cost` | `execution_detail.estimatedTotalCost` | Sum across GFSA invocations |
| `estimation_abs_error_usd` | `execution_detail.{estimatedTotalCost, totalCost}` | Mean abs error |
| `generation_estimation_error_pct` | `execution_detail.generation.{cost, estimatedCost}` | Mean generation-phase error |
| `ranking_estimation_error_pct` | `execution_detail.ranking.{cost, estimatedCost}` | Mean ranking-phase error |
| `agent_cost_projected` | `BudgetFloorObservables.initialAgentCostEstimate` | Pre-dispatch estimate |
| `agent_cost_actual` | `BudgetFloorObservables.actualAvgCostPerAgent` | Runtime-measured (null if parallel had no successes) |
| `parallel_dispatched` | `BudgetFloorObservables.parallelDispatched` | GFSA count in parallel phase |
| `sequential_dispatched` | `BudgetFloorObservables.sequentialDispatched` | GFSA count in sequential phase |
| `median_sequential_gfsa_duration_ms` | `evolution_agent_invocations.duration_ms` | Median wall-clock of sequential GFSA |
| `avg_sequential_gfsa_duration_ms` | `evolution_agent_invocations.duration_ms` | Mean wall-clock of sequential GFSA |

The Cost Estimates tab on run/strategy detail pages (see `visualization.md`) reads
these to render summary cards, Cost-by-Agent rollups, projected-vs-actual Budget
Floor Sensitivity, error histogram, and per-invocation table.

Run Summary JSONB (`run_summary.budgetFloorConfig`) carries the static floor config
(multipliers + numVariants) for the sensitivity module. Older runs with no
`budgetFloorConfig` cause the sensitivity section to be hidden.

---

## Database Schema

**Table:** `evolution_metrics`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Auto-generated |
| `entity_type` | TEXT | `run`, `invocation`, `variant`, `strategy`, `experiment`, `prompt` |
| `entity_id` | UUID | ID of the entity this metric belongs to |
| `metric_name` | TEXT | Registry-validated metric name |
| `value` | DOUBLE PRECISION | The metric value |
| `uncertainty` | DOUBLE PRECISION | Elo-scale rating uncertainty (nullable; renamed from `sigma`) |
| `ci_lower` | DOUBLE PRECISION | 95% CI lower bound (nullable) |
| `ci_upper` | DOUBLE PRECISION | 95% CI upper bound (nullable) |
| `n` | INT | Observation count (default 1) |
| `origin_entity_type` | TEXT | Source entity for propagated metrics |
| `origin_entity_id` | UUID | Source entity ID |
| `aggregation_method` | TEXT | `sum`, `avg`, `max`, `min`, `count`, `bootstrap_mean`, `bootstrap_percentile` |
| `source` | TEXT | Timing phase that wrote this row |
| `stale` | BOOLEAN | Whether this metric needs recomputation |
| `created_at` | TIMESTAMPTZ | Row creation |
| `updated_at` | TIMESTAMPTZ | Last update |

**Unique constraint:** `(entity_type, entity_id, metric_name)` — one value per metric per entity.

### Indexes

| Index | Purpose |
|-------|---------|
| `idx_metrics_entity` | Primary access: get all metrics for an entity |
| `idx_metrics_type_name` | Leaderboard: get one metric across all entities of a type |
| `idx_metrics_origin` | Cascade staleness: find metrics derived from a source |
| `idx_metrics_stale` | Recompute queue: partial index on `stale=true` |

### RLS

Follows the same pattern as all evolution tables: deny-all default, `service_role_all` bypass, `readonly_local` SELECT access.

---

## Per-LLM-Call Cost Persistence

Cost metrics are now written to the database after each successful LLM call via `createEvolutionLLMClient`. When the client is constructed with optional `db` and `runId` parameters, each LLM call writes its cost to `evolution_agent_invocations` fire-and-forget (errors are logged but do not fail the call). This provides fine-grained cost tracking independent of the phase-level cost metric writes.

**Cost computation source (Phase 2):** actual cost uses real `usage.prompt_tokens`/`usage.completion_tokens` from the provider via `calculateLLMCost`, not the `response.length / 4` heuristic. Identical to how `llmCallTracking.estimated_cost_usd` is computed — the two should now match within rounding per `evolution_invocation_id`.

**Per-invocation attribution under parallel dispatch (Phase 2.5):** `Agent.run()` builds a per-invocation `EvolutionLLMClient` bound to the `AgentCostScope` so each agent's `recordSpend` intercepts go through the scope. `cost_usd` is sourced from `scope.getOwnSpent()` rather than a before/after delta of the shared tracker, eliminating sibling cost bleed. 
---

## Elo CI on Run Metrics

Run-level elo metrics (e.g., `winner_elo`) now carry `uncertainty` and 95% confidence intervals derived directly from the source variant's Elo-scale uncertainty:

- **uncertainty** = `variant.uncertainty` (already Elo-scale; no scaling needed)
- **CI** = `[elo - 1.96 * uncertainty, elo + 1.96 * uncertainty]`

These values are stored in the `uncertainty`, `ci_lower`, and `ci_upper` columns of the metric row. Propagated metrics at the strategy/experiment level use bootstrap CI instead (computed by `bootstrapMeanCI()` from multiple run values), not the per-variant uncertainty.

---

## Write Path

**File:** `evolution/src/lib/metrics/writeMetrics.ts`

`writeMetrics(db, rows, timing)` upserts metric rows to the table. Before writing, it validates that each metric belongs to the correct timing phase via the registry — writing a finalization metric during execution throws an error.

The upsert uses `ON CONFLICT (entity_type, entity_id, metric_name)` so repeated writes (e.g., cost updated after each phase) overwrite the previous value. The `stale` flag is always set to `false` on write.

`writeMetric()` is a single-row convenience wrapper.

---

## Read Path

**File:** `evolution/src/lib/metrics/readMetrics.ts`

- `getEntityMetrics(db, entityType, entityId)` — returns all metrics for one entity.
- `getMetric(db, entityType, entityId, metricName)` — returns a single metric row.
- `getMetricsForEntities(db, entityType, entityIds, metricNames)` — batch read with chunking (100 IDs per query) to avoid Supabase `.in()` limits. Returns `Map<entityId, MetricRow[]>`.

---

## Stale Recomputation

**File:** `evolution/src/lib/metrics/recomputeMetrics.ts`

When a variant's DB `mu` or `sigma` columns change after run completion (e.g., from arena matches — these columns back the public `Rating {elo, uncertainty}` via `dbToRating`), a database trigger (`mark_elo_metrics_stale`) sets `stale=true` on **all** dependent run, strategy, and experiment metrics (not just elo-category metrics).

On the next read, server actions detect stale rows and call `recomputeStaleMetrics()`:

1. **Atomic claim-and-clear** via `lock_stale_metrics` RPC — this is NOT advisory locking or `SELECT FOR UPDATE SKIP LOCKED`. Instead, the RPC atomically UPDATEs `stale=false` and RETURNs the claimed rows in a single statement. This ensures exactly one caller processes each stale row. If recomputation fails, the catch block re-marks the rows `stale=true` so they are retried on the next read.
2. **Recompute** based on entity type:
   - **Run**: re-reads variant ratings and recomputes all finalization metrics (elo, match stats, variant counts) via finalization compute functions.
   - **Strategy/Experiment**: re-reads child run metrics and re-runs propagation aggregation.
3. On success, rows remain `stale=false`. On failure, the catch block sets `stale=true` again to allow retry.

---

## Propagation Aggregation

**File:** `evolution/src/lib/metrics/computations/propagation.ts`

Six aggregation functions are available:

| Function | Behavior |
|----------|----------|
| `aggregateSum` | Sum of all row values |
| `aggregateAvg` | Mean of all row values |
| `aggregateMax` | Maximum value |
| `aggregateMin` | Minimum value |
| `aggregateCount` | Number of rows |
| `aggregateBootstrapMean` | Bootstrap mean CI via `bootstrapMeanCI()` — produces 95% confidence intervals when 2+ observations |

Each propagation metric definition specifies a `sourceMetric` (which child metric to read), `sourceEntity` (which entity type to read from), and `aggregate` (which function to apply).

---

## UI Integration

**File:** `evolution/src/lib/metrics/metricColumns.tsx`

`createMetricColumns(entityType)` generates table column definitions from the registry for use in `EntityTable`. Only metrics with `listView: true` appear in list pages. Each column uses the registry's formatter for display. The run `cost` metric has `listView: false`, so it is excluded from list columns; cost is instead fetched directly from `evolution_agent_invocations` by the run list and detail pages.

**Aggregate CI rendering (Phase 4d):** for metrics whose propagation `aggregationMethod` is `bootstrap_mean` / `bootstrap_percentile` / `avg` AND the row carries `ci_lower`/`ci_upper`, `createMetricColumns` appends a CI suffix: `[lo, hi]` for Elo-like formatters and `± half-width` for cost/percent. `max`/`min`/`sum`/`count` aggregations skip the suffix (no CI semantics). This silently adds aggregate CI to strategy list + experiment list columns whenever the bootstrap propagation produced one.

**Dashboard inline CI (Phase 4d):** `getEvolutionDashboardDataAction` computes `seCostPerRun` inline from its per-run cost sample (sample stddev / sqrt(n), when n ≥ 2) and returns it alongside `avgCostPerRun`. The dashboard page renders `avgCost ± SE` when the SE is present.

**Experiment analysis card (Phase 4d):** `computeExperimentMetrics` emits `meanElo` + `seElo` across completed runs in the experiment; `ExperimentAnalysisCard` renders a "Mean Elo ± SE" summary card.

`createRunsMetricColumns()` generates run-specific metric columns for the runs table within experiment and strategy detail pages.

**File:** `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx`

A shared tab component that reads all metrics for an entity and displays them in a `MetricGrid`. Used on run, strategy, experiment, and invocation detail pages. Filters out `agentCost:*` metrics before rendering (they are superseded by `total_generation_cost`/`total_ranking_cost`). Each metric is mapped to a `MetricItem` with an `id` field set to `metric_name` to avoid React key collisions when multiple metrics resolve to the same display label.

---

## Key Files

| File | Purpose |
|------|---------|
| `evolution/src/lib/metrics/types.ts` | Type definitions: EntityType, MetricName, MetricRow (Zod), contexts |
| `evolution/src/lib/metrics/registry.ts` | Declarative metric registry with compute functions |
| `evolution/src/lib/metrics/writeMetrics.ts` | UPSERT to evolution_metrics with timing validation |
| `evolution/src/lib/metrics/readMetrics.ts` | Read with chunked batch support |
| `evolution/src/lib/metrics/recomputeMetrics.ts` | Stale recomputation with row-level locking |
| `evolution/src/lib/metrics/computations/execution.ts` | Cost compute functions |
| `evolution/src/lib/metrics/computations/finalization.ts` | Elo, match, variant count compute functions |
| `evolution/src/lib/metrics/computations/propagation.ts` | Aggregation functions (sum, avg, max, bootstrap) |
| `evolution/src/lib/metrics/metricColumns.tsx` | Table column generation from registry |
| `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx` | Shared metrics display tab |
| `supabase/migrations/20260323000003_evolution_metrics_table.sql` | Table, indexes, RLS, staleness trigger |

---

## Related Documentation

- [Strategies & Experiments](./strategies_and_experiments.md) — how metrics feed into strategy comparison and bootstrap CIs
- [Data Model](./data_model.md) — full database schema
- [Entities](./entities.md) — entity relationships and the metrics table's polymorphic design
- [Cost Optimization](./cost_optimization.md) — per-run cost tracking that feeds into metrics
