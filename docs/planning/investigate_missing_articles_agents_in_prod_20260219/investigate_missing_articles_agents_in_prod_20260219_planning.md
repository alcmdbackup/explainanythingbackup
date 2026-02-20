# Investigate Missing Articles Agents In Prod Plan

## Background
Articles and agents are missing or not showing up in the production evolution dashboard. The evolution tab displays no articles or agents. Root cause: `triggerEvolutionRunAction` (inline admin trigger) calls `executeFullPipeline` without first calling the `claim_evolution_run` RPC, so runs execute with `status='pending'` and every downstream status guard silently no-ops — preventing completion.

## Requirements (from GH Issue #482)
There are no articles or agents showing up under evolution tab of prod evolution dashboard. Give me queries to debug this.

## Problem
`triggerEvolutionRunAction` in `evolutionActions.ts` skips the claim step before calling `executeFullPipeline`. The pipeline's `claimed→running` transition (pipeline.ts:307) has a `WHERE status IN ('claimed')` guard that silently no-ops when status is `pending`. The run executes all agents and writes checkpoints/heartbeats, but status stays `pending` forever. The completion transition (pipeline.ts:461, guards on `running`) also no-ops. The watchdog (guards on `claimed`/`running`) never sees these runs. The `checkpoint_and_continue` RPC (guards on `running`) can't yield at Vercel timeout. Result: 0 completed runs, 0 variants persisted, 0 agent metrics, empty dashboard.

## Options Considered

### Option A: Add claim step to triggerEvolutionRunAction (Recommended)
- Add a direct DB update to transition `pending→claimed` with `runner_id` and `started_at` before calling `executeFullPipeline`
- Mirrors what the cron runner does via the `claim_evolution_run` RPC but inline
- Minimal change, targeted fix, doesn't alter any other code path
- **Pros**: Simple, low risk, fixes the exact bug
- **Cons**: Duplicates claim logic (but only 4 fields). Long-term, a targeted RPC accepting `p_run_id` would be cleaner (follow-up task).

### Option B: Broaden executeFullPipeline's status guard to include 'pending'
- Change pipeline.ts:307 from `.in('status', ['claimed'])` to `.in('status', ['pending', 'claimed'])`
- **Pros**: Fixes the pipeline for any caller that skips claiming
- **Cons**: Weakens the safety guard — the `claimed` check exists to prevent double-execution. A run in `pending` could be claimed by the cron runner at the same moment the inline trigger starts, causing a race condition. Also needs the same change at completion (L461) and would need `runner_id` set separately.

### Option C: Call the claim_evolution_run RPC from triggerEvolutionRunAction
- Use `supabase.rpc('claim_evolution_run', { p_runner_id: 'inline-trigger' })` before pipeline
- **Pros**: Reuses existing RPC, single source of truth for claim logic
- **Cons**: The RPC picks the OLDEST pending/continuation_pending run, not a specific run by ID. It would claim whatever is first in the queue, not necessarily the `runId` we want. Would need a new RPC or modification to accept a specific run ID (good follow-up task).

### Decision: Option A
Option A is the safest and most targeted fix. It directly addresses the missing claim step with minimal blast radius.

## Phased Execution Plan

### Phase 1: Fix triggerEvolutionRunAction (the bug)

**File**: `evolution/src/services/evolutionActions.ts`

After the `preparePipelineRun` call (~line 590) and before `executeFullPipeline`, add the claim step. Use `.select().single()` to detect race conditions where the cron runner claims the run between our status check and our update (Supabase `.update().eq()` returns `{ error: null }` even on 0 rows matched — `.single()` returns PGRST116 error when no row is returned):

```typescript
// Claim the run before pipeline execution — transition pending→claimed
// Uses .select().single() to detect race condition: if cron runner already
// claimed this run, .single() returns error (0 rows matched).
const { data: claimedRun, error: claimError } = await supabase
  .from('content_evolution_runs')
  .update({
    status: 'claimed',
    runner_id: 'inline-trigger',
    last_heartbeat: new Date().toISOString(),
    started_at: new Date().toISOString(),
  })
  .eq('id', runId)
  .eq('status', 'pending')
  .select('id')
  .single();

if (claimError || !claimedRun) {
  // Use a typed error to distinguish claim races from real errors.
  // PGRST116 = "JSON object requested, multiple (or no) rows returned" — means 0 rows matched,
  // i.e., the cron runner already claimed this run. Leave it for the cron runner.
  const isRace = claimError?.code === 'PGRST116';
  throw new ClaimError(
    `Failed to claim run ${runId}: ${claimError?.message ?? 'run no longer pending'}`,
    isRace
  );
}
```

**ClaimError class** (add at top of file or in a shared errors module):

```typescript
class ClaimError extends Error {
  constructor(message: string, public readonly isRaceCondition: boolean) {
    super(message);
    this.name = 'ClaimError';
  }
}
```

**Catch block guard** — use the typed error instead of string matching. In the existing catch block (~line 601-618), wrap the failure update:

```typescript
// Only mark as failed if the error is NOT a claim race —
// claim races mean the cron runner has it, leave it alone
const isClaimRace = error instanceof ClaimError && error.isRaceCondition;
if (!isClaimRace) {
  await failSupabase.from('content_evolution_runs').update({
    status: 'failed',
    error_message: structuredError,
    completed_at: new Date().toISOString(),
  }).eq('id', runId).in('status', ['pending', 'claimed', 'running', 'continuation_pending']);
}
```

This means:
- **PGRST116 (race)**: `isRaceCondition = true` → run is NOT marked failed → cron runner picks it up
- **Real DB error (e.g., connection refused)**: `isRaceCondition = false` → run IS marked failed
- **Any non-ClaimError** (pipeline errors): `isClaimRace = false` → run IS marked failed

### Phase 1b: Add heartbeat for inline trigger

The cron runner (route.ts:239-252) and batch runner (evolution-runner.ts:126-138) both start heartbeat intervals after claiming. Without heartbeats, the watchdog will kill the inline-triggered run after 10 minutes of stale heartbeat while it's still executing.

Add a heartbeat interval that matches the cron runner pattern:

```typescript
// Start heartbeat before pipeline execution (same supabase client, no new connection)
const heartbeatInterval = setInterval(async () => {
  try {
    await supabase.from('content_evolution_runs').update({
      last_heartbeat: new Date().toISOString(),
    }).eq('id', runId);
  } catch (heartbeatErr) {
    // Heartbeat failure is non-fatal — log for observability, watchdog will recover if needed
    logger.warn('Heartbeat update failed', { runId, error: heartbeatErr instanceof Error ? heartbeatErr.message : String(heartbeatErr) });
  }
}, 30_000); // 30 seconds, matching cron runner

try {
  await executeFullPipeline(runId, agents, ctx, ctx.logger, {
    startMs: Date.now(),
  });
} finally {
  clearInterval(heartbeatInterval);
}
```

**Known limitation**: `executeFullPipeline` is called without `maxDurationMs`, so it runs indefinitely without continuation-passing. This is pre-existing behavior. The heartbeat prevents the watchdog from killing it, but very long runs could hit Vercel's hard timeout. This is acceptable for now — the inline trigger is used for admin-initiated runs which are typically short (5 iterations).

### Phase 2: Add/update tests

**File**: `evolution/src/services/evolutionActions.test.ts`

#### 2-prereq. Add fake timers and ClaimError mock

The heartbeat `setInterval` requires fake timers to prevent open handles in Jest:

```typescript
describe('triggerEvolutionRunAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
  });

  afterEach(() => {
    jest.useRealTimers();
  });
  // ... tests
});
```

#### 2a. Update `setupTriggerMocks` for ALL tests in the describe block

The claim step adds `.update().eq().eq().select().single()` to the Supabase call chain. The code flow is:
1. `.select().eq().single()` → fetch run (first `.single()`)
2. `.select().eq().single()` → fetch explanation (second `.single()`)
3. `preparePipelineRun()`
4. `.update().eq().eq().select().single()` → claim (third `.single()`)
5. `executeFullPipeline()`

**This is the updated `setupTriggerMocks` that ALL tests in the describe block must use** (replaces the existing version):

```typescript
function setupTriggerMocks(mock: ReturnType<typeof createChainMock>) {
  // First .single(): fetch run data
  mock.single.mockResolvedValueOnce({
    data: {
      id: 'run-trigger-1', explanation_id: 42, prompt_id: null,
      status: 'pending', config: {}, budget_cap_usd: 5.0,
    },
    error: null,
  });
  // Second .single(): fetch explanation content
  mock.single.mockResolvedValueOnce({
    data: { id: 42, explanation_title: 'Test Article', content: 'Original article text.' },
    error: null,
  });
  // Third .single(): claim step returns the claimed run
  mock.single.mockResolvedValueOnce({
    data: { id: 'run-trigger-1' },
    error: null,
  });

  mockPreparePipelineRun.mockReturnValue({
    ctx: {
      runId: 'run-trigger-1',
      payload: { originalText: 'text', title: 'T', explanationId: 42, runId: 'run-trigger-1', config: {} },
      state: {}, llmClient: {},
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      costTracker: {},
    },
    agents: {}, config: {}, costTracker: {},
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  });
}
```

**Important**: The two existing tests (`marks run as failed when executeFullPipeline throws` and `still returns original error when DB update in catch block fails`) both call `setupTriggerMocks` — they automatically get the 3rd `.single()` mock for the claim step. Verify both still pass after this change.

#### 2b. New test: claim runs BEFORE executeFullPipeline (ordering assertion)

```typescript
it('claims run before calling executeFullPipeline', async () => {
  const mock = createChainMock();
  setupTriggerMocks(mock);
  mockExecuteFullPipeline.mockResolvedValueOnce(undefined);
  (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

  await triggerEvolutionRunAction('run-trigger-1');

  // Verify claim update was called with correct fields
  const updateCalls = mock.update.mock.calls;
  const claimUpdate = updateCalls.find(
    (call: unknown[]) => {
      const arg = call[0] as Record<string, unknown>;
      return arg?.status === 'claimed' && arg?.runner_id === 'inline-trigger';
    },
  );
  expect(claimUpdate).toBeDefined();
  expect((claimUpdate![0] as Record<string, unknown>).started_at).toBeDefined();
  expect((claimUpdate![0] as Record<string, unknown>).last_heartbeat).toBeDefined();

  // Verify ordering: claim must happen BEFORE executeFullPipeline
  const claimCallOrder = mock.update.mock.invocationCallOrder[
    mock.update.mock.calls.findIndex(
      (call: unknown[]) => (call[0] as Record<string, unknown>)?.status === 'claimed'
    )
  ];
  const pipelineCallOrder = mockExecuteFullPipeline.mock.invocationCallOrder[0];
  expect(claimCallOrder).toBeLessThan(pipelineCallOrder);
});
```

#### 2c. New test: claim race condition (PGRST116 — run NOT marked failed)

```typescript
it('does not mark run as failed when claim race condition occurs (PGRST116)', async () => {
  const mock = createChainMock();
  // First .single(): fetch run
  mock.single.mockResolvedValueOnce({
    data: { id: 'run-trigger-1', explanation_id: 42, prompt_id: null, status: 'pending', config: {}, budget_cap_usd: 5.0 },
    error: null,
  });
  // Second .single(): fetch explanation
  mock.single.mockResolvedValueOnce({
    data: { id: 42, explanation_title: 'Test', content: 'Text.' },
    error: null,
  });
  // Third .single(): claim fails — cron runner already claimed it (PGRST116 = 0 rows)
  mock.single.mockResolvedValueOnce({
    data: null,
    error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
  });
  (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

  const result = await triggerEvolutionRunAction('run-trigger-1');

  expect(result.success).toBe(false);
  // Verify the run was NOT marked as failed (claim race should leave it for cron)
  const failedUpdate = mock.update.mock.calls.find(
    (call: unknown[]) => (call[0] as Record<string, unknown>)?.status === 'failed',
  );
  expect(failedUpdate).toBeUndefined();
});
```

#### 2d. New test: real DB error on claim (run IS marked failed)

```typescript
it('marks run as failed when claim has a real DB error (non-PGRST116)', async () => {
  const mock = createChainMock();
  // First .single(): fetch run
  mock.single.mockResolvedValueOnce({
    data: { id: 'run-trigger-1', explanation_id: 42, prompt_id: null, status: 'pending', config: {}, budget_cap_usd: 5.0 },
    error: null,
  });
  // Second .single(): fetch explanation
  mock.single.mockResolvedValueOnce({
    data: { id: 42, explanation_title: 'Test', content: 'Text.' },
    error: null,
  });
  // Third .single(): claim fails with real DB error (NOT PGRST116)
  mock.single.mockResolvedValueOnce({
    data: null,
    error: { message: 'connection refused', code: '08006' },
  });
  (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

  const result = await triggerEvolutionRunAction('run-trigger-1');
  expect(result.success).toBe(false);

  // Verify the run WAS marked as failed (real DB error, not a race condition)
  const failedUpdate = mock.update.mock.calls.find(
    (call: unknown[]) => (call[0] as Record<string, unknown>)?.status === 'failed',
  );
  expect(failedUpdate).toBeDefined();
  expect((failedUpdate![0] as Record<string, unknown>).error_message).toContain('connection refused');
});
```

#### 2e. Verify heartbeat is cleared on pipeline error

```typescript
it('clears heartbeat interval when executeFullPipeline throws', async () => {
  const mock = createChainMock();
  setupTriggerMocks(mock);
  mockExecuteFullPipeline.mockRejectedValueOnce(new Error('pipeline crash'));
  (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

  const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

  await triggerEvolutionRunAction('run-trigger-1');

  // The finally block should have called clearInterval
  expect(clearIntervalSpy).toHaveBeenCalled();
  clearIntervalSpy.mockRestore();
});
```

### Phase 3: Recover stuck production runs

**First**, verify checkpoints exist for both runs (confirmed during investigation — both have checkpoints through iteration 2 with agents up to sectionDecomposition):

```sql
-- Step 1: Diagnostic — confirm checkpoints exist before transitioning
SELECT run_id, COUNT(*) as checkpoint_count, MAX(iteration) as max_iteration, MAX(last_agent) as last_agent
FROM evolution_checkpoints
WHERE run_id IN (
  '7496e0fa-bf39-44f0-a9b6-63dd2562a928',
  '47e5de4b-bc2b-4201-9476-fb6e94c21bb3'
)
GROUP BY run_id;
-- Expected: both runs show checkpoints at iteration 2
```

**Then**, transition to `continuation_pending` so the cron runner resumes from checkpoints:

```sql
-- Step 2: Only proceed if Step 1 confirms checkpoints exist
UPDATE content_evolution_runs
SET status = 'continuation_pending',
    last_heartbeat = NOW()
WHERE id IN (
  '7496e0fa-bf39-44f0-a9b6-63dd2562a928',
  '47e5de4b-bc2b-4201-9476-fb6e94c21bb3'
) AND status = 'pending'
RETURNING id, status;
```

**If Step 1 shows no checkpoints** for a run, use `pending` instead (start fresh):
```sql
-- Alternative: if no checkpoints, just mark failed and re-queue
UPDATE content_evolution_runs
SET status = 'failed',
    error_message = 'Manually failed: stuck in pending due to missing claim step',
    completed_at = NOW()
WHERE id = '<run-id-without-checkpoints>'
AND status = 'pending';
```

### Phase 4: Deploy and verify

1. Deploy the fix to production (merge PR)
2. Trigger a new evolution run from the admin UI
3. Verify in Supabase that the run transitions: `pending → claimed → running → completed`
   - Check: `started_at IS NOT NULL`
   - Check: `runner_id = 'inline-trigger'`
   - Check: `last_heartbeat` updates every ~30 seconds during execution
4. Wait for completion (typically 5-15 minutes for 5 iterations)
5. Verify `content_evolution_variants` has rows for the completed run
6. Verify `evolution_run_agent_metrics` has rows
7. Verify the dashboard evolution tab shows articles and agents

## Testing

### Unit tests (Phase 2)
- **New test**: `claims run before calling executeFullPipeline` — verifies claim fields AND ordering via `invocationCallOrder`
- **New test**: `does not mark run as failed when claim race condition occurs (PGRST116)` — verifies claim race returns error without marking run as failed
- **New test**: `marks run as failed when claim has a real DB error (non-PGRST116)` — verifies real DB errors DO mark run as failed, asserts `failedUpdate` IS defined with error message
- **New test**: `clears heartbeat interval when executeFullPipeline throws` — verifies `clearInterval` called in finally block
- **Updated mock**: `setupTriggerMocks` adds third `.single()` mock for the claim step — used by ALL tests in the describe block (existing + new)
- **Updated setup**: `jest.useFakeTimers()` in `beforeEach`, `jest.useRealTimers()` in `afterEach` to prevent open handles from heartbeat interval
- **Existing test**: `marks run as failed when executeFullPipeline throws` — uses updated `setupTriggerMocks`, verify still passes
- **Existing test**: `still returns original error when DB update in catch block fails` — uses updated `setupTriggerMocks`, verify still passes

### Manual verification (Phase 4)
- Trigger a run from admin UI → check `content_evolution_runs` row shows `started_at` not null, `runner_id = 'inline-trigger'`, `last_heartbeat` updating
- Wait for completion → check `content_evolution_variants` has rows
- Check dashboard evolution tab shows articles and agents

## Files Modified

| File | Change |
|------|--------|
| `evolution/src/services/evolutionActions.ts` | Add `ClaimError` class, claim step with `.select().single()`, heartbeat interval with logging, `isRaceCondition`-based guard in catch block |
| `evolution/src/services/evolutionActions.test.ts` | Update `setupTriggerMocks` (3rd `.single()` for claim), add `jest.useFakeTimers`, add 4 new tests (claim ordering, PGRST116 race, real DB error, clearInterval) |
| `evolution/docs/evolution/architecture.md` | Update "Runner Comparison" table to document inline trigger claims + heartbeat |

## Rollback Plan
If the fix causes issues:
1. Revert the PR (single commit, no schema changes)
2. Stuck runs can be manually transitioned via SQL: `UPDATE content_evolution_runs SET status = 'failed' WHERE status = 'pending' AND last_heartbeat < NOW() - INTERVAL '1 hour'`
3. Cron runner path is unaffected by this change — it was already working correctly

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/architecture.md` - Update "Runner Comparison" table to add inline trigger row documenting claim + heartbeat behavior; update "Known Implementation Gaps" section if this bug is referenced; add note to "Inline Trigger" description about the claim step
- `evolution/docs/evolution/reference.md` - Add mention of inline trigger's direct-claim pattern alongside the `claim_evolution_run` RPC documentation
