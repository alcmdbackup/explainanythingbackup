# Experiments Vs Strategies Refactor Evolution Progress

## Phase 1: Database Migrations + Type Updates
### Work Done
- Created `20260225000001_strategy_experiment_created_by.sql`: extends `created_by` CHECK constraint to include `'experiment'` and `'batch'`
- Created `20260225000002_fix_welford_init.sql`: fixes Welford mean initialization (`COALESCE(v_old.avg_final_elo, p_final_elo)` instead of `0`)
- Updated `StrategyConfigRow.created_by` type in `strategyConfig.ts` to `'system' | 'admin' | 'experiment' | 'batch'`

## Phase 2: Atomic Strategy Resolution Helper
### Work Done
- Added `normalizeEnabledAgents()` to `strategyConfig.ts`: undefined → omit, [] → undefined, non-empty → sort
- Created `strategyResolution.ts` with `resolveOrCreateStrategy()` and `resolveOrCreateStrategyFromRunConfig()`
- INSERT-first atomic upsert pattern eliminates TOCTOU race condition
- Refactored `resolveStrategyConfigAction` in `eloBudgetActions.ts` to delegate to new helper
- 9 tests in `strategyResolution.test.ts`, 4 tests for normalizeEnabledAgents

## Phase 3: Wire Experiments to Pre-Register Strategies
### Work Done
- `experimentActions.ts`: calls `resolveOrCreateStrategyFromRunConfig` before bulk run insert, includes `strategy_config_id`
- `experiment-driver/route.ts`: pre-registers strategy in `handlePendingNextRound`, tracks `bestStrategyId` in `writeTerminalState`
- Both test files updated with strategyResolution mocks

## Phase 4: Fix linkStrategyConfig Race Condition
### Work Done
- Replaced SELECT-then-INSERT in `metricsWriter.ts` `linkStrategyConfig()` with `resolveOrCreateStrategyFromRunConfig()`
- Removed old `extractStrategyConfig`, `hashStrategyConfig`, `labelStrategyConfig` imports
- Added 4 tests: skip when already linked, atomic resolve + link, error handling, link failure handling

## Phase 5: Batch Runner Pre-Linking
### Work Done
- Added strategy pre-registration in `run-batch.ts` `executeEvolutionRun()` after `preparePipelineRun`
- Uses dynamic import for `resolveOrCreateStrategyFromRunConfig` with `createdBy: 'batch'`
- Updates run row with `strategy_config_id` before pipeline execution

## Phase 6: UI Improvements - Created-By Filter
### Work Done
- Added `createdBy?: string[]` filter to `getStrategiesAction` in `strategyRegistryActions.ts`
- Replaced `predefinedOnly` checkbox with `createdByFilter` select dropdown (All/Admin/System/Experiment/Batch)
- Follows existing Midnight Scholar design system patterns (border, surface-input, font-ui tokens)

## Phase 7: Backfill Enhancement
### Work Done
- Updated `backfillStrategyConfigIds()` to select `experiment_id` and `batch_run_id` columns
- Detects run origin: experiment_id → 'experiment', batch_run_id → 'batch', else → 'system'
- Passes `created_by` to strategy insert for correct origin tracking on historical data

## Phase 8: Documentation
### Work Done
- Updated this progress document with all phase details
