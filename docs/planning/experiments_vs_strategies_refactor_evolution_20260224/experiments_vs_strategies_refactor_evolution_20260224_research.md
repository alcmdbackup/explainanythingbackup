# Experiments Vs Strategies Refactor Evolution Research

## Problem Statement
Consolidate experiments as a higher-level orchestration layer over strategies, simplifying the data model. Currently, the evolution pipeline has two overlapping concepts — "experiments" (factorial design testing of configuration factors) and "strategies" (pipeline configuration configs). This project will merge experiment variations into the strategy system, making each experiment variation a strategy, and unifying the data models so strategies are the single source of truth for pipeline configuration.

## Requirements (from GH Issue #559)
Experiment variations should essentially be strategies. Make sure to unify the data models.

## High Level Summary

The experiment and strategy systems share the same underlying config shape (`StrategyConfig`) but follow divergent paths to create evolution runs. Strategies go through `queueEvolutionRunAction()` which sets `strategy_config_id` upfront, while experiments generate configs via L8 factorial design and store them as inline JSONB in `evolution_runs.config` without a `strategy_config_id` — strategies are only auto-created later during `finalizePipelineRun()`. The refactor should make each experiment variation register as a strategy upfront, so experiments become orchestration over strategies rather than a parallel config system.

### Key Insight: The Gap

**Strategy path**: Admin selects strategy → `strategy_config_id` set on run → pipeline uses strategy config → `linkStrategyConfig()` only updates aggregates.

**Experiment path**: Admin picks factor levels → L8 design generates 8 configs → runs inserted with inline config + `_experimentRow` marker, **no `strategy_config_id`** → pipeline runs → `linkStrategyConfig()` auto-creates strategy from config hash → strategy gets aggregates.

The result: experiment-generated strategies appear as `is_predefined: false, created_by: 'system'` — unnamed, unconnected to their experiment. There's no FK from `evolution_experiments` → `evolution_strategy_configs`, so it's impossible to trace which strategies an experiment explored without reverse-engineering the config hash.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md — Documentation structure and reading order
- docs/docs_overall/architecture.md — System design, 60k+ LOC TypeScript, Supabase backend
- docs/docs_overall/project_workflow.md — Project workflow phases

### Relevant Docs
- evolution/docs/evolution/strategy_experiments.md — L8 orthogonal array, factor registry, experiment driver cron, admin UI
- evolution/docs/evolution/data_model.md — Core primitives: Prompt + Strategy = Run, strategy hash dedup, config propagation
- evolution/docs/evolution/architecture.md — Pipeline orchestration, agent selection, budget redistribution, config validation
- evolution/docs/evolution/cost_optimization.md — Cost attribution, strategy identity, batch experiments

## Code Files Read

### Experiment System
- `evolution/src/experiments/evolution/factorial.ts` (246 LOC) — L8 array generation, `mapFactorsToPipelineArgs()`, `generateFullFactorialDesign()`
- `evolution/src/experiments/evolution/factorRegistry.ts` (173 LOC) — 5 registered factors (genModel, judgeModel, iterations, editor, supportAgents), type-safe validation, cost-aware ordering, `expandAroundWinner()`
- `evolution/src/experiments/evolution/experimentValidation.ts` (175 LOC) — Chains: factor registry → L8 design → resolveConfig → validateStrategyConfig → validateRunConfig → cost estimation
- `evolution/src/experiments/evolution/analysis.ts` (336 LOC) — Main effects, interaction effects, factor ranking, recommendations generation
- `evolution/src/services/experimentActions.ts` (524 LOC) — 6 server actions: validate, start, status, list, cancel, getFactorMetadata
- `src/app/api/cron/experiment-driver/route.ts` (640 LOC) — 9-state machine: round_running → round_analyzing → pending_next_round → terminal states
- `src/app/admin/quality/optimization/_components/ExperimentForm.tsx` (449 LOC) — Factor toggles, prompt picker, validation preview
- `src/app/admin/quality/optimization/_components/ExperimentStatusCard.tsx` (230 LOC) — Real-time status, budget tracking, round summary
- `src/app/admin/quality/optimization/_components/ExperimentHistory.tsx` (192 LOC) — Past experiments list
- `scripts/run-strategy-experiment.ts` — CLI orchestrator for manual experiments

### Strategy System
- `evolution/src/lib/core/strategyConfig.ts` (200 LOC) — `StrategyConfig` interface, `hashStrategyConfig()` (12-char SHA256), `labelStrategyConfig()`, `extractStrategyConfig()`
- `evolution/src/services/strategyRegistryActions.ts` (434 LOC) — CRUD: get, create, update, clone, archive, delete, presets (Economy/Balanced/Quality)
- `evolution/src/lib/core/configValidation.ts` (149 LOC) — `validateStrategyConfig()`, `validateRunConfig()` — shared by both systems
- `evolution/src/lib/core/metricsWriter.ts` — `linkStrategyConfig()`: auto-creates or updates strategy after run completion
- `evolution/src/services/evolutionActions.ts` — `queueEvolutionRunAction()`, `buildRunConfig()`: sets `strategy_config_id` upfront
- `src/app/admin/quality/strategies/page.tsx` (1141 LOC) — Strategy CRUD UI with performance stats
- `src/app/admin/quality/strategies/strategyFormUtils.ts` (50 LOC) — Form ↔ config conversion

### Dashboard & Analytics
- `evolution/src/services/eloBudgetActions.ts` — Strategy leaderboard, Pareto frontier, recommendations — all query `evolution_strategy_configs`
- `evolution/src/services/costAnalyticsActions.ts` — Cost accuracy analytics join `evolution_runs → evolution_strategy_configs` via `strategy_config_id`; experiment runs filtered out by `IS NOT NULL`
- `evolution/src/services/unifiedExplorerActions.ts` — Explorer has strategy dimension but NO experiment dimension; filters via `strategy_config_id`
- `src/app/admin/quality/optimization/page.tsx` — Experiments tab and Strategy Analysis tab are completely separate, share no data

### Database Migrations
- `supabase/migrations/20260222100003_add_experiment_tables.sql` (53 LOC) — `evolution_experiments` + `evolution_experiment_rounds` tables
- `supabase/migrations/20260205000005_add_strategy_configs.sql` (90 LOC) — `evolution_strategy_configs` table + `update_strategy_aggregates()` RPC
- `supabase/migrations/20260221000002_evolution_table_rename.sql` — Table rename + RPC recreate
- `supabase/migrations/20260222100004_fix_strategy_aggregates_stddev.sql` — Current RPC with Welford stddev + `elo_sum_sq_diff`

### Batch Run System
- `evolution/scripts/run-batch.ts` — CLI batch runner; inserts runs without `strategy_config_id`
- `src/config/batchRunSchema.ts` — BatchConfig Zod schema; Cartesian product matrix expansion

### Tests
- `evolution/src/experiments/evolution/factorial.test.ts` — L8 design, factor mapping
- `evolution/src/experiments/evolution/factorRegistry.test.ts` — Factor validation, expansion
- `evolution/src/experiments/evolution/analysis.test.ts` — Main effects, ranking
- `evolution/src/experiments/evolution/experimentValidation.test.ts` — Validation pipeline
- `src/app/api/cron/experiment-driver/route.test.ts` — State machine transitions (does NOT assert on run `strategy_config_id`)
- `src/__tests__/integration/strategy-experiment.integration.test.ts` — Round-trip L8→analysis
- `evolution/src/services/strategyRegistryActions.test.ts` — Strategy CRUD
- `evolution/src/lib/core/strategyConfig.test.ts` — Hashing, labeling
- `src/app/admin/quality/strategies/strategyFormUtils.test.ts` — Form utilities
- `src/config/batchRunSchema.test.ts` — Cartesian product expansion, budget filtering

## Key Findings

### 1. Two Parallel Config Systems
**Strategies** (`evolution_strategy_configs`) and **experiments** (`evolution_experiments`) both ultimately produce `EvolutionRunConfig` objects, but via different paths:
- Strategies: Admin-curated, hash-deduped, with aggregated metrics (Elo, cost, run_count)
- Experiments: Programmatic factorial design, stored as factor definitions, no direct link to strategies

### 2. Experiment Runs Don't Pre-Link Strategies
In `experimentActions.ts:237-244`, experiment runs are inserted without `strategy_config_id`. The config is stored inline. Strategies are only auto-created via `linkStrategyConfig()` after run completion. This means:
- No upfront cost-per-strategy tracking during experiment
- No way to view "which strategies this experiment tested" in the UI
- Auto-created strategies have generic names like "Strategy abc123"

### 3. `mapFactorsToPipelineArgs()` is a Thin Wrapper Over `StrategyConfig`
The function in `factorial.ts:144-168` produces `{model, judgeModel, iterations, enabledAgents}` — exactly the fields in `StrategyConfig`. The only extra logic is agent dependency resolution (reflection required for editors).

### 4. Factor Registry = Strategy Config Schema Subset
The 5 factors in `FACTOR_REGISTRY` map to `StrategyConfig` fields:
| Factor | StrategyConfig field |
|--------|---------------------|
| genModel | generationModel |
| judgeModel | judgeModel |
| iterations | iterations |
| editor | enabledAgents (partial) |
| supportAgents | enabledAgents (partial) |

### 5. Experiment Driver Creates Next-Round Configs Without Strategy Registration
The cron state machine (`experiment-driver/route.ts`) derives Round 2+ factors via `expandAroundWinner()` and generates new runs, again without pre-creating strategies. Each round's configs are only connected to strategies post-completion.

### 6. Three Overlapping Config Systems
| System | Table | Config Source | Strategy Link |
|--------|-------|---------------|---------------|
| Manual runs | `evolution_runs` | `queueEvolutionRunAction` | `strategy_config_id` set upfront |
| Experiments | `evolution_runs` | `startExperimentAction` | None (auto-created post-run) |
| Batch runs | `evolution_runs` | `run-batch.ts` | None (auto-created post-run) |

### 7. Shared Validation Pipeline
Both systems validate through the same chain: `validateStrategyConfig()` → `validateRunConfig()`. The experiment system adds factor-level validation on top. This is a good sign — the validation layer is already unified.

### 8. `StrategyConfig` Hash Excludes `budgetCaps` and `agentModels`
The hash only includes: generationModel, judgeModel, iterations, enabledAgents, singleArticle. This means two experiment variations that differ only in budgetCaps will be deduped to the same strategy — potentially losing important experiment information.

### 9. Experiment Analysis is Strategy-Agnostic
The `analysis.ts` module works with `{_experimentRow, topElo, topEloPerDollar, totalCostUsd}` — it doesn't reference strategies at all. It maps runs by L8 row index and computes effects per factor. This module could work unchanged if experiment variations were pre-registered as strategies.

### 10. CLI Script Uses Local File State
The `run-strategy-experiment.ts` CLI stores state in `experiments/strategy-experiment.json` (gitignored), completely separate from the DB-based automated experiment system. Two parallel experiment runners with different state stores.

### 11. Optimization Dashboard: Experiments and Strategy Analysis Are Completely Disjoint
The optimization dashboard (`/admin/quality/optimization`) has separate tabs for Experiments and Strategy Analysis that share **zero data**:
- Strategy Analysis queries `evolution_strategy_configs` via `eloBudgetActions`
- Experiments tab queries `evolution_experiments` via `experimentActions`
- Experiment runs don't appear in strategy leaderboard, Pareto chart, or cost accuracy analytics
- The Unified Explorer has a strategy dimension but no experiment dimension

### 12. Experiment-Generated Strategies Already Visible in Strategy UI (After Completion)
The strategies page (`/admin/quality/strategies`) shows both `is_predefined=true` (admin-created, with edit/archive/delete) and `is_predefined=false` (auto-created by system, read-only). The `is_predefined` filter defaults to **unchecked**, so auto-created strategies appear. However, experiment-generated strategies only appear after run completion (via `linkStrategyConfig()`), have generic names, and have no connection to their source experiment.

### 13. Cron State Machine: 6 Hardcoded Assumptions About Inline Config
The experiment-driver stores configs without `strategy_config_id` at these points:
1. Run creation in `startExperimentAction` (lines 237-244)
2. Run creation in `handlePendingNextRound` (lines 459-467)
3. Run grouping by `config._experimentRow` in `mapRunsForAnalysis` (line 80)
4. `writeTerminalState` stores `bestConfig` as raw JSONB, not a strategy reference (line 543)
5. Factor partitioning reads from `exp.factor_definitions`, not strategy configs (lines 314-346)
6. `expandAroundWinner()` uses factor registry directly, not strategy metadata (line 338)

### 14. Batch Run System Should NOT Be Merged Into Strategies
The `evolution_batch_runs` table serves as an **execution-grouping layer** (not a config layer). It:
- Is the FK target for `evolution_experiment_rounds.batch_run_id`
- Groups individual `evolution_runs` for status polling and cost rollup
- Stores execution plans, not strategy configs
- Is orthogonal to strategy identity — a batch groups runs that may span multiple strategies

The batch system's CLI also doesn't set `strategy_config_id` on runs, but this is a separate fix (pre-link strategies in `run-batch.ts` too).

### 15. `_experimentRow` Marker Is the Only Grouping Mechanism
The `_experimentRow` integer (embedded in `evolution_runs.config` JSONB) is the sole way to group runs back to their L8 design row for analysis. It's not a column, not a FK — just an ad-hoc JSONB field. If experiment variations become strategies, this grouping can be preserved (just add `_experimentRow` alongside `strategy_config_id`) but should eventually migrate to a proper column or junction table.

## Answered Open Questions

### Q1: Should the factor registry be integrated into strategy creation UI?
**Answer: Not in this project.** The factor registry is experiment-specific metadata (validation, ordering, expansion). Strategies have their own creation flow with free-form fields validated by `validateStrategyConfig()`. The two can coexist — experiments use the factor registry to generate strategies, but the strategy CRUD UI doesn't need it.

### Q2: How to handle experiment analysis after unification?
**Answer: No changes needed.** The analysis engine (`analysis.ts`) works with `_experimentRow` indices and Elo values — it never references strategies. Each experiment variation will have a `strategy_config_id` AND an `_experimentRow`, both set at run creation. Analysis uses `_experimentRow`, strategy leaderboard uses `strategy_config_id`. Orthogonal.

### Q3: Should `evolution_experiments` table be kept or removed?
**Answer: Keep.** The experiment table provides orchestration that strategies don't have: multi-round progression, convergence detection, factor definitions, budget tracking. Experiments become a higher-level concept that **orchestrates strategies** — each experiment round generates a set of strategies and runs them.

### Q4: What about the batch run system?
**Answer: Fix batch runs too (minor scope addition).** `run-batch.ts` should also pre-register strategies and set `strategy_config_id` on created runs. Same pattern as experiment unification. The `evolution_batch_runs` table itself stays as-is (execution grouping).

### Q5: Budget tracking divergence?
**Answer: Both can coexist.** Experiment `spent_usd` tracks total experiment cost across all rounds. Strategy `total_cost_usd` tracks per-strategy cost across all runs. With pre-linked strategies, both update independently and correctly — experiment budget is the sum of all strategy costs within the experiment.

## Critical Review Findings (Round 3)

### Corrected Assumptions

#### C1. `resolveOrCreateStrategy()` Has a TOCTOU Race Condition
The proposed helper uses SELECT-by-hash → INSERT-if-not-found. Two concurrent experiment runs with identical configs can both SELECT and find nothing, then both INSERT. One fails on `config_hash UNIQUE` constraint. The existing `linkStrategyConfig()` in `metricsWriter.ts` has the same race — it logs a warning and returns without aggregates, silently dropping the run from the leaderboard. **Fix: Must use `INSERT ... ON CONFLICT (config_hash) DO NOTHING` + re-SELECT, or an upsert pattern.**

#### C2. `created_by` CHECK Constraint Blocks 'experiment'
`supabase/migrations/20260207000007_strategy_lifecycle.sql` has:
```sql
CHECK (created_by IN ('system', 'admin'))
```
Adding `'experiment'` requires a new migration to drop/recreate this constraint. The TypeScript type in `strategyConfig.ts:40` also needs updating: `created_by: 'system' | 'admin' | 'experiment'`.

#### C3. `strategy_config_id` Is Currently Nullable (Intentionally)
Migration `20260207000008` enforced NOT NULL but `20260215000001` **reverted it**. Currently nullable. Pre-linking is safe; no constraint change needed.

#### C4. Welford Mean Initialization Bug in `update_strategy_aggregates` RPC
The current RPC (migration `20260222100004`) has a bug: when `avg_final_elo IS NULL` (first run), `v_delta = p_final_elo - COALESCE(avg, p_final_elo) = 0`, so `v_new_mean = 0 + 0/1 = 0`. The first run's Elo is always recorded as 0. This is a **pre-existing bug** not introduced by this refactor but should be fixed alongside it.

#### C5. `experiment-driver/route.test.ts` Will Break
The test file has **zero mocks for `evolution_strategy_configs`**. The `mockFrom` dispatch only handles experiment/run/batch tables. Any new strategy lookups in the cron driver will fall through to `createChain({ data: null, error: null })`, causing silent failures or thrown errors. Test mocks must be extended.

#### C6. `strategies/page.tsx` — Noise Problem Is Real
The page has **no pagination** and defaults to showing all strategies (predefined filter unchecked). If an experiment generates 8 L8 rows × 3 rounds = 24 strategies, they'd flood the list with opaque names like "Strategy a1b2c3". **Need to either: default `predefinedOnly=true`, or add a `created_by` filter.**

#### C7. `getRecommendedStrategyAction` Has Hardcoded `run_count >= 3` Gate
Experiment strategies with a single prompt get exactly 1 run each — they'd never appear in recommendations. With 3 prompts, they'd just barely qualify. This is acceptable behavior (recommendations should be well-tested strategies) but should be documented.

#### C8. `extractStrategyConfig()` Silently Drops `agentModels`
The function at `strategyConfig.ts:130-152` does NOT include `agentModels` in the returned `StrategyConfig`. Strategies auto-created from runs always have `agentModels: undefined`, even if the run had per-agent overrides. This is a pre-existing data fidelity issue. The label function also can't show overrides because it receives the already-stripped config.

#### C9. Killed/Failed/Paused Runs Skip `finalizePipelineRun`
5 code paths skip `finalizePipelineRun()`: killed runs, budget-exceeded (paused), LLM refusal, max continuations, and fatal errors. If `strategy_config_id` is pre-set at creation, these runs would reference a strategy that never gets aggregate updates. This is acceptable — the strategy row exists, the run is linked, but `run_count` correctly reflects only completed runs.

#### C10. `source` Field Is Pure Metadata
The `source` column on `evolution_runs` has **no CHECK constraint** and is **never read by application code**. It's purely for debugging. No impact on strategy linking.

#### C11. `enabledAgents: undefined` vs Explicit List Produce Different Hashes
`hashStrategyConfig()` conditionally includes `enabledAgents` only when defined. Two configs with identical effective agent behavior but one using `undefined` (all agents) and the other listing all agents explicitly would produce **different hashes** and thus different strategies. The `resolveOrCreateStrategy()` helper should normalize `enabledAgents` (e.g., convert `undefined` to explicit full list or always omit if all agents enabled).

#### C12. Experiment Strategy Reuse Contaminates Isolation
If an experiment tests a config that already has a strategy (from a prior experiment or manual run), the existing strategy's aggregates would be updated. This is **desirable** for the strategy leaderboard (more data = better signal) but means experiment analysis cannot rely on strategy-level metrics for per-experiment comparisons. The L8 analysis using `_experimentRow` is unaffected since it reads Elo from `run_summary`, not from strategies.

#### C13. Existing Experiment Runs Need Backfill
Existing experiment runs have `strategy_config_id = NULL`. The `backfill-prompt-ids.ts` script provides the exact pattern: SELECT runs WHERE source LIKE 'experiment:%' AND strategy_config_id IS NULL, hash config, find-or-create strategy, UPDATE run. Low priority since the experiment system is relatively new.

## Refactoring Scope Summary (Revised)

### Must Change (Core Unification)
| File | Change |
|------|--------|
| `experimentActions.ts` (`startExperimentAction`) | For each L8 row: resolve config → `resolveOrCreateStrategy()` → set `strategy_config_id` on run |
| `experiment-driver/route.ts` (`handlePendingNextRound`) | Same pattern for full-factorial rows |
| `experiment-driver/route.ts` (`writeTerminalState`) | Store `bestStrategyId` (FK) instead of raw `bestConfig` JSONB |
| New migration | DROP/recreate `strategy_configs_created_by_check` to add `'experiment'` |
| `strategyConfig.ts` | Add `'experiment'` to `created_by` type union |
| `experiment-driver/route.test.ts` | Add `evolution_strategy_configs` mocks to all setup functions |

### Must Create (New Code)
| File | Purpose |
|------|---------|
| New: `resolveOrCreateStrategy()` helper | Atomic upsert: `INSERT ... ON CONFLICT (config_hash) DO NOTHING` + re-SELECT. Normalize `enabledAgents`. Set `created_by` per source. |
| New: backfill script | Backfill `strategy_config_id` on existing experiment runs |

### Should Change (Consistency + UX)
| File | Change |
|------|--------|
| `run-batch.ts` | Pre-register strategies on batch runs too |
| `strategies/page.tsx` | Add `created_by` filter or default `predefinedOnly=true` to prevent noise |

### Pre-Existing Bugs to Fix Alongside
| File | Bug |
|------|-----|
| `update_strategy_aggregates` RPC | Welford mean initialization: first run Elo recorded as 0 |
| `metricsWriter.ts` (`linkStrategyConfig`) | TOCTOU race: SELECT-then-INSERT can fail silently on hash collision |

### Confirmed No Change Needed
| File | Reason | Verification |
|------|--------|-------------|
| `factorial.ts` | L8 design generation is strategy-agnostic | Confirmed |
| `factorRegistry.ts` | Factor definitions are experiment metadata | Confirmed |
| `analysis.ts` | Works on `_experimentRow`, never references strategies | Confirmed |
| `configValidation.ts` | Already shared; no double-validation issue | Confirmed |
| `unifiedExplorerActions.ts` | Filters by `strategy_config_id`; trend view caps top 10 | Confirmed |
| `metricsWriter.ts` (early-return path) | When `strategy_config_id` set, calls `updateStrategyAggregates` only | Verified at lines 55-58 |
| `ExperimentStatusCard.tsx` | Works as-is; strategy info is an optional enhancement | Confirmed |
| `experimentValidation.ts` | Validation stays experiment-level; strategy resolution is separate | Confirmed |

---

## Deep Dive Findings (4-Agent Exploration)

Four parallel deep-dive agents explored the strategy lifecycle, experiment flow, metrics/analytics pipeline, and UI integration. Below are new findings that supplement the original research.

### Strategy Lifecycle Details

#### Strategy Creation Has Built-In Dedup + Promote Logic
`strategyRegistryActions.ts:114-118` — When an admin creates a strategy whose `config_hash` matches an existing auto-created one, it **promotes** the existing row to `is_predefined: true, created_by: 'admin'` instead of inserting a duplicate. This means experiment-generated strategies can be "adopted" into the curated set without data loss.

#### Strategy Update Archives Old When Config Changes
`strategyRegistryActions.ts:226-239` — If admin edits a predefined strategy's config AND it has `run_count > 0`, the old row is **archived** and a new row created. This preserves historical aggregates. The `resolveOrCreateStrategy()` helper doesn't need to worry about this — it only does find-or-create, never updates config.

#### Strategy Presets: Economy / Balanced / Quality
`strategyRegistryActions.ts:382-422` — Three built-in presets seed the strategy table. These are always `is_predefined: true, created_by: 'admin'`. Experiment-generated strategies should never collide with these unless an experiment happens to test the exact same config (which would be a valid dedup).

#### `update_strategy_aggregates` RPC Concurrency Details
Migration `20260222100004`, lines 13-25:
- `SET LOCAL statement_timeout = '5s'` prevents deadlock hangs
- `SELECT ... FOR UPDATE` serializes concurrent aggregate updates to the same strategy
- This means multiple experiment runs completing simultaneously for the same strategy are safe — they serialize at the DB level

#### Hash Collision Risk Is Negligible
SHA256 → 12 hex chars = 2^48 ≈ 281 trillion possibilities. For typical experiments (8 L8 rows × 3 rounds = 24 configs), collision is astronomically unlikely. Not a concern.

#### `enabledAgents: []` Is a Third Hash Variant
Besides `undefined` (omitted from hash) and explicit sorted list (included), empty array `[]` also produces a different hash since it's truthy but empty. The normalization in `resolveOrCreateStrategy()` should handle all three cases.

### Experiment System Additional Details

#### `expandAroundWinner()` Produces Up to 3 Neighbors
`factorRegistry.ts:19-46` — For continuous/ordinal factors, expands to ±1 index neighbors around the winning value in the ordered value list. Binary factors (editor, supportAgents) always expand to both levels. This means Round 2+ can test 3^N combinations for N important continuous factors.

#### ITERATION_LEVELS Are Non-Linear
Factor registry defines iteration levels as `[2, 3, 5, 8, 10, 15, 20, 30]`. Expansion around winner=10 would produce `[8, 10, 15]`. This is important for strategy naming — experiment strategies for iterations will have specific known values.

#### Round 2+ Uses `generateFullFactorialDesign()`, Not L8
`experiment-driver/route.ts:444` — After screening (L8), refinement rounds generate Cartesian product of expanded factors. Row index is `idx + 1`. With 2 important factors expanded to 3 levels each, that's 9 factorial rows per round.

### Metrics & Analytics Pipeline Details

#### Elo Rating Flow (Complete Path)
```
In-memory Glicko2 ratings (ctx.state.ratings)
  → ordinalToEloScale() conversion
  → Persisted in evolution_variants.elo_score (per-variant)
  → Top variant's Elo → run_summary.topVariants[0].ordinal
  → Same top Elo → update_strategy_aggregates(p_final_elo)
  → Strategy aggregates: avg_final_elo, best/worst, stddev
```

#### `finalizePipelineRun()` Orchestration
`metricsWriter.ts:161-167` — Runs 5 tasks in parallel:
1. `persistSummary()` — run_summary JSONB
2. `persistVariants()` — evolution_variants table
3. `persistAgentMetrics()` — evolution_run_agent_metrics
4. `persistCostPredictionBlock()` — cost_prediction JSONB
5. `linkStrategyConfig()` — strategy find/create + aggregate update

Then sequentially: `autoLinkPrompt()` → `feedHallOfFame()` → `pruneCheckpoints()`

With pre-linked strategies, `linkStrategyConfig()` hits the early-return path (lines 55-58) and only calls `updateStrategyAggregates()`.

#### `run_summary` vs Strategy Aggregates: Different Granularity
- **`run_summary`** (`EvolutionRunSummary`): Captures intra-run temporal data — `ordinalHistory[]` per iteration, `diversityHistory[]`, `matchStats`, top 5 variants, `strategyEffectiveness` per agent strategy, `metaFeedback`
- **Strategy aggregates**: Cross-run statistics — avg/best/worst Elo, stddev, total cost, run count
- Experiment analysis uses `run_summary` data (via `_experimentRow` grouping), never strategy aggregates — so the two systems are orthogonal

#### Two Distinct Cost Accuracy Analytics
| Action | File | Strategy Filter | Scope |
|--------|------|-----------------|-------|
| `getStrategyAccuracyAction` | `costAnalyticsActions.ts:21-82` | `.not('strategy_config_id', 'is', null)` | Per-strategy accuracy deltas |
| `getCostAccuracyOverviewAction` | `costAnalyticsActions.ts:104-199` | None | All completed runs, strategy-agnostic |

With pre-linked strategies, `getStrategyAccuracyAction` will include experiment runs immediately (no delay waiting for finalization linking).

#### Explorer Includes Unlinked Runs But Doesn't Group Them
`unifiedExplorerActions.ts:applyRunFilters` — No `IS NOT NULL` filter. Runs without `strategy_config_id` appear in table view but return empty array from `getDimensionValues('strategy')`, so they don't contribute to strategy-dimension grouping in matrix/trend views. With pre-linking, all experiment runs become first-class strategy dimension members.

#### Key Database Indexes for Query Performance
| Index | Table | Column(s) |
|-------|-------|-----------|
| `idx_evolution_runs_strategy` | `evolution_runs` | `strategy_config_id` |
| `idx_evolution_runs_summary_gin` | `evolution_runs` | `run_summary` (GIN) |
| `idx_strategy_configs_hash` | `evolution_strategy_configs` | `config_hash` |
| `idx_strategy_configs_elo_per_dollar` | `evolution_strategy_configs` | `avg_elo_per_dollar DESC NULLS LAST` |

The `config_hash` index supports the upsert lookup in `resolveOrCreateStrategy()`. GIN index on `run_summary` supports the experiment analysis queries.

### UI Integration Details

#### Strategy Page CRUD Restrictions
`strategies/page.tsx:1026-1100`:
- **Edit**: Only `is_predefined && status === 'active'`
- **Archive**: Only `is_predefined && status === 'active'`
- **Delete**: Only `is_predefined && run_count === 0`
- **Clone**: Available for ALL strategies (including auto-created)

This means experiment-generated strategies (`is_predefined: false`) are read-only + cloneable. Admin can clone an experiment winner into a named predefined strategy — a natural "promote experiment result" workflow.

#### Optimization Dashboard Has 5 Tabs, Not 2
`optimization/page.tsx:32-40`:
| Tab | Content | Data Source |
|-----|---------|-------------|
| `strategy` | Leaderboard, Pareto chart, recommended strategy | `eloBudgetActions` → `evolution_strategy_configs` |
| `agent` | Agent ROI analysis | Agent-level metrics |
| `cost` | Cost analysis | `costAnalyticsActions` |
| `accuracy` | Cost accuracy panel | `costAnalyticsActions` |
| `experiments` | ExperimentForm + StatusCard + History | `experimentActions` → `evolution_experiments` |

Strategy and Experiments tabs share **zero data** — no cross-references, no links between them.

#### ExperimentForm Validation Flow
`ExperimentForm.tsx:149-173`:
1. Client-side fast-fail: 2-7 factors, 1-10 prompts, budget > 0
2. Server-side debounced (500ms): `validateExperimentConfigAction()` → factor registry → L8 design → resolveConfig → validateStrategyConfig → validateRunConfig → cost estimation
3. Shows preview with run count, estimated cost, errors/warnings

The validation chain already calls `validateStrategyConfig()` — no additional validation needed for pre-registering strategies.

#### ExperimentStatusCard Polls Every 15 Seconds
`ExperimentStatusCard.tsx:83-89` — Auto-refresh for active experiments. Stops on terminal states. With pre-linked strategies, this card could optionally show strategy names for each L8 row's runs.

#### `StrategyConfigDisplay` Is Already Shared
`StrategyConfigDisplay.tsx:55-159` — 3-column grid (Models, Execution, Budget Allocation) used in:
- Strategy leaderboard expansion
- Strategy detail modal
- Could be reused in ExperimentStatusCard to show per-row strategy config

#### Explorer Only Loads Active Strategies
`explorer/page.tsx:429` — `getStrategiesAction({ status: 'active' })`. Archived strategies are excluded from explorer filters. Experiment-generated strategies default to `status: 'active'`, so they'll appear immediately.

### UI Integration Opportunities (Post-Refactor)

These are not required for the core unification but represent natural follow-ups:

1. **Experiment → Strategy cross-reference**: After experiment completes, show which strategy IDs were tested in ExperimentHistory expansion
2. **Strategy → Experiment provenance**: In strategy detail, show "Created by Experiment X, Round Y" when `created_by = 'experiment'`
3. **`created_by` filter on strategies page**: Add dropdown (all / admin / experiment / system) to replace binary `predefinedOnly` checkbox
4. **Clone experiment winner**: ExperimentStatusCard could have "Promote to Predefined" button that clones the winning strategy with a user-provided name
5. **Strategy leaderboard in experiments tab**: Show mini-leaderboard of strategies created by the active/selected experiment

---

## Implementation Deep Dive (Round 2 Exploration)

Four focused agents explored upsert patterns, test infrastructure, migration patterns, and naming conventions. Below are implementation-specific findings.

### `resolveOrCreateStrategy()` Design Options

#### Option A: Supabase `.upsert()` (Simplest)
The codebase already uses `.upsert()` in 12+ locations. Key examples:
- `metricsWriter.ts:223` — batch agent metrics via `{ onConflict: 'run_id,agent_name' }`
- `persistence.ts:40-42` — checkpoint upsert via `{ onConflict: 'run_id,iteration,last_agent' }`
- `hallOfFameIntegration.ts:162` — hall of fame entries

The `config_hash` column already has a non-partial unique index (`idx_strategy_configs_hash`), so `.upsert()` can infer the conflict target. Partial indexes break inference — learned from `20260224000001_fix_hall_of_fame_upsert_index.sql`.

**Caveat**: `.upsert()` would UPDATE existing rows on conflict. Need `ignoreDuplicates: true` option to avoid overwriting existing strategy names/labels.

```typescript
const { data } = await supabase
  .from('evolution_strategy_configs')
  .upsert({
    config_hash: configHash,
    name: strategyName,
    label: labelStrategyConfig(stratConfig),
    config: stratConfig,
    created_by: 'experiment',
  }, { onConflict: 'config_hash', ignoreDuplicates: true })
  .select('id')
  .single();
```

#### Option B: PostgreSQL RPC (Most Reliable)
Follows proven patterns from `claim_evolution_run()` and `update_strategy_aggregates()`:
- Both use `SELECT ... FOR UPDATE` to serialize concurrent access
- Both use `SET LOCAL statement_timeout = '5s'` for deadlock protection
- `claim_evolution_run` RPC is in `20260214000001_claim_evolution_run.sql`
- `update_strategy_aggregates` RPC is in `20260215000003_strategy_aggregates_for_update.sql`

```sql
CREATE OR REPLACE FUNCTION resolve_or_create_strategy(
  p_config_hash TEXT, p_config JSONB, p_label TEXT, p_name TEXT, p_created_by TEXT
) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  SET LOCAL statement_timeout = '5s';
  SELECT id INTO v_id FROM evolution_strategy_configs
    WHERE config_hash = p_config_hash FOR UPDATE LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;
  INSERT INTO evolution_strategy_configs (config_hash, name, label, config, created_by)
    VALUES (p_config_hash, p_name, p_label, p_config, p_created_by)
    ON CONFLICT (config_hash) DO NOTHING;
  SELECT id INTO v_id FROM evolution_strategy_configs WHERE config_hash = p_config_hash;
  RETURN v_id;
END; $$ LANGUAGE plpgsql;
```

#### Option C: Application-Level Retry
Catches `23505` (unique_violation) on INSERT failure and retries SELECT. Least clean but requires no migration.

#### Recommendation
**Option A (`.upsert()` with `ignoreDuplicates`) for simplicity** — matches the 12+ existing usages in the codebase. The `config_hash` unique index is non-partial, so inference works. Reserve Option B (RPC) only if contention becomes an issue.

### Existing Find-or-Create Patterns

| Pattern | File | Lines | Notes |
|---------|------|-------|-------|
| `findOrCreateTopic()` | `hallOfFameIntegration.ts` | 31-45 | SELECT then INSERT, no race protection |
| `getOrCreateExperimentTopic()` | `experimentActions.ts` | 107-126 | SELECT then INSERT, throws on error |
| `createWhitelistTermImpl()` | `linkWhitelist.ts` | 42-82 | SELECT then INSERT, checks PGRST116 |
| `backfillStrategyConfigIds()` | `backfill-prompt-ids.ts` | 202-295 | Bulk find-or-create for strategies — **exact pattern for backfill** |

### `linkStrategyConfig()` Race Condition Details
`metricsWriter.ts:63-88` — The existing implementation:
1. SELECT by `config_hash` → if found, use it (line 63-67)
2. If not found, INSERT new row (line 73-82)
3. If INSERT fails (duplicate key), logs warning and **returns without linking** (line 85-86)
4. Run ends up with `strategy_config_id = NULL` — silently dropped from leaderboard

The `resolveOrCreateStrategy()` helper will also fix this existing bug by using `.upsert()` with `ignoreDuplicates` + re-SELECT.

### Experiment-Driver Test Mock Structure

#### Current `createChain()` Pattern
`route.test.ts:129-147`:
```typescript
function createChain(resolved = { data: null, error: null }) {
  const chain = {};
  const methods = ['select', 'insert', 'update', 'eq', 'in', 'order', 'limit', 'single'];
  for (const m of methods) {
    chain[m] = jest.fn();
    chain[m] = m === 'single' ? mockResolvedValue(resolved) : mockReturnValue(chain);
  }
  chain.then = (resolve) => resolve(resolved);  // Makes chain thenable
  return chain;
}
```

#### Tables Currently Mocked in `mockFrom` Dispatch
| Table | Operations | Test Coverage |
|-------|-----------|---------------|
| `evolution_experiments` | SELECT, UPDATE | All state transitions |
| `evolution_experiment_rounds` | SELECT, INSERT, UPDATE | Round creation/analysis |
| `evolution_runs` | SELECT, INSERT | Run creation/status |
| `evolution_batch_runs` | INSERT | Batch creation |
| `topics` | SELECT | Prompt topic FK |
| `explanations` | INSERT | Prompt explanation records |
| `evolution_strategy_configs` | **NOT MOCKED** | **Must add** |

#### Adding Strategy Config Mocks
Add to the `mockFrom` dispatch (around line 199):
```typescript
if (table === 'evolution_strategy_configs') {
  return createChain({
    data: { id: 'strategy-1', config_hash: 'abc123def456' },
    error: null
  });
}
```

For `.upsert()` calls, the chain needs an additional mock:
```typescript
chain.upsert = jest.fn().mockReturnValue(chain);
```

#### Alternative: Proxy-Based Pattern
`strategyRegistryActions.test.ts:8-32` uses a more flexible approach with `Proxy` and a queue-based `fromResults` map. This auto-creates any chained method on demand, avoiding hardcoded method lists. Could be adopted if the experiment-driver tests grow too complex.

### Migration Patterns

#### CHECK Constraint Modification Pattern
From `20260216000001_add_continuation_pending_status.sql`:
```sql
BEGIN;
  ALTER TABLE evolution_strategy_configs
    DROP CONSTRAINT evolution_strategy_configs_created_by_check;
  ALTER TABLE evolution_strategy_configs
    ADD CONSTRAINT evolution_strategy_configs_created_by_check
    CHECK (created_by IN ('system', 'admin', 'experiment'));
COMMIT;
```

The `BEGIN/COMMIT` wrapper is **essential** — without it, concurrent writes between DROP and ADD could insert invalid values.

#### Migration Naming Convention
Format: `YYYYMMDDHHMMSS_description.sql`. Latest migration is `20260224000001`. Next available: `20260225000001` or later.

#### Welford Bug Fix Details
`20260222100004_fix_strategy_aggregates_stddev.sql`, line 37:
```sql
v_new_mean := COALESCE(v_old.avg_final_elo, 0) + v_delta / v_new_count;
```
When `avg_final_elo IS NULL` (first run): `v_delta = 0` (line 36), so `v_new_mean = 0 + 0/1 = 0`.

**Fix**: Change `COALESCE(v_old.avg_final_elo, 0)` to `COALESCE(v_old.avg_final_elo, p_final_elo)`:
```sql
v_new_mean := COALESCE(v_old.avg_final_elo, p_final_elo) + v_delta / v_new_count;
```
This way first run: `v_new_mean = p_final_elo + 0/1 = p_final_elo` (correct).

### Backfill Script Pattern
`backfill-prompt-ids.ts:202-295` already has `backfillStrategyConfigIds()` — the **exact pattern** for our backfill:
1. SELECT runs WHERE `strategy_config_id IS NULL`
2. For each: extract config → hash → find or create strategy
3. UPDATE run with `strategy_config_id`
4. Returns `{ linked, created, unlinked }` counts
5. Idempotent: `WHERE ... IS NULL` prevents double-processing

Our experiment backfill would add a `WHERE source LIKE 'experiment:%'` filter and set `created_by = 'experiment'` on created strategies.

### Strategy Naming Conventions

#### Existing Name Functions
| Function | File | Format | Example |
|----------|------|--------|---------|
| `labelStrategyConfig()` | `strategyConfig.ts:80-104` | `Gen: {model} \| Judge: {model} \| {n} iters` | `Gen: ds-chat \| Judge: gpt-5-nano \| 3 iters` |
| `defaultStrategyName()` | `strategyConfig.ts:106-110` | `Strategy {hash} ({model}, {n}it)` | `Strategy abc123 (mini, 5it)` |
| `shortenModel()` | `strategyConfig.ts:71-77` | Strips prefixes | `gpt-4.1-mini` → `4.1-mini` |
| Auto-name in `linkStrategyConfig` | `metricsWriter.ts:77` | `Strategy {hash6}` | `Strategy abc123` |

#### Proposed Experiment Strategy Naming
All pieces available at run creation time:
- `experiment.name` — user-provided experiment name
- `round.round_number` — which round
- `run.row` — L8 row index (1-8)
- `run.factors` — resolved factor values per row
- `pipelineArgs` — model names, iterations, agents

Proposed format: `{expName} R{round}/#{row} ({label})`
Example: `MyExperiment R1/#3 (Gen: ds-chat | Judge: gpt-5-nano | 8 iters)`

The `label` part reuses `labelStrategyConfig()`. The prefix adds experiment context. Strategies created by duplicate configs across experiments keep their original name (first-write wins with `ignoreDuplicates`).

### Batch Runner Gap
`evolution/scripts/run-batch.ts:131-141` — Inserts runs with `batch_run_id` but no `strategy_config_id`. Sets status to `'claimed'` immediately (line 138) and executes pipeline inline (lines 150-165), bypassing the queue. The fix mirrors experiments: call `resolveOrCreateStrategy()` before run insertion and pass the resulting ID.

`src/config/batchRunSchema.ts:134-187` — `expandBatchConfig()` generates Cartesian product from matrix fields (generationModels × judgeModels × iterations × agentModelVariants × prompts). Each `ExpandedRun` has all config fields needed to construct a `StrategyConfig` and call `resolveOrCreateStrategy()`.
