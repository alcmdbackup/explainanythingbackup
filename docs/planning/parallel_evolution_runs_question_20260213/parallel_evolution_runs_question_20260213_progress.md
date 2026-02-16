# Parallel Evolution Runs Question Progress

## Phase 1: LLM Call Semaphore
### Work Done
- Created `src/lib/services/llmSemaphore.ts` — `LLMSemaphore` class with FIFO queue, module-level singleton, `initLLMSemaphore()` for CLI override
- Fixed a slot-transfer bug caught by tests: when releasing with queued waiters, the slot should be transferred (not double-counted)
- Integrated into `src/lib/services/llms.ts` — wraps API calls with semaphore acquire/release when `call_source.startsWith('evolution_')`
- Created `src/lib/services/llmSemaphore.test.ts` — 12 tests covering acquire/release, FIFO ordering, concurrency limits, singleton management

### Issues Encountered
- Workflow hook blocked code edits: branch `feat/parallel_evolution_runs_question_20260213` didn't match project folder `parallel_evolution_runs_question_20260213`. Fixed with symlink.
- Semaphore bug: `acquire()` queue callback was incrementing count on slot transfer, causing count to exceed limit. Fixed by making release() transfer the slot directly.

## Phase 2: Atomic Run Claiming (SQL Migration)
### Work Done
- Created `supabase/migrations/20260214000001_claim_evolution_run.sql`
- Function uses `FOR UPDATE SKIP LOCKED` for safe concurrent claiming
- Returns claimed row with updated status/runner_id/timestamps

## Phase 3: Parallel Runner Loop
### Work Done
- Updated `scripts/evolution-runner.ts` with `--parallel N` (default 1), `--max-concurrent-llm N` (default 20) flags
- Added `claimBatch(batchSize)` function for serial batch claiming
- Replaced sequential main loop with: claim batch → `Promise.allSettled(batch.map(executeRun))` → log results → repeat
- Initializes LLM semaphore when parallel > 1
- Exported `claimBatch`, `parseIntArg` for testing
- Created `scripts/evolution-runner.test.ts` — 9 tests covering parseIntArg, claimBatch, parallel execution logic

### Issues Encountered
- Test had wrong expected value (9 vs 7) for batch loop math — fixed assertion.

## Phase 4: GitHub Actions Workflow
### Work Done
- Added `parallel` input to `workflow_dispatch` (default: '5')
- Passed `--parallel` flag to runner command in the batch step
- Kept existing concurrency group unchanged

## Phase 5: Dashboard "Start Batch" UI
### Work Done
- Created `src/lib/services/evolutionBatchActions.ts` — `dispatchEvolutionBatchAction` server action that calls GitHub REST API
- Input clamping: parallel 1-10, maxRuns 1-100
- Added `StartBatchCard` component to `src/app/admin/quality/evolution/page.tsx` with parallel/maxRuns/dryRun inputs
- Added "Trigger All Pending" convenience button that auto-fills maxRuns with pending run count
- Created `src/lib/services/evolutionBatchActions.test.ts` — 5 tests covering token validation, parameter clamping, API error handling

### Issues Encountered
- `handleError` requires `(error, context, additionalData)` — fixed call signature
- `logAdminAction` requires structured object with `adminUserId`/`action`/`entityType`/`entityId` — replaced with simpler `logger.info` since batch dispatch doesn't fit the audit log schema
- `ErrorResponse` requires `code` field — added `ERROR_CODES.INVALID_INPUT` and `ERROR_CODES.UNKNOWN_ERROR`

## Phase 6: Documentation
### Work Done
- Updated `docs/evolution/reference.md`:
  - Added CLI flag table for `--parallel`, `--max-concurrent-llm`, `--max-runs`, `--dry-run`
  - Added environment variables section for `EVOLUTION_MAX_CONCURRENT_LLM`, `GITHUB_TOKEN`, `GITHUB_REPO`
  - Updated `claim_evolution_run` from "not yet created" to documenting the RPC
  - Added `evolutionBatchActions.ts` and `llmSemaphore.ts` to key files table
  - Updated admin UI section with Batch Dispatch card
  - Updated GitHub Actions reference with `--parallel` input
- Updated `docs/evolution/architecture.md`:
  - Added "Parallel Execution" section documenting per-run isolation, LLM semaphore, atomic claiming, and dashboard dispatch
