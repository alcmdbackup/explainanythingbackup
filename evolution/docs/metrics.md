# Metrics System

The evolution pipeline uses a centralized metrics system stored in a single `evolution_metrics` EAV (entity-attribute-value) table. Metrics are computed at three lifecycle stages, support lazy recomputation via stale flags, and propagate from child entities (runs) to parent entities (strategies, experiments) using configurable aggregation.

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
| `cost` | cost | during_execution | Total USD spent (from cost tracker). `listView: false` — not shown in the entity list view. The run list and detail pages display cost by querying `evolution_agent_invocations` directly rather than reading this metric row. |
| `winner_elo` | rating | at_finalization | Elo of the highest-mu variant |
| `median_elo` | rating | at_finalization | 50th percentile Elo across all variants |
| `p90_elo` | rating | at_finalization | 90th percentile Elo |
| `max_elo` | rating | at_finalization | Highest Elo in the pool |
| `total_matches` | match | at_finalization | Total pairwise comparisons |
| `decisive_rate` | match | at_finalization | Fraction of matches with confidence > 0.6 |
| `variant_count` | count | at_finalization | Number of variants in the final pool |
| `agentCost:<name>` | cost | during_execution | Per-phase cost breakdown (dynamic key) |

### Invocation Metrics

| Name | Category | Timing | Description |
|------|----------|--------|-------------|
| `best_variant_elo` | rating | at_finalization | Highest elo among variants produced by this invocation |
| `avg_variant_elo` | rating | at_finalization | Average elo of variants from this invocation |
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

---

## Database Schema

**Table:** `evolution_metrics`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Auto-generated |
| `entity_type` | TEXT | `run`, `invocation`, `variant`, `strategy`, `experiment`, `prompt`, `arena_topic` |
| `entity_id` | UUID | ID of the entity this metric belongs to |
| `metric_name` | TEXT | Registry-validated metric name |
| `value` | DOUBLE PRECISION | The metric value |
| `sigma` | DOUBLE PRECISION | Rating uncertainty (nullable) |
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

When a variant's `mu` or `sigma` changes after run completion (e.g., from arena matches), a database trigger (`mark_elo_metrics_stale`) sets `stale=true` on dependent run, strategy, and experiment metrics.

On the next read, server actions detect stale rows and call `recomputeStaleMetrics()`:

1. **Row-level locking** via `lock_stale_metrics` RPC (`SELECT FOR UPDATE SKIP LOCKED`) — concurrent readers skip recomputation, preventing thundering herd.
2. **Recompute** based on entity type:
   - **Run**: re-reads variant ratings and recomputes elo metrics via finalization compute functions.
   - **Strategy/Experiment**: re-reads child run metrics and re-runs propagation aggregation.
3. **Clear stale flags** in a `finally` block.

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

`createRunsMetricColumns()` generates run-specific metric columns for the runs table within experiment and strategy detail pages.

**File:** `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx`

A shared tab component that reads all metrics for an entity and displays them in a `MetricGrid`. Used on run, strategy, experiment, and invocation detail pages.

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
