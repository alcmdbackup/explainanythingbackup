# Manual Cron Trigger Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract cron runner core logic into a reusable function, add admin server action + UI button to trigger it on demand.

**Architecture:** New `evolutionRunnerCore.ts` exports `claimAndExecuteEvolutionRun()` — the full claim→resolve→heartbeat→execute→cleanup flow. The cron route becomes a thin auth+response wrapper. A new server action `runNextPendingAction` exposes this to the admin UI via a "Run Next Pending" button.

**Tech Stack:** Next.js server actions, Supabase RPC, React (client component)

---

### Task 1: Create `evolutionRunnerCore.ts` with core function

**Files:**
- Create: `evolution/src/services/evolutionRunnerCore.ts`

**Step 1: Write the core module**

This file extracts the logic currently in `src/app/api/cron/evolution-runner/route.ts` lines 21–237 (everything inside the `GET` handler after auth, plus the helper functions `startHeartbeat`, `markRunFailed`). The `buildResponse` helper is NOT extracted — it builds `NextResponse` which is route-specific.

```typescript
// Core evolution runner logic shared by cron route and admin server action.
// Handles claim→resolve content→heartbeat→execute pipeline→cleanup.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';

// ─── Types ───────────────────────────────────────────────────────

export interface RunnerOptions {
  /** Identifier for this runner instance (e.g. 'cron-runner-abc123', 'admin-trigger') */
  runnerId: string;
  /** Max wall-clock time for pipeline execution. Undefined = run to completion. */
  maxDurationMs?: number;
}

export interface RunnerResult {
  /** Whether a pending run was found and claimed */
  claimed: boolean;
  /** The run ID that was claimed and executed */
  runId?: string;
  /** Why the pipeline stopped (e.g. 'completed', 'continuation_timeout', 'budget_exhausted') */
  stopReason?: string;
  /** Total wall-clock time in ms */
  durationMs?: number;
  /** Error message if the run failed */
  error?: string;
}

// ─── Core function ───────────────────────────────────────────────

export async function claimAndExecuteEvolutionRun(
  options: RunnerOptions,
): Promise<RunnerResult> {
  const supabase = await createSupabaseServiceClient();
  const startMs = Date.now();

  // 1. Claim oldest pending or continuation_pending run via atomic RPC (SKIP LOCKED)
  const { data: claimedRows, error: claimError } = await supabase
    .rpc('claim_evolution_run', { p_runner_id: options.runnerId });

  if (claimError) {
    logger.error('Evolution runner claim RPC error', { error: claimError.message, runnerId: options.runnerId });
    return { claimed: false, error: `Failed to claim run: ${claimError.message}` };
  }

  const claimedRun = claimedRows?.[0];
  if (!claimedRun) {
    return { claimed: false };
  }

  const runId = claimedRun.id;
  const isResume = (claimedRun.continuation_count ?? 0) > 0;
  let heartbeatInterval: NodeJS.Timeout | null = null;

  logger.info('Claimed evolution run', { runId, runnerId: options.runnerId, isResume, continuationCount: claimedRun.continuation_count });

  try {
    if (isResume) {
      const {
        executeFullPipeline,
        prepareResumedPipelineRun,
        loadCheckpointForResume,
        CheckpointNotFoundError,
        CheckpointCorruptedError,
      } = await import('@evolution/lib');

      let checkpointData;
      try {
        checkpointData = await loadCheckpointForResume(runId);
      } catch (err) {
        if (err instanceof CheckpointNotFoundError || err instanceof CheckpointCorruptedError) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.error('Failed to load checkpoint for resume', { runId, error: errorMsg });
          await markRunFailed(supabase, runId, errorMsg);
          return { claimed: true, runId, error: errorMsg, durationMs: Date.now() - startMs };
        }
        throw err;
      }

      const title = claimedRun.explanation_id
        ? (await supabase.from('explanations').select('explanation_title').eq('id', claimedRun.explanation_id).single()).data?.explanation_title ?? 'Untitled'
        : 'Prompt-based run';

      const { ctx, agents, logger: evolutionLogger, supervisorResume, resumeComparisonCacheEntries } = prepareResumedPipelineRun({
        runId,
        title,
        explanationId: claimedRun.explanation_id,
        configOverrides: claimedRun.config ?? {},
        llmClientId: `${options.runnerId}-resume`,
        checkpointData,
      });

      heartbeatInterval = startHeartbeat(supabase, runId);

      const { stopReason } = await executeFullPipeline(runId, agents, ctx, evolutionLogger, {
        startMs,
        supervisorResume,
        resumeComparisonCacheEntries,
        maxDurationMs: options.maxDurationMs,
        continuationCount: claimedRun.continuation_count,
      });

      await cleanupRunner(supabase, runId, stopReason);
      return { claimed: true, runId, stopReason, durationMs: Date.now() - startMs };
    }

    // Fresh run — resolve content
    let originalText: string;
    let title: string;
    let explanationId: number | null = claimedRun.explanation_id;

    try {
      if (claimedRun.explanation_id !== null) {
        const { data: explanation, error: contentError } = await supabase
          .from('explanations')
          .select('id, explanation_title, content')
          .eq('id', claimedRun.explanation_id)
          .single();

        if (contentError || !explanation) {
          await markRunFailed(supabase, runId, `Explanation ${claimedRun.explanation_id} not found`);
          return { claimed: true, runId, error: `Explanation ${claimedRun.explanation_id} not found`, durationMs: Date.now() - startMs };
        }

        originalText = explanation.content;
        title = explanation.explanation_title;
        explanationId = explanation.id;
      } else if (claimedRun.prompt_id) {
        const { data: topic, error: topicError } = await supabase
          .from('hall_of_fame_topics')
          .select('prompt')
          .eq('id', claimedRun.prompt_id)
          .single();

        if (topicError || !topic) {
          await markRunFailed(supabase, runId, `Prompt ${claimedRun.prompt_id} not found`);
          return { claimed: true, runId, error: `Prompt ${claimedRun.prompt_id} not found`, durationMs: Date.now() - startMs };
        }

        const { generateSeedArticle } = await import('@evolution/lib/core/seedArticle');
        const { createEvolutionLLMClient } = await import('@evolution/lib');
        const { createCostTracker } = await import('@evolution/lib/core/costTracker');
        const { createEvolutionLogger } = await import('@evolution/lib/core/logger');
        const { resolveConfig } = await import('@evolution/lib/config');

        const seedConfig = resolveConfig(claimedRun.config ?? {});
        const seedCostTracker = createCostTracker(seedConfig);
        const seedLogger = createEvolutionLogger(runId);
        const seedLlmClient = createEvolutionLLMClient(seedCostTracker, seedLogger);

        const seed = await generateSeedArticle(topic.prompt, seedLlmClient, seedLogger);
        originalText = seed.content;
        title = seed.title;
        explanationId = null;

        logger.info('Generated seed article from prompt', { runId, title, promptId: claimedRun.prompt_id });
      } else {
        await markRunFailed(supabase, runId, 'Run has no explanation_id and no prompt_id');
        return { claimed: true, runId, error: 'Run has no explanation_id and no prompt_id', durationMs: Date.now() - startMs };
      }
    } catch (contentResolveError) {
      const errorMsg = contentResolveError instanceof Error ? contentResolveError.message : String(contentResolveError);
      logger.error('Content resolution failed', { runId, error: errorMsg });
      await markRunFailed(supabase, runId, errorMsg);
      return { claimed: true, runId, error: errorMsg, durationMs: Date.now() - startMs };
    }

    const { executeFullPipeline, preparePipelineRun } = await import('@evolution/lib');

    const { ctx, agents } = preparePipelineRun({
      runId,
      originalText,
      title,
      explanationId,
      configOverrides: claimedRun.config ?? {},
      llmClientId: options.runnerId,
    });

    heartbeatInterval = startHeartbeat(supabase, runId);

    const { stopReason } = await executeFullPipeline(runId, agents, ctx, ctx.logger, {
      startMs,
      maxDurationMs: options.maxDurationMs,
      continuationCount: 0,
    });

    await cleanupRunner(supabase, runId, stopReason);
    return { claimed: true, runId, stopReason, durationMs: Date.now() - startMs };
  } catch (pipelineError) {
    const errorMessage = pipelineError instanceof Error ? pipelineError.message : String(pipelineError);
    logger.error('Evolution pipeline failed', { runId, error: errorMessage });

    await supabase.from('content_evolution_runs').update({
      status: 'failed',
      error_message: errorMessage,
      runner_id: null,
    }).eq('id', runId).in('status', ['running', 'claimed']);

    return { claimed: true, runId, error: errorMessage, durationMs: Date.now() - startMs };
  } finally {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function startHeartbeat(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  runId: string,
): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      await supabase.from('content_evolution_runs').update({
        last_heartbeat: new Date().toISOString(),
      }).eq('id', runId);
    } catch (err) {
      logger.warn('Heartbeat update failed', { runId, error: String(err) });
    }
  }, 30_000);
}

async function markRunFailed(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  runId: string,
  errorMessage: string,
): Promise<void> {
  await supabase.from('content_evolution_runs').update({
    status: 'failed',
    error_message: errorMessage,
    runner_id: null,
  }).eq('id', runId).in('status', ['pending', 'claimed', 'running', 'continuation_pending']);
}

async function cleanupRunner(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  runId: string,
  stopReason: string,
): Promise<void> {
  // continuation_timeout means run is NOT terminal — runner_id already cleared by RPC
  if (stopReason !== 'continuation_timeout') {
    await supabase.from('content_evolution_runs').update({
      runner_id: null,
    }).eq('id', runId);
  }

  logger.info('Evolution run finished invocation', { runId, stopReason });
}
```

**Step 2: Run lint and tsc**

Run: `npx eslint evolution/src/services/evolutionRunnerCore.ts --no-warn-ignored && npx tsc --noEmit 2>&1 | grep -v '^\.next/'`
Expected: Clean

**Step 3: Commit**

```bash
git add evolution/src/services/evolutionRunnerCore.ts
git commit -m "refactor: extract evolution runner core into reusable function"
```

---

### Task 2: Rewrite cron route as thin wrapper

**Files:**
- Modify: `src/app/api/cron/evolution-runner/route.ts`

**Step 1: Replace the route handler**

Replace the entire file with a thin wrapper that uses `claimAndExecuteEvolutionRun`:

```typescript
// Evolution runner cron — thin wrapper around shared core logic.
// Called by Vercel cron every 5 minutes. Auth via CRON_SECRET header.

import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/utils/cronAuth';
import { claimAndExecuteEvolutionRun } from '@evolution/services/evolutionRunnerCore';
import { v4 as uuidv4 } from 'uuid';

export const maxDuration = 800;

const RUNNER_ID = `cron-runner-${uuidv4().slice(0, 8)}`;
const PIPELINE_MAX_DURATION_MS = (maxDuration - 60) * 1000;

export async function GET(request: Request): Promise<NextResponse> {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const result = await claimAndExecuteEvolutionRun({
    runnerId: RUNNER_ID,
    maxDurationMs: PIPELINE_MAX_DURATION_MS,
  });

  if (!result.claimed) {
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({
      status: 'ok',
      message: 'No pending runs',
      timestamp: new Date().toISOString(),
    });
  }

  if (result.error) {
    return NextResponse.json({
      status: 'error',
      message: 'Pipeline execution failed',
      runId: result.runId,
      error: result.error,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }

  return NextResponse.json({
    status: 'ok',
    message: result.stopReason === 'continuation_timeout' ? 'Run yielded for continuation' : 'Run completed',
    runId: result.runId,
    stopReason: result.stopReason,
    durationMs: result.durationMs,
    timestamp: new Date().toISOString(),
  });
}
```

**Step 2: Run lint and tsc**

Run: `npx eslint src/app/api/cron/evolution-runner/route.ts --no-warn-ignored && npx tsc --noEmit 2>&1 | grep -v '^\.next/'`
Expected: Clean

**Step 3: Commit**

```bash
git add src/app/api/cron/evolution-runner/route.ts
git commit -m "refactor: cron route uses shared evolutionRunnerCore"
```

---

### Task 3: Add `runNextPendingAction` server action

**Files:**
- Modify: `evolution/src/services/evolutionActions.ts` (add new action at bottom, before the last export)

**Step 1: Add the server action**

Add at the bottom of `evolutionActions.ts`, before the final closing:

```typescript
// ─── Run next pending (manual cron trigger) ──────────────────────

const _runNextPendingAction = withLogging(async (): Promise<{
  success: boolean;
  data: { claimed: boolean; runId?: string; stopReason?: string; durationMs?: number } | null;
  error: ErrorResponse | null;
}> => {
  try {
    await requireAdmin();

    const { claimAndExecuteEvolutionRun } = await import('@evolution/services/evolutionRunnerCore');
    const result = await claimAndExecuteEvolutionRun({
      runnerId: 'admin-trigger',
    });

    if (result.error) {
      return {
        success: false,
        data: { claimed: result.claimed, runId: result.runId },
        error: { code: 'RUNNER_ERROR', message: result.error },
      };
    }

    return {
      success: true,
      data: {
        claimed: result.claimed,
        runId: result.runId,
        stopReason: result.stopReason,
        durationMs: result.durationMs,
      },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'runNextPendingAction') };
  }
}, 'runNextPendingAction');

export const runNextPendingAction = serverReadRequestId(_runNextPendingAction);
```

Also add `runNextPendingAction` to the imports at the top of `page.tsx` (Task 4).

**Step 2: Run lint and tsc**

Run: `npx eslint evolution/src/services/evolutionActions.ts --no-warn-ignored && npx tsc --noEmit 2>&1 | grep -v '^\.next/'`
Expected: Clean

**Step 3: Commit**

```bash
git add evolution/src/services/evolutionActions.ts
git commit -m "feat: add runNextPendingAction server action"
```

---

### Task 4: Add "Run Next Pending" button to admin UI

**Files:**
- Modify: `src/app/admin/quality/evolution/page.tsx`

**Step 1: Add import**

Add `runNextPendingAction` to the existing import from `@evolution/services/evolutionActions`.

**Step 2: Modify `BatchDispatchButtons` to accept `onRunCompleted` and add the button**

Change the component signature and add the button:

```typescript
function BatchDispatchButtons({ pendingCount, onRunCompleted }: { pendingCount: number; onRunCompleted: () => void }) {
  const [dispatching, setDispatching] = useState(false);
  const [runningNext, setRunningNext] = useState(false);

  const handleDispatch = async (maxRuns?: number) => {
    // ... existing code unchanged ...
  };

  const handleRunNext = async () => {
    setRunningNext(true);
    const result = await runNextPendingAction();
    if (result.success && result.data) {
      if (!result.data.claimed) {
        toast.info('No pending runs in queue');
      } else {
        toast.success(`Run ${result.data.runId?.slice(0, 8)} completed (${result.data.stopReason})`);
        onRunCompleted();
      }
    } else {
      toast.error(result.error?.message || 'Failed to run');
      if (result.data?.claimed) onRunCompleted(); // refresh even on failure — run state changed
    }
    setRunningNext(false);
  };

  return (
    <div className="flex items-center gap-2" data-testid="batch-dispatch-section">
      {pendingCount > 0 && (
        <button
          onClick={handleRunNext}
          disabled={runningNext || dispatching}
          data-testid="run-next-pending-btn"
          className="px-3 py-1.5 bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page font-ui text-xs hover:opacity-90 disabled:opacity-50"
        >
          {runningNext ? 'Running...' : `Run Next Pending (${pendingCount})`}
        </button>
      )}
      {/* ... existing Batch Dispatch and Trigger All Pending buttons unchanged ... */}
    </div>
  );
}
```

**Step 3: Update the render call to pass `onRunCompleted`**

Where `<BatchDispatchButtons>` is rendered (~line 876), change to:

```tsx
<BatchDispatchButtons pendingCount={runs.filter((r) => r.status === 'pending').length} onRunCompleted={loadRuns} />
```

**Step 4: Run lint, tsc, and build**

Run: `npx eslint src/app/admin/quality/evolution/page.tsx --no-warn-ignored && npx tsc --noEmit 2>&1 | grep -v '^\.next/'`
Expected: Clean

**Step 5: Commit**

```bash
git add src/app/admin/quality/evolution/page.tsx
git commit -m "feat: add Run Next Pending button to evolution admin UI"
```

---

### Task 5: Add unit tests for `runNextPendingAction`

**Files:**
- Modify: `evolution/src/services/evolutionActions.test.ts`

**Step 1: Add mock for `evolutionRunnerCore`**

Near the top with other mocks:

```typescript
const mockClaimAndExecuteEvolutionRun = jest.fn();
jest.mock('@evolution/services/evolutionRunnerCore', () => ({
  claimAndExecuteEvolutionRun: (...args: unknown[]) => mockClaimAndExecuteEvolutionRun(...args),
}));
```

**Step 2: Add test describe block**

After the `killEvolutionRunAction` describe block:

```typescript
// ─── runNextPendingAction ───────────────────────────────────────

describe('runNextPendingAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
  });

  it('returns claimed=false when no pending runs', async () => {
    mockClaimAndExecuteEvolutionRun.mockResolvedValueOnce({ claimed: false });

    const { runNextPendingAction } = await import('./evolutionActions');
    const result = await runNextPendingAction();

    expect(result.success).toBe(true);
    expect(result.data?.claimed).toBe(false);
    expect(mockClaimAndExecuteEvolutionRun).toHaveBeenCalledWith({ runnerId: 'admin-trigger' });
  });

  it('returns run details on successful execution', async () => {
    mockClaimAndExecuteEvolutionRun.mockResolvedValueOnce({
      claimed: true,
      runId: 'run-next-1',
      stopReason: 'completed',
      durationMs: 5000,
    });

    const { runNextPendingAction } = await import('./evolutionActions');
    const result = await runNextPendingAction();

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      claimed: true,
      runId: 'run-next-1',
      stopReason: 'completed',
      durationMs: 5000,
    });
  });

  it('returns error when runner fails', async () => {
    mockClaimAndExecuteEvolutionRun.mockResolvedValueOnce({
      claimed: true,
      runId: 'run-next-2',
      error: 'Pipeline crashed',
    });

    const { runNextPendingAction } = await import('./evolutionActions');
    const result = await runNextPendingAction();

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Pipeline crashed');
    expect(result.data?.claimed).toBe(true);
  });
});
```

**Step 3: Run tests**

Run: `npx jest evolution/src/services/evolutionActions.test.ts --no-coverage`
Expected: All tests pass (51 existing + 3 new = 54)

**Step 4: Commit**

```bash
git add evolution/src/services/evolutionActions.test.ts
git commit -m "test: add tests for runNextPendingAction"
```

---

### Task 6: Run all checks and final verification

**Step 1:** `npx eslint evolution/src/services/evolutionRunnerCore.ts evolution/src/services/evolutionActions.ts evolution/src/services/evolutionActions.test.ts src/app/api/cron/evolution-runner/route.ts src/app/admin/quality/evolution/page.tsx --no-warn-ignored`

**Step 2:** `npx tsc --noEmit 2>&1 | grep -v '^\.next/'`

**Step 3:** `npx jest evolution/src/services/evolutionActions.test.ts --no-coverage`

**Step 4:** `npx next build 2>&1 | tail -20` (verify build passes)

All must pass.

---

## Testing

### Unit tests (Task 5)
- `returns claimed=false when no pending runs` — verifies passthrough of "nothing to do"
- `returns run details on successful execution` — verifies claimed/runId/stopReason/durationMs
- `returns error when runner fails` — verifies error propagation with claimed=true

### Manual verification
- Queue a run from admin UI → click "Run Next Pending" → verify run transitions through `pending → claimed → running → completed`
- Click "Run Next Pending" with 0 pending runs → verify toast says "No pending runs in queue"

## Files Modified

| File | Change |
|------|--------|
| `evolution/src/services/evolutionRunnerCore.ts` | New — extracted claim+execute+heartbeat+cleanup logic |
| `src/app/api/cron/evolution-runner/route.ts` | Thin wrapper: auth + `claimAndExecuteEvolutionRun()` + response mapping |
| `evolution/src/services/evolutionActions.ts` | New `runNextPendingAction` server action |
| `src/app/admin/quality/evolution/page.tsx` | "Run Next Pending" button in BatchDispatchButtons |
| `evolution/src/services/evolutionActions.test.ts` | 3 new tests for `runNextPendingAction` |
