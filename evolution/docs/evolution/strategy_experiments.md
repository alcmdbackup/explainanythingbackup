# Strategy & Experiments

Strategies define _how_ an evolution run executes (which models, how many iterations, what budget). Experiments group multiple runs together for controlled comparison. This page covers the full lifecycle of both, from strategy registration through experiment completion and aggregate reporting.

For related context see [Architecture](./architecture.md), [Data Model](./data_model.md), [Cost Optimization](./cost_optimization.md), and [Experimental Framework](./experimental_framework.md).

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

Strategy aggregate metrics are now stored in the `evolution_metrics` table with `entity_type='strategy'` rather than as hardcoded columns on `evolution_strategies`. At run finalization, `propagateMetrics()` in TypeScript reads all child run metrics and writes aggregated strategy-level rows to the metrics table.

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

The `listExperimentsAction` returns experiments ordered by creation date (newest first) with an optional status filter. Each result includes a `runCount` derived from the joined `evolution_runs` rows, giving a quick overview without loading full run details.

The `getExperimentAction` returns full experiment detail including all associated runs and computed metrics (via `computeExperimentMetrics`).

---

## UI Workflow

The experiment creation interface is a 3-step wizard located at `src/app/admin/evolution/start-experiment/page.tsx` (the `ExperimentForm` component).

### Step 1: Setup

- Enter an experiment name.
- Select a prompt from the `evolution_prompts` table (loaded via `getPromptsAction`).
- Set the per-run budget cap in USD.

### Step 2: Strategies

- Browse and multi-select from the strategy library (loaded via `getStrategiesAction`).
- Configure how many runs to create per selected strategy.
- Only `active` strategies appear in the picker.

### Step 3: Review

- Summary of all runs that will be created (strategy x count matrix).
- Validate total budget constraint: **$10 maximum total budget** across all planned runs.
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

## Experiment Metrics

Experiment metrics are now persisted in the `evolution_metrics` table with `entity_type='experiment'`. At run finalization, `propagateMetrics()` aggregates child run metrics and writes experiment-level rows. This replaces the previous on-demand `computeExperimentMetrics()` function that recomputed from raw tables on every page load.

### Metric Rows

Experiment metrics stored in `evolution_metrics` include:

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

This makes it straightforward to identify which strategy configuration produces the best results for a given prompt.

### How eloPerDollar Is Calculated

For each run, the efficiency metric is:

```
eloPerDollar = (elo - 1200) / cost
```

where `elo` is the winner variant's final Elo score and `cost` comes from the run's `cost` metric in the `evolution_metrics` table. The 1200 baseline represents the starting Elo for all variants, so eloPerDollar measures the Elo improvement purchased per dollar spent. Runs where cost is zero or Elo is null will have a null eloPerDollar.

This metric surfaces in both the per-experiment analysis (via `evolution_metrics` rows) and the cross-strategy aggregates (also via `evolution_metrics`), enabling comparison at both the individual run level and the strategy level.

---

## Key Files

| File | Purpose |
|------|---------|
| `evolution/src/services/experimentActionsV2.ts` | Experiment lifecycle server actions (create, add run, get, list, cancel) |
| `evolution/src/services/strategyRegistryActionsV2.ts` | Strategy CRUD server actions (list, create, update, clone) |
| `evolution/src/lib/pipeline/experiments.ts` | Core experiment functions (create, addRun, computeMetrics) |
| `evolution/src/lib/pipeline/strategy.ts` | Strategy hashing, labeling, and upsert-by-hash |
| `evolution/src/lib/pipeline/finalize.ts` | Run finalization: auto-completion, aggregate updates |
| `evolution/src/lib/pipeline/types.ts` | `V2StrategyConfig`, `EvolutionConfig`, `EvolutionResult` types |
| `src/app/admin/evolution/start-experiment/page.tsx` | Experiment creation wizard UI |

---

## Summary

The strategy-experiment system provides a structured workflow for comparing evolution configurations:

1. **Register strategies** with specific model and iteration parameters, deduplicated by config hash.
2. **Create experiments** that group runs for a single prompt, with budget guardrails enforced by the UI.
3. **Auto-manage lifecycle** transitions -- draft to running on first run, running to completed on finalization, with atomic cancellation via RPC.
4. **Track aggregates** across runs using Welford's algorithm for numerically stable online statistics.
5. **Analyze results** via per-run metrics (Elo, cost, eloPerDollar) and cross-strategy aggregate comparison (avg Elo, stddev, best/worst).

The V2 design intentionally keeps the action surface small: 5 experiment actions and 5 strategy actions replace V1's 17 experiment actions, reducing complexity while retaining all necessary functionality.

For details on how run costs are tracked and optimized, see [Cost Optimization](./cost_optimization.md). For the broader pipeline architecture that strategies configure, see [Architecture](./architecture.md). For the database schema backing experiments and strategies, see [Data Model](./data_model.md).
