# Strategies & Experiments

Strategies define _how_ an evolution run executes (which models, how many iterations, what budget). Experiments group multiple runs together for controlled comparison. This page covers the full lifecycle of both, from strategy registration through experiment completion, metrics computation, and aggregate reporting.

For related context see [Architecture](./architecture.md), [Data Model](./data_model.md), and [Cost Optimization](./cost_optimization.md).

---

## Strategy System

A **strategy** is a named, versioned configuration that fully specifies the models and iteration count for an evolution run. Strategies are stored in the `evolution_strategies` table and referenced by every run via `strategy_id`. The strategy system was introduced in V2 to replace V1's ad-hoc config objects with a centralized registry that enables cross-run comparison and aggregate tracking.

> **Naming convention:** *Strategy* = the `evolution_strategies` config entity (model, iterations, budget). *Tactic* = a text transformation applied during generation (e.g., `lexical_simplify`, `grounding_enhance`). A single strategy run uses multiple tactics per iteration. See `evolution/src/lib/core/tactics/` for the tactic registry.

Each strategy encapsulates:
- Which LLM generates text variants.
- Which LLM judges pairwise comparisons.
- An ordered sequence of iterations, each specifying agent type (generate/swiss) and budget percentage.
- Optional per-iteration source mode (seed vs pool) and generation guidance.
- Optional budget floors for per-iteration reservation.

Dispatch count per iteration is budget-governed, with `DISPATCH_SAFETY_CAP = 100` as a
defense-in-depth rail — there are no per-iteration `maxAgents`, strategy-level `numVariants`,
or `strategiesPerRound` fields (Phase 4 of the 2026-04-20 refactor removed all three).

### StrategyConfig

The canonical type lives in `evolution/src/lib/pipeline/types.ts`:

```ts
interface IterationConfig {
  agentType: 'generate' | 'swiss';
  budgetPercent: number;  // 1-100, all entries must sum to 100
  sourceMode?: 'seed' | 'pool';  // generate-only; default 'seed'
  qualityCutoff?: { mode: 'topN' | 'topPercent'; value: number };  // required when sourceMode='pool'
  generationGuidance?: Array<{ strategy: string; percent: number }>;  // per-iteration override
}

interface StrategyConfig {
  generationModel: string;
  judgeModel: string;
  iterationConfigs: IterationConfig[];  // ordered sequence, min 1, max 20
  budgetUsd?: number;
  generationGuidance?: Array<{ strategy: string; percent: number }>;
  maxComparisonsPerVariant?: number;               // default 15
  // Budget floors — pick ONE unit mode, parallel + sequential must match.
  minBudgetAfterParallelFraction?: number;         // 0-1 of totalBudget
  minBudgetAfterParallelAgentMultiple?: number;    // N × initial agent cost
  minBudgetAfterSequentialFraction?: number;       // 0-1 of totalBudget
  minBudgetAfterSequentialAgentMultiple?: number;  // N × actual avg cost (runtime)
  /** @deprecated Kept for 1-release backward compat. Preprocess migrates to *Fraction. */
  budgetBufferAfterParallel?: number;
  /** @deprecated Kept for 1-release backward compat. Preprocess migrates to *Fraction. */
  budgetBufferAfterSequential?: number;
}
```

| Field               | Purpose                                    |
|---------------------|--------------------------------------------|
| `generationModel`   | LLM used for text generation calls         |
| `judgeModel`        | LLM used for pairwise comparison/judging. Default: `qwen-2.5-7b-instruct` (see `DEFAULT_JUDGE_MODEL` in `src/config/modelRegistry.ts`). Selected based on empirical judge-agreement research (see `docs/research/judge_agreement_summary_tables.md`) — 100% decisive on both large-gap and close-pair comparisons with ~1.7s median latency and no thinking-mode overhead. |
| `iterationConfigs`  | Ordered array of iteration definitions. Each entry specifies `agentType` (`generate` or `swiss`), `budgetPercent` (1-100, must sum to 100 across all entries), optional `sourceMode` / `qualityCutoff` (generate only), and optional `generationGuidance` (generate only — overrides strategy-level `generationGuidance` for this iteration). First entry must be `generate` (swiss on empty pool is invalid). Max 20 entries. Dollar amounts computed at runtime: `iterationBudgetUsd = (budgetPercent / 100) * totalBudgetUsd`. Dispatch count is budget-governed — no per-iter `maxAgents` field. |
| `budgetUsd`         | Optional per-run budget cap. Per-iteration amounts derived from `iterationConfigs[].budgetPercent`. |
| `generationGuidance`| Optional weighted tactic distribution at the strategy level. Array of `{ tactic, percent }` entries where percentages must sum to 100 and tactic names must be unique. Enables weighted random tactic selection from all 24 tactics via `selectTacticWeighted()` instead of the default deterministic 3-tactic behavior. Can be overridden per-iteration via `IterationConfig.generationGuidance`. |
| `maxVariantsToGenerateFromSeedArticle` | Max generateFromSeedArticle agents per run. Excludes seed article. Default 9. |
| `maxComparisonsPerVariant` | Hard cap on pairwise comparisons per variant during ranking. Default 15. Used for deterministic cost estimation: `min(poolSize - 1, maxComparisonsPerVariant)`. |
| `minBudgetAfterParallelFraction` / `minBudgetAfterParallelAgentMultiple` | Minimum budget to reserve for later phases after parallel generation. Specified as either a fraction of total budget (0-1) or a multiple of estimated agent cost (≥ 0). Exactly one unit per strategy. Parallel uses the initial `estimateAgentCost()` output. |
| `minBudgetAfterSequentialFraction` / `minBudgetAfterSequentialAgentMultiple` | Minimum budget to reserve after sequential generation. Same two-unit system. Sequential uses `actualAvgCostPerAgent` from the parallel batch when available, falling back to initial estimate. Must be ≤ parallel floor (same unit). |
| `budgetBufferAfterParallel` / `budgetBufferAfterSequential` | **Deprecated**. Auto-migrated to `minBudgetAfter*Fraction` via Zod preprocess; kept in output for one release cycle. |
| `generationTemperature` | Optional LLM temperature (0-2) for generation calls. Omit for provider default. Validated against model's `maxTemperature` from registry (e.g., Claude max 1.0, o3-mini rejects temperature entirely). Judge/ranking calls always use temperature=0 regardless of this setting. |

#### Weighted Tactic Selection via generationGuidance

When `generationGuidance` is set, `selectTacticWeighted()` (`evolution/src/lib/core/tactics/selectTacticWeighted.ts`) uses weighted random selection from all 24 tactics. The function builds a cumulative distribution from the `percent` values and draws a tactic per slot. This replaces the default deterministic round-robin behavior that cycles through 3 tactics.

#### Experimental Verification with generationGuidance

To isolate and test a single tactic, create a strategy config with `generationGuidance` set to 100% for one tactic (e.g., `[{ strategy: "engagement_amplify", percent: 100 }]`) and `strategiesPerRound: 1`. This produces runs that use only that tactic, enabling controlled A/B comparison across tactics within an experiment.

#### Per-Iteration generationGuidance Override

Each `IterationConfig` with `agentType: 'generate'` can specify its own `generationGuidance` array, which overrides the strategy-level `generationGuidance` for that iteration only. This enables strategies that use different tactic distributions at different stages of evolution (e.g., broad exploration in early iterations, focused refinement in later ones). Swiss iterations cannot have `generationGuidance` (enforced by Zod validation).

```ts
iterationConfigs: [
  { agentType: 'generate', budgetPercent: 40,
    generationGuidance: [{ strategy: 'structural_transform', percent: 50 }, { strategy: 'grounding_enhance', percent: 50 }] },
  { agentType: 'swiss', budgetPercent: 20 },
  { agentType: 'generate', budgetPercent: 40,
    generationGuidance: [{ strategy: 'style_polish', percent: 100 }] },
]
```

#### Example iterationConfigs

A typical strategy with 1 generation round and 2 swiss rounds:
```ts
iterationConfigs: [
  { agentType: 'generate', budgetPercent: 50 },
  { agentType: 'swiss', budgetPercent: 30 },
  { agentType: 'swiss', budgetPercent: 20 },
]
```

A multi-generation strategy with interleaved swiss:
```ts
iterationConfigs: [
  { agentType: 'generate', budgetPercent: 30, maxAgents: 5 },
  { agentType: 'swiss', budgetPercent: 15 },
  { agentType: 'generate', budgetPercent: 25, maxAgents: 3 },
  { agentType: 'swiss', budgetPercent: 15 },
  { agentType: 'swiss', budgetPercent: 15 },
]
```

### Config Hashing

Each strategy config is identified by a 12-character hex hash derived from SHA-256 of `{generationModel, judgeModel, iterationConfigs}`. These three fields are hashed; `strategiesPerRound` and `budgetUsd` are excluded so that budget adjustments do not create duplicate strategies. The full `iterationConfigs` array (agent types, budget percentages, maxAgents) is included, so changing the iteration sequence creates a new strategy.

```ts
// evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts
function hashStrategyConfig(config: StrategyConfig): string {
  const normalized = {
    generationModel: config.generationModel,
    judgeModel: config.judgeModel,
    iterationConfigs: config.iterationConfigs,
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
Gen: 4.1-mini | Judge: 4.1-mini | 2×gen + 3×swiss
```

The iteration summary counts generate and swiss iterations from `iterationConfigs[]` (e.g., `2×gen + 3×swiss`). If `budgetUsd` is set, it's appended (e.g., `| Budget: $2.00`). Model names are shortened for display (`gpt-` prefix stripped, `claude-` becomes `cl-`, `deepseek-` becomes `ds-`). The label function is `labelStrategyConfig` in `findOrCreateStrategy.ts`.

### Upsert by Hash (Race-Safe)

The `upsertStrategy` function in `evolution/src/lib/pipeline/strategy.ts` uses `INSERT ... ON CONFLICT` on the `config_hash` column. Two concurrent requests with the same config will not create duplicate rows -- the second insert silently becomes a no-op and the existing row is returned. The function returns the strategy ID regardless of whether the row was inserted or already existed.

This is used by the pipeline runner at the start of each run: before execution begins, the runner calls `upsertStrategy` with the run's config to ensure a strategy row exists. The returned `strategy_id` is stored on the run row and later used for aggregate updates at finalization.

An auto-generated name is also assigned during upsert:
```
Strategy a1b2c3 (mini, 5it)
```
This uses the first 6 characters of the config hash plus the generation model suffix and `iterationConfigs.length` for quick identification.

### Strategy Status

Strategies have two statuses:

- **active** -- available for selection in new experiments and visible in the strategy picker.
- **archived** -- hidden from the strategy picker in new experiment creation but retained for historical reference. Existing runs and experiments that reference archived strategies are unaffected.

The `updateStrategyAction` in `evolution/src/services/strategyRegistryActionsV2.ts` handles toggling between these states. Archiving is a soft operation -- no data is deleted, and the strategy can be reactivated at any time.

### Strategy CRUD

The full set of strategy operations is exposed through `evolution/src/services/strategyRegistryActionsV2.ts`:

- **listStrategiesAction** -- paginated listing with optional filters by status, created_by, and pipeline_type. Returns `{ items, total }` for pagination controls.
- **getStrategyDetailAction** -- full detail for a single strategy by ID.
- **createStrategyAction** -- validates input via Zod schema (including `iterationConfigs` validation: sum to 100, first must be generate, max 20), computes config hash and auto-label, inserts the row. The admin UI provides a 2-step wizard at `/admin/evolution/strategies/new` for creating strategies with an interactive iteration builder.
- **updateStrategyAction** -- partial updates to name, description, or status.
- **cloneStrategyAction** -- duplicates an existing strategy with a new name, useful for creating variations of a known-good config.

---

## Strategy Aggregates

Strategy aggregate metrics are stored in the `evolution_metrics` table with `entity_type='strategy'` rather than as hardcoded columns on `evolution_strategies`. At run finalization, `propagateMetrics()` in TypeScript reads all child run metrics and writes aggregated strategy-level rows to the metrics table.

### Algorithm

Aggregation uses **bootstrap confidence intervals** (via `bootstrapMeanCI()` and `bootstrapPercentileCI()`) when 2+ runs are available. This replaces the previous Welford's online algorithm, enabling proper 95% CIs that propagate within-run rating uncertainty.

For scalar metrics (cost, totalVariants, eloPer$), `bootstrapMeanCI()` resamples with replacement and optionally draws from `Normal(value, uncertainty)` when rating uncertainty is present. For Elo percentile metrics (medianElo, p90Elo, maxElo), `bootstrapPercentileCI()` propagates both between-run and within-run uncertainty.

### Metric Rows

Strategy metrics in `evolution_metrics` include:

| metric_name                     | Source metric (run) | Aggregation     | Description                                  |
|---------------------------------|---------------------|-----------------|----------------------------------------------|
| `total_cost`                    | `cost`              | sum             | Total cost across all runs                   |
| `avg_cost_per_run`              | `cost`              | avg             | Mean cost per run                            |
| `total_generation_cost`         | `generation_cost`   | sum             | Total generation spend across runs           |
| `avg_generation_cost_per_run`   | `generation_cost`   | avg             | Mean generation spend per run                |
| `total_ranking_cost`            | `ranking_cost`      | sum             | Total ranking spend across runs              |
| `avg_ranking_cost_per_run`      | `ranking_cost`      | avg             | Mean ranking spend per run                   |
| `run_count`                     | `cost`              | count           | Total completed runs                         |
| `avg_final_elo`                 | `winner_elo`        | bootstrap_mean  | Mean final Elo with bootstrap CI             |
| `best_final_elo`                | `winner_elo`        | max             | Highest final Elo achieved                   |
| `worst_final_elo`               | `winner_elo`        | min             | Lowest final Elo achieved                    |

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
2. The run's strategy config determines model selection and iteration sequence (`iterationConfigs[]`). Each iteration gets its own budget tracker computed from `budgetPercent`.
3. On completion, `finalizeRun` persists results (including `iterationResults[]`), updates strategy aggregates, and triggers experiment auto-completion if applicable.
4. If the run fails or is killed, it is marked `failed` with an error message.

Administrators can monitor experiment progress through the admin UI, which polls `getExperimentAction` to display live status updates for each run.

---

## Per-Run Metrics

Each completed evolution run produces metrics persisted to the `evolution_metrics` table as individual rows keyed by `(entity_type='run', entity_id, metric_name)`. Metrics are computed by registry-driven functions and written at run finalization via `persistRunMetrics()`.

The computation draws from two source tables:

- **`evolution_variants`** — fetches the legacy DB `mu`, `sigma`, and `elo_score` columns for all variants in the run (lifted to `Rating {elo, uncertainty}` at the application layer via `dbToRating`)
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

Each metric is stored as a row in `evolution_metrics` with columns `value`, `uncertainty` (Elo-scale rating uncertainty from the source variant, nullable; renamed from `sigma`), `ci_lower`/`ci_upper` (confidence interval bounds, null at per-run level), and `n` (observation count, always 1 for single-run metrics). The `stale` flag supports lazy recomputation when source data changes (e.g., variant ratings updated by arena matches).

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
2. For each resample, if the metric carries `uncertainty > 0`, draw from `Normal(value, uncertainty)` using the Box-Muller transform instead of using the raw value. This propagates within-run rating uncertainty into the aggregate CI.
3. Compute the mean of each bootstrap sample
4. Return the 95% CI as `[2.5th percentile, 97.5th percentile]` of the 1000 bootstrap means

Single-observation behavior: when `values.length < 2`, returns `ci: null` (no interval can be computed). With 2+ observations, always computes the 95% CI.

The function accepts an optional `rng` parameter for deterministic testing via `createSeededRng()`, a Numerical Recipes LCG.

### `bootstrapPercentileCI()`

Used for Elo percentile metrics: `medianElo`, `p90Elo`, `maxElo`.

```typescript
// evolution/src/experiments/evolution/experimentMetrics.ts
export function bootstrapPercentileCI(
  allRunRatings: Array<Array<{ elo: number; uncertainty: number }>>,
  percentile: number,
  iterations = 1000,
  rng: () => number = Math.random,
): MetricValue | null
```

This function propagates two levels of uncertainty:

1. **Between-run uncertainty**: resamples which runs are included (bootstrap over runs)
2. **Within-run uncertainty**: for each variant, draws a skill sample from `Normal(elo, uncertainty)` using Box-Muller (all Elo-scale)

Each of the 1000 iterations resamples runs, draws variant skills with noise, computes the target percentile within each resampled run, then averages across runs. The final CI is the `[2.5th, 97.5th]` percentile of these 1000 averages.

### Aggregation routing

The `aggregateMetrics()` function routes each metric to the appropriate bootstrap:

| Metric | Bootstrap function | Percentile |
|--------|--------------------|------------|
| `medianElo` | `bootstrapPercentileCI` | 0.5 |
| `p90Elo` | `bootstrapPercentileCI` | 0.9 |
| `maxElo` | `bootstrapPercentileCI` | 1.0 |
| All others | `bootstrapMeanCI` | N/A |

Percentile bootstrap requires `variantRatings` (`{elo, uncertainty}` pairs) from each run. If fewer than 2 runs have valid ratings, the percentile metrics fall back to `bootstrapMeanCI`.

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
| `eloHistory` | `number[][]` | Top-K `elo` values per iteration (see below; renamed from `muHistory`) |
| `diversityHistory` | `number[]` | Diversity scores per iteration (see caveat below) |
| `matchStats` | object | `{ totalMatches, avgConfidence, decisiveRate }` |
| `topVariants` | array | Up to 10 entries: `{ id, strategy, elo, isSeedVariant }` (renamed from `isBaseline` 2026-04-14; legacy rows with `isBaseline` are auto-mapped on read) |
| `seedVariantRank` | number \| null | Final rank of the persisted seed variant (renamed from `baselineRank`). |
| `seedVariantElo` | number \| null | Final Elo of the persisted seed variant (renamed from `baselineElo`). |
| `strategyEffectiveness` | record | Per-tactic `{ count, avgElo }` (field name kept for backward compat) |
| `metaFeedback` | object or null | Always `null` in current implementation |

### Zod validation

The V3 schema (`EvolutionRunSummaryV3Schema` in `evolution/src/lib/types.ts`) enforces strict limits:

- `eloHistory`: max 100 entries
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
  EvolutionRunSummaryV3Schema,      // version: 3 — native Elo-based (current)
  EvolutionRunSummaryV2Schema,      // version: 2 — ordinal-based → V3
  EvolutionRunSummaryV1Schema,      // version: 1 — legacy Elo shape → V3
]);
```

On read, older shapes (including the prior OpenSkill-mu-based schema that used
`muHistory` / `avgMu` / `baselineMu`) are projected forward into the current Elo-scale
fields. The union tries V3 first, then V2, then V1; the first successful parse wins.

---

## eloHistory Tracking

The `eloHistory` array records the skill distribution of top variants after each iteration's ranking phase. It is built in the main evolution loop (`evolution/src/lib/pipeline/evolve-article.ts`):

1. After each iteration's ranking completes, collect all current `elo` values from the ratings map
2. Sort descending by skill estimate
3. Slice to top-K where K = `tournamentTopK` (default 5 from [config](./architecture.md))
4. Push the array of K `elo` values as one entry in `eloHistory`

This produces a 2D array: `eloHistory[iteration][rank]`. The visualization layer uses this to plot convergence curves — how quickly the top variants' skill estimates stabilize. See [Visualization](./visualization.md) for how this data is rendered. (Formerly `muHistory`.)

---

## Diversity Score

> **Warning:** Diversity tracking is declared but **not implemented** in the current V2 pipeline. The `diversityHistory` array is initialized as empty (`[]`) in `evolve-article.ts` and is never populated during the evolution loop. The `diversityScore` parameter on the evolve function defaults to `1.0` when not provided. Because the creative exploration trigger requires `0 < diversity < 0.5`, it never fires with the default value of `1.0`. The expected implementation would compute pairwise text similarity after each ranking phase, but this has not been built. Any `diversityHistory` values in existing run summaries will be empty arrays.

The `EvolutionResult` type declares `diversityHistory: number[]` and the evolve function accepts an optional `diversityScore` parameter, but the pipeline never calls the evolve function with a computed diversity value. This is a known gap — the type system and run summary schema are ready for diversity data, but the computation is missing.

---

## Tactic Effectiveness

Tactic effectiveness is computed at two levels: per-run (in the run summary) and aggregate (across runs via the metrics table).

### Per-run computation

In `buildRunSummary()` (`evolution/src/lib/pipeline/finalize.ts`), tactic effectiveness is computed via a single-pass aggregation using Welford's online mean algorithm:

```typescript
// evolution/src/lib/pipeline/finalize.ts — inside buildRunSummary()
const strategyEffectiveness = pool.reduce<Record<string, { count: number; avgElo: number }>>(
  (acc, v) => {
    const elo = ratings.get(v.id)?.elo ?? DEFAULT_ELO;
    const prev = acc[v.strategy];
    if (prev) {
      const newCount = prev.count + 1;
      acc[v.strategy] = { count: newCount, avgElo: prev.avgElo + (elo - prev.avgElo) / newCount };
    } else {
      acc[v.strategy] = { count: 1, avgElo: elo };
    }
    return acc;
  }, {});
```

This groups variants by their tactic name and computes a running average `elo`. Welford's method avoids the numerical instability of summing then dividing — each new observation incrementally adjusts the mean.

### Aggregate computation

After persisting the run, `finalizeRun()` calls `propagateMetrics()` in TypeScript. This function reads the child run's metrics from the `evolution_metrics` table and writes aggregated strategy-level and experiment-level metrics back to the same table using bootstrap confidence intervals.

When a variant's DB `mu` or `sigma` columns change post-completion (these columns back `Rating {elo, uncertainty}` via `dbToRating`; e.g., from arena matches), a DB trigger marks dependent run, strategy, and experiment metrics as `stale`. On the next read, the server action detects stale metrics and triggers lazy recomputation via `propagateMetrics()`.

---

## Key Files

| File | Purpose |
|------|---------|
| `evolution/src/services/experimentActionsV2.ts` | Experiment lifecycle server actions (create, add run, get, list, cancel) |
| `evolution/src/services/strategyRegistryActionsV2.ts` | Strategy CRUD server actions (list, create, update, clone) |
| `evolution/src/lib/pipeline/experiments.ts` | Core experiment functions (create, addRun, computeMetrics) |
| `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` | Strategy hashing (includes `iterationConfigs`), labeling, and upsert-by-hash |
| `evolution/src/lib/pipeline/finalize.ts` | Run finalization: auto-completion, aggregate updates |
| `evolution/src/lib/pipeline/infra/types.ts` | `StrategyConfig`, `EvolutionConfig`, `EvolutionResult` (with `iterationResults[]`), `IterationConfig`, `IterationResult`, `IterationStopReason` types |
| `evolution/src/experiments/evolution/experimentMetrics.ts` | Bootstrap CI functions, MetricValue type |
| `evolution/src/lib/metrics/registry.ts` | Declarative metric registry with compute functions |
| `evolution/src/lib/metrics/writeMetrics.ts` | UPSERT metrics to evolution_metrics table |
| `evolution/src/lib/metrics/recomputeMetrics.ts` | Stale metric recomputation with row-level locking |
| `src/app/admin/evolution/start-experiment/page.tsx` | Experiment creation wizard UI |
| `src/app/admin/evolution/strategies/new/page.tsx` | 2-step strategy creation wizard with iteration builder, TacticGuidanceEditor popover for per-iteration tactic weights, agent dispatch preview. Defaults: $0.05 budget, agentMultiple floor 2, maxAgents 100. |

---

## Related Documentation

- [Architecture](./architecture.md) — pipeline phases and configuration
- [Data Model](./data_model.md) — database tables referenced by metrics
- [Metrics](./metrics.md) — metrics system architecture, registry, and DB schema
- [Visualization](./visualization.md) — how metrics and eloHistory are rendered in the UI
- [Cost Optimization](./cost_optimization.md) — budget tracking and spending gates

---

## sourceMode + qualityCutoff (Phase 2)

Each generate iteration accepts two optional fields on its `IterationConfig`:

```ts
interface IterationConfig {
  agentType: 'generate' | 'swiss';
  budgetPercent: number;
  maxAgents?: number;
  sourceMode?: 'seed' | 'pool';   // default 'seed'
  qualityCutoff?: {
    mode: 'topN' | 'topPercent';
    value: number;                 // topN: integer >= 1; topPercent: 0 < x <= 100
  };
}
```

**Semantics**

- `sourceMode: 'seed'` (default): each generation agent receives the seed article as its parent.
- `sourceMode: 'pool'`: each agent receives a randomly-selected parent drawn from **variants produced by the current run only**, filtered by `qualityCutoff`. Arena entries loaded via `loadArenaEntries` (prior runs of the same prompt) participate in **ranking** as competitors but are explicitly **excluded as candidate parents** via the call-site filter in `runIterationLoop.ts` (`initialPoolSnapshot.filter((v) => !v.fromArena)`). This invariant — that a new variant's `parent_variant_id` always resolves to the seed or another variant from the same run — was added 2026-04-21; pre-fix pool-mode runs can have cross-run parent lineage and surface it via the `(other run)` pill on `VariantParentBadge`.
- First iteration (index 0) is locked to `'seed'` by schema refine — the pool is empty at start.
- `qualityCutoff` is required when `sourceMode === 'pool'`. For `mode: 'topN'` the value is an absolute count; for `mode: 'topPercent'` it is a percentile (1-100). The strategy creation wizard at `/admin/evolution/strategies/new` auto-defaults `{ mode: 'topN', value: 5 }` when the user switches an iteration to pool mode, so the user doesn't need to interact with the cutoff-mode dropdown separately.
- The parent pick uses a deterministic RNG seeded from `(runId, iteration, executionOrder)` via FNV-1a, so retries pick the same parent for the same tuple.
- If no eligible parent exists (empty filtered pool, all variants unrated, cutoff too strict), `resolveParent` falls back to seed and logs a warning. When the filter specifically dropped all candidates (i.e., pool had arena variants but no in-run variants yet), the call site emits a distinct `fallbackReason: 'no_same_run_variants'` log-context for diagnosability.
- `qualityCutoff.value` is part of the strategy-config hash: two configs that differ only by cutoff value produce different strategy IDs.

**Example** — two-iteration strategy where iteration 2 re-generates from the top 3 pool variants:

```ts
iterationConfigs: [
  { agentType: 'generate', budgetPercent: 40 },
  { agentType: 'swiss',    budgetPercent: 20 },
  { agentType: 'generate', budgetPercent: 40,
    sourceMode: 'pool', qualityCutoff: { mode: 'topN', value: 3 } },
]
```

**UI.** The strategy builder at `src/app/admin/evolution/strategies/new/page.tsx` renders a Source dropdown + quantity/unit controls for non-first generate iterations. Swiss iterations have no source controls.
