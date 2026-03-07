# Use Local Minicomputer Not GH For Evolution Runs Progress

## Phase 1: Fix Batch Runner — Prompt-Based Run Support
### Work Done
- Added `prompt_id` to `ClaimedRun` interface and fallback query
- Replaced rejection guard with three-way content resolution (explanation, prompt+seed, or fail)
- Guarded `main()` for testability
- Exported `executeRun`, `markRunFailed`, `getSupabase`

### Issues Encountered
- Module-level `main()` call ran on import during tests, causing `process.exit(1)`. Fixed with `require.main === module` guard.
- Supabase mock chain needed restructuring for the new prompt-based path (`from().select().eq().single()` chain).

## Phase 2: Update Tests
### Work Done
- Added `prompt_id: null` to existing mock objects
- Added 3 new tests: explanation-based, prompt-based, both-null failure
- Set up mocks for `../src/lib/index`, `../src/lib/core/seedArticle`, `../../src/lib/services/llmSemaphore`
- 12/12 tests passing

## Phase 3: Vercel Cron — Disabled via Env Var Gate
### Work Done
- Added `EVOLUTION_CRON_ENABLED` runtime check to GET handler in `route.ts`
- Kept cron entry in `vercel.json` (not removed)
- Added 2 tests for the gate; updated existing tests to set env var
- 16/16 route tests passing

### User Clarifications
- User requested keeping the cron as a re-enableable backup rather than fully removing it
- Final approach: gate at runtime via env var, no code deploy needed to re-enable

## Phase 4: Documentation & Systemd Files
### Work Done
- Updated `architecture.md`: replaced GH Actions reference with minicomputer description
- Updated `reference.md`: replaced Batch Dispatch card, removed unused env vars, added `EVOLUTION_CRON_ENABLED`, added minicomputer deployment section
- Updated `environments.md`: added Local Minicomputer row
- Created `evolution/deploy/evolution-runner.service` and `evolution-runner.timer`

## Verification
- Lint: clean
- TSC: clean
- Build: success
- All tests: 28/28 passing
