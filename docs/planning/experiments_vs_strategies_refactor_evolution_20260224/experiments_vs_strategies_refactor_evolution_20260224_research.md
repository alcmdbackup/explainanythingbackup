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
