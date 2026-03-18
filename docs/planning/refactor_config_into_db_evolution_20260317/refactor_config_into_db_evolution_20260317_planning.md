# Refactor Config Into DB Evolution Plan

## Background
Refactor strategy config so it is linked from run, not contained in run. Currently, when a run is queued, key strategy fields are snapshot-copied into the run's `config` JSONB column. The V2 pipeline only uses 4 fields from this JSONB at runtime, and the admin UI already reads from strategy.config, not run.config. This refactoring eliminates the redundant inline config and makes strategy_config_id the single source of truth.

## Requirements (from GH Issue #TBD)
Refactor strategy config so it is linked from run, not contained in run. Refactor the run config so that it is stored in the DB.

## Problem
The evolution system stores run configuration in two places: as a JSONB blob on `evolution_runs.config` and as a linked row via `evolution_runs.strategy_config_id → evolution_strategy_configs`. This dual-storage creates data duplication, confusion about source of truth, and maintenance burden. The V2 pipeline only needs 4 fields at runtime (`maxIterations`, `budgetCapUsd`, `judgeModel`, `generationModel`), all of which already exist in the strategy config. The `strategy_config_id` FK is currently nullable, and the local CLI creates runs without it, forcing the runner to backfill. The V1 and V2 codepaths use incompatible hash functions for strategy deduplication.

## Decisions Made
1. **Make `strategy_config_id` NOT NULL** — via backfill-then-constrain migration
2. **Remove `config` JSONB column** — drop immediately (no soak period, no backward compat writes)
3. **Use V2 hash, delete V1 hash** — only `generationModel`, `judgeModel`, `iterations` matter at runtime
4. **Keep `budget_cap_usd` as standalone column on runs** — budget legitimately varies per-run within same strategy; runner reads `budget_cap_usd` from run row, all other config from strategy FK
5. **Delete `EvolutionRunConfig` type, use V2 `EvolutionConfig` everywhere** — V1 nested config is dead code
6. **Delete all V1 strategy rows** — V1 strategies with enabledAgents/singleArticle are dead data; clean them out

## Options Considered

### Option A: Drop config JSONB, FK-only (CHOSEN)
- Make `strategy_config_id` NOT NULL
- Runner reads config from strategy FK + `budget_cap_usd` column
- All run-creation paths must pre-create a strategy
- Remove `config` JSONB column via migration
- **Pros:** Single source of truth, no duplication, clean
- **Cons:** Requires all codepaths to create strategy upfront

### Option B: Keep config JSONB as read-only audit trail
- **Rejected:** Still maintains duplication, confusing what's authoritative

### Option C: Gradual deprecation with backward compat writes
- **Rejected:** Unnecessary complexity. V2 migration was a clean break, no legacy consumers to support.

## Phased Execution Plan

### Phase 1: Strategy creation + runner reads from FK + drop config column
**Goal:** All in one phase — update all run-creation paths to set strategy_config_id, update runner to read from FK, stop writing config JSONB, drop the column. No backward compat period.

**Extract `upsertStrategy()` to shared module:** The `upsertStrategy()` function is currently a private function inside `runner.ts` (line 108). Extract it to `evolution/src/lib/v2/strategy.ts` as an exported function so all run-creation paths can import it. The runner.ts copy is replaced with an import.

**Strategy creation rule:** All run-creation paths call the shared `upsertStrategy()` to find-or-create a strategy by config hash. If a strategy with the same (generationModel, judgeModel, iterations) already exists, the existing row's ID is reused. If no strategyId is provided by the caller, one is auto-created from default config values.

**Concurrent strategy upsert safety:** The DB has a UNIQUE constraint on `config_hash`. V2's `upsertStrategy()` uses `INSERT ... ON CONFLICT (config_hash) DO NOTHING` then fallback SELECT. Race-condition safe via DB constraint.

**Config source at runtime:** Runner fetches strategy row by `strategy_config_id` (single SELECT), extracts `config.generationModel`, `config.judgeModel`, `config.iterations`. Budget comes from `evolution_runs.budget_cap_usd` column (NOT from strategy config — budget varies per-run).

**Files to modify:**
- `evolution/src/lib/v2/strategy.ts` — Extract `upsertStrategy()` from `runner.ts` into this shared module (alongside existing `hashStrategyConfig()` and `labelStrategyConfig()`)
- `evolution/scripts/run-evolution-local.ts` — Import shared `upsertStrategy()`, call at run creation, set strategy_config_id on insert. Build V2StrategyConfig from CLI args (model, iterations). Stop writing `config` JSONB.
- `evolution/src/services/evolutionActions.ts` — `queueEvolutionRunAction()`: when `strategyId` is provided, use it directly. When `strategyId` is NOT provided, auto-create a strategy from default config via `upsertStrategy()`. Always set `strategy_config_id` on the run insert. Stop writing `config` JSONB. Delete `buildRunConfig()`.
- `evolution/src/services/experimentActions.ts` — `addRunToExperimentAction()`: switch from V1 `resolveOrCreateStrategyFromRunConfig()` to V2 `upsertStrategy()`. Stop writing `config` JSONB.
- `evolution/src/lib/v2/experiments.ts` — Update run insertion to use strategy FK, stop writing config JSONB.
- `evolution/src/services/evolutionRunnerCore.ts` — Remove V1 `resolveConfig()` call and V1 `createCostTracker(runConfig)` call. Pass the raw claimed run (with strategy_config_id) to V2 runner. The V2 runner handles its own config resolution and cost tracking internally via `v2/cost-tracker.ts`.
- `evolution/src/lib/v2/runner.ts` — Update `executeV2Run()`: fetch strategy row from DB via `strategy_config_id`, build `EvolutionConfig` from strategy.config + run.budget_cap_usd. Remove the strategy upsert logic (now done at queue time). Remove inline `resolveConfig()` function.
- `evolution/scripts/evolution-runner.ts` — Remove `config` from the SELECT list in claim query (line 88). Already selects `strategy_config_id`.

**Tests:**
- Update `evolution/src/services/evolutionActions.test.ts` — verify strategy_config_id is always set on run insert. Remove all assertions on `insertCall.config` JSONB (lines 336, 383, 573, 586, 599, 612, 627).
- Update `evolution/src/services/experimentActions.test.ts` — update mock of `resolveOrCreateStrategyFromRunConfig` to V2 `upsertStrategy`, verify strategy_config_id set, remove config JSONB assertions.
- Update `evolution/src/lib/v2/runner.test.ts` — update `makeClaimedRun` helper to include strategy_config_id; mock strategy DB fetch instead of inline config resolution. Remove `config` field from helper.
- Update `evolution/src/services/evolutionRunnerCore.test.ts` — remove V1 resolveConfig/createCostTracker assertions; verify V2 executeV2Run is called with strategy_config_id.
- Verify V2 strategy hash produces correct results with existing `strategy.test.ts`.

### Phase 2: Migration — backfill, NOT NULL, drop column, delete V1 strategies
**Goal:** Database schema changes.

**Migration:** `supabase/migrations/YYYYMMDD000001_config_into_db.sql`
```sql
-- Step 1: Backfill any NULL strategy_config_id rows
-- (Pre-migration backfill script should have handled this, but safety check)
DO $$
DECLARE missing_count INT;
BEGIN
  SELECT count(*) INTO missing_count FROM evolution_runs WHERE strategy_config_id IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Cannot proceed: % runs have NULL strategy_config_id. Backfill first.', missing_count;
  END IF;
END $$;

-- Step 2: Make strategy_config_id NOT NULL
ALTER TABLE evolution_runs ALTER COLUMN strategy_config_id SET NOT NULL;

-- Step 3: Drop config JSONB column
ALTER TABLE evolution_runs DROP COLUMN config;

-- Step 4: Delete V1 strategy rows that have enabledAgents or singleArticle in config
-- These are dead data — no V2 runs will ever link to them
DELETE FROM evolution_strategy_configs
WHERE config ? 'enabledAgents' OR config ? 'singleArticle';

-- Step 5: Update claim_evolution_run RPC if it references config column
-- (verify via: SELECT prosrc FROM pg_proc WHERE proname = 'claim_evolution_run')
```

**Pre-migration backfill script:** `evolution/scripts/backfill-strategy-config-id.ts`
1. Finds all runs with `strategy_config_id IS NULL`
2. For each, reads `config` JSONB, extracts (generationModel, judgeModel, maxIterations)
3. Calls V2 `upsertStrategy()` to find-or-create strategy
4. Updates the run's `strategy_config_id`

**V1 strategy deletion rationale:** V1 strategies with `enabledAgents` or `singleArticle` in their config JSONB have different hashes from V2 strategies. No V2 run will ever link to them. Any V1 runs that referenced them are historical — deleting the strategy rows orphans the FK on those runs. We must either:
- CASCADE delete the runs too (if historical V1 runs are not needed), OR
- SET NULL on the FK before deletion (but we just made it NOT NULL), OR
- Only delete strategies with `run_count = 0` to be safe

**Safest approach:** `DELETE FROM evolution_strategy_configs WHERE (config ? 'enabledAgents' OR config ? 'singleArticle') AND run_count = 0;` — deletes unused V1 strategies. V1 strategies that have runs keep their rows but are naturally frozen (no new V2 runs will link to them).

### Phase 3: V1 type and code cleanup
**Goal:** Delete all dead V1 config code.

**Files to delete:**
- `evolution/src/services/strategyResolution.ts` — V1 atomic upsert (replaced by V2 strategy.ts)
- `evolution/src/services/strategyResolution.test.ts` — V1 upsert tests
- `src/__tests__/integration/strategy-resolution.integration.test.ts` — V1 integration tests

**Files to modify:**
- `evolution/src/lib/types.ts` — Delete `EvolutionRunConfig` interface
- `evolution/src/lib/config.ts` — Delete `DEFAULT_EVOLUTION_CONFIG`, `resolveConfig()` (V1 version). Keep `MAX_RUN_BUDGET_USD` and `MAX_EXPERIMENT_BUDGET_USD`.
- `evolution/src/lib/core/configValidation.ts` — Delete `validateRunConfig()` (V1). Keep `validateStrategyConfig()` updated to validate V2 fields only. Keep `isTestEntry()`.
- `evolution/src/lib/core/strategyConfig.ts` — Delete V1 `hashStrategyConfig()`, `extractStrategyConfig()`, `diffStrategyConfigs()`. Update `StrategyConfigRow.config` type to `V2StrategyConfig` (see Admin UI section below). Keep `labelStrategyConfig()` updated for V2.
- `evolution/src/lib/core/costEstimator.ts` — Partial rewrite: simplify `estimateRunCostWithAgentModels()` signature to `(generationModel, judgeModel, iterations, textLength)`. Delete the agent-filtering block (lines ~178-195) that branches on `enabledAgents`/`singleArticle` — V2 always runs all agents. Delete the internal `RunCostConfig` interface (6 V1-specific fields). The function body reduces to: estimate cost for all agents using the 2 model prices + iteration count.
- `evolution/src/lib/core/costTracker.ts` — Update `createCostTracker()` to accept `budgetUsd: number` instead of full `EvolutionRunConfig`. (Note: the V2 cost-tracker in `v2/cost-tracker.ts` already works this way.)
- `evolution/src/services/experimentActions.ts` — Remove `buildConfigLabel()` (read from strategy.label instead). Remove V1 `resolveConfig` import. Remove `resolveOrCreateStrategyFromRunConfig` import.
- `evolution/src/services/strategyRegistryActions.ts` — Remove `DEFAULT_EVOLUTION_CONFIG` import (line 13). Use V2 defaults directly.
- `evolution/src/lib/index.ts` — Remove V1 config exports (`DEFAULT_EVOLUTION_CONFIG`, `resolveConfig`, `validateRunConfig`)
- `evolution/src/testing/evolution-test-helpers.ts` — Remove `DEFAULT_EVOLUTION_CONFIG` and `EvolutionRunConfig` imports; update helpers to use V2 types

**Admin UI & StrategyConfigRow type change:**
Since we're deleting V1 strategy rows with `enabledAgents`/`singleArticle` (unused ones), and the remaining V1 rows (with runs) naturally have the extra fields in their JSONB, we take the simple approach:
- Change `StrategyConfigRow.config` type to `V2StrategyConfig` (generationModel, judgeModel, iterations, strategiesPerRound?, budgetUsd?)
- Remove all UI code that displays `enabledAgents`, `singleArticle`, `agentModels` — these are V1 concepts that don't exist in V2
- Specific fixes:
  - `StrategyConfigDisplay.tsx` — Remove agent selection display, agent overrides section
  - `src/app/admin/evolution/strategies/strategyFormUtils.ts` — Remove `enabledAgents` handling
  - `src/app/admin/evolution/strategies/page.tsx` — Remove `enabledAgents` from preset display
  - `ExperimentForm.tsx` — Remove enabledAgents from strategy picker display

**Tests to delete:**
- `evolution/src/lib/config.test.ts` — V1 resolveConfig tests
- `evolution/src/services/strategyResolution.test.ts` — V1 atomic upsert tests
- `src/__tests__/integration/strategy-resolution.integration.test.ts` — V1 integration tests
- `evolution/src/lib/core/configValidation.test.ts` — remove `validateRunConfig()` tests; keep `validateStrategyConfig()` and `isTestEntry()` tests

**Tests to update:**
- `evolution/src/lib/core/strategyConfig.test.ts` — remove V1 hash tests, update `StrategyConfig` type usage
- `src/__tests__/integration/evolution-actions.integration.test.ts` — remove assertion on `run.config` (line 291)

### Phase 4: Documentation updates
**Goal:** Update all evolution docs to reflect the new architecture.

**Files to update:**
- `evolution/docs/evolution/architecture.md` — Remove "Config propagation" section about snapshot-copying; update pipeline execution flow
- `evolution/docs/evolution/data_model.md` — Update Strategy System section (remove config propagation, note strategy_config_id is NOT NULL), update migrations list
- `evolution/docs/evolution/reference.md` — Rewrite Configuration section (remove DEFAULT_EVOLUTION_CONFIG, resolveConfig(), nested config docs; document that config lives in strategy_configs table, budget_cap_usd on run row)
- `evolution/docs/evolution/cost_optimization.md` — Update strategy identity section
- `evolution/docs/evolution/strategy_experiments.md` — Update strategy pre-registration flow
- `evolution/docs/evolution/entity_diagram.md` — Update relationships (strategy_config_id now NOT NULL)
- `evolution/docs/evolution/visualization.md` — Minor updates if any UI changes
- `evolution/docs/evolution/curriculum.md` — Update Module 6: Config System

## Deployment & Migration Strategy

### Deployment Order
1. **Run backfill script** — populate strategy_config_id for any existing NULL rows
2. **Deploy Phase 1 code + Phase 2 migration + Phase 3 code** — all at once. Code stops writing/reading config JSONB, migration drops column and sets NOT NULL.
3. **Deploy Phase 4** — documentation updates

### Rollback Plan
- **Phase 1 code rollback:** Revert code. But config column is already dropped — would need to also revert migration. Since this is a clean-break approach, rollback = revert all code + restore column from backup if needed.
- **Migration rollback:** The config column drop is irreversible without a backup. Before deploying, take a pg_dump of `evolution_runs` (or just the config column: `SELECT id, config FROM evolution_runs INTO evolution_runs_config_backup;`).
- **Phase 2 migration rollback:** `ALTER TABLE evolution_runs ALTER COLUMN strategy_config_id DROP NOT NULL;` + restore config column from backup table.

### Pre-Migration Verification Queries
```sql
-- Before migration: verify no NULL strategy_config_id rows
SELECT count(*) FROM evolution_runs WHERE strategy_config_id IS NULL;
-- Expected: 0

-- Verify claim_evolution_run RPC does not reference config column
SELECT prosrc FROM pg_proc WHERE proname = 'claim_evolution_run';

-- Count V1 strategy rows to be deleted
SELECT count(*) FROM evolution_strategy_configs
WHERE (config ? 'enabledAgents' OR config ? 'singleArticle') AND run_count = 0;
```

## Testing

### Unit Tests
- V2 strategy hash function (existing `strategy.test.ts`)
- Runner reading from strategy FK (updated `runner.test.ts`)
- All run-creation paths setting strategy_config_id (updated `evolutionActions.test.ts`, `experimentActions.test.ts`)
- Cost estimator with V2 config (updated `costEstimator.test.ts`)

### Integration Tests
- Queue run → claim → execute → finalize with FK-based config
- Local CLI creates strategy and links it
- Experiment creates runs with strategy FKs
- Backfill script correctly creates strategies from config JSONB

### E2E Tests
- Verify existing admin evolution page E2E tests pass
- Strategy detail page displays correctly for V2 strategies

### Migration Tests
- Run migration against dev DB with seeded NULL rows → verify it fails
- Run backfill → re-run migration → verify it succeeds

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
