# No Tasks Articles Found Production Research

**Date**: 2026-02-18T23:33:22Z
**Git Commit**: 1101fcb66ba6f75e2eb30db637e25d651ca3d1a6
**Branch**: fix/no_tasks_articles_found_production_20260218

## Problem Statement
The article and task tabs under "explorer" in production currently have no data. The "task" tab needs to be renamed to "agents", and both tabs need to be fixed to correctly populate with data.

## Requirements (from GH Issue #467)
1. Rename the "task" tab to "agents" under explorer
2. Fix the articles tab to display data correctly in production
3. Fix the agents (formerly tasks) tab to display data correctly in production

## Root Cause Summary

The explorer's Article and Task tabs are blank because **no evolution run has ever completed in production**. Variants and agent metrics are only persisted to the database during `finalizePipelineRun()`, which only executes when a run reaches `completed` status. All 10 production runs are either `failed` (8) or `pending` (2).

### Data exists — but it's trapped
The pipeline generates variants successfully (confirmed in checkpoint `state_snapshot` JSONB blobs), but they never get written to `content_evolution_variants` or `evolution_run_agent_metrics` because runs die before completion.

### Production Database State (as of 2026-02-18)

| Metric | Value |
|--------|-------|
| Total runs | 10 |
| Completed runs | 0 |
| Failed runs | 8 |
| Pending runs | 2 |
| Rows in `content_evolution_variants` | 0 |
| Rows in `evolution_run_agent_metrics` | 0 |
| Rows in `evolution_checkpoints` | 50+ (variants exist in state_snapshot JSONB) |

---

## Detailed Findings

### 1. Explorer Page Location and Structure

**Route**: `/admin/quality/explorer`
**File**: `src/app/admin/quality/explorer/page.tsx` (client component, ~1240 lines)

The page has:
- **3 view modes**: Table, Matrix, Trend (controlled by `ViewMode` type)
- **3 unit-of-analysis tabs** (only visible in table view): Run, Article, Task
- **Multi-dimensional filtering**: prompts, strategies, pipeline types, date ranges
- **URL state sync**: all filter/view state persisted in URL params

Tab config at lines 120-124:
```typescript
const UNITS: { id: UnitOfAnalysis; label: string }[] = [
  { id: 'run', label: 'Run' },
  { id: 'article', label: 'Article' },
  { id: 'task', label: 'Task' },       // ← rename to 'Agents'
];
```

### 2. Data Fetching Architecture

**Service file**: `src/lib/services/unifiedExplorerActions.ts` (~800 lines, `'use server'`)

All actions use:
- `createSupabaseServiceClient()` — service role, bypasses any RLS
- `requireAdmin()` — only admin users can call these actions

#### Article Tab Data Flow (lines 296-380):
1. Query `content_evolution_runs` with all filters → get list of run IDs
2. **If runIdList is empty → return `{ articles: [], ... }`** ← early exit
3. Query `content_evolution_variants` filtered by run IDs, with optional agent/variant filters
4. Enrich with hall-of-fame rank and prompt text
5. Return `ExplorerArticleRow[]`

#### Task Tab Data Flow (lines 382-450):
1. Query `content_evolution_runs` with all filters → get list of run IDs
2. **If runIdList is empty → return `{ tasks: [], ... }`** ← early exit
3. Query `evolution_run_agent_metrics` filtered by run IDs, with optional agent filter
4. Enrich with prompt text
5. Return `ExplorerTaskRow[]`

### 3. Database Tables

| Table | Migration | Purpose |
|-------|-----------|---------|
| `content_evolution_runs` | `20260131000001` | Evolution pipeline runs |
| `content_evolution_variants` | `20260131000002` | Generated text variants with Elo scores |
| `evolution_run_agent_metrics` | `20260205000001` | Per-agent cost/Elo metrics |

**No RLS policies** exist on any evolution tables.

### 4. Environment Configuration

From `docs/docs_overall/environments.md`:
- **Dev DB** (`ifubinffdbyewoezcidz`): Used by local, tests, CI, Vercel preview
- **Prod DB** (`qbxhivoezkfbjbsctdzo`): Used by Vercel production only
- Evolution batch runner (`evolution-batch.yml`): Uses **Development environment secrets** → targets dev DB only

### 5. Pipeline Persistence Architecture

**Critical design**: Variants and agent metrics are only written to the database on **successful run completion**, inside `finalizePipelineRun()` in `persistence.ts`. During continuation checkpoints, data lives only in `evolution_checkpoints.state_snapshot` JSONB.

```
executeFullPipeline (pipeline.ts)
  └─ finalizePipelineRun (persistence.ts) — ONLY on stopReason != 'continuation_timeout'
       ├─ persistVariants → content_evolution_variants
       └─ persistAgentMetrics → evolution_run_agent_metrics
```

This means if a run never reaches `completed`, its generated variants are forever trapped in checkpoint JSONB.

### 6. Vercel Timeout & Continuation Mechanism

| Setting | Value |
|---------|-------|
| `maxDuration` (Vercel route config) | 800s (~13 min) |
| Pipeline compute budget | 740s (~12.3 min, after 60s buffer) |
| Cron schedule | Every 5 minutes |
| Watchdog schedule | Every 15 minutes |
| Watchdog heartbeat threshold | 10 minutes |
| Continuation abandonment threshold | 30 minutes |
| Max continuations per run | 10 |

**Continuation lifecycle:**
1. Cron claims oldest `pending` or `continuation_pending` run (atomic `SKIP LOCKED`)
2. Pipeline runs for up to 740s
3. Before soft timeout → `stopReason = 'continuation_timeout'`
4. Checkpoint full state + set `status = 'continuation_pending'`, increment `continuation_count`
5. Next cron tick (5 min later) picks it up and resumes from checkpoint
6. Watchdog recovers runs that were hard-killed (no checkpoint) or abandoned

### 7. Why Runs Fail — Failure Analysis by Cohort

#### Feb 13 runs (5 runs): Immediate startup failure
- All at iteration 0, no checkpoints, $0.00 cost, no phase
- `config = {}` (empty) — likely missing configuration at pipeline creation time

#### Feb 14 run `50140d27`: EXPANSION completed, never reached COMPETITION
- Completed 5 EXPANSION iterations in ~4.5 minutes
- $0.00 cost — suggests mocked or dry-run mode
- Has 3 variants in checkpoint `state_snapshot` but `total_variants = 0` on run row
- Died after EXPANSION without transitioning to COMPETITION or finalizing

#### Feb 16 runs (2 runs): Died mid-COMPETITION after ~5 minutes
- `8cb82822`: Completed iteration 1 (all agents including tournament), started iteration 2, died at `generation` agent
- `30a08545`: Died mid-iteration 1, got through 6 agents but never reached `tournament`
- Both started within 14 seconds of each other (separate cron invocations)
- Both died around the same time (~23:45 UTC), suggesting a shared external cause
- **Not the Vercel timeout** — 5 minutes is well under both the 800s hard limit and 740s soft limit

#### Feb 18 runs (2 runs): Currently pending with checkpoints
- `30d01212` and `0197aa4b`: status='pending' with 9+ checkpoints each
- All checkpoints in COMPETITION iteration 1, spanning 23:02-23:07 UTC
- Status being `pending` despite having checkpoints is suspicious — may indicate status-guard race condition

### 8. Identified Bugs

#### Bug 1: No intermediate heartbeats during tournament execution
The tournament agent makes ~80 parallel LLM calls in a single `agent.execute()` call. `persistCheckpoint` only fires AFTER `agent.execute()` returns. During long tournaments, neither the heartbeat interval nor checkpoint writes update the heartbeat, potentially triggering the 10-minute watchdog.

**Files**: `src/lib/evolution/agents/tournament.ts`, `src/lib/evolution/core/pipeline.ts`

#### Bug 2: Status guard chain silently swallows failures
All status updates use `.in('status', [...])` guards that silently no-op if the status doesn't match. If the initial `claimed→running` transition no-ops (race with watchdog), ALL subsequent status writes also no-op, and the run ends without being marked `completed`.

**File**: `src/lib/evolution/core/pipeline.ts` (lines 291-295, 437-448)

#### Bug 3: `checkpoint_and_continue` RPC throws on status mismatch
The `checkpoint_and_continue` Postgres RPC requires `status = 'running'`. If the watchdog changes the status between pipeline execution and checkpoint write, the RPC throws, causing the pipeline to mark the run `failed`.

**File**: `supabase/migrations/20260216000001_add_continuation_pending_status.sql`

#### Bug 4: Double-write of `error_message` on failure
`markRunFailed` in `persistence.ts` writes `error_message` first, then the cron route's catch block tries to write again with `.in('status', ['running', 'claimed'])` — this second write is usually a no-op (already `failed`), but the first write's `error_message` may be overwritten if timing allows.

**Files**: `src/lib/evolution/core/persistence.ts`, `src/app/api/cron/evolution-runner/route.ts`

### 9. Empty State Rendering

Each table component has an explicit empty state message:
- `RunTable` (line 910): "No runs found. Adjust filters to see results."
- `ArticleTable` (line 969): "No articles found. Adjust filters to see results."
- `TaskTable` (line 1033): "No tasks found. Adjust filters to see results."

### 10. Page Subtitle Reference

Line 660: `"Cross-dimensional analysis of evolution runs, articles, and tasks"` — should update "tasks" → "agents" here.

---

### 11. Vercel Timeout Was the Root Cause

**All 8 failed runs have `error_message = null` and `completed_at = null`.** This proves that neither `markRunFailed()` (persistence.ts) nor the cron catch block ever executed — the Vercel function was **hard-killed** before any JavaScript cleanup could run.

**Evidence:**
- `markRunFailed()` sets both `error_message` and `completed_at` — neither is set
- The cron catch block sets `error_message` — not set
- The watchdog sets `error_message` with structured JSON — not set
- Feb 16 runs both died at exactly ~5 minutes (300s = Vercel Pro timeout without Fluid Compute)

**Resolution:** Fluid Compute was enabled and timeout set to 800s in the Vercel dashboard on 2026-02-18. This is a project-wide setting (affects all environments). Requires redeployment to take effect.

### 12. Tournament Agent Timeout Risk Analysis

**File**: `src/lib/evolution/agents/tournament.ts`

The tournament agent runs a Swiss-style ranking with up to 50 rounds. Each round:
1. Swiss pairing (O(n²) candidate scoring, greedy selection)
2. Parallel LLM calls via `Promise.allSettled` — 2 calls per pair (bias mitigation) + optional tiebreaker
3. Optional flow comparison (doubles LLM calls if enabled)
4. Rating update + convergence check

With `maxComparisons = 40` (low budget pressure), that's 80+ LLM calls minimum. At 2-5s per call in parallel batches, a full tournament takes 2-10 minutes depending on pool size and API latency.

**The pipeline's timeout check only fires between iterations, not between agents.** If the tournament starts with 8 minutes remaining and takes 10 minutes, the function gets hard-killed with no checkpoint.

**Tournament exit conditions (5 existing):**
1. `maxComparisons` reached → `exitReason = 'budget'`
2. `convergenceChecks` consecutive convergent rounds → `exitReason = 'convergence'`
3. `maxStaleRounds` with no new pairings → `exitReason = 'stale'`
4. `maxRounds` loop exhaustion → `exitReason = 'maxRounds'`
5. `BudgetExceededError` from cost tracker → throws

**No time-based exit exists.** The tournament has no awareness of the Vercel function deadline.

### 13. Proposed Solution: Time-Aware Tournament

**Approach:** Add a 6th exit condition — `exitReason = 'time_limit'` — checked between rounds.

The tournament's round-based structure is ideal for this. State (`ratings`, `matchHistory`, `matchCounts`) is mutated in-place after each round, so partial results are fully valid. A tournament that completes 20 of 40 comparisons still produces meaningful ratings.

**Implementation:**

1. Add `timeContext` to `ExecutionContext`:
```typescript
// In types.ts
interface ExecutionContext {
  // ... existing fields ...
  timeContext?: {
    startMs: number;
    maxDurationMs: number;
  };
}
```

2. Add time check in tournament loop (between rounds, line ~244):
```typescript
// In tournament.ts execute(), inside the round loop:
if (ctx.timeContext) {
  const elapsed = Date.now() - ctx.timeContext.startMs;
  const remaining = ctx.timeContext.maxDurationMs - elapsed;
  // Reserve 120s for post-tournament checkpoint + cleanup
  if (remaining < 120_000) {
    logger.info('Tournament yielding due to time pressure', {
      round, elapsed, remaining, comparisons: totalComparisons,
    });
    exitReason = 'time_limit';
    break;
  }
}
```

3. Pipeline passes time context when calling agents:
```typescript
// In pipeline.ts, before agent execution:
ctx.timeContext = options.startMs && options.maxDurationMs
  ? { startMs: options.startMs, maxDurationMs: options.maxDurationMs }
  : undefined;
```

**Why this works:**
- Tournament returns early with partial-but-valid results (ratings updated in-place after each round)
- Remaining fast agents (proximity, meta_review) complete the iteration within the time buffer
- Pipeline writes `iteration_complete` checkpoint
- Next iteration starts → pipeline-level time check fires → `continuation_timeout`
- `checkpointAndMarkContinuationPending()` saves full state including partial ratings
- On resume, `loadCheckpointForResume` finds `iteration_complete` checkpoint
- Pipeline resumes at next iteration; tournament runs again with already-refined ratings

**Fallback:** The 30s heartbeat interval in the cron route also helps — it runs independently of agent execution, keeping the watchdog from killing runs that are making progress.

### 14. Tournament Resume from Checkpoint — Pair Skipping

**Problem:** Currently the tournament initializes `completedPairs = new Set()` fresh on every `execute()` call (line 235). On resume, it has no memory of which pairs were already compared, causing redundant LLM calls.

**Solution:** `state.matchHistory` is already checkpointed (state.ts:92, 128) and `Match` stores both `variationA` and `variationB` IDs (types.ts:97-99). Reconstruct `completedPairs` from matchHistory at tournament start:

```typescript
// Current (loses memory):
const completedPairs = new Set<string>();

// Fixed (reconstructs from checkpoint):
const completedPairs = new Set<string>();
for (const match of state.matchHistory) {
  completedPairs.add(normalizePair(match.variationA, match.variationB));
}
```

**What's preserved vs reset on resume:**

| Tournament state | Preserved? | How |
|---|---|---|
| `completedPairs` | Yes (after fix) | Reconstructed from `state.matchHistory` |
| `ratings` (mu/sigma) | Yes | Checkpointed in `state.ratings` |
| `matchCounts` | Yes | Checkpointed in `state.matchCounts` |
| `matchHistory` | Yes | Checkpointed directly |
| `totalComparisons` | Reset to 0 | Fresh budget per invocation — completedPairs prevents waste |
| `convergenceStreak` | Reset to 0 | Reconverges quickly since sigmas already low |
| `multiTurnCount` | Reset to 0 | Budget optimization, not correctness |

**Resume flow example:**
```
INVOCATION 1 (~12 min):
  Iteration 1: agents → tournament (25/40 comparisons, time_limit exit)
    → remaining fast agents → iteration_complete checkpoint
  Iteration 2: time check → continuation_timeout → checkpoint

INVOCATION 2 (5 min later):
  Resume from iteration 1 iteration_complete checkpoint → starts iteration 2
  Iteration 2: agents → tournament
    → reconstructs 25 completedPairs from matchHistory
    → Swiss pairing generates only NEW pairs
    → 15 more comparisons → convergence! → exitReason='convergence'
    → iteration_complete checkpoint
  ...continues → finalizePipelineRun → persistVariants ✓
```

**Key insight:** Swiss pairing already excludes `completedPairs` (tournament.ts:93). By reconstructing this set from checkpointed `matchHistory`, the tournament naturally avoids re-doing work. Combined with already-reduced sigmas from prior rounds, convergence detection triggers faster on resume.

## Key Questions Still Open

1. **Should the `UnitOfAnalysis` type value change from `'task'` to `'agent'`, or just the display label?**
2. **Should we also add time-awareness to other long-running agents?** (debate, sectionDecomposition could also be slow)
3. **Should variants be persisted incrementally during checkpoints?** Currently they're only written at finalization. Incremental persistence would make Article tab show data even for in-progress runs.

## Proposed Fix Strategy

### Phase 1: Immediate (unblock production)
1. **Confirm Fluid Compute + 800s timeout takes effect** — redeploy and monitor next cron run
2. **Rename "Task" → "Agents"** in UI labels
3. **Clean up stale runs** — mark the 8 failed and 2 orphaned pending runs

### Phase 2: Robustness (prevent recurrence)
4. **Time-aware tournament** — add `timeContext` to ExecutionContext and `time_limit` exit to tournament
5. **Heartbeat during long agents** — tournament can call a heartbeat callback between rounds
6. **Status guard assertions** — `.in('status', [...])` should check affected row count and log/throw on no-op

### Phase 3: Data visibility improvements
7. **Incremental variant persistence** — write variants during checkpoint, not just finalization
8. **Explorer shows in-progress runs** — Article/Task tabs could query checkpoint state_snapshot for active runs

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/feature_deep_dives/search_generation_pipeline.md
- docs/feature_deep_dives/authentication_rls.md
- docs/docs_overall/environments.md
- docs/feature_deep_dives/error_handling.md
- docs/feature_deep_dives/vector_search_embedding.md
- docs/feature_deep_dives/admin_panel.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/explanation_summaries.md

## Code Files Read
- `src/app/admin/quality/explorer/page.tsx` — explorer page component
- `src/lib/services/unifiedExplorerActions.ts` — server actions for explorer data
- `src/lib/evolution/core/pipeline.ts` — main pipeline loop, continuation logic
- `src/lib/evolution/core/persistence.ts` — variant/metric persistence, markRunFailed
- `src/lib/evolution/core/metricsWriter.ts` — agent metrics persistence
- `src/lib/evolution/agents/tournament.ts` — tournament agent (long-running)
- `src/app/api/cron/evolution-runner/route.ts` — cron route, claiming, error handling
- `src/app/api/cron/evolution-watchdog/route.ts` — watchdog for stale runs
- `supabase/migrations/20260131000001_content_evolution_runs.sql` — runs table
- `supabase/migrations/20260131000002_content_evolution_variants.sql` — variants table
- `supabase/migrations/20260205000001_add_evolution_run_agent_metrics.sql` — agent metrics table
- `supabase/migrations/20260216000001_add_continuation_pending_status.sql` — continuation RPC
- `vercel.json` — cron schedules
