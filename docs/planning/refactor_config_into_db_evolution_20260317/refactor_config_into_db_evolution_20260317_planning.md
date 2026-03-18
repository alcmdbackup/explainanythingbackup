# Refactor Config Into DB Evolution Plan

## Background
Refactor strategy config so it is linked from run, not contained in run. Currently, when a run is queued, key strategy fields are snapshot-copied into the run's `config` JSONB column. The V2 pipeline only uses 4 fields from this JSONB at runtime, and the admin UI already reads from strategy.config, not run.config. This refactoring eliminates the redundant inline config and makes strategy_config_id the single source of truth.

## Requirements (from GH Issue #TBD)
Refactor strategy config so it is linked from run, not contained in run. Refactor the run config so that it is stored in the DB.

## Problem
The evolution system stores run configuration in two places: as a JSONB blob on `evolution_runs.config` and as a linked row via `evolution_runs.strategy_config_id → evolution_strategy_configs`. This dual-storage creates data duplication, confusion about source of truth, and maintenance burden. The V2 pipeline only needs 4 fields at runtime (`maxIterations`, `budgetCapUsd`, `judgeModel`, `generationModel`), all of which already exist in the strategy config. The `strategy_config_id` FK is currently nullable, and the local CLI creates runs without it, forcing the runner to backfill. The V1 and V2 codepaths use incompatible hash functions for strategy deduplication.

## Decisions Made
1. **Make `strategy_config_id` NOT NULL immediately** — no gradual migration needed (V2 migration was clean-slate)
2. **Remove `config` JSONB column** — strategy FK is the audit trail (immutable via version-on-edit)
3. **Use V2 hash, delete V1 hash** — only `generationModel`, `judgeModel`, `iterations` matter at runtime
4. **Keep `budget_cap_usd` as standalone column on runs** — budget legitimately varies per-run within same strategy
5. **Delete `EvolutionRunConfig` type, use V2 `EvolutionConfig` everywhere** — V1 nested config is dead code

## Options Considered

### Option A: Drop config JSONB, FK-only (CHOSEN)
- Make `strategy_config_id` NOT NULL
- Runner reads config from strategy FK + `budget_cap_usd` column
- All run-creation paths must pre-create a strategy
- Remove `config` JSONB column via migration
- **Pros:** Single source of truth, no duplication, clean
- **Cons:** Requires all codepaths to create strategy upfront

### Option B: Keep config JSONB as read-only audit trail
- Make `strategy_config_id` NOT NULL, runner reads from FK
- Keep config JSONB populated at queue time but never read at runtime
- **Pros:** Audit trail preserved
- **Cons:** Still maintains duplication, confusing what's authoritative

### Option C: Gradual deprecation
- Add deprecation warnings, migrate incrementally
- **Pros:** Low risk
- **Cons:** Unnecessary — V2 migration was already a clean break, no legacy runs to worry about

## Phased Execution Plan

### Phase 1: Unify strategy creation (all run-creation paths)
**Goal:** Every run-creation path creates a strategy_config_id before inserting the run.

**Files to modify:**
- `evolution/scripts/run-evolution-local.ts` — Call V2 `upsertStrategy()` at run creation, set strategy_config_id on insert
- `evolution/src/services/evolutionActions.ts` — `buildRunConfig()` and `queueEvolutionRunAction()`: switch to V2 strategy hash, set strategy_config_id, stop building config JSONB
- `evolution/src/services/experimentActions.ts` — `addRunToExperimentAction()`: switch from V1 `resolveOrCreateStrategyFromRunConfig()` to V2 strategy creation, stop setting config JSONB
- `evolution/src/lib/v2/experiments.ts` — Update run insertion to use strategy FK, not inline config

**Tests:**
- Update `evolution/src/services/evolutionActions.test.ts` — verify strategy_config_id is always set
- Update `evolution/src/services/experimentActions.test.ts` — verify no config JSONB on runs
- Update `evolution/scripts/run-evolution-local.ts` tests if any exist
- Run existing strategy tests to verify V2 hash produces correct results

### Phase 2: Runner reads from strategy FK
**Goal:** The V2 runner reads config from `evolution_strategy_configs` via FK instead of inline JSONB.

**Files to modify:**
- `evolution/src/services/evolutionRunnerCore.ts` — Remove V1 `resolveConfig()` call; pass strategy_config_id to V2 runner
- `evolution/src/lib/v2/runner.ts` — `resolveConfig()` reads from strategy row (fetched via FK join or separate query) + `budget_cap_usd` from run row. Remove strategy upsert logic (now done at queue time). Update `executeV2Run()` signature.
- `evolution/scripts/evolution-runner.ts` — Update claim query to JOIN or select strategy config alongside run
- `evolution/src/lib/v2/finalize.ts` — No change needed (already uses strategy_config_id for aggregates)

**Tests:**
- Update `evolution/src/lib/v2/runner.test.ts` — mock strategy fetch instead of inline config
- Update `evolution/src/services/evolutionRunnerCore.test.ts` — verify no V1 resolveConfig call
- Integration test: verify a run with strategy FK executes correctly

### Phase 3: Remove config JSONB column and V1 config types
**Goal:** Clean up dead code and drop the column.

**Files to modify:**
- `supabase/migrations/YYYYMMDD000001_drop_run_config_jsonb.sql` — `ALTER TABLE evolution_runs DROP COLUMN config;` and `ALTER TABLE evolution_runs ALTER COLUMN strategy_config_id SET NOT NULL;`
- `evolution/src/lib/types.ts` — Delete `EvolutionRunConfig` interface (or slim to alias V2's `EvolutionConfig`)
- `evolution/src/lib/config.ts` — Delete `DEFAULT_EVOLUTION_CONFIG`, `resolveConfig()` (V1 version), keep `MAX_RUN_BUDGET_USD` and `MAX_EXPERIMENT_BUDGET_USD`
- `evolution/src/lib/core/configValidation.ts` — Delete `validateRunConfig()` (V1), keep `validateStrategyConfig()` updated for V2 fields, keep `isTestEntry()`
- `evolution/src/lib/core/strategyConfig.ts` — Delete V1 `hashStrategyConfig()`, `extractStrategyConfig()`, `diffStrategyConfigs()`. Keep `StrategyConfigRow`, `labelStrategyConfig()` updated for V2
- `evolution/src/services/strategyResolution.ts` — Delete entirely (V1 atomic upsert, replaced by V2 strategy.ts)
- `evolution/src/services/experimentActions.ts` — Remove `buildConfigLabel()` (read from strategy.label instead), remove V1 resolveConfig import
- `evolution/src/lib/v2/runner.ts` — Remove inline `resolveConfig()` function (config comes from strategy row now)
- `evolution/src/lib/index.ts` — Remove V1 config exports

**Tests:**
- Delete V1 config tests: `config.test.ts` (if exists), `configValidation.test.ts` V1-specific tests
- Update `strategyConfig.test.ts` — remove V1 hash tests
- Update any integration tests that assert on `run.config`
- Verify all existing tests pass after column removal

### Phase 4: Documentation updates
**Goal:** Update all evolution docs to reflect the new architecture.

**Files to update:**
- `evolution/docs/evolution/architecture.md` — Remove "Config propagation" section about snapshot-copying; update pipeline execution flow
- `evolution/docs/evolution/data_model.md` — Update Strategy System section (remove config propagation, note strategy_config_id is NOT NULL), update migrations list
- `evolution/docs/evolution/reference.md` — Rewrite Configuration section (remove DEFAULT_EVOLUTION_CONFIG, resolveConfig(), nested config docs; document that config lives in strategy_configs table)
- `evolution/docs/evolution/cost_optimization.md` — Update strategy identity section
- `evolution/docs/evolution/strategy_experiments.md` — Update strategy pre-registration flow
- `evolution/docs/evolution/entity_diagram.md` — Update relationships (strategy_config_id now NOT NULL)
- `evolution/docs/evolution/visualization.md` — Minor updates if any UI changes
- `evolution/docs/evolution/curriculum.md` — Update Module 6: Config System

## Testing
- Unit tests for V2 strategy hash function (already exist in `strategy.test.ts`)
- Unit tests for runner reading from strategy FK
- Unit tests for all run-creation paths setting strategy_config_id
- Integration test: queue run → claim → execute → finalize with FK-based config
- Integration test: local CLI creates strategy and links it
- Integration test: experiment creates runs with strategy FKs
- Verify existing E2E tests pass (admin evolution pages)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/architecture.md` - Remove config propagation/snapshot section
- `evolution/docs/evolution/data_model.md` - Strategy system, strategy_config_id NOT NULL, migrations
- `evolution/docs/evolution/reference.md` - Rewrite Configuration section for FK-based config
- `evolution/docs/evolution/cost_optimization.md` - Strategy identity and hashing
- `evolution/docs/evolution/strategy_experiments.md` - Strategy pre-registration flow
- `evolution/docs/evolution/entity_diagram.md` - Entity relationships (NOT NULL FK)
- `evolution/docs/evolution/visualization.md` - Minor UI config display changes
- `evolution/docs/evolution/curriculum.md` - Module 6: Config System
