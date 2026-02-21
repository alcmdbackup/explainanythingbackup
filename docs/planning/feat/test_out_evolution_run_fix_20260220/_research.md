# Test Out Evolution Run Fix Research

## Problem Statement
Test out and fix issues found during evolution pipeline runs. The goal is to run the evolution pipeline end-to-end, identify any failures or issues, and resolve them.

## Requirements (from GH Issue #493)
Run evolution pipeline end-to-end and fix any issues

## High Level Summary

Production run `fba9df1d` is stuck as `running` with no checkpoint, caused by the inline trigger path missing `maxDurationMs`. Vercel killed the function at ~800s before continuation could fire. Two of three trigger paths are broken for continuation.

## Root Cause Analysis

### Observed Behavior (run fba9df1d-5dc6-4064-abfa-439520ad9ce2)

| Field | Value |
|---|---|
| status | `running` (zombie — process dead) |
| continuation_count | 0 (never checkpointed) |
| runner_id | `inline-trigger` |
| started_at | 2026-02-21 05:57:07 |
| last_heartbeat | 2026-02-21 06:10:07 (~13min, right at Vercel 800s limit) |
| current_iteration | 2 |
| total_cost_usd | 0.0432 |
| checkpoints | **None** |

### Why Continuation Didn't Fire

The continuation timeout check in `pipeline.ts:344` requires both `maxDurationMs` and `startMs`:

```typescript
if (!options.maxDurationMs || !options.startMs) return false; // always false without maxDurationMs
```

The inline trigger (`evolutionActions.ts:629-631`) only passes `startMs`:

```typescript
await executeFullPipeline(runId, agents, ctx, ctx.logger, {
  startMs: Date.now(),
  // maxDurationMs is MISSING → isNearTimeout() always returns false
});
```

So the pipeline never detected that it was approaching the Vercel timeout. Vercel killed the function at ~800s with no checkpoint saved. The run became a zombie: `status = 'running'` but no process alive to execute it.

### Three Trigger Paths — Only One Works

| Path | File | Runner ID | Uses shared core? | Has `maxDurationMs`? | Continuation works? |
|---|---|---|---|---|---|
| Cron runner | `src/app/api/cron/evolution-runner/route.ts` | `cron-runner-<uuid>` | Yes (`claimAndExecuteEvolutionRun`) | Yes (740s) | Yes |
| `runNextPendingAction` | `evolutionActions.ts:1014-1048` | `admin-trigger` | Yes (`claimAndExecuteEvolutionRun`) | **No** | **No** |
| `triggerEvolutionRunAction` | `evolutionActions.ts:515-667` | `inline-trigger` | **No** (duplicated code) | **No** | **No** |

### Why Both Inline and Cron Exist

- **Inline trigger** (`triggerEvolutionRunAction`): Predates cron. Admin clicks "Run" on a specific run → executes immediately in the server action. Designed for instant feedback.
- **Cron runner** (`/api/cron/evolution-runner`): Added later for automated execution and continuation. Runs every 5 minutes via Vercel cron, uses `claim_evolution_run` RPC with `SKIP LOCKED` for safe concurrency.
- **`runNextPendingAction`**: Manual "Run Next Pending" button that delegates to the shared cron runner core but also forgets to pass `maxDurationMs`.

The inline trigger can't call the cron route directly because it requires `CRON_SECRET` auth from Vercel's scheduler. The inline trigger was designed for **immediate** execution rather than queue-and-wait.

### The Duplicated Code Problem

`triggerEvolutionRunAction` duplicates ~100 lines of logic from `evolutionRunnerCore.ts`:
- Content resolution (explanation lookup, seed article generation)
- Claim logic (direct UPDATE instead of atomic RPC)
- Heartbeat setup
- Pipeline execution
- Error handling and status updates

This duplication means fixes to the runner core (like adding `maxDurationMs`) don't propagate to the inline path.

## Consolidation Analysis

### What Makes the Inline Trigger Different

Side-by-side comparison of the only meaningful difference:

| Step | Inline trigger (`triggerEvolutionRunAction`) | Shared core (`claimAndExecuteEvolutionRun`) |
|---|---|---|
| **Claim** | Direct UPDATE on **specific run ID** | `claim_evolution_run` RPC — claims **oldest pending** |
| Auth | `requireAdmin()` | Caller-dependent (cron auth / requireAdmin) |
| Content resolution | Duplicated inline | Same logic |
| Heartbeat | Duplicated `setInterval` | `startHeartbeat()` helper |
| Execute pipeline | `executeFullPipeline` (no maxDuration!) | `executeFullPipeline` (with maxDuration) |
| Cleanup | Manual UPDATE | `cleanupRunner()` helper |
| Error handling | Manual fail + ClaimError race check | `markRunFailed()` helper |

**The only real feature the inline trigger adds**: claiming a specific run by ID. Everything else is duplicated (and worse — missing `maxDurationMs`).

### Simplest Consolidation: Add `targetRunId` to Shared Core

**Principle**: one function runs evolution. Period.

#### Changes needed:

**1. SQL: Add optional `p_run_id` to `claim_evolution_run`**

```sql
CREATE OR REPLACE FUNCTION claim_evolution_run(p_runner_id TEXT, p_run_id UUID DEFAULT NULL)
...
WHERE status IN ('pending', 'continuation_pending')
  AND (p_run_id IS NULL OR id = p_run_id)  -- target specific run or oldest
ORDER BY ...
```

When `p_run_id` is NULL → existing behavior (oldest pending). When set → claims that specific run.

**2. TypeScript: Add `targetRunId` to `RunnerOptions`**

```typescript
export interface RunnerOptions {
  runnerId: string;
  maxDurationMs?: number;
  targetRunId?: string;  // NEW: claim specific run instead of oldest pending
}
```

Pass it through to the RPC:
```typescript
const { data: claimedRows } = await supabase
  .rpc('claim_evolution_run', {
    p_runner_id: options.runnerId,
    p_run_id: options.targetRunId ?? null,
  });
```

**3. Collapse all three callers**

```typescript
// triggerEvolutionRunAction — was 150 lines, now 5:
const result = await claimAndExecuteEvolutionRun({
  runnerId: 'inline-trigger',
  targetRunId: runId,
  maxDurationMs: 740_000,
});

// runNextPendingAction — just add maxDurationMs:
const result = await claimAndExecuteEvolutionRun({
  runnerId: 'admin-trigger',
  maxDurationMs: 740_000,
});

// cron route — unchanged (already works)
```

**4. Delete ~120 lines of duplicated code** from `triggerEvolutionRunAction`

The entire content resolution block, heartbeat setup, manual claim UPDATE, error handling, and ClaimError class can be removed — the shared core already handles all of it.

### What About `maxDurationMs` Default?

Even simpler: make `maxDurationMs` **default to 740_000** in `RunnerOptions` so callers can't forget it:

```typescript
export interface RunnerOptions {
  runnerId: string;
  maxDurationMs?: number;  // defaults to 740_000 (Vercel 800s - 60s safety margin)
  targetRunId?: string;
}

// In claimAndExecuteEvolutionRun:
const maxDurationMs = options.maxDurationMs ?? 740_000;
```

Then the cron route's explicit `(maxDuration - 60) * 1000` calculation becomes just a sanity override, and admin callers automatically get safe defaults.

### Summary

| Before | After |
|---|---|
| 3 code paths (cron, runNextPending, triggerInline) | 1 code path (`claimAndExecuteEvolutionRun`) |
| 2 claim mechanisms (RPC vs direct UPDATE) | 1 claim mechanism (RPC with optional `p_run_id`) |
| 2/3 paths missing `maxDurationMs` | Default 740_000, can't forget |
| ~120 lines of duplicated code | Deleted |
| `ClaimError` class in evolutionActions.ts | Removed (RPC handles races via `SKIP LOCKED`) |

### Files to Change

1. `supabase/migrations/` — new migration adding `p_run_id` param to `claim_evolution_run`
2. `evolution/src/services/evolutionRunnerCore.ts` — add `targetRunId` option, default `maxDurationMs`
3. `evolution/src/services/evolutionActions.ts` — replace `triggerEvolutionRunAction` body with ~10-line call, add `maxDurationMs` to `runNextPendingAction`
4. `evolution/src/services/evolutionActions.test.ts` — update tests

## Deep Research: Implementation Details

### SKIP LOCKED Edge Case with targetRunId

When `p_run_id` is provided and that specific row is locked by another transaction, `SKIP LOCKED` will skip it and return empty set (no run claimed). This is actually fine — it means if cron is already running the same run, the inline trigger gets `claimed: false` instead of blocking. The current inline trigger handles this via `ClaimError` with PGRST116; the RPC path handles it more cleanly by just returning empty.

### Return Type Contract Change

The inline trigger currently returns `{ success: boolean; error: ErrorResponse | null }` — no `data` field. After consolidation, it wraps `RunnerResult` which has `{ claimed, runId?, stopReason?, durationMs?, error? }`. The UI at `page.tsx:671-683` only checks `result.success` and `result.error?.message`, so the return shape can stay the same — just map internally:

```typescript
// Current UI expectation (page.tsx:673-682):
const result = await triggerEvolutionRunAction(runId);
if (result.success) { toast.success('Evolution run triggered'); }
else { toast.error(result.error?.message || 'Failed to trigger run'); }
```

The action wrapper can map `RunnerResult` → `{ success, error }` without UI changes.

### Queue-Then-Trigger Pattern (page.tsx:213-229)

The admin UI's "Start Pipeline" flow does:
1. `queueEvolutionRunAction({ promptId, strategyId, budgetCapUsd })` → creates `pending` row, returns run ID
2. `triggerEvolutionRunAction(result.data.id)` → immediately executes that specific run

After consolidation, step 2 becomes `claimAndExecuteEvolutionRun({ targetRunId: id, ... })`. The queue-then-trigger pattern still works — just the trigger uses the RPC claim instead of direct UPDATE.

### ClaimError Can Be Deleted

`ClaimError` (evolutionActions.ts:67-72) is only used by `triggerEvolutionRunAction`. After consolidation:
- Race conditions are handled by `SKIP LOCKED` in the RPC (returns empty set, no error)
- The shared core already handles `!claimedRun` → `{ claimed: false }`
- No need for explicit race detection via PGRST116 error codes

### Exclusive Inline Trigger Imports (Can Be Removed)

These dynamic imports exist only in the inline trigger path and are duplicated in `evolutionRunnerCore.ts`:
- `@evolution/lib/core/seedArticle` → `generateSeedArticle`
- `@evolution/lib` → `createEvolutionLLMClient`
- `@evolution/lib/core/costTracker` → `createCostTracker`
- `@evolution/lib/core/logger` → `createEvolutionLogger`
- `@evolution/lib/config` → `resolveConfig`
- `@evolution/lib` → `executeFullPipeline`, `preparePipelineRun`

All of these are already handled by the shared core. After consolidation, the inline trigger becomes a thin wrapper with no direct evolution imports.

### Error Handling Differences

| Aspect | Inline trigger (current) | Shared core |
|---|---|---|
| Status guard on fail | `.in(['pending', 'claimed', 'running', 'continuation_pending'])` | `.in(['running', 'claimed'])` (catch block) or `.in(['pending', 'claimed', 'running', 'continuation_pending'])` (markRunFailed helper) |
| Sets `completed_at` | Yes | No (relies on pipeline finalization) |
| Error format | Structured JSON `{ message, source, timestamp }` | Raw error message string |
| New Supabase client | Creates `failSupabase` for isolation | Reuses existing client |
| Race bypass | Skips DB update on ClaimError | N/A — SKIP LOCKED prevents races |

After consolidation, the shared core's error handling covers all cases. The inline trigger's structured JSON error and `completed_at` are nice-to-haves but not critical — the run gets marked `failed` either way.

### Test Impact

**Existing tests for `triggerEvolutionRunAction`** (6 tests in evolutionActions.test.ts):
1. Marks run as failed when pipeline throws
2. Returns original error when DB update in catch block fails
3. Claims run before calling executeFullPipeline
4. Does not mark failed on claim race (PGRST116)
5. Marks failed on real DB error (non-PGRST116)
6. Clears heartbeat interval on pipeline throw

After consolidation, tests 1-2 become tests for `claimAndExecuteEvolutionRun` (already covered by its own error handling). Tests 3-5 simplify — the RPC claim replaces direct UPDATE + race detection. Test 6 is handled by the shared core's `finally` block.

**Existing tests for `runNextPendingAction`** (3 tests):
1. Returns claimed=false when no pending runs
2. Returns run details on success
3. Returns error when runner fails

These only need `maxDurationMs` added to the mock expectations.

**No separate test file for `evolutionRunnerCore.ts`** — tested indirectly. Should add unit tests as part of this work.

### Batch Runner Script Compatibility

`evolution/scripts/evolution-runner.ts:55-57` also calls `claim_evolution_run` RPC. It has a fallback for when the function doesn't exist (error code 42883). Adding `p_run_id DEFAULT NULL` to the RPC signature is backward-compatible — the script passes only `p_runner_id` and will continue to work unchanged.

## Immediate SQL Fix (zombie run)

```sql
UPDATE content_evolution_runs
SET status = 'pending',
    runner_id = NULL,
    continuation_count = 0,
    current_iteration = 0,
    total_cost_usd = 0,
    started_at = NULL,
    last_heartbeat = NOW()
WHERE id = 'fba9df1d-5dc6-4064-abfa-439520ad9ce2';
```

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- docs/feature_deep_dives/testing_setup.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/cost_optimization.md
- docs/feature_deep_dives/error_handling.md

## Code Files Read
- `evolution/src/services/evolutionActions.ts` — inline trigger (515-667), runNextPending (1014-1050), ClaimError (67-72), queue-then-trigger pattern
- `evolution/src/services/evolutionActions.test.ts` — 6 tests for trigger, 3 for runNextPending, chainable mock factory pattern
- `evolution/src/services/evolutionRunnerCore.ts` — shared runner core, RunnerOptions/RunnerResult interfaces, resume path, cleanupRunner
- `src/app/api/cron/evolution-runner/route.ts` — cron route, maxDuration=800, PIPELINE_MAX_DURATION_MS calculation
- `src/app/api/cron/evolution-runner/route.test.ts` — RPC mock setup for claim
- `src/app/admin/quality/evolution/page.tsx` — UI callers: handleTrigger (671-683), handleRunNext (368-383), queue-then-trigger (213-229)
- `evolution/src/lib/core/pipeline.ts` — isNearTimeout(), executeFullPipeline, FullPipelineOptions
- `evolution/src/lib/core/persistence.ts` — checkpoint save/load, checkpoint_and_continue RPC
- `src/app/api/cron/evolution-watchdog/route.ts` — stale run recovery
- `supabase/migrations/20260220000001_inter_agent_timeout_checkpoint.sql` — continuation RPC with p_last_agent
- `supabase/migrations/20260216000001_add_continuation_pending_status.sql` — claim RPC (current version), checkpoint_and_continue RPC
- `supabase/migrations/20260216000001_revert_continuation_pending.sql.rollback` — rollback for continuation feature
- `supabase/migrations/20260214000001_claim_evolution_run.sql` — original claim RPC (pending-only)
- `supabase/migrations/20260131000001_content_evolution_runs.sql` — runs table schema
- `supabase/migrations/20260131000003_evolution_checkpoints.sql` — checkpoints table schema
- `evolution/scripts/evolution-runner.ts` — batch runner CLI, also calls claim RPC with fallback
- `evolution/src/testing/evolution-test-helpers.ts` — test factories, mock builders, cleanup helpers
- `src/lib/logging/server/automaticServerLoggingBase.ts` — withLogging/withServerLogging wrapper
- `src/lib/serverReadRequestId.ts` — request context wrapper with Sentry + AsyncLocalStorage
