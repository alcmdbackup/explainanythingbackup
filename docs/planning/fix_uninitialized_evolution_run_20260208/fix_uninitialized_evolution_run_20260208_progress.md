# Fix Uninitialized Evolution Run Progress

## Phase 1: Type Fixes & Validation Guardrails

### Work Done
- **Phase 1a**: Changed `explanationId` type from `number` to `number | null` across 6 files:
  - `src/lib/evolution/types.ts` (AgentPayload)
  - `src/lib/evolution/index.ts` (PipelineRunInputs)
  - `src/lib/services/evolutionActions.ts` (EvolutionRun, EvolutionVariant)
  - `src/lib/services/evolutionVisualizationActions.ts` (DashboardRun)
  - `scripts/evolution-runner.ts` (ClaimedRun)
  - `src/testing/utils/evolution-test-helpers.ts` (factory params)

- **Phase 1b**: Added `source` column to `queueEvolutionRunAction` insert:
  - `'explanation'` for explanation-based runs, `'prompt:<id>'` for prompt-based runs

- **Phase 1c**: Added null `explanation_id` guard in `triggerEvolutionRunAction` (admin trigger rejects prompt-based runs with descriptive error) and admin UI (`handleApplyWinner`, `handleRollback`)

### Issues Encountered
- 4 downstream TypeScript errors after type change: `evolution-runner.ts:160`, `page.tsx:476,492,507`. Fixed by adding null guards with early returns.

## Phase 2: Cron Runner Prompt-Based Execution

### Work Done
- **Phase 2a**: Extracted `generateSeedArticle` from `scripts/run-evolution-local.ts` into shared utility at `src/lib/evolution/core/seedArticle.ts`. Updated CLI to import from shared module.

- **Phase 2b**: Updated cron runner (`route.ts`) with:
  - `maxDuration = 300` (5 min headroom for seed generation + pipeline)
  - Added `prompt_id` to SELECT query
  - Branching content resolution: explanation-based vs prompt-based vs invalid
  - `promptBasedEvolutionEnabled` feature flag check
  - Try/catch around content resolution that calls `markRunFailed` (prevents orphaned `claimed` runs)

- **Phase 2c**: Added `promptBasedEvolutionEnabled` to feature flags system:
  - `EvolutionFeatureFlags` interface, `DEFAULT_EVOLUTION_FLAGS`, `FLAG_MAP`

### Issues Encountered
None.

## Phase 3: Batch Runner Error Cleanup

### Work Done
- Added `markRunFailed()` function to `scripts/evolution-runner.ts`
- Added null `explanation_id` guard at top of `executeRun()` (logs warning + marks failed)
- Added `await markRunFailed()` call in catch block (was previously just logging — runs stayed `claimed` forever)

### Issues Encountered
None.

## Phase 4: Tests + Test Helper Updates

### Work Done
- Created `src/lib/evolution/core/seedArticle.test.ts` (4 tests):
  - Happy path: valid JSON title + article content
  - Fallback: raw title when JSON parse fails
  - Error: title LLM call failure with descriptive message
  - Error: article LLM call failure with descriptive message

- Updated `src/app/api/cron/evolution-runner/route.test.ts` (4 new tests):
  - Prompt-based run: seed article generation when `explanation_id` null + `prompt_id` set
  - Invalid run: both null → marks failed with 400
  - Seed failure: `claimed` → `failed` transition (not orphaned)
  - Feature flag: prompt-based evolution disabled → marks failed

- Updated `src/lib/services/runTriggerContract.test.ts` (1 new test):
  - Queue with `promptId` only (no `explanationId`) succeeds

- Updated test helpers: `createTestEvolutionRun` and `createTestVariant` accept `number | null`, `cleanupEvolutionData` accepts `extraRunIds`

### Issues Encountered
- `titleQuerySchema` requires `title1`, `title2`, `title3` — test initially only provided `title1`, causing Zod parse to fall back to raw string. Fixed by providing all three fields.
- Error test called `generateSeedArticle` twice with `mockRejectedValueOnce` — second call got `undefined`. Fixed by using `mockRejectedValue` (persistent) and single regex assertion.

### Test Results
- `seedArticle.test.ts`: 4/4 passed
- `route.test.ts`: 16/16 passed (12 existing + 4 new)
- `runTriggerContract.test.ts`: 8/8 passed (7 existing + 1 new)
- TypeScript: clean (`npx tsc --noEmit` — no errors outside `.next/` cache)
- ESLint: clean (all changed files)

## Phase 5: Documentation Updates

### Work Done
- Updated `docs/feature_deep_dives/evolution_pipeline.md`:
  - Added `seedArticle.ts` to integration points table
  - Updated cron runner description (prompt-based support, feature flag)
  - Updated `evolution_runs` table description (prompt-based source)
  - Updated feature_flags table description
  - Updated pipeline execution flow (two run types, seed generation)

- Updated `docs/feature_deep_dives/evolution_framework.md`:
  - Updated Run primitive description (two run types)
  - Added `seedArticle.ts` to key files
  - Added inline trigger rejection note

## Summary

All 5 phases completed. The fix enables prompt-based evolution runs (null `explanation_id`) to be correctly picked up and executed by the cron runner via `generateSeedArticle`. Batch runner and admin trigger gracefully reject or handle null `explanation_id` with descriptive errors. All type signatures are null-safe. 28 tests pass (4 new seed article + 4 new cron runner + 1 new trigger contract + 19 existing).
