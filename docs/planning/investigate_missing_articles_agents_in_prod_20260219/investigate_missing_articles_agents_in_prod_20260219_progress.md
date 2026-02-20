# Investigate Missing Articles Agents In Prod Progress

## Phase 1: Fix triggerEvolutionRunAction (claim step + heartbeat)
### Work Done
- Added `ClaimError` class with `isRaceCondition` flag to `evolutionActions.ts`
- Added claim step (`pending→claimed`) after `preparePipelineRun` and before `executeFullPipeline`
  - Sets `status: 'claimed'`, `runner_id: 'inline-trigger'`, `last_heartbeat`, `started_at`
  - Uses `.select().single()` for race detection (PGRST116 when 0 rows match)
- Added heartbeat interval (30s) before `executeFullPipeline`, cleared in `finally` block
- Updated catch block with `isClaimRace` guard — PGRST116 races don't mark run as failed

### Issues Encountered
None — implementation matched plan exactly.

## Phase 2: Tests
### Work Done
- Updated `setupTriggerMocks` with 3rd `.single()` mock for claim step
- Added `jest.useFakeTimers()` in `beforeEach`, `jest.useRealTimers()` in `afterEach`
- Added 4 new tests:
  1. `claims run before calling executeFullPipeline` — verifies claim fields AND ordering
  2. `does not mark run as failed when claim race condition occurs (PGRST116)` — verifies race leaves run for cron
  3. `marks run as failed when claim has a real DB error (non-PGRST116)` — verifies real errors mark failed
  4. `clears heartbeat interval when executeFullPipeline throws` — verifies cleanup in finally block
- Verified both existing tests still pass with updated mocks

### Verification
- ESLint: Clean
- TypeScript: Clean
- Tests: 51/51 passed

## Phase 3: Recover stuck production runs
### Status
SQL queries documented in planning doc — to be run manually in prod Supabase.

## Phase 4: Deploy and verify
### Status
Pending PR creation and merge.
