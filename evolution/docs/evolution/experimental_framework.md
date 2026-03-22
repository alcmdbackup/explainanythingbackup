# Experimental Framework

The experimental framework provides metrics computation, statistical confidence intervals, and run summary persistence for evolution experiments. It connects the pipeline's per-run outputs to cross-run analysis and visualization.

## Per-Run Metrics

Each completed evolution run produces a `MetricsBag` — a flat map of named metrics computed by `computeRunMetrics()` in `evolution/src/experiments/evolution/experimentMetrics.ts`.

The function queries two tables:

- **`evolution_variants`** — fetches `elo_score` for all variants in the run
- **`evolution_agent_invocations`** — fetches `agent_name` and `cost_usd` for cost breakdown

### Metric definitions

| Metric | Type | Description |
|--------|------|-------------|
| `totalVariants` | scalar | Number of variants produced |
| `medianElo` | scalar | 50th percentile Elo across variants |
| `p90Elo` | scalar | 90th percentile Elo |
| `maxElo` | scalar | Highest Elo in the run |
| `cost` | scalar | Total USD spent (sum of all agent invocations) |
| `eloPer$` | scalar | `(maxElo - 1200) / cost` — efficiency metric |
| `agentCost:<name>` | scalar | Per-agent cost breakdown (template literal key) |

```typescript
// evolution/src/experiments/evolution/experimentMetrics.ts
export async function computeRunMetrics(
  runId: string,
  supabase: SupabaseClient,
): Promise<RunMetricsWithRatings>
```

Each metric is wrapped in a `MetricValue` with fields `value`, `sigma` (rating uncertainty, if available), `ci` (confidence interval, null at per-run level), and `n` (observation count, always 1 for single-run metrics).

The `eloPer$` metric uses 1200 as the baseline Elo — this is the starting Elo for all variants. A run that produces no improvement above baseline yields `eloPer$ = 0`.

## Bootstrap Confidence Intervals

When aggregating metrics across multiple runs (e.g., for [Strategy Experiments](./strategy_experiments.md)), the framework computes 95% confidence intervals using two bootstrap functions.

### `bootstrapMeanCI()`

Used for scalar metrics: `cost`, `totalVariants`, `eloPer$`, and per-agent costs.

```typescript
// evolution/src/experiments/evolution/experimentMetrics.ts
export function bootstrapMeanCI(
  values: MetricValue[],
  iterations = 1000,
  rng: () => number = Math.random,
): MetricValue
```

Algorithm:
1. Draw 1000 bootstrap samples (resample with replacement from input values)
2. For each resample, if the metric carries `sigma > 0`, draw from `Normal(value, sigma)` using the Box-Muller transform instead of using the raw value. This propagates within-run rating uncertainty into the aggregate CI.
3. Compute the mean of each bootstrap sample
4. Return the 95% CI as `[2.5th percentile, 97.5th percentile]` of the 1000 bootstrap means

Single-observation behavior: when `values.length < 2`, returns `ci: null` (no interval can be computed). With 2+ observations, always computes the 95% CI.

The function accepts an optional `rng` parameter for deterministic testing via `createSeededRng()`, a Numerical Recipes LCG.

### `bootstrapPercentileCI()`

Used for Elo percentile metrics: `medianElo`, `p90Elo`, `maxElo`.

```typescript
// evolution/src/experiments/evolution/experimentMetrics.ts
export function bootstrapPercentileCI(
  allRunRatings: Array<Array<{ mu: number; sigma: number }>>,
  percentile: number,
  iterations = 1000,
  rng: () => number = Math.random,
): MetricValue | null
```

This function propagates two levels of uncertainty:

1. **Between-run uncertainty**: resamples which runs are included (bootstrap over runs)
2. **Within-run uncertainty**: for each variant, draws a skill sample from `Normal(mu, sigma)` using Box-Muller, then converts to Elo scale via `toEloScale()`

Each of the 1000 iterations resamples runs, draws variant skills with noise, computes the target percentile within each resampled run, then averages across runs. The final CI is the `[2.5th, 97.5th]` percentile of these 1000 averages.

### Aggregation routing

The `aggregateMetrics()` function routes each metric to the appropriate bootstrap:

| Metric | Bootstrap function | Percentile |
|--------|--------------------|------------|
| `medianElo` | `bootstrapPercentileCI` | 0.5 |
| `p90Elo` | `bootstrapPercentileCI` | 0.9 |
| `maxElo` | `bootstrapPercentileCI` | 1.0 |
| All others | `bootstrapMeanCI` | N/A |

Percentile bootstrap requires `variantRatings` (mu/sigma pairs) from each run. If fewer than 2 runs have valid ratings, the percentile metrics fall back to `bootstrapMeanCI`.

## Run Summary V3

When a run completes, `finalizeRun()` in `evolution/src/lib/pipeline/finalize.ts` constructs a run summary and persists it to the `run_summary` JSONB column on `evolution_runs`.

### Fields

The V3 summary contains:

| Field | Type | Description |
|-------|------|-------------|
| `version` | `3` | Schema version literal |
| `stopReason` | string | `budget_exceeded`, `iterations_complete`, `converged`, or `killed` |
| `totalIterations` | number | Actual iterations completed |
| `muHistory` | `number[][]` | Top-K mu values per iteration (see below) |
| `diversityHistory` | `number[]` | Diversity scores per iteration (see caveat below) |
| `matchStats` | object | `{ totalMatches, avgConfidence, decisiveRate }` |
| `topVariants` | array | Up to 10 entries: `{ id, strategy, mu, isBaseline }` |
| `strategyEffectiveness` | record | Per-strategy `{ count, avgMu }` |
| `metaFeedback` | object or null | Always `null` in current implementation |

### Zod validation

The V3 schema (`EvolutionRunSummaryV3Schema` in `evolution/src/lib/types.ts`) enforces strict limits:

- `muHistory`: max 100 entries
- `topVariants`: max 10 entries
- String fields: max 200 characters
- `totalIterations`: integer, 0-100
- `matchStats.avgConfidence` and `decisiveRate`: 0-1 range
- Schema uses `.strict()` — unknown fields are rejected

### Auto-migration

Older run summaries are automatically migrated on read via a Zod union with `.transform()`:

```typescript
// evolution/src/lib/types.ts
export const EvolutionRunSummarySchema = z.union([
  EvolutionRunSummaryV3Schema,      // version: 3 — native mu-based
  EvolutionRunSummaryV2Schema,      // version: 2 — ordinal-based → V3
  EvolutionRunSummaryV1Schema,      // version: 1 — Elo-based → V3
]);
```

The migration formula converts legacy rating values to mu:

```
mu = elo_or_ordinal + 3 * DEFAULT_SIGMA
```

Where `DEFAULT_SIGMA = 25 / 3` (approximately 8.333), so the offset is approximately 25. This applies to `eloHistory`/`ordinalHistory` (becomes `muHistory`), `topVariants[].elo`/`ordinal` (becomes `mu`), `baselineElo`/`baselineOrdinal` (becomes `baselineMu`), and `strategyEffectiveness[].avgElo`/`avgOrdinal` (becomes `avgMu`).

V1 schemas have `version: 1` (optional — early V1 data may omit it). V2 schemas have `version: 2`. The union tries V3 first, then V2, then V1; the first successful parse wins.

## muHistory Tracking

The `muHistory` array records the skill distribution of top variants after each iteration's ranking phase. It is built in the main evolution loop (`evolution/src/lib/pipeline/evolve-article.ts`):

1. After each iteration's ranking completes, collect all current mu values from the ratings map
2. Sort descending by skill estimate
3. Slice to top-K where K = `tournamentTopK` (default 5 from [config](./architecture.md))
4. Push the array of K mu values as one entry in `muHistory`

This produces a 2D array: `muHistory[iteration][rank]`. The visualization layer uses this to plot convergence curves — how quickly the top variants' skill estimates stabilize. See [Visualization](./visualization.md) for how this data is rendered.

## Diversity Score

> **Warning:** Diversity tracking is declared but **not implemented** in the current V2 pipeline. The `diversityHistory` array is initialized as empty (`[]`) in `evolve-article.ts` and is never populated during the evolution loop. The `diversityScore` parameter on the evolve function defaults to `1.0` when not provided. Because the creative exploration trigger requires `0 < diversity < 0.5`, it never fires with the default value of `1.0`. The expected implementation would compute pairwise text similarity after each ranking phase, but this has not been built. Any `diversityHistory` values in existing run summaries will be empty arrays.

The `EvolutionResult` type declares `diversityHistory: number[]` and the evolve function accepts an optional `diversityScore` parameter, but the pipeline never calls the evolve function with a computed diversity value. This is a known gap — the type system and run summary schema are ready for diversity data, but the computation is missing.

## Strategy Effectiveness

Strategy effectiveness is computed at two levels: per-run (in the run summary) and aggregate (across runs in the database).

### Per-run computation

In `buildRunSummary()` (`evolution/src/lib/pipeline/finalize.ts`), strategy effectiveness is computed via a single-pass aggregation using Welford's online mean algorithm:

```typescript
// evolution/src/lib/pipeline/finalize.ts — inside buildRunSummary()
const strategyEffectiveness = pool.reduce<Record<string, { count: number; avgMu: number }>>(
  (acc, v) => {
    const mu = ratings.get(v.id)?.mu ?? DEFAULT_MU;
    const prev = acc[v.strategy];
    if (prev) {
      const newCount = prev.count + 1;
      acc[v.strategy] = { count: newCount, avgMu: prev.avgMu + (mu - prev.avgMu) / newCount };
    } else {
      acc[v.strategy] = { count: 1, avgMu: mu };
    }
    return acc;
  }, {});
```

This groups variants by their strategy name and computes a running average mu. Welford's method avoids the numerical instability of summing then dividing — each new observation incrementally adjusts the mean.

### Aggregate computation

After persisting the run, `finalizeRun()` calls the `update_strategy_aggregates` Postgres RPC (defined in `supabase/migrations/20260222100004_fix_strategy_aggregates_stddev.sql`). This RPC:

1. Reads the current aggregate row from `evolution_strategy_configs` with `FOR UPDATE` (row lock)
2. Increments `run_count`
3. Adds `p_cost_usd` to `total_cost_usd`
4. Updates `avg_final_elo` using Welford's online mean: `new_mean = old_mean + delta / new_count`
5. Updates `elo_sum_sq_diff` (M2 accumulator) for online standard deviation: `M2 += delta * delta2`
6. Derives `stddev = sqrt(M2 / new_count)` and `avg_elo_per_dollar = (avg_final_elo - 1200) / total_cost_usd`
7. Updates `best_final_elo` and `worst_final_elo` via `GREATEST`/`LEAST`

The RPC uses a 5-second statement timeout as a safety net. The Welford update is numerically stable for computing both mean and standard deviation in a single pass without storing individual run results.

These aggregate statistics power the strategy comparison views. See [Strategy Experiments](./strategy_experiments.md) for how strategies are configured, and [Data Model](./data_model.md) for the `evolution_strategy_configs` table schema.

## Related Documentation

- [Architecture](./architecture.md) — pipeline phases and configuration
- [Data Model](./data_model.md) — database tables referenced by metrics
- [Strategy Experiments](./strategy_experiments.md) — experiment design and strategy comparison
- [Visualization](./visualization.md) — how metrics and muHistory are rendered in the UI
