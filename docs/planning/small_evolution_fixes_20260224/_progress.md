# Small Evolution Fixes Progress

## Phase 1: Budget passthrough fix (backend)
### Work Done
- Added `perRunBudget = input.budget / totalRunCount` with zero-guard in `experimentActions.ts`
- Added `budgetCapUsd: perRunBudget` to overrides after `...input.configDefaults` spread
- Added `perRunBudgetNextRound = remainingBudget / totalNextRoundRuns` with zero-guard in `route.ts`
- Added `budgetCapUsd: perRunBudgetNextRound` to `resolveRunConfig` closure overrides
- All 23 existing experimentActions tests pass, all 17 route tests pass

## Phase 2: Budget UX fix (frontend)
### Work Done
- Changed label from "Budget ($)" to "Total Budget ($)"
- Added `step="0.01"` and `min={0.01}` to number input
- Changed client validation from `budget <= 0` to `budget < 0.01`
- Added refresh button next to "Validation Preview" calling `runValidation()`
- Lint and tsc clean

## Phase 3: Kill button (frontend)
### Work Done
- Added `killEvolutionRunAction` import from `@evolution/services/evolutionActions`
- Added `handleKill` handler following `handleTrigger` pattern
- Added Kill button for statuses `['pending', 'claimed', 'running', 'continuation_pending']`
- Uses `text-[var(--status-error)]` styling (red) to distinguish from other actions
- Lint and tsc clean

## Phase 4: Unit tests
### Work Done
- `experimentActions.test.ts`: Added budget passthrough test (budget $12.50, 8 runs → assert $1.5625 each)
- `experimentActions.test.ts`: Added zero-runs edge case test (mock L8 → 0 runs → assert error)
- `route.test.ts`: Updated `resolveConfig` mock to respect overrides via `(overrides) => ({ ...defaults, ...overrides })`
- `route.test.ts`: Added budget passthrough test (remaining $30, 3 runs → assert $10.0 each)
- `route.test.ts`: Added zero-runs edge case test (mock FF → 0 runs → assert graceful return)
- All 25 experimentActions tests pass (23 + 2 new), all 19 route tests pass (17 + 2 new)

## Phase 5: Full verification
### Work Done
- `npm run lint`: 0 errors (pre-existing warnings only)
- `npx tsc --noEmit`: 0 errors
- `npm test`: 4,983 pass, 5 fail in unrelated suite (npm cache EROFS sandbox issue)
- `npm run build`: Fails due to missing env vars (pre-existing, not related to changes)
