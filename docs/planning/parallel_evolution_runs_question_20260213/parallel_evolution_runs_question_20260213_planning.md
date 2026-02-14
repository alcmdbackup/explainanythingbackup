# Parallel Evolution Runs Plan

## Background
The evolution pipeline processes runs sequentially — the batch runner executes one at a time, Vercel cron claims one per invocation (with a 5-min timeout too short for most runs), and GitHub Actions runs the batch script in a single-threaded loop. Research confirmed the pipeline is fully isolated per-run (state, DB writes, cost tracking), so parallel execution is safe. The main bottleneck is LLM API rate limits.

## Requirements (from GH Issue #422)
- Can the current infrastructure run multiple evolution runs in parallel?
- What is the limiting factor on parallel runs?
- How to maximize speed running things in parallel?

## Problem
The batch runner (`scripts/evolution-runner.ts`) processes evolution runs sequentially in a while loop. With 5-10 pending runs at $3-5 budget each, sequential execution takes hours. The pipeline state is fully per-run isolated, but there's no mechanism to run multiple pipelines concurrently within a single process. Additionally, no rate limiting exists on LLM API calls — running multiple pipelines simultaneously without throttling would cause 429 rate limit errors from providers.

## Options Considered

1. **Approach A: `--parallel N` in runner script** (CHOSEN) — Add concurrency to the batch runner with an in-process LLM semaphore. Works in GitHub Actions and locally. Single npm install, single process.

2. **Approach B: GitHub Actions matrix jobs** (rejected) — Spawn N parallel workflow jobs, each running the existing sequential script. Simpler (YAML only) but wastes time on N separate npm installs (~2-3 min each) and provides no rate limit control.

3. **Multiple separate processes** (rejected as primary approach) — Launch N batch runner processes manually. Works today with no code changes but provides no rate limiting and no coordination.

## Phased Execution Plan

### Phase 1: LLM Call Semaphore
**Goal**: Add rate limiting infrastructure that prevents API 429 storms.

**Files:**
- **NEW** `src/lib/services/llmSemaphore.ts` — Counting semaphore class
- **MODIFY** `src/lib/services/llms.ts` — Integrate semaphore for `evolution_*` call sources
- **NEW** `src/lib/services/llmSemaphore.test.ts` — Unit tests

**Implementation:**
1. Create `LLMSemaphore` class with `acquire()` / `release()` methods and a FIFO wait queue
2. Export a module-level singleton initialized from `EVOLUTION_MAX_CONCURRENT_LLM` env var (default: 20)
3. In `callLLMModelRaw()` (`llms.ts`), wrap the API call with semaphore acquire/release when `call_source.startsWith('evolution_')`
4. Write unit tests: concurrent acquire up to limit, queue beyond limit, release unblocks waiters, FIFO ordering

**Verification:** Existing evolution unit tests still pass. Semaphore tests pass.

### Phase 2: Atomic Run Claiming (SQL Migration)
**Goal**: Implement the `claim_evolution_run` RPC that the batch runner already references but doesn't exist.

**Files:**
- **NEW** `supabase/migrations/YYYYMMDD_claim_evolution_run.sql`

**Implementation:**
1. Create `claim_evolution_run(p_runner_id TEXT)` function using `FOR UPDATE SKIP LOCKED`
2. Returns the claimed run row or empty set if none available

**Verification:** Apply migration locally. Test claiming via Supabase dashboard or script.

### Phase 3: Parallel Runner Loop
**Goal**: Add `--parallel N` flag to the batch runner.

**Files:**
- **MODIFY** `scripts/evolution-runner.ts` — Add flags, `claimBatch()`, parallel main loop
- **NEW** `scripts/evolution-runner.test.ts` — Unit tests for parallel logic (or extend existing test file)

**Implementation:**
1. Add `--parallel N` (default: 1) and `--max-concurrent-llm N` (default: 20) CLI flag parsing
2. Initialize the LLM semaphore with the `--max-concurrent-llm` value
3. Add `claimBatch(n)` function — serial loop of `claimNextRun()` up to N times
4. Replace the sequential main loop with: claim batch → `Promise.allSettled(batch.map(executeRun))` → log results → repeat
5. Update logging to include parallel count and per-run result status
6. Write unit tests: batch claiming, parallel execution, shutdown mid-batch

**Verification:**
```bash
# Dry run: verify 3 runs claimed per batch
npx tsx scripts/evolution-runner.ts --parallel 3 --dry-run --max-runs 6
```

### Phase 4: GitHub Actions Workflow
**Goal**: Expose `--parallel` in the CI workflow.

**Files:**
- **MODIFY** `.github/workflows/evolution-batch.yml`

**Implementation:**
1. Add `parallel` input to `workflow_dispatch` (default: `'5'`)
2. Pass `--parallel` flag to the runner command
3. Keep existing concurrency group

**Verification:** Manual dispatch with `parallel: 2`, `max-runs: 4`, `dry-run: true`.

### Phase 5: Dashboard "Start Batch" UI
**Goal**: Allow admins to dispatch parallel batch execution from the dashboard.

The dashboard can't execute pipelines inline (Vercel 5-min serverless timeout). Instead, it dispatches the GitHub Actions workflow which runs on a 7-hour VM.

**Flow:**
```
Dashboard "Start Batch" button
  → dispatchEvolutionBatchAction(parallel, maxRuns)
    → GitHub API: POST /repos/{owner}/{repo}/actions/workflows/evolution-batch.yml/dispatches
      → GitHub Actions VM runs: evolution-runner.ts --parallel N --max-runs M
        → Runs appear in dashboard table with status updates (existing auto-refresh)
```

**Files:**
- **NEW** `src/lib/services/evolutionBatchActions.ts` — Server action to dispatch GitHub Actions workflow
- **MODIFY** `src/app/admin/quality/evolution/page.tsx` — Add "Start Batch" card/button with parallel and maxRuns inputs
- **MODIFY** `src/app/admin/quality/evolution/page.tsx` — Add "Trigger All Pending" button that dispatches batch for all pending runs

**Implementation:**
1. Create `dispatchEvolutionBatchAction(parallel: number, maxRuns: number, dryRun: boolean)` server action:
   - Calls GitHub REST API: `POST /repos/{owner}/{repo}/actions/workflows/evolution-batch.yml/dispatches`
   - Passes `inputs: { parallel, 'max-runs': maxRuns, 'dry-run': dryRun }` as workflow dispatch inputs
   - Requires `GITHUB_TOKEN` env var with `actions:write` scope (fine-grained PAT or GitHub App token)
   - Returns success/error status
2. Add "Start Batch" UI to the evolution admin page:
   - Parallel count input (default: 5, range 1-10)
   - Max runs input (default: 10)
   - Dry run checkbox
   - "Dispatch Batch" button
   - Success toast: "Batch dispatched — runs will appear as they're claimed"
3. Add "Trigger All Pending" convenience button:
   - Counts pending runs, dispatches batch with `maxRuns = pendingCount`
   - Disabled when no pending runs exist

**Environment setup:**
- Add `GITHUB_TOKEN` to Vercel environment variables (fine-grained PAT with `actions:write` on the repo)
- Add `GITHUB_REPO` env var (e.g., `Minddojo/explainanything`) or derive from git remote

**Verification:**
- Click "Start Batch" with parallel=2, maxRuns=4, dryRun=true
- Verify GitHub Actions workflow is dispatched (check Actions tab)
- Verify runs table updates as the batch runner processes them

### Phase 6: Documentation
**Goal**: Update relevant docs with parallel execution information.

**Files:**
- `docs/evolution/reference.md` — Add `--parallel` flag docs, `EVOLUTION_MAX_CONCURRENT_LLM` env var, `claim_evolution_run` RPC, dashboard batch dispatch
- `docs/evolution/architecture.md` — Add note about parallel run support and rate limiting

## Testing

### Unit Tests (new)
- `src/lib/services/llmSemaphore.test.ts` — Semaphore acquire/release, queue, concurrency limit, FIFO
- `scripts/evolution-runner.test.ts` — `claimBatch()`, parallel loop, shutdown behavior

### Existing Tests (must still pass)
- `src/lib/evolution/agents/*.test.ts` — All agent tests (semaphore transparent to them)
- `src/lib/services/llms.test.ts` — LLM service tests (if exists)
- `scripts/evolution-runner.test.ts` — Existing runner tests (if exists)

### Manual Verification
1. `--parallel 3 --dry-run --max-runs 6` — verify batch claiming and parallel "execution"
2. `--parallel 2 --max-runs 4` with real runs — monitor logs for rate limit errors
3. GitHub Actions manual dispatch with `parallel: 3`
4. Dashboard "Start Batch" button → verify GitHub Actions workflow dispatched and runs process

## Documentation Updates
The following docs need updates:
- `docs/evolution/reference.md` — Add `--parallel` CLI flag, `EVOLUTION_MAX_CONCURRENT_LLM` env var, `claim_evolution_run` RPC, dashboard batch dispatch
- `docs/evolution/architecture.md` — Add brief note that parallel execution is supported and rate-limited
