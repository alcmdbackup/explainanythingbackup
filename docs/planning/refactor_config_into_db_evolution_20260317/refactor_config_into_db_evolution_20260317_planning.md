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
4. **Keep budget per-run** — budget varies per-run within same strategy. The V2 migration omitted `budget_cap_usd` as a column but production has it (used by 10+ files). Our migration will add it if missing via `ADD COLUMN IF NOT EXISTS`. Runner reads `budget_cap_usd` from run row, all other config from strategy FK.
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

**Error handling:** Currently `upsertStrategy()` returns null on error and the runner silently skips. After this refactor, `strategy_config_id` is NOT NULL — run creation MUST fail if strategy creation fails. Update `upsertStrategy()` to throw on error (not return null). All callers must propagate the error to prevent inserting runs without a strategy.

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
- `evolution/src/services/evolutionVisualizationActions.ts` — Line 547: remove `config` from SELECT in `getEvolutionRunBudgetAction`. Budget data already comes from `budget_cap_usd` column (line 580). Also remove `config` from `EvolutionRunBrief` type (line 43 area) if present.

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
-- Step 0: Ensure budget_cap_usd column exists (V2 migration omitted it but production has it)
ALTER TABLE evolution_runs ADD COLUMN IF NOT EXISTS budget_cap_usd NUMERIC(10,4) DEFAULT 1.00;

-- Step 1: Backfill budget_cap_usd from config JSONB where missing
UPDATE evolution_runs
SET budget_cap_usd = COALESCE((config->>'budgetCapUsd')::NUMERIC, 1.00)
WHERE budget_cap_usd IS NULL AND config IS NOT NULL AND config != '{}'::jsonb;

-- Step 2: Safety check — abort if any runs still have NULL strategy_config_id
DO $$
DECLARE missing_count INT;
BEGIN
  SELECT count(*) INTO missing_count FROM evolution_runs WHERE strategy_config_id IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Cannot proceed: % runs have NULL strategy_config_id. Run backfill script first.', missing_count;
  END IF;
END $$;

-- Step 3: Make strategy_config_id NOT NULL
ALTER TABLE evolution_runs ALTER COLUMN strategy_config_id SET NOT NULL;

-- Step 4: Delete unused V1 strategy rows (no runs reference them)
-- Uses EXISTS subquery against actual FK, NOT the denormalized run_count counter
DELETE FROM evolution_strategy_configs s
WHERE (s.config ? 'enabledAgents' OR s.config ? 'singleArticle')
  AND NOT EXISTS (SELECT 1 FROM evolution_runs r WHERE r.strategy_config_id = s.id);

-- Step 5: Drop config JSONB column
ALTER TABLE evolution_runs DROP COLUMN config;
```

**Pre-migration backfill script:** `evolution/scripts/backfill-strategy-config-id.ts`
1. Finds all runs with `strategy_config_id IS NULL`
2. For each, reads `config` JSONB, extracts (generationModel, judgeModel, maxIterations) with fallback defaults for empty/malformed config: `generationModel ?? 'gpt-4.1-mini'`, `judgeModel ?? 'gpt-4.1-nano'`, `maxIterations ?? 5`
3. Calls V2 `upsertStrategy()` to find-or-create strategy
4. Updates the run's `strategy_config_id`
5. Logs all backfilled runs and any that had missing/malformed config fields

**Backfill script test:** `evolution/scripts/backfill-strategy-config-id.test.ts`
Test cases:
- Run with full V2 config → correctly extracts and links strategy
- Run with empty config `{}` → uses defaults, creates default strategy
- Run with V1 config (enabledAgents, expansion, etc.) → extracts only V2 fields, ignores V1 fields
- Run already having strategy_config_id → skipped
- Duplicate configs across runs → reuses same strategy (hash dedup)

**V1 strategy deletion:** Uses `NOT EXISTS` subquery against `evolution_runs` to verify no FK references exist. This is safer than relying on the denormalized `run_count` counter which could be stale. V1 strategies that DO have runs linked to them are kept as frozen rows.

**Note on `claim_evolution_run` RPC:** The RPC uses `RETURNING *` which dynamically returns all columns. After dropping `config`, the return shape changes but the RPC itself works fine. The TypeScript claim handlers in `evolution-runner.ts` must stop destructuring `config` from the result.

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
- `evolution/src/lib/core/costTracker.test.ts` — update `createCostTracker()` and `createCostTrackerFromCheckpoint()` tests for new signature (budgetUsd: number)
- `evolution/src/services/strategyRegistryActions.test.ts` — update for V2 defaults (no DEFAULT_EVOLUTION_CONFIG)
- `src/__tests__/integration/evolution-actions.integration.test.ts` — remove assertion on `run.config` (line 291)
- `src/__tests__/integration/strategy-archiving.integration.test.ts` — verify still works with V2 strategy type

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
0. **Backup config column:** `CREATE TABLE evolution_runs_config_backup AS SELECT id, config FROM evolution_runs;` — MANDATORY before proceeding. This is irreversible otherwise.
1. **Stop the evolution batch runner** — `sudo systemctl stop evolution-runner.timer`. This drains in-flight runs and prevents new claims during deployment.
2. **Run backfill script** — populate strategy_config_id for any existing NULL rows.
3. **Deploy Phase 1 code + Phase 2 migration + Phase 3 code** — all at once. Code stops writing/reading config JSONB, migration drops column and sets NOT NULL. No rolling-deploy race because the batch runner is stopped.
4. **Restart the evolution batch runner** — `sudo systemctl start evolution-runner.timer`.
5. **Deploy Phase 4** — documentation updates.
6. **After 1 week:** Drop backup table: `DROP TABLE evolution_runs_config_backup;`

### Rollback Plan
- **Full rollback:** Revert code + restore config column from backup:
  ```sql
  ALTER TABLE evolution_runs ADD COLUMN config JSONB NOT NULL DEFAULT '{}';
  UPDATE evolution_runs r SET config = b.config FROM evolution_runs_config_backup b WHERE r.id = b.id;
  ALTER TABLE evolution_runs ALTER COLUMN strategy_config_id DROP NOT NULL;
  ```
- **Partial rollback (code only):** If migration succeeded but code has a bug, the old code won't work (config column gone). Must do full rollback including DB restore.

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
