# Understand How Evolution Runs Work Plan

## Background
This project aims to understand how the evolution pipeline runs both locally and in production. The goal is to document and trace the full lifecycle of an evolution run — from queuing through execution to completion — across both environments, identifying differences in configuration, execution paths, infrastructure, and observability.

## Requirements (from GH Issue #448)
- Understand how evolution runs are triggered and executed locally (CLI runner, local scripts)
- Understand how evolution runs are triggered and executed in production (admin UI, cron, batch runner, GitHub Actions)
- Document the differences between local and production execution paths
- Trace the full run lifecycle in each environment
- What happens with long-running jobs?
- What happens if the server dies locally vs in production?

## Problem

Evolution pipeline runs often exceed Vercel's serverless timeout (currently 300s, max 800s on Pro). When killed, runs are stuck as `running` until the watchdog marks them `failed` 10+ minutes later — all progress lost. The checkpoint/resume infrastructure is 80% built (`serializeState`, `deserializeState`, `supervisorResume` param in `executeFullPipeline`) but **no runner ever loads a checkpoint to resume**.

This plan adds continuation-passing: the pipeline detects it's approaching timeout, checkpoints, exits cleanly with `continuation_pending` status, and the cron runner resumes it from the checkpoint on its next cycle.

## Options Considered

See research doc sections 9-15 for full analysis. Summary:

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **A: Bump maxDuration to 800s** | 1-line change, immediate | 13-min ceiling, some runs exceed | Do first (Phase 1) |
| **B: Queue + GH Actions dispatch** | No timeout, simple | 30-60s cold start, no instant feedback | Rejected — loses UX |
| **C: Hybrid inline + batch** | Covers all runs | Two execution paths | Good fallback, more complex |
| **D: Chunked self-chain** | Unlimited duration | Chain breaks = silent stalls | Rejected — fragile |
| **E: Inngest** | Full orchestration | $25/mo, vendor lock | Overkill for current volume |
| **F: Continuation-passing + cron** | Unlimited duration, $0 cost, reuses 80% existing infra | 2-5 min idle between chunks | **Selected (Phase 2)** |
| Dedicated worker (Fly.io) | Simplest, most robust | $5-10/mo ongoing | Good Phase 3 if volume grows |

## Phased Execution Plan

### Phase 1: Bump maxDuration to 800s (trivial, ship first)

#### Step 1.1 — Cron runner maxDuration
**File:** `src/app/api/cron/evolution-runner/route.ts:10`
- Change `export const maxDuration = 300` → `export const maxDuration = 800`

That's it for Phase 1. Covers most runs immediately (800s = 13 min). Phase 2 handles the rest.

---

### Phase 2: Continuation-Passing

#### Resume Timing & Cron Infrastructure

The cron is run by **Vercel's built-in cron scheduler**, configured in `vercel.json`. The evolution runner fires every 5 minutes (`*/5`).

**Resume latency:** When a run yields with `continuation_pending`, it sits idle until the next cron fires — **up to 5 minutes** between chunks.

**Example: a 30-minute pipeline needing 3 continuations:**
```
Invocation 1: runs ~12 min → checkpoint → continuation_pending
  [~5 min idle waiting for cron]
Invocation 2: runs ~12 min → checkpoint → continuation_pending
  [~5 min idle]
Invocation 3: runs ~6 min → convergence → completed

Total wall clock: ~40 min (30 min compute + 10 min idle)
```

**Cron frequency tradeoff:** The schedule could be tightened to `*/2` (every 2 min) to reduce idle time, but Vercel Pro limits cron invocations at tighter intervals (40/day for `*/2`). At `*/5` invocations are unlimited. Since the idle time is a small fraction of total run duration and only matters for runs exceeding 800s, `*/5` is acceptable. A dedicated worker ($5-10/mo) would eliminate idle gaps entirely if this becomes a concern.

#### Step 2.1 — DB migration: add `continuation_pending` status

**New file:** `supabase/migrations/YYYYMMDDNNNNNN_add_continuation_pending_status.sql`

```sql
-- Wrap constraint swap in a transaction to prevent invalid status values
-- between DROP and ADD (without this, concurrent writes could insert garbage).
BEGIN;
  ALTER TABLE content_evolution_runs
    DROP CONSTRAINT content_evolution_runs_status_check;
  ALTER TABLE content_evolution_runs
    ADD CONSTRAINT content_evolution_runs_status_check
    CHECK (status IN ('pending','claimed','running','completed','failed','paused','continuation_pending'));
  ALTER TABLE content_evolution_runs
    ADD COLUMN IF NOT EXISTS continuation_count INT NOT NULL DEFAULT 0;
COMMIT;

-- CONCURRENTLY cannot run inside a transaction, so this is a separate statement.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evolution_runs_continuation
  ON content_evolution_runs (created_at ASC) WHERE status = 'continuation_pending';
```

**Rollback migration** (save as `YYYYMMDDNNNNNN_revert_continuation_pending.sql`):
```sql
BEGIN;
  -- First, transition any in-flight continuation_pending runs to 'failed'
  -- so they don't violate the restored CHECK constraint.
  UPDATE content_evolution_runs
  SET status = 'failed',
      error = '{"message": "Run failed during rollback of continuation-passing feature", "source": "migration-rollback"}'::jsonb
  WHERE status = 'continuation_pending';

  ALTER TABLE content_evolution_runs
    DROP CONSTRAINT content_evolution_runs_status_check;
  ALTER TABLE content_evolution_runs
    ADD CONSTRAINT content_evolution_runs_status_check
    CHECK (status IN ('pending','claimed','running','completed','failed','paused'));
  -- continuation_count column is harmless to keep; DROP only if needed:
  -- ALTER TABLE content_evolution_runs DROP COLUMN IF EXISTS continuation_count;

  -- Drop the atomic RPC (no longer needed)
  DROP FUNCTION IF EXISTS checkpoint_and_continue(UUID, JSONB, TEXT);
  -- Restore original claim RPC (pending only)
  -- NOTE: Re-apply the original migration 20260214000001_claim_evolution_run.sql
COMMIT;
DROP INDEX CONCURRENTLY IF EXISTS idx_evolution_runs_continuation;
```

#### Step 2.1b — Update `claim_evolution_run` RPC to accept continuation_pending

**File:** `supabase/migrations/YYYYMMDDNNNNNN_add_continuation_pending_status.sql` (same migration file as 2.1)

The existing `claim_evolution_run` RPC (`supabase/migrations/20260214000001_claim_evolution_run.sql`) hardcodes `WHERE status = 'pending'`. It must be replaced to also accept `continuation_pending`, otherwise any callsite using this RPC (including the batch runner) will never resume continuation runs.

```sql
CREATE OR REPLACE FUNCTION claim_evolution_run(p_runner_id TEXT)
RETURNS SETOF content_evolution_runs AS $$
DECLARE
  v_run content_evolution_runs;
BEGIN
  SELECT * INTO v_run FROM content_evolution_runs
  WHERE status IN ('pending', 'continuation_pending')
  ORDER BY
    -- Prioritize continuation_pending (already invested cost) over pending
    CASE WHEN status = 'continuation_pending' THEN 0 ELSE 1 END,
    created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE content_evolution_runs
  SET status = 'claimed', runner_id = p_runner_id,
      last_heartbeat = NOW(),
      started_at = CASE WHEN started_at IS NULL THEN NOW() ELSE started_at END
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  RETURN NEXT v_run;
END;
$$ LANGUAGE plpgsql;
```

This also addresses the priority concern: `continuation_pending` runs are claimed before `pending` runs to avoid wasting already-invested compute.

**Resume detection note:** The RPC returns the UPDATED row (with `status = 'claimed'`), not the original status. To detect whether a claimed run needs resume vs fresh start, check `continuation_count > 0` instead of checking the original status.

#### Step 2.1c — Add `checkpoint_and_continue` RPC

**File:** Same migration file as Step 2.1.

This RPC atomically persists a checkpoint AND transitions the run to `continuation_pending` in a single transaction, eliminating the race window where the process could be killed between two separate DB calls.

The RPC must match the actual `evolution_checkpoints` table schema:
- Columns: `run_id`, `iteration`, `phase`, `last_agent`, `state_snapshot`, `created_at`
- Unique constraint: `(run_id, iteration, last_agent)` (used by ON CONFLICT for upsert)
- The `content_evolution_runs` table also gets metadata updates (matching existing `persistCheckpoint` pattern)

```sql
CREATE OR REPLACE FUNCTION checkpoint_and_continue(
  p_run_id UUID,
  p_iteration INT,
  p_phase TEXT,
  p_state_snapshot JSONB,
  p_pool_length INT DEFAULT 0,
  p_total_cost_usd NUMERIC DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  -- Upsert checkpoint (matches existing persistCheckpoint pattern)
  -- Uses 'iteration_complete' as last_agent to distinguish from per-agent checkpoints
  INSERT INTO evolution_checkpoints (run_id, iteration, phase, last_agent, state_snapshot, created_at)
  VALUES (p_run_id, p_iteration, p_phase, 'iteration_complete', p_state_snapshot, NOW())
  ON CONFLICT (run_id, iteration, last_agent)
  DO UPDATE SET state_snapshot = EXCLUDED.state_snapshot,
               phase = EXCLUDED.phase,
               created_at = NOW();

  -- Update run metadata (matches existing persistCheckpoint's run update)
  -- AND transition to continuation_pending atomically
  UPDATE content_evolution_runs
  SET status = 'continuation_pending',
      runner_id = NULL,
      continuation_count = continuation_count + 1,
      current_iteration = p_iteration,
      phase = p_phase,
      last_heartbeat = NOW(),
      runner_agents_completed = p_pool_length,
      total_cost_usd = COALESCE(p_total_cost_usd, total_cost_usd)
  WHERE id = p_run_id
    AND status = 'running';  -- guard: only transition from running

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run % is not in running status, cannot transition to continuation_pending', p_run_id;
  END IF;
END;
$$ LANGUAGE plpgsql;
```

The TypeScript wrapper in `persistence.ts` (mirrors existing `persistCheckpoint` signature):
```typescript
export async function checkpointAndMarkContinuationPending(
  runId: string,
  state: PipelineState,
  supervisor: PoolSupervisor,
  phase: string,
  logger: EvolutionLogger,
  totalCostUsd: number,
  comparisonCache?: ComparisonCache
): Promise<void> {
  // Build state_snapshot the same way persistCheckpoint does
  const stateSnapshot = {
    ...serializeState(state),
    ...(totalCostUsd != null && { costTrackerTotalSpent: totalCostUsd }),
    ...(comparisonCache && comparisonCache.size > 0 && {
      comparisonCacheEntries: comparisonCache.entries()
    }),
    supervisorState: supervisor.getResumeState(),
  };

  const supabase = await createSupabaseServiceClient();
  const { error } = await supabase.rpc('checkpoint_and_continue', {
    p_run_id: runId,
    p_iteration: state.iteration,
    p_phase: phase,
    p_state_snapshot: stateSnapshot,
    p_pool_length: state.pool.length,
    p_total_cost_usd: totalCostUsd,
  });
  if (error) throw new Error(`checkpoint_and_continue RPC failed: ${error.message}`);
}
```

#### Step 2.2 — TypeScript type update

**File:** `src/lib/evolution/types.ts:533`
- Add `'continuation_pending'` to `EvolutionRunStatus` union

#### Step 2.3 — CostTracker: add `restoreSpent()` method

**File:** `src/lib/evolution/core/costTracker.ts`
- Add `restoreSpent(amount: number)` method to `CostTrackerImpl` (sets `totalSpent` from checkpoint; throws if called after spending has begun)
- Add `createCostTrackerFromCheckpoint(config, restoredTotalSpent)` factory function
- Export from `src/lib/evolution/index.ts`

#### Step 2.4 — Pipeline: add `maxDurationMs` option + time-check + continuation logic

**File:** `src/lib/evolution/core/pipeline.ts`

**2.4a** — Add to `FullPipelineOptions` interface (line 308):
- `maxDurationMs?: number` — wall-clock budget for this invocation
- `continuationCount?: number` — for infinite-loop guard

**2.4b** — Add per-iteration time-check at top of loop body (line ~393), after `startNewIteration()` and before the kill-check query.

**Important:** `startMs` already exists on `FullPipelineOptions` (line 314 of pipeline.ts). For resumed runs, the cron runner must set `startMs: Date.now()` at the *current invocation's* start — NOT the original run's start time. This ensures the elapsed-time calculation measures wall-clock time within the current serverless invocation, not total run time across all continuations.

```typescript
if (options.maxDurationMs && options.startMs) {
  const elapsedMs = Date.now() - options.startMs;
  // Adaptive margin: at least 60s, at most 120s, or 10% of elapsed (whichever is larger).
  // Cap prevents wasting excessive time at the end of long invocations.
  const safetyMarginMs = Math.min(120_000, Math.max(60_000, elapsedMs * 0.10));
  if (options.maxDurationMs - elapsedMs < safetyMarginMs) {
    stopReason = 'continuation_timeout';
    break;
  }
}
```

**2.4c** — Add max-continuation guard at top of function (after line 337):
```typescript
const MAX_CONTINUATIONS = 10;
if ((options.continuationCount ?? 0) >= MAX_CONTINUATIONS) {
  await markRunFailed(runId, null, new Error(`Max continuation limit (${MAX_CONTINUATIONS}) reached`));
  return { stopReason: 'max_continuations_exceeded' };
}
```

**2.4d** — Add continuation branch in post-loop block (line 516). Change `if (stopReason !== 'killed')` to:
```typescript
if (stopReason === 'continuation_timeout') {
  // CRITICAL: checkpoint + status update must be atomic to prevent orphaned
  // checkpoints. If the process is killed between these two calls, the
  // checkpoint is saved but the status remains 'running', and the watchdog
  // marks it 'failed' — losing progress.
  //
  // Approach: Use a Supabase RPC that performs both in a single transaction,
  // OR use the defense-in-depth strategy: always persist checkpoint first
  // (idempotent), then update status. If status update fails, the watchdog
  // should check for a recent checkpoint before marking 'failed'.
  await checkpointAndMarkContinuationPending(
    runId, ctx.state, supervisor, phase, logger,
    ctx.costTracker.getTotalSpent(), ctx.comparisonCache
  );
} else if (stopReason !== 'killed') {
  // ... existing completion logic unchanged ...
}
```

**New RPC (add to Step 2.1 migration):** `checkpoint_and_continue(p_run_id, p_checkpoint_state)` — a SQL function that inserts/upserts the checkpoint row AND updates the run status to `continuation_pending` in a single transaction. This eliminates the race window.

**Fallback defense-in-depth (add to Step 2.8):** The watchdog, before marking a stale `running` run as `failed`, should check if a checkpoint exists with `created_at > last_heartbeat`. If so, transition to `continuation_pending` instead of `failed` — the run was in the process of yielding when it was killed.

#### Step 2.5 — Persistence: add `markRunContinuationPending()`

**File:** `src/lib/evolution/core/persistence.ts` (after `markRunPaused` at line 115)
- New function: transitions `running` → `continuation_pending`, clears `runner_id`, increments `continuation_count`
- Also update `markRunFailed` status guard (line 105): add `'continuation_pending'` to the `.in()` array so failed continuations can be marked

#### Step 2.6 — Add checkpoint loading + `resumePipelineRun()`

**Architectural note:** `index.ts` is currently a synchronous factory/re-export module. To match the existing pattern (`preparePipelineRun` is synchronous and receives all data as arguments), we split resume into two parts:

**Step 2.6a — DB loading in persistence.ts**
**File:** `src/lib/evolution/core/persistence.ts`

New function `loadCheckpointForResume(runId: string)`:
1. Queries: `SELECT * FROM evolution_checkpoints WHERE run_id = $1 AND last_agent = 'iteration_complete' ORDER BY created_at DESC LIMIT 1` (matches the checkpoint saved by `checkpointAndMarkContinuationPending`)
2. If no row returned, throws `CheckpointNotFoundError` (the caller should mark the run as `failed` with a descriptive error)
3. Calls `deserializeState(row.state_snapshot)` — if JSONB is malformed or deserialization fails, wraps in `CheckpointCorruptedError`
4. Extracts `supervisorState`, `costTrackerTotalSpent`, `comparisonCacheEntries` from `state_snapshot` (these are extra fields added alongside the serialized state)
5. Returns `{ snapshot: row.state_snapshot, iteration: row.iteration, phase: row.phase, supervisorState, costTrackerTotalSpent, comparisonCacheEntries }`

**Step 2.6b — Sync assembly in index.ts**
**File:** `src/lib/evolution/index.ts` (after `preparePipelineRun` at line 195)

New function `prepareResumedPipelineRun(checkpointData, runConfig, title, explanationId)` (synchronous, matching `preparePipelineRun` pattern):
1. Calls `deserializeState()` to restore pool, ratings, matches, critiques, etc.
2. Creates `CostTrackerImpl` via `createCostTrackerFromCheckpoint(config, totalSpent)`
3. Creates agents via `createDefaultAgents(config)`
4. Returns `{ ctx, agents, supervisorResume, resumeComparisonCacheEntries }` — same shape the cron runner needs

**Step 2.6c — Integration in cron runner**
The cron runner (Step 2.7) calls `loadCheckpointForResume()` then `prepareResumedPipelineRun()`, mirroring how it currently fetches explanation content then calls `preparePipelineRun()`.

**Error handling:** If `loadCheckpointForResume` throws `CheckpointNotFoundError` or `CheckpointCorruptedError`, the cron runner marks the run as `failed` with the error message and continues to the next run.

#### Step 2.7 — Cron runner: handle continuation_pending runs

**File:** `src/app/api/cron/evolution-runner/route.ts`

**Query (line 24-30):** Change `.eq('status', 'pending')` → `.in('status', ['pending', 'continuation_pending'])`. Add `status` to the select list.

**Claim (line 48-58):** Replace the current two-step SELECT/UPDATE claim with the `claim_evolution_run` RPC (updated in Step 2.1b) which uses `FOR UPDATE SKIP LOCKED`. This prevents two concurrent cron invocations from both selecting and attempting to resume the same `continuation_pending` run. The RPC also handles priority ordering (continuation_pending before pending).

**Branch after claim (line 70):** Check `claimedRun.continuation_count > 0` to detect a resume (since the RPC returns the mutated row with `status = 'claimed'`, not the original status):
- **Resume path:** Call `resumePipelineRun()`, then `executeFullPipeline()` with `supervisorResume`, `resumeComparisonCacheEntries`, `maxDurationMs`, and `continuationCount`
- **New run path:** Existing code (content resolution → `preparePipelineRun` → `executeFullPipeline`), but now also pass `maxDurationMs: (maxDuration - 60) * 1000`

Both paths handle `stopReason === 'continuation_timeout'` in the response (run is NOT terminal).

#### Step 2.8 — Watchdog: stale continuation safety net

**File:** `src/app/api/cron/evolution-watchdog/route.ts`

**Query 1 — Stale continuation_pending runs** (after existing stale-run block, line 88):
```typescript
// Find continuation_pending runs not resumed within 30 min
const { data: staleContinuations } = await supabase
  .from('content_evolution_runs')
  .select('id, last_heartbeat')
  .eq('status', 'continuation_pending')
  .lt('last_heartbeat', new Date(Date.now() - 30 * 60_000).toISOString());

for (const run of staleContinuations ?? []) {
  await supabase
    .from('content_evolution_runs')
    .update({
      status: 'failed',
      error: { message: 'Continuation run abandoned: not resumed within 30 minutes', source: 'evolution-watchdog' }
    })
    .eq('id', run.id)
    .eq('status', 'continuation_pending'); // guard: only if still continuation_pending
}
```

**Query 2 — Defense-in-depth: stale running runs with recent checkpoint** (modify existing stale-run handler):

Before marking a stale `running` run as `failed`, check if a checkpoint was saved after the last heartbeat. If so, the pipeline was in the process of yielding when killed — transition to `continuation_pending` instead of `failed`:

```typescript
for (const staleRun of staleRuns) {
  // Check for recent checkpoint (saved after last heartbeat = pipeline was yielding)
  const { data: recentCheckpoint } = await supabase
    .from('evolution_checkpoints')
    .select('created_at')
    .eq('run_id', staleRun.id)
    .gt('created_at', staleRun.last_heartbeat) // checkpoint newer than last heartbeat
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentCheckpoint) {
    // Pipeline was yielding — transition to continuation_pending (not failed)
    await supabase
      .from('content_evolution_runs')
      .update({
        status: 'continuation_pending',
        runner_id: null,
        continuation_count: staleRun.continuation_count + 1
      })
      .eq('id', staleRun.id)
      .in('status', ['running', 'claimed']); // guard
  } else {
    // No recent checkpoint — truly stale, mark failed (existing logic)
    await markRunFailed(staleRun.id, ...);
  }
}
```

The existing query (line 39) already excludes `continuation_pending` since it only checks `['claimed', 'running']`.

#### Step 2.9 — UI: status badge for continuation_pending

**File:** `src/components/evolution/EvolutionStatusBadge.tsx`
- Add `continuation_pending` to `STATUS_STYLES` (use accent-gold like `running`)
- Add `continuation_pending` to `STATUS_ICONS` (use `↻`)
- Update display text (line 54): show as `"resuming"`

#### Step 2.10 — Additional status guard updates (found during review)

These files have hardcoded status lists that need `continuation_pending` added:

**a) Cron runner local `markRunFailed`** (route.ts:237-247):
- Local helper has NO status guard at all — add `.in('status', ['pending', 'claimed', 'running', 'continuation_pending'])` for safety

**b) `evolutionActions.ts` markRunFailed guards** (lines 632, 971):
- Two `.in('status', ['pending', 'claimed', 'running'])` guards → add `'continuation_pending'`

**c) Admin UI status filter** (`src/app/admin/quality/evolution/page.tsx:840-851`):
- Hardcoded `<option>` dropdown — add `<option value="continuation_pending">Resuming</option>`

**d) Batch runner** (`scripts/evolution-runner.ts`):
The batch runner uses the `claim_evolution_run` RPC (updated in Step 2.1b), so it will automatically pick up `continuation_pending` runs after the RPC migration. Additional changes needed:
- **`markRunFailed` guard** (line ~180): Add `'continuation_pending'` to the status guard so failed continuation runs can be marked from the batch runner
- **Resume path** (after claim, line ~120): Check `claimedRun.continuation_count > 0` (since the RPC returns the mutated row with `status = 'claimed'`, use `continuation_count` to detect resumes). If so, call `loadCheckpointForResume()` + `prepareResumedPipelineRun()` instead of `preparePipelineRun()`. Note: the batch runner has no serverless timeout, so `maxDurationMs` is not needed — but passing it is harmless and enables the batch runner to do graceful continuation for other reasons (e.g., memory pressure) in the future.
- The batch runner does NOT need continuation-passing itself (no timeout), but it must be able to **resume** runs that were yielded by the cron runner.

**e) Dashboard visualization counts** (`src/lib/services/evolutionVisualizationActions.ts:222-261`):
- Line 222: active runs query `.in('status', ['running', 'claimed'])` → add `'continuation_pending'` (it IS an active run)
- Lines 238-261: success/fail/pause aggregation — do NOT include `continuation_pending` (it's transient, not a result)

---

## Execution Order (dependency-aware)

1. **Step 2.1 + 2.1b + 2.1c** — Migration + claim RPC update + checkpoint_and_continue RPC (deploy independently, backward-compatible)
2. **Step 2.2** — TypeScript type (everything depends on this)
3. **Step 2.3** — CostTracker restore (needed by Step 2.6b)
4. **Step 2.5** — Persistence functions incl. `markRunContinuationPending` (needed by Step 2.4)
5. **Step 2.6a** — `loadCheckpointForResume()` in persistence.ts (needed by Step 2.6b)
6. **Step 2.4** — Pipeline time-check + continuation logic + `checkpointAndMarkContinuationPending` RPC call (core change)
7. **Step 2.6b** — `prepareResumedPipelineRun()` in index.ts (needed by Step 2.7)
8. **Step 2.7** — Cron runner resume path (integrates everything, uses updated RPC for SKIP LOCKED claiming)
9. **Step 2.10d** — Batch runner resume path + guard updates
10. **Step 2.8** — Watchdog safety net incl. defense-in-depth checkpoint check (independent)
11. **Step 2.9** — UI badge (independent)
12. **Step 2.10** — Remaining status guard updates (independent)
13. **Step 1.1** — Bump maxDuration (do alongside or before any of the above)

Steps 2.8, 2.9, 2.10, and 1.1 can be done in parallel with everything else.

## Testing

### Test file locations
Tests follow existing convention: `src/lib/evolution/__tests__/` for core pipeline tests, co-located `*.test.ts` for component tests.
- `src/lib/evolution/__tests__/pipeline.continuation.test.ts` — pipeline time-check, max-continuation guard
- `src/lib/evolution/__tests__/persistence.continuation.test.ts` — markRunContinuationPending, loadCheckpointForResume
- `src/lib/evolution/__tests__/costTracker.test.ts` — extend existing with restoreSpent tests
- `src/lib/evolution/__tests__/resume.integration.test.ts` — full resume integration test
- `src/components/evolution/__tests__/EvolutionStatusBadge.test.tsx` — badge rendering
- `src/app/api/cron/__tests__/evolution-watchdog.continuation.test.ts` — watchdog stale-continuation behavior

### Unit tests
- **Pipeline time-check**: Mock `Date.now()` to simulate approaching deadline → verify `stopReason === 'continuation_timeout'` and checkpoint is persisted
- **Pipeline max-continuation guard**: Pass `continuationCount: 10` → verify run is marked failed. Also test `continuationCount: 9` → verify run proceeds. Also test `continuationCount: 11` → verify run is marked failed (boundary-value coverage).
- **CostTracker.restoreSpent()**: Verify sets totalSpent correctly; verify throws if called after `recordSpend`
- **loadCheckpointForResume()**: Mock supabase → verify checkpoint loaded. Also test: (1) missing checkpoint → throws `CheckpointNotFoundError`, (2) malformed JSONB → throws `CheckpointCorruptedError`, (3) checkpoint referencing deleted variations → graceful error
- **prepareResumedPipelineRun()**: Verify state deserialized, supervisor/cache extracted, cost tracker restored with correct totalSpent
- **markRunContinuationPending()**: Verify status transition from `running`, `runner_id` cleared, `continuation_count` incremented. Also verify: status guard rejects transition from non-`running` status.
- **EvolutionStatusBadge**: Verify `continuation_pending` renders with correct style/icon/text

### checkpoint_and_continue RPC tests
- **Atomic success**: Create a `running` run → call RPC with valid checkpoint data → verify both checkpoint row upserted AND run status = `continuation_pending`, `runner_id = NULL`, `continuation_count` incremented, run metadata (current_iteration, phase, total_cost_usd) updated
- **Status guard rejection**: Create a `completed` run → call RPC → verify EXCEPTION raised, no checkpoint upserted
- **Idempotent upsert**: Call RPC twice with same run_id + iteration → verify checkpoint row updated (not duplicated)
- **Concurrent calls**: Two concurrent RPC calls for same run → verify one succeeds (sets continuation_pending), the second fails (status guard rejects since status is no longer `running`)

### Resume detection branching tests
- **continuation_count = 0 → new run path**: Claim a run with `continuation_count = 0` → verify cron runner takes new run path (calls `preparePipelineRun`)
- **continuation_count > 0 → resume path**: Claim a run with `continuation_count = 1` → verify cron runner takes resume path (calls `loadCheckpointForResume` + `prepareResumedPipelineRun`)
- **continuation_count boundary**: Claim a run with `continuation_count = 1` (minimum resume) → verify resume path taken

### Watchdog tests
- **Stale continuation detection**: Create `continuation_pending` run with `last_heartbeat` 31 min ago → verify watchdog marks as `failed`
- **Fresh continuation NOT touched**: Create `continuation_pending` run with `last_heartbeat` 5 min ago → verify watchdog does NOT mark as failed
- **Defense-in-depth checkpoint check**: Create stale `running` run with a recent checkpoint → verify watchdog transitions to `continuation_pending` instead of `failed`

### Concurrency tests
- **Concurrent cron claiming**: Simulate two concurrent cron invocations claiming the same `continuation_pending` run → verify only one succeeds (SKIP LOCKED behavior)
- **Cron + batch runner claiming**: Verify the updated `claim_evolution_run` RPC correctly handles concurrent claims from different runner types

### Integration test
- Create a run → execute 2 iterations → mock timeout → verify `continuation_pending` status + checkpoint saved
- Load checkpoint via `loadCheckpointForResume()` + `prepareResumedPipelineRun()` → execute to completion → verify:
  - Population array equality (same variants across boundary)
  - OpenSkill mu/sigma values preserved
  - Cost budget continuity (totalSpent restored correctly)
  - Iteration counter correctness (resumes at correct iteration)
  - Comparison cache entries restored (no re-judging)

### Manual verification
- Queue a run with low `maxIterations` (3) → confirm completes normally (no continuation)
- Queue a run with high `maxIterations` (15) and set `maxDurationMs` artificially low (60s) → confirm it goes `pending → running → continuation_pending → running → completed` across multiple cron cycles

### Deployment plan
- **Phase 1** (maxDuration bump): Ship as a standalone PR. No migration, no code dependencies. Can deploy immediately.
- **Phase 2** (continuation-passing): Ship as a single PR. Deploy sequence:
  1. Run DB migration first (backward-compatible — adds new status value and column, no code depends on them yet)
  2. Deploy application code (all TypeScript changes)
  3. Verify with manual test (artificially low maxDurationMs)
- **Rollback:** Revert application code first (continuation_pending runs become orphaned), then run the revert migration (Step 2.1 rollback SQL). The watchdog will mark any in-flight continuation_pending runs as failed within 30 min.

## Files Modified (summary)

| File | Change | ~Lines |
|------|--------|--------|
| `supabase/migrations/new.sql` | New: status constraint (transactional), continuation_count, `claim_evolution_run` RPC update, `checkpoint_and_continue` RPC, rollback SQL | 40 |
| `src/lib/evolution/types.ts` | Add to EvolutionRunStatus union + CheckpointNotFoundError/CheckpointCorruptedError | 10 |
| `src/lib/evolution/core/costTracker.ts` | restoreSpent + factory | 15 |
| `src/lib/evolution/core/persistence.ts` | markRunContinuationPending + guard update + loadCheckpointForResume + error handling | 40 |
| `src/lib/evolution/core/pipeline.ts` | options + time-check (with capped adaptive margin) + continuation branch (using RPC) | 30 |
| `src/lib/evolution/index.ts` | prepareResumedPipelineRun (sync) + exports | 35 |
| `src/app/api/cron/evolution-runner/route.ts` | resume branch + maxDurationMs + use RPC for SKIP LOCKED claiming | 55 |
| `src/app/api/cron/evolution-watchdog/route.ts` | stale continuation check + defense-in-depth checkpoint check | 25 |
| `scripts/evolution-runner.ts` | Resume path for continuation_pending + markRunFailed guard | 30 |
| `src/components/evolution/EvolutionStatusBadge.tsx` | style/icon/label | 4 |
| `src/lib/services/evolutionActions.ts` | markRunFailed guards (lines 632, 971) | 2 |
| `src/lib/services/evolutionVisualizationActions.ts` | active runs count (line 222) | 1 |
| `src/app/admin/quality/evolution/page.tsx` | status filter dropdown | 1 |
| **Total** | | **~288** |

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/evolution/README.md` - Entry point for evolution docs
- `docs/evolution/architecture.md` - Pipeline orchestration and phases (add continuation-passing flow)
- `docs/evolution/data_model.md` - Core primitives and run structure (add continuation_pending status, continuation_count column)
- `docs/evolution/visualization.md` - Dashboard and monitoring (add continuation_pending badge)
- `docs/evolution/reference.md` - Config, CLI commands, deployment (add maxDurationMs option, continuation config)
- `docs/evolution/rating_and_comparison.md` - OpenSkill rating system
- `docs/evolution/agents/overview.md` - Agent framework
- `docs/evolution/cost_optimization.md` - Cost tracking and allocation (CostTracker restore behavior)
- `docs/evolution/hall_of_fame.md` - Cross-run comparison system
- `docs/evolution/strategy_experiments.md` - Factorial experiment design
