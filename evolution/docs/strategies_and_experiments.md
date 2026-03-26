# Strategies & Experiments

Strategies define _how_ an evolution run executes (which models, how many iterations, what budget). Experiments group multiple runs together for controlled comparison. This page covers the full lifecycle of both, from strategy registration through experiment completion, metrics computation, and aggregate reporting.

For related context see [Architecture](./architecture.md), [Data Model](./data_model.md), and [Cost Optimization](./cost_optimization.md).

---

## Strategy System

A **strategy** is a named, versioned configuration that fully specifies the models and iteration count for an evolution run. Strategies are stored in the `evolution_strategies` table and referenced by every run via `strategy_id`. The strategy system was introduced in V2 to replace V1's ad-hoc config objects with a centralized registry that enables cross-run comparison and aggregate tracking.

Each strategy encapsulates:
- Which LLM generates text variants.
- Which LLM judges pairwise comparisons.
- How many generate-rank-evolve iterations to run.
- Optional parameters for round sizing and budget caps.

### V2StrategyConfig

The canonical type lives in `evolution/src/lib/pipeline/types.ts`:

```ts
interface V2StrategyConfig {
  generationModel: string;
  judgeModel: string;
  iterations: number;
  strategiesPerRound?: number;  // default 3
  budgetUsd?: number;
}
```

| Field               | Purpose                                    |
|---------------------|--------------------------------------------|
| `generationModel`   | LLM used for text generation calls         |
| `judgeModel`        | LLM used for pairwise comparison/judging   |
| `iterations`        | Number of generate-rank-evolve cycles      |
| `strategiesPerRound`| Generation strategies per iteration round  |
| `budgetUsd`         | Optional per-run budget cap                |

### Config Hashing

Each strategy config is identified by a 12-character hex hash derived from SHA-256 of `{generationModel, judgeModel, iterations}`. Only these three fields are hashed; `strategiesPerRound` and `budgetUsd` are excluded so that budget adjustments do not create duplicate strategies.

```ts
// evolution/src/lib/pipeline/strategy.ts
function hashStrategyConfig(config: V2StrategyConfig): string {
  const normalized = {
    generationModel: config.generationModel,
    judgeModel: config.judgeModel,
    iterations: config.iterations,
  };
  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .slice(0, 12);
}
```

### Auto-Label

Every strategy receives a human-readable label generated from its config:

```
Gen: 4.1-mini | Judge: 4.1-mini | 5 iters | Budget: $2.00
```

Model names are shortened for display (`gpt-` prefix stripped, `claude-` becomes `cl-`, `deepseek-` becomes `ds-`). The label function is `labelStrategyConfig` in the same module.

### Upsert by Hash (Race-Safe)

The `upsertStrategy` function in `evolution/src/lib/pipeline/strategy.ts` uses `INSERT ... ON CONFLICT` on the `config_hash` column. Two concurrent requests with the same config will not create duplicate rows -- the second insert silently becomes a no-op and the existing row is returned. The function returns the strategy ID regardless of whether the row was inserted or already existed.

This is used by the pipeline runner at the start of each run: before execution begins, the runner calls `upsertStrategy` with the run's config to ensure a strategy row exists. The returned `strategy_id` is stored on the run row and later used for aggregate updates at finalization.

An auto-generated name is also assigned during upsert:
```
Strategy a1b2c3 (mini, 5it)
```
This uses the first 6 characters of the config hash plus the generation model suffix and iteration count for quick identification.

### Strategy Status

Strategies have two statuses:

- **active** -- available for selection in new experiments and visible in the strategy picker.
- **archived** -- hidden from the strategy picker in new experiment creation but retained for historical reference. Existing runs and experiments that reference archived strategies are unaffected.

The `updateStrategyAction` in `evolution/src/services/strategyRegistryActionsV2.ts` handles toggling between these states. Archiving is a soft operation -- no data is deleted, and the strategy can be reactivated at any time.

### Strategy CRUD

The full set of strategy operations is exposed through `evolution/src/services/strategyRegistryActionsV2.ts`:

- **listStrategiesAction** -- paginated listing with optional filters by status, created_by, and pipeline_type. Returns `{ items, total }` for pagination controls.
- **getStrategyDetailAction** -- full detail for a single strategy by ID.
- **createStrategyAction** -- validates input via Zod schema, computes config hash and auto-label, inserts the row.
- **updateStrategyAction** -- partial updates to name, description, or status.
- **cloneStrategyAction** -- duplicates an existing strategy with a new name, useful for creating variations of a known-good config.

---

## Strategy Aggregates

Strategy aggregate metrics are stored in the `evolution_metrics` table with `entity_type='strategy'` rather than as hardcoded columns on `evolution_strategies`. At run finalization, `propagateMetrics()` in TypeScript reads all child run metrics and writes aggregated strategy-level rows to the metrics table.

### Algorithm

Aggregation uses **bootstrap confidence intervals** (via `bootstrapMeanCI()` and `bootstrapPercentileCI()`) when 2+ runs are available. This replaces the previous Welford's online algorithm, enabling proper 95% CIs that propagate within-run rating uncertainty.

For scalar metrics (cost, totalVariants, eloPer$), `bootstrapMeanCI()` resamples with replacement and optionally draws from `Normal(value, sigma)` when rating uncertainty is present. For Elo percentile metrics (medianElo, p90Elo, maxElo), `bootstrapPercentileCI()` propagates both between-run and within-run uncertainty.

### Metric Rows

Strategy metrics in `evolution_metrics` include:

| metric_name       | Description                                            |
|-------------------|--------------------------------------------------------|
| `cost`            | Total cost across all runs (aggregation: sum)          |
| `run_count`       | Total completed runs (aggregation: count)              |
| `avg_final_elo`   | Mean final Elo with bootstrap CI                       |
| `best_final_elo`  | Highest final Elo achieved (aggregation: max)          |
| `worst_final_elo` | Lowest final Elo achieved (aggregation: min)           |
| `medianElo`       | Median Elo with percentile bootstrap CI                |
| `eloPer$`         | Efficiency metric with bootstrap CI                    |

The derived metric **eloPer$** is computed as:

```
eloPer$ = (avg_final_elo - 1200) / total_cost_usd
```

This measures how much Elo improvement over the 1200 baseline each dollar buys.

> **Note:** Strategy metrics support lazy recomputation via the `stale` flag. When a variant's rating changes post-completion (e.g., from arena matches), a DB trigger marks dependent metrics as stale. On the next read, `propagateMetrics()` recomputes the aggregates.

---

## Experiment Lifecycle

An experiment groups multiple runs -- potentially across different strategies -- for a single prompt. Each experiment is tied to exactly one `evolution_prompts` row, and all runs within it share that prompt. This makes experiments the primary unit for answering "which strategy works best for this prompt?"

Experiments follow a linear state machine with four states:

```
                  ┌────────────────────────┐
                  │         draft          │
                  │  (created, no runs)    │
                  └──────────┬─────────────┘
                             │ addRunToExperiment()
                             │ (auto-transition)
                             ▼
                  ┌────────────────────────┐
          ┌───── │        running         │ ─────┐
          │      │  (runs in progress)    │      │
          │      └────────────────────────┘      │
          │ cancelExperiment()                   │ run finalizes
          ▼                                      ▼
┌──────────────────┐              ┌──────────────────┐
│    cancelled     │              │    completed     │
│ (bulk-fail runs) │              │ (all runs done)  │
└──────────────────┘              └──────────────────┘
```

### Creating an Experiment

```ts
// evolution/src/services/experimentActionsV2.ts
export const createExperimentAction = adminAction(
  'createExperiment',
  async (input: { name: string; promptId: string }, ctx: AdminContext) => {
    // Validates promptId, inserts row with status='draft'
    return createExperiment(input.name, input.promptId, ctx.supabase);
  },
);
```

The underlying `createExperiment` function in `evolution/src/lib/pipeline/experiments.ts` trims the name and enforces a 1-200 character limit.

### Adding Runs

```ts
export const addRunToExperimentAction = adminAction(
  'addRunToExperiment',
  async (
    input: { experimentId: string; config: { strategy_id: string; budget_cap_usd: number } },
    ctx: AdminContext,
  ) => {
    return addRunToExperiment(input.experimentId, input.config, ctx.supabase);
  },
);
```

When a run is added:

1. The experiment must be in `draft` or `running` status (adding to `completed`/`cancelled` throws).
2. A new run row is inserted with `status: 'pending'`.
3. If the experiment is still in `draft`, it auto-transitions to `running`.

### Auto-Completion

When a run finalizes (in `evolution/src/lib/pipeline/finalize.ts`, Step 6), the system checks whether the parent experiment is in `running` status and updates it to `completed`:

```ts
await db
  .from('evolution_experiments')
  .update({ status: 'completed', updated_at: new Date().toISOString() })
  .eq('id', run.experiment_id)
  .eq('status', 'running');
```

> **Note:** The status guard (`.eq('status', 'running')`) prevents overwriting a manually cancelled experiment. Only experiments that are still running get auto-completed.

### Cancellation

`cancelExperimentAction` calls the `cancel_experiment` Postgres RPC, which performs two operations atomically:

1. Sets the experiment status to `cancelled`.
2. Bulk-updates all `pending`, `claimed`, and `running` runs to `failed`.

This ensures no orphaned runs continue executing after cancellation. Any runs that were already claimed by a worker will detect the `failed` status on their next checkpoint and terminate gracefully.

### Listing and Querying

The `listExperimentsAction` returns experiments ordered by creation date (newest first) with an optional status filter (options: All, Draft, Running, Completed, Cancelled). Each result includes a `runCount` derived from the joined `evolution_runs` rows, giving a quick overview without loading full run details.

The `getExperimentAction` returns full experiment detail including all associated runs and computed metrics.

---

## UI Workflow

The experiment creation interface is a 3-step wizard located at `src/app/admin/evolution/start-experiment/page.tsx` (the `ExperimentForm` component).

### Step 1: Setup

- Enter an experiment name.
- Select a prompt from the `evolution_prompts` table (loaded via `getPromptsAction`).
- Set the per-run budget cap in USD.

### Step 2: Strategies

- Browse and multi-select from the strategy library (loaded via `getStrategiesAction`). A select-all checkbox is available for quick bulk selection.
- Configure how many runs to create per selected strategy (runs-per-strategy input).
- Only `active` strategies appear in the picker. A "Hide test strategies" filter excludes `[TEST]`-prefixed strategies.
- An inline prompt creation dialog allows creating a new prompt without leaving the wizard.

### Step 3: Review

- Summary of all runs that will be created (strategy x count matrix). Each step has a visible label.
- Validate total budget constraint: **$10 maximum total budget** across all planned runs. Validation is deferred — errors are shown only on the review step, not inline during selection.
- Confirm to create the experiment and enqueue all runs.

On confirmation, the wizard calls `createExperimentAction` once, then calls `addRunToExperimentAction` for each planned run. The first `addRunToExperiment` call auto-transitions the experiment from `draft` to `running`.

### Execution Flow

After runs are enqueued, the pipeline worker picks them up in FIFO order. Each run executes independently:

1. Worker claims a `pending` run (sets status to `claimed`).
2. The run's strategy config determines model selection and iteration count.
3. On completion, `finalizeRun` persists results, updates strategy aggregates, and triggers experiment auto-completion if applicable.
4. If the run fails or is killed, it is marked `failed` with an error message.

Administrators can monitor experiment progress through the admin UI, which polls `getExperimentAction` to display live status updates for each run.

---

## Per-Run Metrics

Each completed evolution run produces metrics persisted to the `evolution_metrics` table as individual rows keyed by `(entity_type='run', entity_id, metric_name)`. Metrics are computed by registry-driven functions and written at run finalization via `persistRunMetrics()`.

The computation draws from two source tables:

- **`evolution_variants`** — fetches `mu`, `sigma`, and `elo_score` for all variants in the run
- **`evolution_agent_invocations`** — fetches `agent_name` and `cost_usd` for cost breakdown

Cost metrics are also written incrementally during execution (after each pipeline phase completes), so in-progress runs have up-to-date cost in the metrics table.

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

Each metric is stored as a row in `evolution_metrics` with columns `value`, `sigma` (rating uncertainty from the source variant, nullable), `ci_lower`/`ci_upper` (confidence interval bounds, null at per-run level), and `n` (observation count, always 1 for single-run metrics). The `stale` flag supports lazy recomputation when source data changes (e.g., variant ratings updated by arena matches).

The `eloPer$` metric uses 1200 as the baseline Elo — this is the starting Elo for all variants. A run that produces no improvement above baseline yields `eloPer$ = 0`.

---

## Experiment Metrics

Experiment metrics are persisted in the `evolution_metrics` table with `entity_type='experiment'`. At run finalization, `propagateMetrics()` aggregates child run metrics and writes experiment-level rows. This replaces the previous on-demand `computeExperimentMetrics()` function that recomputed from raw tables on every page load.

### Metric Rows

| metric_name    | Description                                    | Aggregation |
|----------------|------------------------------------------------|-------------|
| `maxElo`       | Highest winner Elo across completed runs       | max         |
| `cost`         | Total cost across all runs                     | sum         |
| `eloPer$`      | Best efficiency ratio across runs              | max         |
| `medianElo`    | Median Elo with bootstrap CI (when 2+ runs)    | bootstrap_percentile |

### Display

The `ExperimentAnalysisCard` component renders these metrics as:

1. **Summary cards** -- maxElo, totalCost, best eloPerDollar at a glance, now with confidence intervals when available.
2. **Per-run table** -- all completed runs sorted by Elo descending, showing strategy name, Elo, cost, and eloPerDollar.

### How eloPerDollar Is Calculated

For each run, the efficiency metric is:

```
eloPerDollar = (elo - 1200) / cost
```

where `elo` is the winner variant's final Elo score and `cost` comes from the run's `cost` metric in the `evolution_metrics` table. The 1200 baseline represents the starting Elo for all variants, so eloPerDollar measures the Elo improvement purchased per dollar spent. Runs where cost is zero or Elo is null will have a null eloPerDollar.

---

## Bootstrap Confidence Intervals

When aggregating metrics across multiple runs, the framework computes 95% confidence intervals using two bootstrap functions.

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

---

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

Where `DEFAULT_SIGMA = 25 / 3` (approximately 8.333), so the offset is approximately 25. V1 schemas have `version: 1` (optional — early V1 data may omit it). V2 schemas have `version: 2`. The union tries V3 first, then V2, then V1; the first successful parse wins.

---

## muHistory Tracking

The `muHistory` array records the skill distribution of top variants after each iteration's ranking phase. It is built in the main evolution loop (`evolution/src/lib/pipeline/evolve-article.ts`):

1. After each iteration's ranking completes, collect all current mu values from the ratings map
2. Sort descending by skill estimate
3. Slice to top-K where K = `tournamentTopK` (default 5 from [config](./architecture.md))
4. Push the array of K mu values as one entry in `muHistory`

This produces a 2D array: `muHistory[iteration][rank]`. The visualization layer uses this to plot convergence curves — how quickly the top variants' skill estimates stabilize. See [Visualization](./visualization.md) for how this data is rendered.

---

## Diversity Score

> **Warning:** Diversity tracking is declared but **not implemented** in the current V2 pipeline. The `diversityHistory` array is initialized as empty (`[]`) in `evolve-article.ts` and is never populated during the evolution loop. The `diversityScore` parameter on the evolve function defaults to `1.0` when not provided. Because the creative exploration trigger requires `0 < diversity < 0.5`, it never fires with the default value of `1.0`. The expected implementation would compute pairwise text similarity after each ranking phase, but this has not been built. Any `diversityHistory` values in existing run summaries will be empty arrays.

The `EvolutionResult` type declares `diversityHistory: number[]` and the evolve function accepts an optional `diversityScore` parameter, but the pipeline never calls the evolve function with a computed diversity value. This is a known gap — the type system and run summary schema are ready for diversity data, but the computation is missing.

---

## Strategy Effectiveness

Strategy effectiveness is computed at two levels: per-run (in the run summary) and aggregate (across runs via the metrics table).

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

After persisting the run, `finalizeRun()` calls `propagateMetrics()` in TypeScript. This function reads the child run's metrics from the `evolution_metrics` table and writes aggregated strategy-level and experiment-level metrics back to the same table using bootstrap confidence intervals.

When a variant's `mu` or `sigma` changes post-completion (e.g., from arena matches), a DB trigger marks dependent run, strategy, and experiment metrics as `stale`. On the next read, the server action detects stale metrics and triggers lazy recomputation via `propagateMetrics()`.

---

## Key Files

| File | Purpose |
|------|---------|
| `evolution/src/services/experimentActionsV2.ts` | Experiment lifecycle server actions (create, add run, get, list, cancel) |
| `evolution/src/services/strategyRegistryActionsV2.ts` | Strategy CRUD server actions (list, create, update, clone) |
| `evolution/src/lib/pipeline/experiments.ts` | Core experiment functions (create, addRun, computeMetrics) |
| `evolution/src/lib/pipeline/strategy.ts` | Strategy hashing, labeling, and upsert-by-hash |
| `evolution/src/lib/pipeline/finalize.ts` | Run finalization: auto-completion, aggregate updates |
| `evolution/src/lib/pipeline/infra/types.ts` | `V2StrategyConfig`, `EvolutionConfig`, `EvolutionResult` types |
| `evolution/src/experiments/evolution/experimentMetrics.ts` | Bootstrap CI functions, MetricValue type |
| `evolution/src/lib/metrics/registry.ts` | Declarative metric registry with compute functions |
| `evolution/src/lib/metrics/writeMetrics.ts` | UPSERT metrics to evolution_metrics table |
| `evolution/src/lib/metrics/recomputeMetrics.ts` | Stale metric recomputation with row-level locking |
| `src/app/admin/evolution/start-experiment/page.tsx` | Experiment creation wizard UI |

---

## Related Documentation

- [Architecture](./architecture.md) — pipeline phases and configuration
- [Data Model](./data_model.md) — database tables referenced by metrics
- [Metrics](./metrics.md) — metrics system architecture, registry, and DB schema
- [Visualization](./visualization.md) — how metrics and muHistory are rendered in the UI
- [Cost Optimization](./cost_optimization.md) — budget tracking and spending gates
