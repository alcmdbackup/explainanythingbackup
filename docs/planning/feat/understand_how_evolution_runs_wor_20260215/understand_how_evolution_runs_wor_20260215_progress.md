# Understand How Evolution Runs Work — Progress

## Phase 1: Research
### Work Done
- Researched evolution pipeline job processing: cron-based claiming, heartbeat tracking, checkpoint/resume, serverless timeout constraints
- Documented findings in `_research.md` covering Vercel serverless model, timeout limits, and continuation-passing strategy

### Issues Encountered
- None

## Phase 2: Implementation — Continuation-Passing

### Work Done

#### Step 1.1: Bump maxDuration (route.ts)
- Changed `maxDuration` from 300 to 800 seconds (Vercel Pro Fluid Compute limit)

#### Step 2.1: DB Migration
- Created `supabase/migrations/20260216000001_add_continuation_pending_status.sql`
  - Added `continuation_pending` to CHECK constraint
  - Added `continuation_count INT NOT NULL DEFAULT 0` column
  - Created partial index `idx_evolution_runs_continuation`
  - Updated `claim_evolution_run` RPC to prioritize `continuation_pending` over `pending`
  - Added `checkpoint_and_continue` RPC (atomic checkpoint + status transition)
- Created rollback migration

#### Step 2.2: TypeScript Types
- Added `'continuation_pending'` to `EvolutionRunStatus` union
- Added `CheckpointNotFoundError` and `CheckpointCorruptedError` error classes

#### Step 2.3: CostTracker restoreSpent()
- Added `restoreSpent(amount)` method to `CostTrackerImpl` — sets totalSpent from checkpoint
- Added `createCostTrackerFromCheckpoint(config, restoredTotalSpent)` factory

#### Step 2.4: Pipeline Time-Check + Continuation Logic
- Added `maxDurationMs` and `continuationCount` to `FullPipelineOptions`
- Added max-continuation guard (MAX_CONTINUATIONS = 10)
- Added per-iteration time-check with adaptive safety margin: `Math.min(120_000, Math.max(60_000, elapsed * 0.10))`
- Added `continuation_timeout` branch that calls `checkpointAndMarkContinuationPending` atomically

#### Step 2.5: Persistence Functions
- Added `checkpointAndMarkContinuationPending()` — atomic RPC wrapper
- Added `loadCheckpointForResume()` — queries latest `iteration_complete` checkpoint
- Added `CheckpointResumeData` interface
- Updated `markRunFailed` guard to include `continuation_pending`

#### Step 2.6: Resume Pipeline Factory
- Added `ResumedPipelineRunInputs` and `PreparedResumedPipelineRun` interfaces
- Added `prepareResumedPipelineRun()` — creates ctx from checkpoint with restored cost tracker

#### Step 2.7: Cron Runner Resume Path
- Rewrote `evolution-runner/route.ts` with `claim_evolution_run` RPC
- Added resume detection via `continuation_count > 0`
- Passes `maxDurationMs: (maxDuration - 60) * 1000` to pipeline
- Handles `continuation_timeout` stopReason as non-terminal

#### Step 2.8: Watchdog Stale Continuation
- Defense-in-depth: checks for recent checkpoint before marking stale run as failed
- If checkpoint found → transitions to `continuation_pending` instead
- Added stale `continuation_pending` detection (30 min threshold → abandoned)
- Response now includes `markedFailed`, `recoveredViaContinuation`, `abandonedContinuations`

#### Step 2.9 + 2.10: UI & Status Guards
- `EvolutionStatusBadge`: added `continuation_pending` style (gold) and `↻` icon, displays as "resuming"
- `evolutionActions.ts`: added `continuation_pending` to `markRunFailed` and `killEvolutionRunAction` guards
- `evolutionVisualizationActions.ts`: added `continuation_pending` to active runs count
- Admin page: added `<option value="continuation_pending">Resuming</option>` to dropdown

#### Step 2.10d: Batch Runner Resume Path
- Added `continuation_count` to `ClaimedRun` interface
- Rewrote `executeRun()` with resume detection and two paths (fresh vs. resume)
- Updated `markRunFailed` guard to include `continuation_pending`

### Unit Tests Written
- Extended `costTracker.test.ts`: +7 tests for `restoreSpent()` and `createCostTrackerFromCheckpoint`
- Created `persistence.continuation.test.ts`: 9 tests for `checkpointAndMarkContinuationPending` and `loadCheckpointForResume`
- Updated `persistence.test.ts`: fixed `markRunFailed` guard assertion to include `continuation_pending`
- Updated `EvolutionStatusBadge.test.tsx`: added `continuation_pending` to ALL_STATUSES, icon map, display text
- Rewrote `evolution-watchdog/route.test.ts`: 6 tests covering checkpoint recovery, stale continuation abandonment
- **Total: 58 tests passing across 5 test files**

### Issues Encountered
1. **Project folder path mismatch**: Hook expected `docs/planning/feat/...` matching branch `feat/understand_how_evolution_runs_wor_20260215`, but folder was at `docs/planning/understand_how_evolution_runs_wor_20260215/`. Fixed by moving folder.
2. **Frontend prerequisite hook**: Blocked StatusBadge edit until `design_style_guide.md` was read. Fixed by reading it.
3. **Unused import lint error**: `CostTracker` type imported but unused in `persistence.ts`. Fixed by removing it.
4. **Self-referencing export**: `export { prepareResumedPipelineRun } from './index'` would cause circular import. Removed immediately.
5. **Jest mock hoisting**: `chain` variable in persistence.continuation.test.ts was inaccessible inside `jest.mock()` factory. Fixed by defining mock object inside the factory.
6. **Watchdog test breakage**: Existing watchdog tests didn't account for new checkpoint check and continuation_pending queries. Rewrote with `buildWatchdogMock()` helper.

### Verification
- `npx tsc --noEmit` — 0 errors
- `npx next lint` — 0 errors (pre-existing warnings only)
- `npx next build` — successful
- All 58 unit tests pass

### Files Changed
| File | Change |
|------|--------|
| `src/app/api/cron/evolution-runner/route.ts` | Bumped maxDuration, rewrote with RPC claiming + resume path |
| `src/app/api/cron/evolution-watchdog/route.ts` | Defense-in-depth checkpoint check, stale continuation detection |
| `src/lib/evolution/types.ts` | continuation_pending status, error classes |
| `src/lib/evolution/core/costTracker.ts` | restoreSpent(), createCostTrackerFromCheckpoint factory |
| `src/lib/evolution/core/persistence.ts` | checkpointAndMarkContinuationPending, loadCheckpointForResume |
| `src/lib/evolution/core/pipeline.ts` | Time-check, max-continuation guard, continuation_timeout branch |
| `src/lib/evolution/index.ts` | Exports + prepareResumedPipelineRun factory |
| `scripts/evolution-runner.ts` | Batch runner resume path |
| `src/components/evolution/EvolutionStatusBadge.tsx` | continuation_pending style + icon |
| `src/lib/services/evolutionActions.ts` | Status guard updates |
| `src/lib/services/evolutionVisualizationActions.ts` | Active runs count |
| `src/app/admin/quality/evolution/page.tsx` | Status filter dropdown |
| `supabase/migrations/20260216000001_*.sql` | DB migration + rollback |

### Files Created
| File | Purpose |
|------|---------|
| `supabase/migrations/20260216000001_add_continuation_pending_status.sql` | Migration |
| `supabase/migrations/20260216000001_revert_continuation_pending.sql.rollback` | Rollback |
| `src/lib/evolution/core/persistence.continuation.test.ts` | Continuation persistence tests |
