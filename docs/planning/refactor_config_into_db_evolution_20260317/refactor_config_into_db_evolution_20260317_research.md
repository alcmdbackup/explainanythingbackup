# Refactor Config Into DB Evolution Research

## Problem Statement
Refactor strategy config so it is linked from run, not contained in run. Currently, when a run is queued, key strategy fields are snapshot-copied into the run's `config` JSONB column (`maxIterations`, `budgetCapUsd`, `generationModel`, `judgeModel`, `enabledAgents`, `singleArticle`). This creates data duplication between `evolution_runs.config` and `evolution_strategy_configs.config`. The goal is to make runs reference the strategy config via FK at execution time rather than maintaining an inline snapshot.

## Requirements (from GH Issue #TBD)
Refactor strategy config so it is linked from run, not contained in run. Refactor the run config so that it is stored in the DB.

## High Level Summary

### Current Architecture
The evolution system has a **dual-storage model** for run configuration:
1. **Inline JSONB** — `evolution_runs.config` (NOT NULL, defaults to `'{}'`) stores a snapshot of strategy fields at queue time
2. **FK reference** — `evolution_runs.strategy_config_id` (NULLABLE) points to `evolution_strategy_configs` for metrics aggregation

### V2 Pipeline is Active Production Path
- V1 pipeline code (agents, supervisor, checkpoint/resume) was **deleted** in commit 4f03d4f6 (March 16, 2026)
- All runs now execute via `executeV2Run()` in `evolution/src/lib/v2/runner.ts`
- V1 modules still reused: types, config, rating, comparison, cost tracking, logger, strategy config

### V2 Config is Dramatically Simpler
V2 only uses **4 fields** from the run config at execution time:
- `maxIterations` → `iterations`
- `budgetCapUsd` → `budgetUsd`
- `judgeModel`
- `generationModel`

The remaining 3 fields (`strategiesPerRound`, `calibrationOpponents`, `tournamentTopK`) are hardcoded defaults in V2's `resolveConfig()`.

V1's nested config (expansion, calibration, tournament, enabledAgents, singleArticle) is **dead code** — stored in DB but never consumed at runtime.

### Admin UI Already Reads from Strategy, Not Run Config
All UI components that display config info read from `strategy.config` (via `getStrategyDetailAction`), not from `run.config`. The only backend consumers of `run.config` are:
- `evolutionRunnerCore.ts` (line 88): `resolveConfig(claimedRun.config ?? {})`
- `experimentActions.ts` (line 453): building config labels with `buildConfigLabel()`

### Key Finding: The Refactoring is Largely About Cleanup
Since V2 only needs 4 config fields and the strategy already stores them, the refactoring is mostly:
1. Make `strategy_config_id` NOT NULL on runs
2. Have the runner read config from strategy FK instead of inline JSONB
3. Remove the `config` JSONB column (or deprecate it)
4. Fix the local CLI to create a strategy when creating a run

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md — Pipeline phases, config validation, agent gating
- evolution/docs/evolution/data_model.md — Strategy system, config propagation, migrations
- evolution/docs/evolution/reference.md — DEFAULT_EVOLUTION_CONFIG, resolveConfig(), model routing, budget caps
- evolution/docs/evolution/strategy_experiments.md — Experiment config flow, strategy pre-registration
- evolution/docs/evolution/cost_optimization.md — Cost estimation uses config, strategy identity/hashing
- evolution/docs/evolution/entity_diagram.md — Entity relationships
- evolution/docs/evolution/rating_and_comparison.md — Rating system (no direct config dependency)
- evolution/docs/evolution/arena.md — Arena sync (no direct config dependency)
- evolution/docs/evolution/visualization.md — UI reads strategy.config, not run.config
- evolution/docs/evolution/experimental_framework.md — Metrics framework
- evolution/docs/evolution/curriculum.md — Learning guide, Module 6: Config System
- evolution/docs/evolution/minicomputer_deployment.md — Batch runner deployment
- evolution/docs/evolution/agents/overview.md — Agent config consumption (V1, now dead)

## Code Files Read

### Config System
- `evolution/src/lib/config.ts` (91 lines) — DEFAULT_EVOLUTION_CONFIG, resolveConfig() with deep merge, MAX_RUN_BUDGET_USD=$1.00, MAX_EXPERIMENT_BUDGET_USD=$10.00
- `evolution/src/lib/types.ts` (863 lines) — EvolutionRunConfig interface (14 fields, nested objects for expansion/generation/calibration/tournament)
- `evolution/src/lib/core/configValidation.ts` (123 lines) — validateStrategyConfig() (lenient), validateRunConfig() (strict), isTestEntry()

### Strategy System
- `evolution/src/lib/core/strategyConfig.ts` (212 lines) — StrategyConfig interface (7 fields, flat), StrategyConfigRow, hashStrategyConfig(), labelStrategyConfig(), extractStrategyConfig()
- `evolution/src/services/strategyResolution.ts` (111 lines) — V1 atomic INSERT-first upsert (not used by V2)
- `evolution/src/services/strategyRegistryActions.ts` (388 lines) — Strategy CRUD, version-on-edit, 3 presets
- `evolution/src/lib/v2/strategy.ts` (45 lines) — V2 simplified strategy hash/label (no Zod, no AgentName)

### Run Queueing
- `evolution/src/services/evolutionActions.ts` (726 lines) — queueEvolutionRunAction, buildRunConfig (copies 6 fields from strategy to run config JSONB)
- `evolution/src/services/experimentActions.ts` — addRunToExperimentAction stores both config JSONB and strategy_config_id FK

### Pipeline Execution (V2 — Active)
- `evolution/src/services/evolutionRunnerCore.ts` (161 lines) — V2 is only active path; V1 resume explicitly rejected
- `evolution/src/lib/v2/runner.ts` (238 lines) — V2 resolveConfig() maps 4 fields from raw JSONB, upserts strategy, executes pipeline
- `evolution/src/lib/v2/evolve-article.ts` (320 lines) — Config validation, generate→rank→evolve loop
- `evolution/src/lib/v2/types.ts` (63 lines) — V2 EvolutionConfig (7 fields, all flat)
- `evolution/src/lib/v2/finalize.ts` (204 lines) — Calls update_strategy_aggregates RPC with strategy_config_id
- `evolution/src/lib/v2/llm-client.ts` (135 lines) — Uses generationModel as default, judgeModel via options
- `evolution/src/lib/v2/cost-tracker.ts` (71 lines) — Budget enforcement with budgetUsd

### Batch/CLI Runners
- `evolution/scripts/evolution-runner.ts` — Batch runner claims runs, selects config JSONB and strategy_config_id
- `evolution/scripts/run-evolution-local.ts` — Local CLI creates EvolutionConfig inline, does NOT create strategy_config_id

### Admin UI
- `src/app/admin/evolution/runs/[runId]/page.tsx` — Reads strategy.config.iterations, NOT run.config
- `src/app/admin/evolution/runs/page.tsx` — Shows budget_cap_usd (run column), NOT run.config
- `src/app/admin/evolution/strategies/page.tsx` — StrategyDialog reads strategy.config
- `src/app/admin/evolution/_components/ExperimentForm.tsx` — Reads strategy.config for form

### Database
- `supabase/migrations/20260315000001_evolution_v2.sql` — V2 clean-slate schema: 10 tables, 4 RPCs

## Key Findings

### 1. V2 Only Needs 4 Config Fields at Runtime
The V2 `resolveConfig()` in `runner.ts` extracts only: `maxIterations`, `budgetCapUsd`, `judgeModel`, `generationModel`. The remaining 3 optional fields (`strategiesPerRound`, `calibrationOpponents`, `tournamentTopK`) are hardcoded to 3, 5, 5.

### 2. V1 Nested Config is Dead Code
Fields like `expansion.*`, `calibration.*`, `tournament.*`, `enabledAgents`, `singleArticle` are stored in the DB config JSONB but never read at runtime.

### 3. strategy_config_id is Currently Nullable
The V2 migration defines `strategy_config_id UUID REFERENCES evolution_strategy_configs(id)` with no NOT NULL. The local CLI runner creates runs without setting it. The V2 runner upserts a strategy during execution and links it.

### 4. Config JSONB is NOT NULL with Default '{}'
Every run has a config column, but it can be an empty object. V2's resolveConfig uses `?? defaults` for all fields.

### 5. Two Different Hash Functions Exist
- V1 `hashStrategyConfig()` hashes: generationModel, judgeModel, iterations, enabledAgents, singleArticle
- V2 `hashStrategyConfig()` hashes: generationModel, judgeModel, iterations only
- Same config can produce different hashes depending on which function is used.

### 6. Admin UI is Already Decoupled from run.config
All UI components read from `strategy.config` via the strategy detail action. No UI directly renders `run.config`.

### 7. buildConfigLabel() is the Only Non-Execution Consumer of run.config
`experimentActions.ts:buildConfigLabel()` reads `config.generationModel` and `config.judgeModel` for display labels. This could easily read from strategy instead.

### 8. V1 resolveConfig() Still Called but Redundant
`evolutionRunnerCore.ts` calls V1 `resolveConfig()` on line 88, but then passes raw config to V2's `executeV2Run()` which calls its own `resolveConfig()`. The V1 call produces a full nested config that is then discarded.

### 9. The update_strategy_aggregates RPC Already Works via FK
Finalization uses `strategy_config_id` to update aggregates (run_count, cost, elo) — this is already FK-based.

### 10. Local CLI is the Main Obstacle
`run-evolution-local.ts` creates runs without a strategy. It stores config inline and relies on V2 runner to upsert a strategy during execution. Any refactor must handle this case.

## Open Questions

1. **Should we make strategy_config_id NOT NULL immediately or transition gradually?** Making it NOT NULL requires the local CLI and all run-creation paths to pre-create a strategy.

2. **Should we keep config JSONB as a read-only audit trail?** Even after the refactor, having the snapshot config on the run row provides audit/debugging value for "what config did this run actually execute with?" An alternative is a `config_snapshot_at_queue_time` column.

3. **Should we unify V1 and V2 hash functions?** Currently two different hashStrategyConfig() exist. If V2 is the only active path, the V1 version in `strategyConfig.ts` may produce orphaned strategy rows.

4. **What about per-run budget overrides?** Currently `budgetCapUsd` can differ per-run even for the same strategy. If we make runs always read from strategy, we lose per-run budget flexibility unless we add a `budget_cap_usd` column on runs (which already exists).

5. **Should V1 config types/interfaces be cleaned up?** The EvolutionRunConfig interface has 14 fields but V2 only uses 4. Should we slim it down or deprecate the unused fields?
