# Test Out Evolution Run Fix Plan

## Background

Production evolution run `fba9df1d` is stuck as `running` (zombie). The inline trigger path (`triggerEvolutionRunAction`) doesn't pass `maxDurationMs` to the pipeline, so the continuation timeout never fires. Vercel kills the function at ~800s with no checkpoint saved. Two of three trigger paths are broken for continuation.

## Requirements (from GH Issue #493)

Run evolution pipeline end-to-end and fix any issues.

## Problem

The evolution pipeline has three trigger paths but only the cron runner correctly supports continuation. The inline trigger (`triggerEvolutionRunAction`) duplicates ~120 lines of runner core logic but omits `maxDurationMs`, causing runs to die at Vercel's 800s limit without checkpointing. `runNextPendingAction` is a near-identical wrapper around the same shared core as cron. The duplication means bug fixes to the runner core don't propagate to admin-triggered runs.

## Options Considered

1. **Minimal fix: just add `maxDurationMs` to both broken paths** — Quick but leaves 120 lines of duplicated code that will diverge again.
2. **Consolidate to 2 paths: server action + cron route, both using shared core** — Eliminates duplication but leaves two nearly-identical thin wrappers.
3. **Consolidate to 1 endpoint: upgrade cron route with dual auth + optional targetRunId** — Maximum simplicity. Admin UI calls the same HTTP endpoint as cron. Delete both server actions entirely.
4. **Remove inline trigger entirely, queue-only** — Simplest but loses instant-execution UX.

**Chosen: Option 3** — one endpoint. The cron route and admin trigger are identical except for auth and response mapping. Merge them into one route that accepts both cron secret and admin session auth.

## Architecture After Consolidation

### One endpoint, one core

```
Admin UI (fetch)                   Vercel Cron (every 5 min)
   │                                      │
   │  POST /api/evolution/run              │  GET /api/evolution/run
   │  { runId?: string }                   │  (no body)
   │  Cookie: admin session                │  Authorization: Bearer CRON_SECRET
   │                                       │
   └──────────────┐          ┌─────────────┘
                  ▼          ▼
         /api/evolution/run route handler
            │  - dual auth: cron secret OR admin session
            │  - parse optional runId from body (POST) or skip (GET)
            │  - call claimAndExecuteEvolutionRun(options)
            │  - return JSON response
            │
            ▼
        claimAndExecuteEvolutionRun(options)
            │  - claim via RPC (SKIP LOCKED)
            │  - resolve content
            │  - heartbeat + execute pipeline
            │  - checkpoint on timeout
            │  - cleanup
            │
            ▼
        claim_evolution_run(p_runner_id, p_run_id?)
            - p_run_id NULL  → oldest pending (FIFO)
            - p_run_id set   → that specific run
```

### End-to-end flow: admin clicks "Start Pipeline"

1. **Queue**: UI calls `queueEvolutionRunAction({ promptId, strategyId, budgetCapUsd })` (server action, unchanged). Inserts a row with `status = 'pending'` into `evolution_runs`.

2. **Trigger**: UI calls `triggerEvolutionRun(runId)` (new client-side fetch helper). Sends `POST /api/evolution/run` with `{ runId }` and the browser's session cookie.

3. **Auth**: Route tries `requireCronAuth` (fails — no CRON_SECRET header), falls back to `requireAdmin()` (reads session cookie, verifies admin role in DB). Returns `runnerId: 'admin-trigger'`.

4. **Claim**: `claimAndExecuteEvolutionRun({ runnerId: 'admin-trigger', targetRunId: runId, maxDurationMs: 740_000 })` calls the Postgres RPC `claim_evolution_run('admin-trigger', runId)`. The RPC atomically locks and transitions the specific row from `pending → claimed`.

5. **Content resolution**: `continuation_count = 0` → fresh run. Queries `evolution_hall_of_fame_topics` for the prompt, calls `generateSeedArticle()` via LLM to produce the initial article text.

6. **Execute**: Sets `status = 'running'`, starts 30s heartbeat interval, calls `executeFullPipeline()` with `maxDurationMs: 740_000`. Pipeline runs generation, tournament, and rating agents iteration by iteration. Between each agent and iteration, checks `isNearTimeout()`:

   ```
   isNearTimeout():
     elapsed = now - startMs
     safetyMargin = clamp(elapsed * 0.10, 60s, 120s)
     return (740_000 - elapsed) < safetyMargin
   ```

7. **Outcome A — completes within 740s**: All iterations finish. Pipeline persists variants/ratings, sets `status = 'completed'`. Route returns `{ claimed: true, stopReason: 'completed' }`. UI shows success toast. Done.

8. **Outcome B — hits 740s timeout**: `isNearTimeout()` fires. Pipeline calls `checkpoint_and_continue` RPC which **atomically**:
   - Saves full state snapshot (pool, ratings, supervisor, comparison cache) to `evolution_checkpoints`
   - Sets `status = 'continuation_pending'`, `runner_id = NULL`, increments `continuation_count`

   Route returns `{ claimed: true, stopReason: 'continuation_timeout' }`. UI shows success toast. The Vercel function dies.

9. **Cron continues**: Within 5 minutes, Vercel cron sends `GET /api/evolution/run`. Same route, same shared core. `claim_evolution_run` prioritizes `continuation_pending` over `pending` — claims this run. `continuation_count > 0` → resume path: loads checkpoint, restores state, resumes pipeline from where it stopped.

10. **Repeat**: Each cron invocation runs up to 740s, checkpoints if needed. Cron picks up the baton each cycle:
    ```
    Admin POST → runs 740s → checkpoints → function dies
      → Cron GET → resumes → runs 740s → checkpoints → function dies
        → Cron GET → resumes → runs 740s → completed
    ```
    Max 10 continuations enforced in `pipeline.ts:300`.

11. **Watchdog safety net** (separate cron, every 15 min): If a function gets killed by Vercel before checkpointing (agent took too long within the safety margin):
    - Stale `running` + recent checkpoint exists → set `continuation_pending` (recovery)
    - Stale `running` + no checkpoint → set `failed` (abandoned)
    - `continuation_pending` unclaimed for 30+ min → set `failed`

### Continuation correctness checklist

The root cause bug was `maxDurationMs` not being set. After this plan:

| Check | Status |
|---|---|
| `maxDurationMs` passed to pipeline | Yes — `PIPELINE_MAX_DURATION_MS = (800 - 60) * 1000 = 740_000`, set in the one route handler, passed to shared core |
| `maxDurationMs` default in shared core | Yes — `options.maxDurationMs ?? 740_000` as fallback if caller forgets |
| `startMs` passed to pipeline | Yes — set by shared core at `Date.now()` before pipeline call |
| `isNearTimeout()` fires correctly | Yes — both values present, safety margin = `clamp(elapsed * 10%, 60s, 120s)` |
| `checkpoint_and_continue` RPC atomic | Yes — single transaction: insert checkpoint + update status |
| Cron claims `continuation_pending` | Yes — RPC `WHERE status IN ('pending', 'continuation_pending')` with priority ordering |
| Resume loads checkpoint correctly | Yes — `loadCheckpointForResume` queries `last_agent IN ('iteration_complete', 'continuation_yield')` |
| No duplicate code paths to forget | Yes — one route, one shared core, one claim RPC |

### Race condition handling

- **Admin and cron fire simultaneously**: `FOR UPDATE SKIP LOCKED` — first caller locks the row, second skips it and gets a different run (or empty set). No error, no conflict.
- **Admin triggers a run cron already claimed**: RPC returns empty set (row is locked or status already changed). Client gets `{ claimed: false }` → UI shows "not available".
- **Cron tries to continue a run admin re-triggered**: Same SKIP LOCKED behavior. Only one wins.

### Error handling and retries

**API route provides**:
- Structured JSON errors with status codes (401, 500)
- Consistent response shape via `EvolutionRunResponse` type

**Client-side helper (`triggerEvolutionRun`) provides**:
- Typed response parsing
- Fetch error handling (network failures, non-200 responses, JSON parse failures)
- Optional retry with exponential backoff (1s, 2s, 4s...) for 500s and network errors
- No retry on 401 (auth failures are not transient)

**Server-side (shared core) provides**:
- `maxDurationMs` default of 740_000 — can't forget it
- `markRunFailed()` on unrecoverable errors
- Heartbeat every 30s so watchdog can detect stale runs
- `checkpoint_and_continue` atomic RPC — no race window between checkpoint save and status transition

**Watchdog (every 15 min) provides**:
- Recovery for runs where Vercel killed the function before checkpoint could save
- Automatic failure marking for truly abandoned runs (no checkpoint, stale heartbeat)

## Phased Execution Plan

### Phase 1: SQL Migration — Add `p_run_id` to claim RPC

**File**: New migration `supabase/migrations/20260221000001_add_target_run_id_to_claim.sql`

Update `claim_evolution_run` to accept optional `p_run_id UUID DEFAULT NULL`:

```sql
CREATE OR REPLACE FUNCTION claim_evolution_run(p_runner_id TEXT, p_run_id UUID DEFAULT NULL)
RETURNS SETOF evolution_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run evolution_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM evolution_runs
  WHERE status IN ('pending', 'continuation_pending')
    AND (p_run_id IS NULL OR id = p_run_id)
  ORDER BY
    CASE WHEN status = 'continuation_pending' THEN 0 ELSE 1 END,
    created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE evolution_runs
  SET status = 'claimed',
      runner_id = p_runner_id,
      last_heartbeat = NOW(),
      started_at = CASE WHEN started_at IS NULL THEN NOW() ELSE started_at END
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  RETURN NEXT v_run;
END;
$$;
```

**Backward compatible**: existing callers omit `p_run_id` → defaults to NULL → existing FIFO behavior.

**Verify**: lint, tsc, build. Run cron route tests to confirm no regression.

### Phase 2: Add `targetRunId` and default `maxDurationMs` to shared core

**File**: `evolution/src/services/evolutionRunnerCore.ts`

Changes:
1. Add `targetRunId?: string` to `RunnerOptions` interface
2. Default `maxDurationMs` to `740_000` inside `claimAndExecuteEvolutionRun`:
   ```typescript
   const maxDurationMs = options.maxDurationMs ?? 740_000;
   ```
3. Pass `targetRunId` to RPC:
   ```typescript
   const { data: claimedRows, error: claimError } = await supabase
     .rpc('claim_evolution_run', {
       p_runner_id: options.runnerId,
       ...(options.targetRunId ? { p_run_id: options.targetRunId } : {}),
     });
   ```

**Verify**: lint, tsc, build. Run existing cron route tests — should pass unchanged.

### Phase 3: Replace cron route with unified endpoint

**Move**: `src/app/api/cron/evolution-runner/route.ts` → `src/app/api/evolution/run/route.ts`

Keep a re-export at the old path so Vercel cron still works (or update `vercel.json`).

New route supports both GET (cron) and POST (admin):

```typescript
// Unified evolution runner endpoint.
// GET: called by Vercel cron (auth via CRON_SECRET).
// POST: called by admin UI (auth via session cookie, optional targetRunId).

import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/utils/cronAuth';
import { requireAdmin } from '@/lib/services/adminAuth';
import { claimAndExecuteEvolutionRun } from '@evolution/services/evolutionRunnerCore';
import { logger } from '@/lib/server_utilities';
import { v4 as uuidv4 } from 'uuid';

export const maxDuration = 800;

const PIPELINE_MAX_DURATION_MS = (maxDuration - 60) * 1000;

// ─── Auth: cron secret OR admin session ──────────────────────────

async function authenticateRequest(request: Request): Promise<
  { authorized: true; runnerId: string } | { authorized: false; response: NextResponse }
> {
  // Try cron secret first (fast, no DB call)
  const cronError = requireCronAuth(request);
  if (!cronError) {
    return { authorized: true, runnerId: `cron-runner-${uuidv4().slice(0, 8)}` };
  }

  // Fall back to admin session
  try {
    await requireAdmin();
    return { authorized: true, runnerId: 'admin-trigger' };
  } catch {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
}

// ─── Shared handler ──────────────────────────────────────────────

async function handleRun(request: Request, targetRunId?: string): Promise<NextResponse> {
  const auth = await authenticateRequest(request);
  if (!auth.authorized) return auth.response;

  const result = await claimAndExecuteEvolutionRun({
    runnerId: auth.runnerId,
    targetRunId,
    maxDurationMs: PIPELINE_MAX_DURATION_MS,
  });

  if (!result.claimed) {
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({
      claimed: false,
      message: 'No pending runs',
    });
  }

  if (result.error) {
    return NextResponse.json({
      claimed: true,
      runId: result.runId,
      error: result.error,
    }, { status: 500 });
  }

  return NextResponse.json({
    claimed: true,
    runId: result.runId,
    stopReason: result.stopReason,
    durationMs: result.durationMs,
  });
}

// ─── GET: cron (no targetRunId) ──────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  return handleRun(request);
}

// ─── POST: admin UI (optional targetRunId) ───────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<NextResponse> {
  let targetRunId: string | undefined;
  try {
    const body = await request.json();
    if (body.runId != null) {
      if (typeof body.runId !== 'string' || !UUID_RE.test(body.runId)) {
        return NextResponse.json({ error: 'Invalid runId — must be a UUID' }, { status: 400 });
      }
      targetRunId = body.runId;
    }
  } catch {
    // No body or unparseable JSON — log and treat as "run next pending"
    logger.warn('POST /api/evolution/run: no valid JSON body, treating as run-next-pending');
  }
  return handleRun(request, targetRunId);
}
```

**Note on `requireAdmin()` in route handler context**: `adminAuth.ts` has a `'use server'` directive, but importing and calling its exports from a route handler is valid — both run server-side. The `'use server'` directive makes functions callable as server actions from the client; it doesn't restrict server-to-server calls. The `cookies()` API from `next/headers` works in both server actions and route handlers in Next.js App Router.

**Fallback if `requireAdmin()` doesn't work in route handler**: If during Phase 2/3 implementation, `requireAdmin()` fails to read cookies in route handler context, the fallback is to create a `requireAdminFromRequest(request: Request)` helper that reads the auth token directly from the `Request` object's cookies header and calls Supabase's `auth.getUser()`. This would be a ~10 line function. We expect this fallback is NOT needed since `cookies()` works in route handlers, but document it here as a contingency.

**Verify**: lint, tsc, build.

### Phase 4: Add client-side helper with error handling and retries

**File**: New `evolution/src/services/evolutionRunClient.ts`

**Client/server boundary note**: This file lives alongside server files (`evolutionRunnerCore.ts`, `evolutionActions.ts`) but has a `'use client'` directive. This is safe because Next.js uses the directive to determine the module boundary — the bundler will NOT include server-side siblings in the client bundle unless they are explicitly imported by this file. The `'use client'` file only imports browser globals (`fetch`). If this feels risky, an alternative location is `src/lib/client/evolutionRunClient.ts`, but keeping it in `evolution/src/services/` is consistent with colocation of related evolution code.

Typed fetch wrapper the UI imports instead of server actions:

```typescript
'use client';

// Client-side helper for calling the evolution run endpoint.
// Handles fetch errors, non-200 responses, and optional retry with backoff.

export interface EvolutionRunResponse {
  claimed: boolean;
  runId?: string;
  stopReason?: string;
  durationMs?: number;
  message?: string;
  error?: string;
}

export async function triggerEvolutionRun(
  runId?: string,
  options?: { retries?: number },
): Promise<EvolutionRunResponse> {
  const maxRetries = options?.retries ?? 0;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s, 4s...
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }

    try {
      const res = await fetch('/api/evolution/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });

      const data: EvolutionRunResponse = await res.json();

      if (!res.ok) {
        // Non-retryable auth errors
        if (res.status === 401) {
          throw new Error(data.error ?? 'Unauthorized');
        }
        // Server errors may be retryable
        if (attempt < maxRetries && res.status >= 500) {
          lastError = new Error(data.error ?? `Server error ${res.status}`);
          continue;
        }
        throw new Error(data.error ?? `Request failed with status ${res.status}`);
      }

      return data;
    } catch (err) {
      if (err instanceof TypeError) {
        // Network error (fetch failed entirely)
        lastError = new Error('Network error — could not reach server');
        if (attempt < maxRetries) continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error('Request failed after retries');
}
```

**Verify**: lint, tsc, build. Write unit tests for the client helper.

### Phase 5: Update UI to use client helper

**File**: `src/app/admin/quality/evolution/page.tsx`

Replace server action imports with client helper:

```typescript
// Before:
import { triggerEvolutionRunAction, runNextPendingAction } from '@evolution/services/evolutionActions';

// After:
import { triggerEvolutionRun } from '@evolution/services/evolutionRunClient';
```

Update handlers:

```typescript
// "Trigger" button on a specific run
const handleTrigger = async (runId: string) => {
  setActionLoading(true);
  try {
    const result = await triggerEvolutionRun(runId);
    toast.success('Evolution run triggered');
    loadRuns();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to trigger run');
  }
  setActionLoading(false);
};

// "Run Next Pending" button
const handleRunNext = async () => {
  setRunningNext(true);
  try {
    const result = await triggerEvolutionRun();
    if (!result.claimed) {
      toast.info('No pending runs in queue');
    } else {
      toast.success(`Run ${result.runId?.slice(0, 8)} completed (${result.stopReason})`);
      onRunCompleted();
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to run');
  }
  setRunningNext(false);
};

// Queue + trigger (Start Pipeline)
const handleStart = async () => {
  setSubmitting(true);
  const result = await queueEvolutionRunAction({ promptId, strategyId, budgetCapUsd: cap });
  if (result.success && result.data) {
    toast.success('Run queued — triggering pipeline...');
    onQueued();
    try {
      await triggerEvolutionRun(result.data.id);
      toast.success('Pipeline started');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Pipeline trigger failed');
    }
    onQueued();
  }
  setSubmitting(false);
};
```

**Verify**: lint, tsc, build.

### Phase 6: Delete server actions and old cron path

**File**: `evolution/src/services/evolutionActions.ts`

Delete:
- `triggerEvolutionRunAction` (~150 lines including the duplicated pipeline logic)
- `runNextPendingAction` (~35 lines)
- `ClaimError` class (~6 lines)
- Their exports

**File**: `src/app/api/cron/evolution-runner/route.ts`

**Strategy**: Keep old route as a re-export AND update `vercel.json`. This prevents a deployment gap where cron hits 404 if `vercel.json` deploys before the new route is live (or vice versa).

Step 1 — Replace old route with re-export:
```typescript
// Legacy cron path — re-exports from unified endpoint.
// Safe to delete once vercel.json is confirmed pointing to /api/evolution/run.
export { GET, POST } from '@/app/api/evolution/run/route';
export { maxDuration } from '@/app/api/evolution/run/route';
```

Step 2 — Update `vercel.json`:
```json
{ "path": "/api/evolution/run", "schedule": "*/5 * * * *" }
```

Step 3 — After confirming cron hits the new path in production logs, delete the old re-export route in a follow-up PR.

**Verify**: lint, tsc, build. Confirm both paths respond correctly.

### Phase 7: Update tests

**File**: `evolution/src/services/evolutionActions.test.ts`
- Delete all `triggerEvolutionRunAction` tests (6 tests)
- Delete all `runNextPendingAction` tests (3 tests)

**File**: `src/app/api/cron/evolution-runner/route.test.ts` → move/update to `src/app/api/evolution/run/route.test.ts`
- Add tests for dual auth (cron secret passes, admin session passes, neither fails)
- **Critical**: Test that `requireAdmin()` works correctly in a route handler context (reads cookies from the request, not just server action context). Mock `cookies()` from `next/headers` and verify admin check passes.
- Add tests for POST with `runId` body (passes `targetRunId` to shared core)
- Add tests for POST with invalid `runId` (non-UUID) → returns 400
- Add tests for POST with malformed JSON body → logs warning, treats as run-next-pending
- Add tests for POST without body (no `targetRunId`, claims oldest)
- **Rewrite** existing GET tests: response shape changed from `{ status: 'ok' }` to `{ claimed: boolean, runId?, stopReason?, durationMs? }`. All GET test assertions must be updated to match the new response contract.

**File**: `src/app/api/cron/evolution-runner/route.test.ts` (old path — keep for re-export tests)
- Test that importing `GET` from the old path resolves to the same handler as the new path
- Test that `maxDuration` export is available from the old path
- This ensures the re-export works and cron isn't silently 404ing

**File**: New `evolution/src/services/evolutionRunClient.test.ts`
- Test success response parsing
- Test 401 error (no retry)
- Test 500 error with retry (attempts backoff, succeeds on retry)
- Test network error with retry
- Test no-retry mode (retries: 0)

**File**: New `evolution/src/services/evolutionRunnerCore.test.ts`
- `targetRunId` passed to RPC as `p_run_id`
- `targetRunId` omitted → `p_run_id` not sent
- `maxDurationMs` defaults to 740_000 when not provided
- `maxDurationMs` override is respected when explicitly set

**Verify**: Run full test suite. lint, tsc, build.

### Phase 8: Manual verification

1. Reset zombie run in production:
   ```sql
   UPDATE evolution_runs
   SET status = 'pending', runner_id = NULL, continuation_count = 0,
       current_iteration = 0, total_cost_usd = 0, started_at = NULL,
       last_heartbeat = NOW()
   WHERE id = 'fba9df1d-5dc6-4064-abfa-439520ad9ce2';
   ```

2. Deploy to staging
3. **Smoke test cron path** after deploy:
   ```bash
   # Verify the new cron endpoint responds (with cron secret)
   curl -s -o /dev/null -w "%{http_code}" \
     -H "Authorization: Bearer $CRON_SECRET" \
     https://staging.explainanything.com/api/evolution/run
   # Should return 200 (with { claimed: false } if no pending runs)

   # Verify the old re-export path also works
   curl -s -o /dev/null -w "%{http_code}" \
     -H "Authorization: Bearer $CRON_SECRET" \
     https://staging.explainanything.com/api/cron/evolution-runner
   # Should also return 200
   ```
4. Test on staging:
   - Admin UI "Start Pipeline" (queue + POST with runId) → verify checkpoints and continues
   - Admin UI "Run Next Pending" (POST, no runId) → verify claims oldest pending
   - Cron fires (GET) → verify unchanged behavior
   - Verify 401 when unauthenticated
   - Verify retry behavior when server returns 500

## Summary

| Before | After |
|---|---|
| 3 code paths, 3 files | 1 endpoint, 1 file + 1 client helper |
| `triggerEvolutionRunAction` — 150 lines, broken | **Deleted** |
| `runNextPendingAction` — 35 lines, broken | **Deleted** |
| `ClaimError` class | **Deleted** |
| Cron route — 15 lines, only working path | Upgraded to unified route (~60 lines) |
| No client-side error handling/retries | `triggerEvolutionRun` with typed responses and retry |
| 2 claim mechanisms (direct UPDATE + RPC) | 1 claim mechanism (RPC) |
| 2/3 paths missing `maxDurationMs` | Default 740_000, can't forget |

**Net change**: ~185 lines deleted, ~100 lines added (route + client helper). Simpler, correct, and harder to break.

### Breaking change: cron response shape

The old cron route returned `{ status: 'ok' }` on success. The new unified route returns `{ claimed: boolean, runId?, stopReason?, durationMs? }`. **Impact**: Vercel cron only checks HTTP status code (200 vs non-200) — it does not parse the response body. No external monitoring is known to depend on the `{ status: 'ok' }` shape. The old cron route test (`route.test.ts`) asserts on the body shape and must be updated (covered in Phase 7).

## Testing

### Unit tests to write/update
- `src/app/api/evolution/run/route.test.ts` — dual auth, GET/POST, targetRunId, error responses
- `evolution/src/services/evolutionRunClient.test.ts` — fetch wrapper, retries, error handling
- `evolution/src/services/evolutionRunnerCore.test.ts` — targetRunId and maxDurationMs defaults

### Tests to delete
- `triggerEvolutionRunAction` tests (6) in `evolutionActions.test.ts`
- `runNextPendingAction` tests (3) in `evolutionActions.test.ts`

### Integration tests
- `src/__tests__/integration/evolution-actions.integration.test.ts` (existing, should pass)
- **New**: Add integration test for `POST /api/evolution/run` with admin session cookie → verifies end-to-end: auth → claim → run → response. Can mock the pipeline execution but should exercise the real route handler + auth flow.

### Manual verification on staging
- Admin UI trigger specific run → continuation works
- Admin UI run next pending → continuation works
- Cron picks up pending run → unchanged (regression check)

## Deployment Ordering

**Critical**: The SQL migration (Phase 1) MUST be deployed to Supabase BEFORE the Vercel code deploy. The new TypeScript code calls `claim_evolution_run` with `p_run_id` — if the Postgres function hasn't been updated yet, the RPC call will fail with an unexpected argument error.

**Deploy sequence**:
1. Run migration `20260221000001_add_target_run_id_to_claim.sql` on Supabase (production)
2. Verify: `SELECT proname, pronargs FROM pg_proc WHERE proname = 'claim_evolution_run';` → should show 2 args
3. Deploy Vercel (code changes)
4. Verify: Admin UI trigger works, cron fires normally

**Rollback**: The migration is backward-compatible (new param has `DEFAULT NULL`). If code deploy fails, the old code continues to work with the updated RPC. No rollback SQL needed.

## Documentation Updates

- `evolution/docs/evolution/architecture.md` — update trigger path description (3 paths → 1 unified endpoint)
- `evolution/docs/evolution/reference.md` — update `claim_evolution_run` RPC signature (new `p_run_id` param), document new API endpoint
