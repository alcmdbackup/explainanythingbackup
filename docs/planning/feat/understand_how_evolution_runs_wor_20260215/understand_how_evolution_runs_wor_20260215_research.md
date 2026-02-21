# Research: How the Evolution Pipeline Processes Jobs (Updated 2026-02-16)

**Date**: 2026-02-16T23:58:51Z
**Git Commit**: 6aee6252d680f7c7102eac570dfadd08891260ae
**Branch**: feat/test_out_longer_running_evolution_pipelines_20261012

## Research Question

How does the evolution pipeline process jobs today? After they are started, how do they get picked up? What happens if they are long jobs? What happens if the server dies, on local? What happens in production?

## Summary

The evolution pipeline uses a **claim-execute-checkpoint-continue** architecture. Jobs are created in `pending` status, claimed atomically via a PostgreSQL RPC with `FOR UPDATE SKIP LOCKED`, executed through a multi-agent iteration loop with checkpoints after every agent. Long-running jobs use **continuation-passing**: the pipeline yields before the Vercel serverless timeout (740s of 800s max), saves full state to a checkpoint, transitions to `continuation_pending`, and the next cron invocation (every 5 min) resumes from that checkpoint. Server death is handled by a **watchdog cron** (every 15 min) that detects stale heartbeats and either recovers runs from their last checkpoint or marks them as failed. Max 10 continuations per run.

---

## 1. How Jobs Get Into the Queue

### Entry Points That Create Runs

| Entry Point | File | Creates DB Row? | Executes Inline? |
|-------------|------|-----------------|-------------------|
| **Admin UI** | `evolutionActions.ts:135` | Yes (queue) then triggers | Yes (inline) |
| **Auto-queue cron** | `content-quality-eval/route.ts:160` | Yes | No (waits for runner) |
| **Batch runner** | `evolution-runner.ts:50` | No (claims existing) | Yes |
| **Cron runner** | `evolution-runner/route.ts:24` | No (claims existing) | Yes |

### `queueEvolutionRunAction` — The Main Queue Path
**File:** `src/lib/services/evolutionActions.ts:135-268`

1. Validates inputs (needs `explanationId` OR `promptId`)
2. Fetches strategy config
3. Pre-flight cost check: estimates cost, rejects if > budget cap
4. Inserts into `content_evolution_runs` with `status='pending'`
5. Stores `estimated_cost_usd` and `cost_estimate_detail` JSONB

### Auto-Queue Cron (Low-Scoring Articles)
**File:** `src/app/api/cron/content-quality-eval/route.ts:120-183`

- Finds articles scoring < 0.4 on `overall` dimension
- Excludes articles with existing pending/claimed/running runs
- Queues up to 5 runs with $3.00 budget

---

## 2. How Jobs Get Picked Up (Claiming)

### Atomic Claim via RPC
**File:** `supabase/migrations/20260214000001_claim_evolution_run.sql`
**Updated in:** `supabase/migrations/20260216000001_add_continuation_pending_status.sql`

```sql
SELECT * FROM content_evolution_runs
WHERE status IN ('pending', 'continuation_pending')
ORDER BY
  CASE WHEN status = 'continuation_pending' THEN 0 ELSE 1 END,  -- priority
  created_at ASC
FOR UPDATE SKIP LOCKED
LIMIT 1;

UPDATE content_evolution_runs
SET status = 'claimed',
    runner_id = p_runner_id,
    last_heartbeat = NOW(),
    started_at = CASE WHEN started_at IS NULL THEN NOW() ELSE started_at END
WHERE id = v_run.id;
```

Key properties:
- **`FOR UPDATE SKIP LOCKED`**: Multiple parallel runners claim different runs without blocking
- **Priority**: `continuation_pending` runs claimed BEFORE `pending` (already invested cost)
- **Atomicity**: Claim + status update in single transaction
- **Fallback**: `scripts/evolution-runner.ts:61-102` has non-atomic fallback if RPC doesn't exist

### Who Claims vs Who Skips Claiming

| Runner | Claims? | Mechanism |
|--------|---------|-----------|
| Cron runner | Yes | `claim_evolution_run()` RPC |
| Batch runner | Yes | Same RPC, with non-atomic fallback |
| Admin UI trigger | No | Skips claiming, executes inline |

---

## 3. How Jobs Execute

### All Paths Converge on Two Functions

**`executeFullPipeline`** (`pipeline.ts:269`): Production path with PoolSupervisor for EXPANSION→COMPETITION phase transitions, checkpoints, convergence detection, continuation-passing.

**`executeMinimalPipeline`** (`pipeline.ts:171`): Simplified single-pass for testing — runs agents once, no phases.

### Per-Runner Execution Details

#### Admin UI Inline Trigger
- **File:** `evolutionActions.ts:511-623`
- Does NOT claim via RPC, does NOT set heartbeat
- Does NOT pass `maxDurationMs` → runs to completion or crash
- On error: catches and marks run `failed`

#### Cron Runner (Vercel Serverless) — Primary Production Path
- **File:** `src/app/api/cron/evolution-runner/route.ts`
- **Schedule:** Every 5 minutes (`vercel.json`)
- **maxDuration:** 800 seconds (Vercel Pro Fluid Compute max)
- **Pipeline max:** 740 seconds (800 - 60s buffer for claim/setup/cleanup)
- **Heartbeat:** 30 seconds
- **Supports both new runs and resumed runs** (via `continuation_count`)
- **Supports prompt-based and explanation-based runs**

#### Batch Runner (CLI / GitHub Actions)
- **File:** `scripts/evolution-runner.ts`
- **GitHub Actions:** `.github/workflows/evolution-batch.yml` (Monday 4 AM UTC, 7-hour timeout)
- **No time limit** (no `maxDurationMs` passed)
- **Heartbeat:** 60 seconds
- **Parallel:** `--parallel N` runs N pipelines concurrently
- **Also supports resume** via `continuation_count > 0`

### Resume Detection
All runners detect resume via:
```typescript
const isResume = (claimedRun.continuation_count ?? 0) > 0;
```
Resume path:
1. `loadCheckpointForResume(runId)` — queries `evolution_checkpoints` with `last_agent='iteration_complete'`
2. `prepareResumedPipelineRun()` — restores state, cost tracker, comparison cache
3. `executeFullPipeline()` with `supervisorResume`, `resumeComparisonCacheEntries`, `continuationCount`

---

## 4. Pipeline Iteration Loop

**File:** `src/lib/evolution/core/pipeline.ts:327-427`

```
for iteration in range(currentIteration, maxIterations):
  1. TIME CHECK: if elapsed + safetyMargin > maxDurationMs → break with 'continuation_timeout'
  2. KILL CHECK: query DB status, if 'failed' → break (externally killed)
  3. supervisor.beginIteration(state)
  4. config = supervisor.getPhaseConfig(state)  // EXPANSION or COMPETITION
  5. shouldStop check: budget exhausted, plateau, quality threshold
  6. For each agent in config.activeAgents:
       - Run agent → persist invocation → persist checkpoint
  7. Persist iteration-complete checkpoint with supervisor state
```

### Two Phases (PoolSupervisor, `supervisor.ts`)

**EXPANSION** (early iterations):
- Agents: generation, calibration (ranking), proximity
- Goal: Build pool quickly, focus on diversity
- 3x structural_transform if diversity low, else all 3 strategies

**COMPETITION** (later iterations):
- Agents: ALL enabled agents
- Goal: Refine winners with deep analysis
- Single rotated strategy per iteration
- Transition trigger: `poolSize >= minPool AND diversity >= threshold` OR iteration limit

**Agent Execution Order** (canonical, `supervisor.ts:72-78`):
```
generation → outlineGeneration → reflection → flowCritique
→ iterativeEditing → treeSearch → sectionDecomposition
→ debate → evolution
→ ranking (calibration/tournament depending on phase)
→ proximity → metaReview
```

### Stopping Conditions
1. **Quality threshold** (single-article only): All critique dimensions >= 8
2. **Quality plateau**: Top ordinal improves < 0.12 over last 3 iterations
3. **Budget exhausted**: Available < $0.01
4. **Max iterations**: Hard cap (default 15)
5. **External kill**: Admin sets status to `failed`

---

## 5. What Happens with Long-Running Jobs (Continuation-Passing)

### The Problem
Vercel cron has 800s max. Full pipeline runs can take 10-60 minutes.

### The Solution: Continuation-Passing (Implemented)

**Time Check** (`pipeline.ts:331-338`):
```typescript
if (options.maxDurationMs && options.startMs) {
  const elapsedMs = Date.now() - options.startMs;
  const safetyMarginMs = Math.min(120_000, Math.max(60_000, elapsedMs * 0.10));
  if (options.maxDurationMs - elapsedMs < safetyMarginMs) {
    stopReason = 'continuation_timeout';
    break;
  }
}
```

Safety margin: 60-120 seconds dynamic (10% of elapsed, clamped). This ensures the pipeline has time to save its checkpoint before Vercel kills the process.

**Yielding** (`persistence.ts:115-149`):
When `stopReason = 'continuation_timeout'`:
1. Serializes full state: pool, ratings, matches, critiques, diversity, supervisor state, cost tracker, comparison cache
2. Calls `checkpoint_and_continue` RPC (atomic PostgreSQL function):
   - Upserts checkpoint to `evolution_checkpoints` table with `last_agent='iteration_complete'`
   - Transitions status: `running → continuation_pending`
   - Increments `continuation_count`
   - Clears `runner_id = NULL` (so next runner can claim)
3. Run is now claimable by next cron invocation (within 5 minutes)

**Resuming** (`route.ts:50-102`):
1. Next cron claims `continuation_pending` run (prioritized over `pending`)
2. Loads latest checkpoint: `loadCheckpointForResume(runId)`
3. Restores full state, supervisor, cost tracker, comparison cache
4. Calls `executeFullPipeline()` with resume options
5. Pipeline continues from saved iteration

**Max continuations**: 10 (`pipeline.ts:283`). After 10, run is marked failed with `max_continuations_exceeded`.

### Example: A 30-Minute Run
```
Invocation 1: iterations 0-4  → checkpoint → continuation_pending (740s elapsed)
  [~5 min wait for next cron]
Invocation 2: iterations 5-9  → checkpoint → continuation_pending (740s elapsed)
  [~5 min wait]
Invocation 3: iterations 10-14 → convergence → completed
```

Total wall-clock: ~35 minutes. Actual compute: ~30 minutes.

### What Gets Serialized in Checkpoint
**File:** `state.ts:80-103`, `persistence.ts:115-149`

| Data | Description |
|------|-------------|
| `pool` | All TextVariation objects with parentIds lineage |
| `ratings` | OpenSkill mu/sigma per variant |
| `matchCounts`, `matchHistory` | Pairwise comparison results |
| `dimensionScores`, `allCritiques` | Quality dimension analysis |
| `similarityMatrix`, `diversityScore` | Pool diversity metrics |
| `metaFeedback`, `debateTranscripts` | Agent output data |
| `supervisorState` | Phase, strategyRotationIndex, ordinal/diversity history |
| `costTrackerTotalSpent` | Total USD spent so far |
| `comparisonCacheEntries` | Cached match results (avoid re-judging) |

---

## 6. What Happens When the Server Dies

### Heartbeat Mechanism

| Runner | Interval | Column |
|--------|----------|--------|
| Cron runner | 30 seconds | `last_heartbeat` |
| Batch runner | 60 seconds | `last_heartbeat` |
| Admin trigger | None | Not set |

### Watchdog: The Safety Net
**File:** `src/app/api/cron/evolution-watchdog/route.ts`
**Schedule:** Every 15 minutes

**Phase 1: Detect stale active runs**
- Queries `claimed/running` runs where `last_heartbeat < NOW() - 10 minutes`
- For each stale run:
  - If recent checkpoint exists (newer than last heartbeat) → recover to `continuation_pending`
  - If no recent checkpoint → mark `failed` with structured error

**Phase 2: Detect abandoned continuations**
- Queries `continuation_pending` runs where `last_heartbeat < NOW() - 30 minutes`
- Mark `failed` (never resumed, cron may be broken)

### Local Development: Server Crash

| Scenario | What Happens |
|----------|-------------|
| `next dev` crashes mid-run | Run stuck in `running`, heartbeat stale |
| Admin trigger (inline) | No heartbeat was set → same outcome |
| Recovery | Watchdog detects after 10 min, marks failed (or recovers if checkpoint exists) |
| No Supabase persistence | Run data lost entirely |

**Manual recovery:** No "Kill" button in admin UI. Must use direct DB update or `killEvolutionRunAction` server action (exists at `evolutionActions.ts:935-975` but not UI-exposed).

### Production (Vercel): Server Death

**Normal path (pipeline yields before timeout):**
1. At ~740s elapsed, pipeline detects approaching deadline
2. Calls `checkpoint_and_continue` RPC → saves checkpoint + transitions to `continuation_pending`
3. Returns response cleanly, process exits
4. Next cron (within 5 min) claims and resumes

**Abnormal path (process killed before checkpoint):**
1. Rare: happens only if checkpoint write takes >60s
2. Run stuck in `running` with stale heartbeat
3. Watchdog detects within 15 minutes
4. If checkpoint exists → recovers to `continuation_pending`
5. If no checkpoint → marks `failed`

### Recovery Timeline

| Event | Time | Action |
|-------|------|--------|
| Server dies | T+0 | Run stuck in `running` |
| Watchdog runs | T+15min max | Detects stale heartbeat |
| If checkpoint → continuation_pending | T+15min | Status transition |
| Next cron claims resumed run | T+20min max | Execution resumes |
| If no checkpoint → failed | T+15min | Run terminated |
| Abandoned continuation → failed | T+30min | Watchdog cleanup |

---

## 7. Status State Machine

```
pending ──claim RPC──> claimed ──pipeline start──> running
                                     │
                          ┌──────────┼──────────────┐
                          │          │              │
                    continuation  completed     failed
                     _timeout                  (error/crash)
                          │
                          v
                  continuation_pending ──claim──> claimed ──> running
                          │                                    │
                          └──30min watchdog──> failed           └──> (repeat)

running ──budget exceeded──> paused
running ──external kill──> failed (admin sets status)
```

All status transitions use guard clauses (`.eq('status', ...)` or `.in('status', [...])`) to prevent race conditions.

---

## 8. Infrastructure Comparison

| Aspect | Production (Vercel Cron) | Local (Admin Trigger) | Batch (GitHub Actions) |
|--------|--------------------------|----------------------|------------------------|
| **Entry Point** | `/api/cron/evolution-runner` | `triggerEvolutionRunAction` | `scripts/evolution-runner.ts` |
| **Schedule** | Every 5 minutes | Manual | Monday 4 AM UTC |
| **Max Duration** | 800s (13 min) | Unlimited | 420 min (7 hours) |
| **Runs per Invocation** | 1 | 1 | Configurable (default 10) |
| **Claiming** | Atomic RPC | None (inline) | Atomic RPC + fallback |
| **Heartbeat** | 30 seconds | None | 60 seconds |
| **Continuation** | Yes (yields at 740s) | No (runs to completion) | Supports resume but no timeout |
| **Recovery** | Watchdog + continuation | Manual only | Watchdog (if persisted to DB) |
| **Auth** | `CRON_SECRET` bearer token | Supabase auth | GitHub secrets |

---

## 9. Cost Tracking During Execution

**CostTracker** (`src/lib/evolution/core/costTracker.ts`):
- Budget cap: $5.00 default
- Per-agent caps: generation 20%, calibration 15%, etc.
- Safety margin: 30% on reservations (`estimate * 1.3`)
- FIFO reservation queue: `reserveBudget()` → execute → `recordSpend()` → release
- `BudgetExceededError` → run paused
- Total spend persisted in checkpoints for resume continuity

---

## 10. Post-Completion Data Flow

When a pipeline completes, `finalizePipelineRun()` runs:
1. Build run summary → `run_summary` JSONB
2. Persist variants → `content_evolution_variants` table
3. Persist agent metrics
4. Cost prediction (estimated vs actual)
5. Link strategy config
6. Auto-link prompt
7. Feed Hall of Fame → top 3 variants
8. Flush buffered logs

---

## Key Code References

| Component | File | Key Lines |
|-----------|------|-----------|
| Queue run | `src/lib/services/evolutionActions.ts` | 135-268 |
| Admin trigger | `src/lib/services/evolutionActions.ts` | 511-623 |
| Cron runner | `src/app/api/cron/evolution-runner/route.ts` | 1-290 |
| Watchdog | `src/app/api/cron/evolution-watchdog/route.ts` | 1-161 |
| Batch runner | `scripts/evolution-runner.ts` | 1-377 |
| Pipeline loop | `src/lib/evolution/core/pipeline.ts` | 269-478 |
| Supervisor | `src/lib/evolution/core/supervisor.ts` | 72-78, 146-154 |
| Checkpoint save | `src/lib/evolution/core/persistence.ts` | 115-149 |
| Checkpoint load | `src/lib/evolution/core/persistence.ts` | 160-196 |
| State serialization | `src/lib/evolution/core/state.ts` | 80-103 |
| Cost tracker | `src/lib/evolution/core/costTracker.ts` | - |
| Prepare run | `src/lib/evolution/index.ts` | 155-196 |
| Prepare resume | `src/lib/evolution/index.ts` | 226-270 |
| Claim RPC | `supabase/migrations/20260214000001_claim_evolution_run.sql` | 4-42 |
| Continuation RPC | `supabase/migrations/20260216000001_add_continuation_pending_status.sql` | 57-93 |
| Cron config | `vercel.json` | 2-6 |
| GH Actions batch | `.github/workflows/evolution-batch.yml` | 1-83 |

## Open Questions

1. The admin "Kill" action exists in code (`killEvolutionRunAction`) but is not exposed in the admin UI — how do operators kill a stuck run? (Likely via Supabase dashboard)
2. What happens if `checkpoint_and_continue` RPC itself fails (DB outage during yield)? The run would be stuck in `running` and caught by watchdog.
3. The batch runner supports `--parallel > 1`, sharing a global LLM semaphore (max 20 concurrent). Is this sufficient for parallel evolution runs?
