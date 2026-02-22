# Parallel Evolution Runner Design

## Problem

The evolution pipeline processes runs sequentially — the batch runner executes one run at a time, the Vercel cron claims one per invocation (with a 5-min timeout that's too short for most runs), and GitHub Actions runs the batch script in a single-threaded loop. To maximize throughput, we need in-process parallelism with rate limiting to prevent LLM API 429 storms.

## Decision

Add a `--parallel N` flag to `scripts/evolution-runner.ts` that executes N evolution runs concurrently within a single process, paired with a global LLM call semaphore to prevent rate limit exhaustion.

## Design

### 1. Runner Script Changes (`scripts/evolution-runner.ts`)

**New CLI flags:**
- `--parallel N` (default: 1) — number of concurrent pipeline executions
- `--max-concurrent-llm N` (default: 20) — max simultaneous LLM API calls across all runs

**Main loop change:**

```typescript
// Current: sequential
while (processedRuns < MAX_RUNS && !shuttingDown) {
  const run = await claimNextRun();
  await executeRun(run);
  processedRuns++;
}

// New: batched parallel
while (processedRuns < MAX_RUNS && !shuttingDown) {
  const remaining = MAX_RUNS - processedRuns;
  const batchSize = Math.min(PARALLEL, remaining);
  const batch = await claimBatch(batchSize);
  if (batch.length === 0) break;

  const results = await Promise.allSettled(batch.map(run => executeRun(run)));
  processedRuns += batch.length;

  // Log results per run
  for (const [i, result] of results.entries()) {
    if (result.status === 'rejected') {
      log('error', 'Parallel run failed', { runId: batch[i].id, error: String(result.reason) });
    }
  }
}
```

**`claimBatch(n)` function:**

```typescript
async function claimBatch(n: number): Promise<ClaimedRun[]> {
  const claimed: ClaimedRun[] = [];
  for (let i = 0; i < n; i++) {
    const run = await claimNextRun();
    if (!run) break; // no more pending runs
    claimed.push(run);
  }
  return claimed;
}
```

Claims are serial (not parallel) to minimize the race window in optimistic locking.

**Graceful shutdown:** No changes needed. The `shuttingDown` flag prevents claiming new batches. `Promise.allSettled` waits for all in-flight runs to complete before the loop exits.

### 2. LLM Call Semaphore (`src/lib/services/llmSemaphore.ts`)

A counting semaphore that limits concurrent LLM API calls across all evolution runs in the process:

```typescript
class LLMSemaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.maxConcurrent) {
      this.current++;
      return;
    }
    return new Promise<void>(resolve => {
      this.queue.push(() => { this.current++; resolve(); });
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) next();
  }
}
```

**Integration point:** Wrap the LLM API call in `llms.ts` — only for evolution calls (check `call_source.startsWith('evolution_')`):

```typescript
// In callLLMModelRaw, before the actual API call:
if (call_source.startsWith('evolution_')) {
  await evolutionSemaphore.acquire();
  try {
    return await actualApiCall(...);
  } finally {
    evolutionSemaphore.release();
  }
}
```

**Default limit:** 20 concurrent calls. Configurable via:
- CLI: `--max-concurrent-llm 30`
- Env var: `EVOLUTION_MAX_CONCURRENT_LLM=30`

**Why 20:** A single tournament round fires ~20 calls. With 5 parallel runs, 20 means only one tournament round proceeds at a time while other agents' smaller parallel batches (3-5 calls) can interleave. This provides natural backpressure without starving any single run.

### 3. Atomic Run Claiming (SQL Migration)

Create the missing `claim_evolution_run` RPC that the batch runner already tries to call:

```sql
CREATE OR REPLACE FUNCTION claim_evolution_run(p_runner_id TEXT)
RETURNS SETOF evolution_runs
LANGUAGE sql
AS $$
  UPDATE evolution_runs
  SET status = 'claimed',
      runner_id = p_runner_id,
      last_heartbeat = now(),
      started_at = now()
  WHERE id = (
    SELECT id FROM evolution_runs
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;
```

`FOR UPDATE SKIP LOCKED` ensures multiple concurrent claimers never grab the same run — locked rows are silently skipped.

### 4. GitHub Actions Workflow Changes (`.github/workflows/evolution-batch.yml`)

Add `parallel` input:

```yaml
workflow_dispatch:
  inputs:
    max-runs:
      description: 'Maximum runs to process'
      default: '10'
      type: string
    parallel:
      description: 'Concurrent runs'
      default: '5'
      type: string
    dry-run:
      description: 'Dry run (no LLM calls or DB writes)'
      default: false
      type: boolean
```

Update the run command:

```yaml
- name: Run evolution batch
  run: |
    PARALLEL="${{ inputs.parallel || '5' }}"
    MAX="${{ inputs.max-runs || '10' }}"
    npx tsx scripts/evolution-runner.ts --max-runs "$MAX" --parallel "$PARALLEL"
```

Keep the existing concurrency group — it prevents multiple workflow invocations (which would be redundant since parallelism is now in-process).

### 5. Dashboard "Start Batch" UI

The dashboard can't execute pipelines inline (Vercel 5-min serverless timeout). Instead, it dispatches the GitHub Actions workflow which runs on a 7-hour VM.

**Flow:**
```
Dashboard "Start Batch" button
  → dispatchEvolutionBatchAction(parallel, maxRuns)
    → GitHub API: POST /repos/{owner}/{repo}/actions/workflows/evolution-batch.yml/dispatches
      → GitHub Actions VM runs: evolution-runner.ts --parallel N --max-runs M
        → Runs appear in dashboard table with status updates (existing auto-refresh)
```

**New server action** (`src/lib/services/evolutionBatchActions.ts`):
```typescript
export async function dispatchEvolutionBatchAction(
  parallel: number, maxRuns: number, dryRun: boolean
): Promise<ActionResult<{ dispatched: true }>> {
  // POST to GitHub API to dispatch evolution-batch.yml workflow
  // Requires GITHUB_TOKEN env var with actions:write scope
}
```

**Dashboard UI changes** (`src/app/admin/quality/evolution/page.tsx`):
- "Start Batch" card with parallel (1-10), maxRuns, dryRun inputs
- "Trigger All Pending" convenience button (counts pending runs, dispatches with maxRuns=count)
- Success toast: "Batch dispatched — runs will appear as they're claimed"
- Disabled state when `GITHUB_TOKEN` not configured

**Environment requirements:**
- `GITHUB_TOKEN` — Fine-grained PAT with `actions:write` on the repo
- `GITHUB_REPO` — e.g., `Minddojo/explainanything` (or derived from git remote)

### 6. Testing

**Unit tests:**
- `scripts/evolution-runner.test.ts` — test `claimBatch()`, parallel loop logic, shutdown behavior
- `src/lib/services/llmSemaphore.test.ts` — test acquire/release, queue behavior, concurrency limiting
- `src/lib/services/evolutionBatchActions.test.ts` — test GitHub API dispatch, error handling

**Manual verification:**
- `npx tsx scripts/evolution-runner.ts --parallel 3 --dry-run --max-runs 6` — verify batch claiming
- Dashboard "Start Batch" → verify GitHub Actions workflow dispatched
- Monitor LLM call logs during real parallel execution to verify semaphore throttling

## Files Modified

| File | Change |
|------|--------|
| `scripts/evolution-runner.ts` | Add `--parallel`, `--max-concurrent-llm` flags, `claimBatch()`, parallel main loop |
| `src/lib/services/llmSemaphore.ts` | **NEW** — counting semaphore for LLM call throttling |
| `src/lib/services/llms.ts` | Integrate semaphore for `evolution_*` call sources |
| `.github/workflows/evolution-batch.yml` | Add `parallel` input, pass to runner |
| `supabase/migrations/YYYYMMDD_claim_evolution_run.sql` | **NEW** — atomic claim RPC |
| `src/lib/services/evolutionBatchActions.ts` | **NEW** — server action to dispatch GitHub Actions |
| `src/app/admin/quality/evolution/page.tsx` | Add "Start Batch" card and "Trigger All Pending" button |
| `scripts/evolution-runner.test.ts` | **NEW** — runner parallel logic tests |
| `src/lib/services/llmSemaphore.test.ts` | **NEW** — semaphore unit tests |
| `src/lib/services/evolutionBatchActions.test.ts` | **NEW** — batch dispatch action tests |

## Out of Scope

- Vercel cron parallelism (5-min timeout makes it impractical for full runs)
- Multi-provider routing (agentModels wiring) — separate project
- Global budget enforcement across concurrent runs
