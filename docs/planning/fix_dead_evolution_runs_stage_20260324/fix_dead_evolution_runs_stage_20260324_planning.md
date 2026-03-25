# Fix Dead Evolution Runs Stage Plan

## Background
Evolution runs on stage are dying during finalization due to a runner_id mismatch between processRunQueue.ts (which claims runs) and executeV2Run (which finalizes them). The claim RPC sets runner_id to 'v2-hostname-pid-timestamp' but executeV2Run hardcodes 'legacy-runId', causing the finalization UPDATE to match 0 rows. Additionally, executeV2Run should be fully deprecated since claimAndExecuteRun handles the full lifecycle correctly.

## Requirements (from GH Issue #812)
1. Fix runner_id mismatch: processRunQueue.ts passes RUNNER_ID to claim but executeV2Run hardcodes 'legacy-runId' for finalization
2. Deprecate executeV2Run: migrate processRunQueue.ts to use executePipeline directly
3. Remove executeV2Run entirely (only 1 caller: processRunQueue.ts)
4. Update evolution/docs/architecture.md and reference.md to fix incorrect file paths and remove executeV2Run references
5. Add/update unit tests for the affected code paths
6. Verify fix on stage by re-running a failed evolution run

## Problem
`processRunQueue.ts` (the minicomputer batch runner) claims runs via the `claim_evolution_run` RPC which sets `runner_id = "v2-hostname-pid-timestamp"` in the DB. It then calls `executeV2Run()`, which hardcodes `runnerId = "legacy-${runId}"` when calling the internal `executePipeline()`. During finalization, `persistRunResults.ts` builds an UPDATE with `WHERE runner_id = 'legacy-...'` which matches 0 rows since the DB has the v2 format. The run stays in `running` status with no further progress until the next claim call expires it as stale. Three runs on stage failed this way on March 23-24.

## Options Considered

### Option A: Pass runnerId to executeV2Run
- Add a `runnerId` parameter to `executeV2Run`
- processRunQueue.ts passes `RUNNER_ID`
- Minimal change, fixes the bug
- Leaves deprecated code in place

### Option B: Refactor claimAndExecuteRun to accept external DB
- Add optional `supabase` parameter to `claimAndExecuteRun`
- processRunQueue.ts stops doing its own claiming
- Invasive — changes the public API and breaks multi-DB round-robin claiming

### Option C: Export executePipeline, remove executeV2Run (CHOSEN)
- Export `executePipeline` and `markRunFailed` from `claimAndExecuteRun.ts` (`startHeartbeat` is already exported; `RawLLMProvider` is NOT exported — processRunQueue.ts never references it by name, it just passes an object literal)
- processRunQueue.ts calls `executePipeline` directly with correct `RUNNER_ID`
- processRunQueue.ts manages its own heartbeat + error handling (it already does both)
- Remove `executeV2Run` entirely — it has exactly 1 caller
- Eliminates double error handling (both executeV2Run and processRunQueue catch + markRunFailed)
- Maximum simplicity: fewer layers, no deprecated bridge code

**Important contract note:** `executePipeline` calls `markRunFailed` internally when `buildRunContext` fails (line 179), then re-throws. External callers catching the thrown error and calling `markRunFailed` again is safe — the `.in('status', ['pending', 'claimed', 'running'])` guard makes the second call a no-op. But callers should be aware of this behavior.

## Phased Execution Plan

### Phase 1: Export internal functions and remove executeV2Run

**File: `evolution/src/lib/pipeline/claimAndExecuteRun.ts`**
1. Add `export` to `markRunFailed` (line 51)
2. Update `executePipeline` JSDoc: remove executeV2Run reference, add contract note that it calls `markRunFailed` internally on context build failure then re-throws (so callers should not assume every thrown error needs marking — though double-marking is safe due to status guards)
3. Add `export` to `executePipeline` (line 162)
4. Delete `executeV2Run` function entirely (lines 223-248)
5. Do NOT export `RawLLMProvider` — processRunQueue.ts uses it implicitly via `createRawLLMProvider()` returning an inferred type. No consumer needs the named type.

**File: `evolution/src/lib/pipeline/index.ts`**
6. Remove `executeV2Run` from exports (line 79)
7. Add `executePipeline`, `startHeartbeat`, `markRunFailed` to barrel exports (startHeartbeat is already exported from claimAndExecuteRun.ts but not re-exported from the barrel — add it for consistency)

### Phase 2: Update processRunQueue.ts

**File: `evolution/scripts/processRunQueue.ts`**
1. Change import from `executeV2Run` to `executePipeline, startHeartbeat, markRunFailed` (note: `createRawLLMProvider` remains a local function in processRunQueue.ts — it is NOT imported from the pipeline)
2. Remove local `markRunFailed` function (lines 162-173) — now imported from pipeline
3. Rewrite `executeRun()` to call executePipeline directly:

```typescript
async function executeRun(tagged: TaggedRun): Promise<void> {
  const { run, db } = tagged;
  log('info', 'Starting evolution run', {
    runId: run.id, db: db.name,
    explanationId: run.explanation_id, promptId: run.prompt_id, dryRun: DRY_RUN,
  });

  if (DRY_RUN) {
    log('info', 'DRY RUN: would execute full pipeline here', { runId: run.id, db: db.name });
    await db.client.from('evolution_runs').update({
      status: 'completed', completed_at: new Date().toISOString(),
      error_message: 'dry-run: no execution performed',
    }).eq('id', run.id);
    return;
  }

  const llmProvider = createRawLLMProvider();
  const heartbeatInterval = startHeartbeat(db.client, run.id);
  const startTime = Date.now();

  try {
    await executePipeline(run.id, run, db.client, llmProvider, startTime, RUNNER_ID);
    log('info', 'Run completed', { runId: run.id, db: db.name });
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    log('error', 'Run failed', { runId: run.id, db: db.name, error: message });
    await markRunFailed(db.client, run.id, message);
  } finally {
    clearInterval(heartbeatInterval);
  }
}
```

Key improvements:
- `RUNNER_ID` is passed as runnerId — matches what the claim RPC stored
- Single error handler (no more double markRunFailed)
- Heartbeat managed directly with proper finally cleanup

### Phase 3: Update tests

**File: `evolution/scripts/processRunQueue.test.ts`**

Update mocks:
```typescript
const mockExecutePipeline = jest.fn().mockResolvedValue(undefined);
const mockStartHeartbeat = jest.fn().mockReturnValue(setInterval(() => {}, 99999));
const mockMarkRunFailed = jest.fn().mockResolvedValue(undefined);

jest.mock('../src/lib/pipeline/claimAndExecuteRun', () => ({
  executePipeline: mockExecutePipeline,
  startHeartbeat: mockStartHeartbeat,
  markRunFailed: mockMarkRunFailed,
}));
```

Test updates:
1. **REGRESSION TEST (critical)** — "passes RUNNER_ID as runnerId to executePipeline":
```typescript
it('passes RUNNER_ID as runnerId to executePipeline (regression: runner_id mismatch)', async () => {
  // ... setup claimed run ...
  await executeRun(tagged);
  // executePipeline(runId, claimedRun, dbClient, llmProvider, startTime, runnerId)
  // runnerId is the 6th positional argument
  expect(mockExecutePipeline).toHaveBeenCalledWith(
    run.id,           // runId
    run,              // claimedRun
    expect.anything(), // db client
    expect.objectContaining({ complete: expect.any(Function) }), // llmProvider
    expect.any(Number), // startTime
    expect.stringMatching(/^v2-/), // runnerId — MUST match claim format, NOT 'legacy-*'
  );
});
```

2. Update "delegates to executeV2Run" → "delegates to executePipeline with correct args"
3. Update "marks run failed when executeV2Run throws" → "marks run failed when executePipeline throws" — assert `mockMarkRunFailed` is called (imported, not local)
4. Add test: "starts heartbeat before pipeline and clears on success":
```typescript
it('starts heartbeat before pipeline and clears on completion', async () => {
  const callOrder: string[] = [];
  mockStartHeartbeat.mockImplementation(() => { callOrder.push('heartbeat'); return setInterval(() => {}, 99999); });
  mockExecutePipeline.mockImplementation(async () => { callOrder.push('pipeline'); });
  await executeRun(tagged);
  expect(callOrder).toEqual(['heartbeat', 'pipeline']);
  // clearInterval is called in finally — verify heartbeat handle was used
});
```
5. Add test: "clears heartbeat even on pipeline failure":
```typescript
it('clears heartbeat even on pipeline failure', async () => {
  const fakeHandle = setInterval(() => {}, 99999);
  mockStartHeartbeat.mockReturnValue(fakeHandle);
  mockExecutePipeline.mockRejectedValueOnce(new Error('boom'));
  await executeRun(tagged);
  // clearInterval should have been called with the exact handle from startHeartbeat
  expect(clearInterval).toHaveBeenCalledWith(fakeHandle);
  expect(mockMarkRunFailed).toHaveBeenCalledWith(
    expect.anything(), // db client
    run.id,
    expect.stringContaining('boom'),
  );
});
```
6. Update "marks run failed" test to assert on `mockMarkRunFailed` (the imported function), NOT on raw Supabase `.update()` calls — the imported markRunFailed is now mocked at module level
7. Remove local `markRunFailed` from test exports line (processRunQueue.ts line 293) since the local function no longer exists
8. Note: use `jest.isolateModules()` if mock leakage occurs across describe blocks (the existing dry-run test at line 363 already uses `jest.resetModules()`)

**File: `evolution/src/lib/pipeline/claimAndExecuteRun.test.ts`**
- No changes needed — no tests for executeV2Run exist here

### Phase 4: Update documentation

**File: `evolution/docs/architecture.md`** — Fix incorrect file paths and executeV2Run references:
- Line 70: Change `executeV2Run()` → `executePipeline()` in description of core runner
- Line 90: Change `executeV2Run() [runner.ts]` → `executePipeline() [claimAndExecuteRun.ts]`
- Line 132: Change `executeV2Run()` → `executePipeline()` via `claimAndExecuteRun()`

**File: `evolution/docs/reference.md`** — Fix 6 incorrect file paths:
- `evolution/src/services/evolutionRunnerCore.ts` → `evolution/src/lib/pipeline/claimAndExecuteRun.ts`
- `evolution/src/lib/pipeline/runner.ts` → `evolution/src/lib/pipeline/claimAndExecuteRun.ts`
- `evolution/src/lib/pipeline/evolve-article.ts` → `evolution/src/lib/pipeline/loop/runIterationLoop.ts`
- Remove all `executeV2Run` references, replace with `executePipeline` where appropriate

**File: `evolution/docs/minicomputer_deployment.md`** — No changes needed (docs reference processRunQueue.ts by behavior, not internal function names)

### Phase 5: Verify on stage
1. Run lint, tsc, build
2. Run unit tests for affected files
3. Run integration tests
4. Create a pending evolution run on stage
5. Execute processRunQueue.ts manually with `--max-runs 1`
6. Confirm run completes successfully (status='completed', runner_id preserved)

## Testing

### Unit tests to update
- `evolution/scripts/processRunQueue.test.ts` — Update mocks from executeV2Run to executePipeline+startHeartbeat+markRunFailed

### Unit tests to verify pass (no changes)
- `evolution/src/lib/pipeline/claimAndExecuteRun.test.ts`
- `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts`

### Integration tests to run
- `src/__tests__/integration/evolution-claim.integration.test.ts`

### Manual verification on stage
- Run `npx tsx evolution/scripts/processRunQueue.ts --max-runs 1` against stage
- Verify: run status = 'completed', runner_id matches RUNNER_ID format, finalization succeeds

## Rollback Plan
If the fix breaks on stage:
1. Stop the systemd timer: `sudo systemctl stop evolution-runner.timer`
2. Revert the branch: `git revert HEAD` (or reset to the commit before our changes)
3. Restart the timer: `sudo systemctl restart evolution-runner.timer`
4. Any runs that failed during the broken window will be auto-expired by the stale-expiry mechanism and can be re-queued

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/architecture.md` - Fix 3 executeV2Run references and incorrect file paths (runner.ts doesn't exist)
- `evolution/docs/reference.md` - Fix 6+ incorrect file paths and remove executeV2Run from public API listing
- `evolution/docs/minicomputer_deployment.md` - No changes needed
- `docs/docs_overall/debugging.md` - No changes expected
- `docs/docs_overall/testing_overview.md` - No changes expected
- `docs/docs_overall/environments.md` - No changes expected
