# Fix Dead Evolution Runs Stage Plan

## Background
Evolution runs on stage are dying during finalization due to a runner_id mismatch between processRunQueue.ts (which claims runs) and executeV2Run (which finalizes them). The claim RPC sets runner_id to 'v2-hostname-pid-timestamp' but executeV2Run hardcodes 'legacy-runId', causing the finalization UPDATE to match 0 rows. Additionally, executeV2Run should be fully deprecated since claimAndExecuteRun handles the full lifecycle correctly.

## Requirements (from GH Issue #812)
1. Fix runner_id mismatch: processRunQueue.ts passes RUNNER_ID to claim but executeV2Run hardcodes 'legacy-runId' for finalization
2. Unify processRunQueue.ts to use claimAndExecuteRun directly (not executeV2Run or executePipeline)
3. Remove executeV2Run entirely (only 1 caller: processRunQueue.ts)
4. Keep executePipeline internal — no new public exports needed
5. Update evolution/docs/architecture.md and reference.md to fix incorrect file paths and remove executeV2Run references
6. Add/update unit tests for the affected code paths
7. Verify fix on stage by re-running a failed evolution run

## Problem
`processRunQueue.ts` (the minicomputer batch runner) claims runs via the `claim_evolution_run` RPC which sets `runner_id = "v2-hostname-pid-timestamp"` in the DB. It then calls `executeV2Run()`, which hardcodes `runnerId = "legacy-${runId}"` when calling the internal `executePipeline()`. During finalization, `persistRunResults.ts` builds an UPDATE with `WHERE runner_id = 'legacy-...'` which matches 0 rows since the DB has the v2 format. The run stays in `running` status with no further progress until the next claim call expires it as stale. Three runs on stage failed this way on March 23-24.

## Design: Unified Architecture

**`claimAndExecuteRun.ts`** — the engine. Does everything: claim → heartbeat → pipeline → finalize → cleanup. Accepts an optional `db` client.

**`processRunQueue.ts`** — the scheduler. Loads two DB clients (staging + prod), loops through them calling `claimAndExecuteRun({ runnerId, db })` until no pending runs remain.

One does the work, the other decides which database to point it at.

```
processRunQueue.ts                    claimAndExecuteRun.ts
┌─────────────────────┐              ┌──────────────────────────────┐
│                     │              │                              │
│ RUNNER_ID = "v2-…"  │              │  claimAndExecuteRun(opts)    │
│                     │              │    db = opts.db ?? default   │
│ for target in       │              │    ├─ claim RPC (runnerId)   │
│   [staging, prod]:  │              │    ├─ startHeartbeat()       │
│                     │   call w/    │    ├─ executePipeline(…,     │
│   claimAndExecute ──│──── db ────▶ │    │    runnerId) ✅         │
│     Run({ runnerId, │              │    └─ cleanup                │
│       db: target }) │              │                              │
│                     │              │  executePipeline() [internal]│
│                     │              │    ├─ buildRunContext()       │
│                     │              │    ├─ evolveArticle()        │
│                     │              │    ├─ finalizeRun(…,runnerId)│
│                     │              │    └─ syncToArena()          │
│                     │              │                              │
└─────────────────────┘              │  executeV2Run() ← DELETED   │
                                     └──────────────────────────────┘
```

## Options Considered

### Option A: Pass runnerId to executeV2Run
- Add a `runnerId` parameter to `executeV2Run`
- processRunQueue.ts passes `RUNNER_ID`
- Minimal change, fixes the bug
- Leaves deprecated code in place

### Option B: Export executePipeline, remove executeV2Run
- Export `executePipeline` and `markRunFailed` from `claimAndExecuteRun.ts`
- processRunQueue.ts calls `executePipeline` directly
- Removes executeV2Run but creates two public entry points with different responsibilities (claiming vs not)
- processRunQueue.ts still manages its own heartbeat and error handling redundantly

### Option C: Add optional `db` and `dryRun` to claimAndExecuteRun, simplify processRunQueue (CHOSEN)
- Add `db?: SupabaseClient` and `dryRun?: boolean` to `RunnerOptions`
- `claimAndExecuteRun` uses `options.db ?? await createSupabaseServiceClient()`
- When `dryRun` is true, `claimAndExecuteRun` claims the run then returns immediately with `{ claimed: true, stopReason: 'dry-run' }` without executing the pipeline
- processRunQueue.ts calls `claimAndExecuteRun({ runnerId: RUNNER_ID, db: target.client, dryRun: DRY_RUN })` directly
- Delete `executeV2Run` entirely — no replacement needed
- Delete all claiming/heartbeat/error-handling/LLM-provider code from processRunQueue.ts (~190 lines removed)
- Also delete `EVOLUTION_SYSTEM_USERID` constant (line 31) — no longer needed since processRunQueue.ts no longer creates its own LLM provider
- Also delete `TaggedRun` interface — only used by deleted functions
- `executePipeline` stays internal — no new public exports
- Maximum simplicity: one entry point, one responsibility per file
- **PARALLEL preserved:** The systemd service (`evolution-runner.service`) uses `--parallel 2`. Parallel execution is preserved via `Promise.allSettled` in the main loop (see Phase 2)

## Phased Execution Plan

### Phase 1: Add `db` option to claimAndExecuteRun, delete executeV2Run

**File: `evolution/src/lib/pipeline/claimAndExecuteRun.ts`**
1. Add `db?: SupabaseClient` and `dryRun?: boolean` to `RunnerOptions` interface
2. Change line 82 from `const supabase = await createSupabaseServiceClient()` to `const supabase = options.db ?? await createSupabaseServiceClient()`. Note: the local variable `supabase` is used by `markRunFailed(supabase, ...)` in the catch block (line 143) and `startHeartbeat(supabase, ...)` (line 136), so the injected db flows correctly to all downstream operations.
3. Add dry-run handling after claiming, before pipeline execution:
```typescript
if (options.dryRun) {
  await supabase.from('evolution_runs').update({
    status: 'completed', completed_at: new Date().toISOString(),
    error_message: 'dry-run: no execution performed',
  }).eq('id', runId);
  return { claimed: true, runId, stopReason: 'dry-run', durationMs: Date.now() - startMs };
}
```
4. Update `executePipeline` JSDoc to remove executeV2Run reference
5. Delete `executeV2Run` function entirely (lines 223-248)

**File: `evolution/src/lib/pipeline/index.ts`**
5. Remove `executeV2Run` from exports (line 79)

### Phase 2: Simplify processRunQueue.ts

**File: `evolution/scripts/processRunQueue.ts`**

Delete these functions (no longer needed):
- `claimNextRun()` — claimAndExecuteRun does claiming
- `claimBatch()` — replaced by simple loop
- `executeRun()` — claimAndExecuteRun does everything
- `markRunFailed()` — claimAndExecuteRun handles it
- `createRawLLMProvider()` — claimAndExecuteRun creates its own

Change import:
```typescript
// Before:
import { executeV2Run } from '../src/lib/pipeline/claimAndExecuteRun';
import type { ClaimedRun } from '../src/lib/pipeline/setup/buildRunContext';

// After:
import { claimAndExecuteRun } from '../src/lib/pipeline/claimAndExecuteRun';
```

Rewrite main loop (preserves `--parallel N` — the systemd service uses `--parallel 2`):
```typescript
async function main() {
  initLLMSemaphore(MAX_CONCURRENT_LLM);
  log('info', 'Evolution runner starting', {
    runnerId: RUNNER_ID, dryRun: DRY_RUN, maxRuns: MAX_RUNS,
    parallel: PARALLEL, maxConcurrentLLM: MAX_CONCURRENT_LLM,
  });

  setupGracefulShutdown();
  const targets = await buildDbTargets();
  log('info', 'Connected to databases', { targets: targets.map(t => t.name) });

  let processedRuns = 0;

  while (processedRuns < MAX_RUNS && !shuttingDown) {
    const remaining = MAX_RUNS - processedRuns;
    const batchSize = Math.min(PARALLEL, remaining);

    // Build batch: round-robin across targets, up to batchSize
    const batch: { target: DbTarget }[] = [];
    let targetIdx = 0;
    while (batch.length < batchSize) {
      batch.push({ target: targets[targetIdx % targets.length]! });
      targetIdx++;
    }

    // Execute batch in parallel (preserves --parallel N behavior)
    const results = await Promise.allSettled(
      batch.map(({ target }) =>
        claimAndExecuteRun({
          runnerId: RUNNER_ID,
          db: target.client,
          dryRun: DRY_RUN || undefined,
        }).then(result => ({ result, target }))
      ),
    );

    let claimedAny = false;
    for (const settled of results) {
      if (settled.status === 'rejected') {
        log('error', 'claimAndExecuteRun threw unexpectedly', { error: String(settled.reason) });
        continue;
      }
      const { result, target } = settled.value;
      if (result.claimed) {
        claimedAny = true;
        processedRuns++;
        log('info', 'Run completed', {
          db: target.name, runId: result.runId,
          stopReason: result.stopReason, durationMs: result.durationMs,
          error: result.error,
        });
      }
    }

    if (!claimedAny) {
      log('info', 'No pending runs found, exiting');
      break;
    }

    if (processedRuns < MAX_RUNS && !shuttingDown) {
      log('info', 'Batch complete, looking for more runs', { processed: processedRuns, max: MAX_RUNS });
    }
  }

  log('info', 'Runner finished', { processedRuns, shuttingDown });
  process.exit(0);
}
```

What stays in processRunQueue.ts:
- `buildDbTargets()` and `DbTarget` type — multi-DB env loading and connectivity check
- `RUNNER_ID` generation
- `setupGracefulShutdown()`
- `main()` with the simplified loop
- CLI arg parsing (`DRY_RUN`, `MAX_RUNS`, `PARALLEL`, `MAX_CONCURRENT_LLM`)
- `log()` helper and `parseIntArg()` helper

What gets deleted:
- `claimNextRun()`, `claimBatch()`, `executeRun()`, `markRunFailed()`, `createRawLLMProvider()`
- `EVOLUTION_SYSTEM_USERID` constant
- `TaggedRun` interface
- `ClaimedRun` type import

Update exports line (line 293) to only export what remains:
```typescript
export { parseIntArg, log, buildDbTargets, loadEnvFile };
export type { DbTarget };
```

### Phase 3: Update tests

**File: `evolution/scripts/processRunQueue.test.ts`**

Major rewrite — the test file mocks `executeV2Run` and tests claiming/batching logic that no longer exists. Replace with:

Mock setup:
```typescript
const mockClaimAndExecuteRun = jest.fn().mockResolvedValue({ claimed: false });

jest.mock('../src/lib/pipeline/claimAndExecuteRun', () => ({
  claimAndExecuteRun: mockClaimAndExecuteRun,
}));
```

Test cases:
1. **REGRESSION TEST (critical)** — "passes runnerId matching v2- format":
```typescript
it('passes runnerId matching v2- format (regression: runner_id mismatch)', async () => {
  mockClaimAndExecuteRun.mockResolvedValueOnce({ claimed: true, runId: 'r1', stopReason: 'completed' });
  mockClaimAndExecuteRun.mockResolvedValue({ claimed: false });
  await main();
  expect(mockClaimAndExecuteRun).toHaveBeenCalledWith(
    expect.objectContaining({
      runnerId: expect.stringMatching(/^v2-/),
      db: expect.anything(),
    }),
  );
});
```

2. "passes target db client to claimAndExecuteRun":
```typescript
it('passes target db client to claimAndExecuteRun', async () => {
  mockClaimAndExecuteRun.mockResolvedValue({ claimed: false });
  await main();
  // First call should receive the staging client, second call the prod client
  const calls = mockClaimAndExecuteRun.mock.calls;
  expect(calls[0][0].db).toBe(stagingClient);
  expect(calls[1][0].db).toBe(prodClient);
});
```

3. "executes batch in parallel with --parallel N":
```typescript
it('executes batch in parallel with --parallel N', async () => {
  // With PARALLEL=2 and 2 targets, should fire 2 concurrent calls
  mockClaimAndExecuteRun.mockResolvedValue({ claimed: false });
  await main();
  // Promise.allSettled is used — verify both calls were made
  expect(mockClaimAndExecuteRun).toHaveBeenCalledTimes(2); // one per target in batch
});
```

4. "stops when no runs claimed from any target"
5. "respects MAX_RUNS limit"
6. "respects graceful shutdown"
7. "logs run results with db target name"
8. "passes dryRun flag when DRY_RUN is set"
9. "handles unexpected throw from claimAndExecuteRun gracefully" (Promise.allSettled rejected path)

Preserve existing tests for surviving functions:
- `parseIntArg` tests
- `buildDbTargets` / `loadEnvFile` tests

Delete tests for removed functions: `claimNextRun`, `claimBatch`, `executeRun`, local `markRunFailed`.

**File: `evolution/src/lib/pipeline/claimAndExecuteRun.test.ts`**

Add tests for `db` option — verify injected db flows to ALL downstream operations:
```typescript
it('uses provided db option for claim, heartbeat, pipeline, and error handling', async () => {
  const customDb = createMockSupabaseClient();
  // setup claim to return a run...
  await claimAndExecuteRun({ runnerId: 'test', db: customDb });
  // db was used, not createSupabaseServiceClient
  expect(mockCreateSupabaseServiceClient).not.toHaveBeenCalled();
  // db used for claim RPC
  expect(customDb.rpc).toHaveBeenCalledWith('claim_evolution_run', expect.anything());
  // db used for heartbeat (status update to 'running')
  expect(customDb.from).toHaveBeenCalledWith('evolution_runs');
});
```

Add test for `dryRun` option:
```typescript
it('returns dry-run result without executing pipeline when dryRun is true', async () => {
  const customDb = createMockSupabaseClient();
  // setup claim to return a run...
  const result = await claimAndExecuteRun({ runnerId: 'test', db: customDb, dryRun: true });
  expect(result.claimed).toBe(true);
  expect(result.stopReason).toBe('dry-run');
  expect(mockBuildRunContext).not.toHaveBeenCalled(); // pipeline was NOT executed
  expect(mockEvolveArticle).not.toHaveBeenCalled();
});
```

Add test: "falls back to createSupabaseServiceClient when db not provided" (existing behavior, verify it still works)

**runnerId propagation through claimAndExecuteRun → executePipeline → finalizeRun:**
The existing `claimAndExecuteRun.test.ts` already tests the full pipeline flow (claim → buildRunContext → evolveArticle → finalizeRun) with mocked internals. Since `claimAndExecuteRun` passes `options.runnerId` directly to `executePipeline` (line 138) which passes it to `finalizeRun` (line 209), and the mocked `finalizeRun` can assert it received the correct runnerId:
```typescript
it('propagates runnerId from options through to finalizeRun', async () => {
  // setup claim + pipeline mocks...
  await claimAndExecuteRun({ runnerId: 'v2-test-runner' });
  expect(mockFinalizeRun).toHaveBeenCalledWith(
    expect.anything(), // runId
    expect.anything(), // result
    expect.anything(), // metadata
    expect.anything(), // db
    expect.anything(), // durationSeconds
    expect.anything(), // logger
    'v2-test-runner',  // runnerId — the 7th arg must match what was passed to claimAndExecuteRun
  );
});
```
This test verifies the exact bug: that the runnerId given to `claimAndExecuteRun` reaches `finalizeRun` without being replaced by "legacy-".

### Phase 4: Update documentation

**File: `evolution/docs/architecture.md`** — Fix incorrect file paths and executeV2Run references:
- Line 70: Remove mention of "dynamically import and call `executeV2Run()`". Replace with: `claimAndExecuteRun()` handles the full lifecycle (claim → heartbeat → pipeline → finalize)
- Line 90: Change `executeV2Run() [runner.ts]` → remove this intermediate step; `claimAndExecuteRun` calls `executePipeline()` directly
- Line 132: Change `executeV2Run()` → `claimAndExecuteRun()` transitions the run to 'running' status

**File: `evolution/docs/reference.md`** — Fix 6 incorrect file paths:
- `evolution/src/services/evolutionRunnerCore.ts` → `evolution/src/lib/pipeline/claimAndExecuteRun.ts`
- `evolution/src/lib/pipeline/runner.ts` → `evolution/src/lib/pipeline/claimAndExecuteRun.ts`
- `evolution/src/lib/pipeline/evolve-article.ts` → `evolution/src/lib/pipeline/loop/runIterationLoop.ts`
- Remove all `executeV2Run` references
- Update barrel export listing to remove `executeV2Run`

**File: `evolution/docs/minicomputer_deployment.md`** — Update to reflect simplified processRunQueue.ts:
- Note that processRunQueue.ts now delegates to `claimAndExecuteRun` instead of managing claiming/execution/heartbeat itself
- Update "How It Works" section (line 245-256) to reflect the simpler architecture

### Phase 5: Verify on stage
1. Run lint, tsc, build
2. Run unit tests for affected files
3. Run integration tests
4. Create a pending evolution run on stage
5. Execute processRunQueue.ts manually with `--max-runs 1`
6. Confirm run completes successfully (status='completed', runner_id preserved)

## Testing

### Unit tests to rewrite
- `evolution/scripts/processRunQueue.test.ts` — Major rewrite: mock `claimAndExecuteRun` instead of `executeV2Run` + claiming internals

### Unit tests to update
- `evolution/src/lib/pipeline/claimAndExecuteRun.test.ts` — Add tests for `db` option

### Unit tests to verify pass (no changes)
- `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts`
- Tests for `parseIntArg`, `buildDbTargets`, `loadEnvFile` in processRunQueue.test.ts (these survive the refactor)

### Integration tests to run
- `src/__tests__/integration/evolution-claim.integration.test.ts` — backward-compatible since `db?` is optional; verify passes without modification

### Manual verification on stage
- Run `npx tsx evolution/scripts/processRunQueue.ts --max-runs 1` against stage
- Verify: run status = 'completed', runner_id matches RUNNER_ID format, finalization succeeds

## Rollback Plan
If the fix breaks on stage:
1. Stop the systemd timer: `sudo systemctl stop evolution-runner.timer`
2. Revert to the last known-good commit: `git log --oneline -5` to find it, then `git revert <commit>..HEAD` (or if the change is a single squashed merge commit, `git revert HEAD`)
3. Restart the timer: `sudo systemctl restart evolution-runner.timer`
4. Any runs that failed during the broken window will be auto-expired by the stale-expiry mechanism and can be re-queued

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/architecture.md` - Fix 3 executeV2Run references and incorrect file paths (runner.ts doesn't exist)
- `evolution/docs/reference.md` - Fix 6+ incorrect file paths and remove executeV2Run from public API listing
- `evolution/docs/minicomputer_deployment.md` - Update "How It Works" to reflect simplified architecture
- `docs/docs_overall/debugging.md` - No changes expected
- `docs/docs_overall/testing_overview.md` - No changes expected
- `docs/docs_overall/environments.md` - No changes expected
