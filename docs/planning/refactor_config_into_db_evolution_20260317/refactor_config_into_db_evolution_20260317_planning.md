# Refactor Config Into DB Evolution Plan

## Background
Refactor strategy config so it is linked from run, not contained in run. Currently, when a run is queued, key strategy fields are snapshot-copied into the run's `config` JSONB column. The V2 pipeline only uses 4 fields from this JSONB at runtime, and the admin UI already reads from strategy.config, not run.config. This refactoring eliminates the redundant inline config and makes strategy_config_id the single source of truth.

## Requirements (from GH Issue #TBD)
Refactor strategy config so it is linked from run, not contained in run. Refactor the run config so that it is stored in the DB.

## Problem
The evolution system stores run configuration in two places: as a JSONB blob on `evolution_runs.config` and as a linked row via `evolution_runs.strategy_config_id → evolution_strategy_configs`. This dual-storage creates data duplication, confusion about source of truth, and maintenance burden. The V2 pipeline only needs 4 fields at runtime (`maxIterations`, `budgetCapUsd`, `judgeModel`, `generationModel`), all of which already exist in the strategy config. The `strategy_config_id` FK is currently nullable, and the local CLI creates runs without it, forcing the runner to backfill. The V1 and V2 codepaths use incompatible hash functions for strategy deduplication.

## Decisions Made
1. **Make `strategy_config_id` NOT NULL** — via two-step migration (backfill then constrain)
2. **Remove `config` JSONB column** — via rename-then-drop soak strategy (see Rollback Plan)
3. **Use V2 hash, delete V1 hash** — only `generationModel`, `judgeModel`, `iterations` matter at runtime
4. **Keep `budget_cap_usd` as standalone column on runs** — budget legitimately varies per-run within same strategy; runner reads `budget_cap_usd` from run row, all other config from strategy FK
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
**Goal:** Every run-creation path creates a strategy_config_id before inserting the run. Config JSONB is still written for backward compat (runner still reads it).

**Strategy creation rule:** All run-creation paths call V2 `upsertStrategy()` to find-or-create a strategy by config hash. If a strategy with the same (generationModel, judgeModel, iterations) already exists, the existing row's ID is reused. If no strategyId is provided by the caller, one is auto-created from default config values.

**Files to modify:**
- `evolution/scripts/run-evolution-local.ts` — Call V2 `upsertStrategy()` at run creation, set strategy_config_id on insert. Build V2StrategyConfig from CLI args (model, iterations).
- `evolution/src/services/evolutionActions.ts` — `queueEvolutionRunAction()`: when `strategyId` is provided, use it directly. When `strategyId` is NOT provided, auto-create a strategy from default config via V2 `upsertStrategy()`. Always set `strategy_config_id` on the run insert. Continue writing `config` JSONB for now (Phase 2 stops reading it).
- `evolution/src/services/experimentActions.ts` — `addRunToExperimentAction()`: switch from V1 `resolveOrCreateStrategyFromRunConfig()` to V2 `upsertStrategy()`. Continue writing `config` JSONB for now.
- `evolution/src/lib/v2/experiments.ts` — Update run insertion to always set strategy_config_id.

**Concurrent strategy upsert safety:** The DB has a UNIQUE constraint on `config_hash`. V2's `upsertStrategy()` uses `INSERT ... ON CONFLICT (config_hash) DO NOTHING` then fallback SELECT. This is race-condition safe — concurrent upserts on the same hash are handled by the DB constraint. No application-level locking needed.

**Tests:**
- Update `evolution/src/services/evolutionActions.test.ts` — verify strategy_config_id is always set on run insert (10+ assertions reference `insertCall.config` at lines 336, 383, 573, 586, 599, 612, 627 — update all to also verify strategy_config_id)
- Update `evolution/src/services/experimentActions.test.ts` — update mock of `resolveOrCreateStrategyFromRunConfig` to V2 `upsertStrategy`, verify strategy_config_id set
- Verify V2 strategy hash produces correct results with existing `strategy.test.ts`

### Phase 2: Runner reads from strategy FK
**Goal:** The V2 runner reads config from `evolution_strategy_configs` via FK instead of inline JSONB. Config JSONB is still written by Phase 1 code but no longer read.

**Config source at runtime:** Runner fetches strategy row by `strategy_config_id` (single SELECT), extracts `config.generationModel`, `config.judgeModel`, `config.iterations`. Budget comes from `evolution_runs.budget_cap_usd` column (NOT from strategy config — budget varies per-run).

**Files to modify:**
- `evolution/src/services/evolutionRunnerCore.ts` — Remove V1 `resolveConfig()` call and V1 `createCostTracker(runConfig)` call. Instead, pass the raw claimed run (with strategy_config_id) to V2 runner. The V2 runner handles its own config resolution and cost tracking internally via `v2/cost-tracker.ts`.
- `evolution/src/lib/v2/runner.ts` — Update `executeV2Run()`: fetch strategy row from DB via `strategy_config_id`, build `EvolutionConfig` from strategy.config + run.budget_cap_usd. Remove the strategy upsert logic (now done at queue time in Phase 1). Remove inline `resolveConfig()` function.
- `evolution/scripts/evolution-runner.ts` — Update claim query: SELECT strategy_config_id alongside other run fields. The strategy config itself is fetched by the V2 runner, not the batch script.
- `evolution/src/lib/v2/finalize.ts` — No change needed (already uses strategy_config_id for aggregates)

**Phase 1→2 transition safety:** During rollout, both phases can be live simultaneously. Phase 1 still writes config JSONB. If the old runner code reads config JSONB, it still works. If the new runner code reads from strategy FK, it also works. The DB constraint is the source of truth — no race conditions.

**Tests:**
- Update `evolution/src/lib/v2/runner.test.ts` — update `makeClaimedRun` helper to include strategy_config_id; mock strategy DB fetch instead of inline config resolution
- Update `evolution/src/services/evolutionRunnerCore.test.ts` — remove V1 resolveConfig/createCostTracker assertions; verify V2 executeV2Run is called with strategy_config_id
- Integration test: seed a strategy row + run row with FK → claim → execute → verify config read from strategy

### Phase 3: Remove config JSONB column and V1 config types
**Goal:** Clean up dead code and drop the column. Split into two sub-phases for safety.

#### Phase 3a: Backfill + NOT NULL constraint
**Migration:** `supabase/migrations/YYYYMMDD000001_backfill_strategy_config_id.sql`
```sql
-- Safety check: count rows missing strategy_config_id
DO $$
DECLARE missing_count INT;
BEGIN
  SELECT count(*) INTO missing_count FROM evolution_runs WHERE strategy_config_id IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Cannot proceed: % runs have NULL strategy_config_id. Backfill first.', missing_count;
  END IF;
END $$;

ALTER TABLE evolution_runs ALTER COLUMN strategy_config_id SET NOT NULL;
```

**Pre-migration backfill script:** Before running this migration, execute a backfill script that:
1. Finds all runs with `strategy_config_id IS NULL`
2. For each, reads `config` JSONB, extracts (generationModel, judgeModel, maxIterations)
3. Calls V2 `upsertStrategy()` to find-or-create strategy
4. Updates the run's `strategy_config_id`

#### Phase 3b: Rename config column (soak period), then drop
**Migration 1:** `supabase/migrations/YYYYMMDD000002_rename_config_column.sql`
```sql
ALTER TABLE evolution_runs RENAME COLUMN config TO _config_deprecated;
```
Deploy this with the code changes. If any missed reference surfaces, the column still exists for diagnosis. Soak for 1 week.

**Migration 2:** `supabase/migrations/YYYYMMDD000003_drop_config_column.sql`
```sql
ALTER TABLE evolution_runs DROP COLUMN _config_deprecated;
```

**Update `claim_evolution_run` RPC:** The RPC selects from `evolution_runs` — verify it does not reference the `config` column. If it does, update the RPC in Migration 1 to remove that reference.

#### Phase 3c: V1 type and code cleanup
**Files to delete:**
- `evolution/src/services/strategyResolution.ts` — V1 atomic upsert (replaced by V2 strategy.ts)
- `evolution/src/services/strategyResolution.test.ts` — V1 upsert tests
- `src/__tests__/integration/strategy-resolution.integration.test.ts` — V1 integration tests

**Files to modify:**
- `evolution/src/lib/types.ts` — Delete `EvolutionRunConfig` interface
- `evolution/src/lib/config.ts` — Delete `DEFAULT_EVOLUTION_CONFIG`, `resolveConfig()` (V1 version). Keep `MAX_RUN_BUDGET_USD` and `MAX_EXPERIMENT_BUDGET_USD`.
- `evolution/src/lib/core/configValidation.ts` — Delete `validateRunConfig()` (V1). Keep `validateStrategyConfig()` updated to validate V2 fields only. Keep `isTestEntry()`.
- `evolution/src/lib/core/strategyConfig.ts` — Delete V1 `hashStrategyConfig()`, `extractStrategyConfig()`, `diffStrategyConfigs()`. Keep `StrategyConfigRow` but update `config` field type (see Admin UI section below). Keep `labelStrategyConfig()` updated for V2.
- `evolution/src/lib/core/costEstimator.ts` — Update `estimateRunCostWithAgentModels()` to accept V2 `EvolutionConfig` instead of V1 `EvolutionRunConfig`. Remove references to `calibration.opponents`, `enabledAgents`, `singleArticle` (V2 doesn't use these).
- `evolution/src/lib/core/costTracker.ts` — Update `createCostTracker()` to accept `budgetUsd: number` instead of full `EvolutionRunConfig`. (Note: the V2 cost-tracker in `v2/cost-tracker.ts` already works this way.)
- `evolution/src/services/experimentActions.ts` — Remove `buildConfigLabel()` (read from strategy.label instead). Remove V1 `resolveConfig` import. Remove `resolveOrCreateStrategyFromRunConfig` import.
- `evolution/src/services/strategyRegistryActions.ts` — Remove `DEFAULT_EVOLUTION_CONFIG` import (line 13). Use V2 defaults directly.
- `evolution/src/lib/v2/runner.ts` — Remove inline `resolveConfig()` function (config comes from strategy row now)
- `evolution/src/lib/index.ts` — Remove V1 config exports (`DEFAULT_EVOLUTION_CONFIG`, `resolveConfig`, `validateRunConfig`)
- `evolution/src/testing/evolution-test-helpers.ts` — Remove `DEFAULT_EVOLUTION_CONFIG` and `EvolutionRunConfig` imports; update helpers to use V2 types

**Admin UI & StrategyConfigRow type change:**
The `StrategyConfigRow.config` field is currently typed as V1 `StrategyConfig` (includes `enabledAgents`, `singleArticle`, `agentModels`). Since V2 strategies only store `(generationModel, judgeModel, iterations)`, we need a transition:
- Define `V2StrategyConfig` as the canonical type for `StrategyConfigRow.config`
- Add optional fields for backward compat display: `enabledAgents?`, `singleArticle?`, `agentModels?` — these render as "N/A" in the admin UI for V2 strategies but still display correctly for pre-existing V1 strategy rows
- Update admin UI components that read these fields (`strategies/page.tsx`, `StrategyConfigDisplay.tsx`, `ExperimentForm.tsx`) to handle the optional fields gracefully

**V1→V2 strategy hash collision handling:**
Existing V1 strategy rows have hashes computed with `enabledAgents` and `singleArticle` included. V2 hashes only use `(generationModel, judgeModel, iterations)`. This means:
- Two V1 strategies that differ only in `enabledAgents` will NOT collide with V2 strategies (they have different hashes)
- New V2 runs will create new strategy rows with V2 hashes
- Old V1 strategy rows remain in the DB with their original hashes and aggregate metrics
- No re-hashing needed — V1 and V2 strategy rows coexist. V1 rows are effectively frozen (no new runs will link to them since V2 hash is different)

**Tests to delete:**
- `evolution/src/lib/config.test.ts` — V1 resolveConfig tests (expansion auto-clamping, enabledAgents passthrough, etc.)
- `evolution/src/services/strategyResolution.test.ts` — V1 atomic upsert tests
- `src/__tests__/integration/strategy-resolution.integration.test.ts` — V1 integration tests
- `evolution/src/lib/core/configValidation.test.ts` — remove `validateRunConfig()` tests; keep `validateStrategyConfig()` and `isTestEntry()` tests

**Tests to update:**
- `evolution/src/lib/core/strategyConfig.test.ts` — remove V1 hash tests, update `StrategyConfig` type usage
- `evolution/src/services/evolutionActions.test.ts` — remove all assertions on `insertCall.config` JSONB (lines 336, 383, 573, 586, 599, 612, 627)
- `evolution/src/services/experimentActions.test.ts` — remove mock of `resolveOrCreateStrategyFromRunConfig`, update to V2 strategy mock
- `evolution/src/lib/v2/runner.test.ts` — remove `config` field from `makeClaimedRun` helper
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
1. **Deploy Phase 1 code** — all run-creation paths now set strategy_config_id. Config JSONB still written.
2. **Deploy Phase 2 code** — runner reads from strategy FK. Config JSONB still written but no longer read.
3. **Run backfill script** — populate strategy_config_id for any existing NULL rows.
4. **Run Migration 3a** — SET NOT NULL on strategy_config_id (fails safely if any NULLs remain).
5. **Deploy Phase 3c code** — V1 types deleted, config JSONB no longer written.
6. **Run Migration 3b-1** — RENAME config to _config_deprecated.
7. **Soak 1 week** — monitor for any errors referencing the old column name.
8. **Run Migration 3b-2** — DROP _config_deprecated column.

### Rollback Plan
- **Phase 1 rollback:** Revert code. Runs still have config JSONB, no data loss.
- **Phase 2 rollback:** Revert code. Runner falls back to reading config JSONB (still populated by Phase 1).
- **Phase 3a rollback:** `ALTER TABLE evolution_runs ALTER COLUMN strategy_config_id DROP NOT NULL;`
- **Phase 3b-1 rollback:** `ALTER TABLE evolution_runs RENAME COLUMN _config_deprecated TO config;`
- **Phase 3b-2 is irreversible** — this is why we soak for 1 week after rename. If issues found during soak, rename back.

### Pre-Migration Verification Queries
```sql
-- Before Phase 3a: verify no NULL strategy_config_id rows
SELECT count(*) FROM evolution_runs WHERE strategy_config_id IS NULL;
-- Expected: 0

-- Before Phase 3b: verify no code reads config column
-- (manual code review — grep for '.config' on run objects)

-- Verify claim_evolution_run RPC does not reference config column
SELECT prosrc FROM pg_proc WHERE proname = 'claim_evolution_run';
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
- Strategy detail page displays correctly for both V1 (frozen) and V2 strategies

### Migration Tests
- Run Phase 3a migration against dev DB with seeded NULL rows → verify it fails
- Run backfill → re-run Phase 3a → verify it succeeds
- Run Phase 3b-1 rename → verify application still works
- Run Phase 3b-2 drop → verify application still works

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
