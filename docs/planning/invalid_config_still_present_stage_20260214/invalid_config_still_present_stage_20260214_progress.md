# Invalid Config Still Present Stage Progress

## Phase 1: Kill Run — Server Action + Pipeline Check
### Work Done
- **1.1**: Added `'kill_evolution_run'` to `AuditAction` type in `auditLog.ts`. Created `killEvolutionRunAction` server action in `evolutionActions.ts` with `requireAdmin()` guard, `withLogging` wrapper, and `serverReadRequestId` wrapper. Updates status to `'failed'` with `error_message: 'Manually killed by admin'` using `.in('status', ['pending', 'claimed', 'running'])` guard.
- **1.2**: Added 3 pipeline kill checkpoints in `pipeline.ts`:
  - 1.2a: Guard claimed→running transition with `.in('status', ['claimed'])`
  - 1.2b: Status check at top of each iteration loop — breaks with `stopReason = 'killed'` if DB status is `'failed'`
  - 1.2c: Completion guard — wraps completion update in `if (stopReason !== 'killed')` with `.in('status', ['running'])` defense-in-depth
  - Made `supervisorState` optional in return type
- **1.3**: Added Kill button in admin UI `page.tsx` — visible when `run.status === 'running' || 'claimed'`, red styling, confirm dialog
- **1.4**: Added 6 kill action tests in `evolutionActions.test.ts` — all pass (43/43 total)
- **1.5**: Added 5 kill detection tests in `pipeline.test.ts` — all pass (64/64 total)

### Issues Encountered
- Claimed→running guard initially used `.select('id')` chained after `.in()`, incompatible with test mock where `.in()` is a terminal resolver. Simplified to `.in('status', ['claimed'])` without result check.
- Existing test "calls markRunFailed with status guard" broke because new `.in('status', ['claimed'])` call was found before the `markRunFailed` `.in()` call. Fixed by making test find more specific: `call[1].includes('running')`.

### User Clarifications
None needed.

## Phase 2: Test Name Filtering
### Work Done
- **2.1**: Added `isTestEntry()` helper in new `configValidation.ts` module. Applied filter in `page.tsx` `useEffect` for both prompts and strategies dropdowns.
- **2.2**: Added 6 `isTestEntry` tests in `configValidation.test.ts` — all pass.

### Issues Encountered
None.

### User Clarifications
None needed.

## Phase 3: Config Validation — Server-Side
### Work Done
- **3.1**: Created `src/lib/evolution/core/configValidation.ts` with two validation functions:
  - `validateStrategyConfig()` — lenient (skips checks on absent fields, since partial configs get defaults from `resolveConfig()`). Checks: model names against `allowedLLMModelSchema`, budget cap keys/values, agent selection via `validateAgentSelection()`, iterations > 0.
  - `validateRunConfig()` — strict (all fields must be present and valid after `resolveConfig()`). Checks everything in strategy validation PLUS: `budgetCapUsd > 0` and finite, supervisor constraints (expansion minPool, maxIterations relationships, diversityThreshold), nested object bounds (plateau, generation, calibration, tournament).
- **3.2**: Integrated validation at two points:
  - Point A: `buildRunConfig()` in `evolutionActions.ts` — validates processed (post-clamping) config values
  - Point B: `preparePipelineRun()` in `index.ts` — validates complete config after `resolveConfig()` merges defaults
- **3.3**: Added 32 tests in `configValidation.test.ts` — 6 isTestEntry + 11 validateStrategyConfig + 15 validateRunConfig. All pass.

### Issues Encountered
- `validateAgentSelection()` returns `string[]` not `{ valid, errors }` — fixed usage.
- `ALLOWED_MODELS` Set needed explicit `: Set<string>` type annotation for `.has(string)` to work.
- `QueueStrategyConfig.enabledAgents` is `string[]` but `StrategyConfig.enabledAgents` expects `AgentName[]` — used cast.
- Validation in `buildRunConfig` initially used raw strategy values (`iterations: 0`), causing 8 existing edge-case tests to fail. Fixed by validating the processed `runConfig` values (post-clamping) and making `validateStrategyConfig` lenient about absent fields.

### User Clarifications
None needed.

## Phase 4: Config Validation — Client-Side Warnings
### Work Done
- **4.1**: Changed `strategies` state from `{ id: string; label: string }[]` to `StrategyConfigRow[]` in `page.tsx`. Updated `useEffect` to keep full rows with test-name filter.
- **4.2**: Added `configWarnings` computed state using `useMemo` — runs `validateStrategyConfig()` on selected strategy's `.config` field.
- **4.3**: Added inline warning UI (red error boxes between form row and cost estimate). Disabled "Start Pipeline" button when `configWarnings.length > 0`.
- **4.4**: No separate tests needed — `validateStrategyConfig` already tested in Phase 3. Added `data-testid="config-warnings"` for future E2E tests.

### Issues Encountered
None.

### User Clarifications
None needed.

## Phase 5: Staging Audit & Cleanup
### Work Done
Not yet started — requires staging DB access and manual verification.

### Verification Summary
- **tsc**: Clean (no errors, only pre-existing `.next/` cache warnings)
- **eslint**: Clean (only pre-existing design-system warnings)
- **Tests**: 139/139 pass across 3 test files (configValidation: 32, evolutionActions: 43, pipeline: 64)
