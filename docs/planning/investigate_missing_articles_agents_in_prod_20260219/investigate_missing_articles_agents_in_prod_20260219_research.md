# Investigate Missing Articles Agents In Prod Research

## Problem Statement
Articles and agents are missing or not showing up in the production evolution dashboard. The evolution tab displays no articles or agents, suggesting either data is not being persisted, dashboard queries are filtering incorrectly, or the evolution pipeline is not running in production.

## Requirements (from GH Issue #482)
There are no articles or agents showing up under evolution tab of prod evolution dashboard. Give me queries to debug this.

## High Level Summary

**Root cause identified**: `triggerEvolutionRunAction` (inline admin trigger) calls `executeFullPipeline` without first calling the `claim_evolution_run` RPC. This means runs execute with `status='pending'` throughout their lifecycle, and every downstream status guard silently no-ops — preventing runs from ever reaching `completed` status. Since dashboard article/agent data is only written on completion, the dashboard shows empty.

### Key Facts
- 12 total runs: 10 failed, 2 stuck in pending
- 0 completed runs → 0 variants persisted → 0 agent metrics → empty dashboard
- All failed runs have `error_message: NULL` (status guards prevented error capture too)
- 11 of 12 runs have `started_at: NULL` (claim RPC never ran)
- The 2 pending runs have checkpoints at iteration 2 and recent heartbeats — the pipeline IS executing, just with broken status

---

## Production Data Analysis

### Query 1: Run Status Distribution
```
| status  | count | earliest                  | latest                    |
| failed  | 10    | 2026-02-13 23:21:07+00    | 2026-02-18 23:02:08+00    |
| pending | 2     | 2026-02-20 06:04:15+00    | 2026-02-20 06:04:29+00    |
```
Zero completed runs — explains empty dashboard entirely.

### Query 2: Failed Run Details
- 4 runs failed at EXPANSION iteration 0, no heartbeat → crashed before first agent
- 2 runs failed at EXPANSION iteration 5 → ran for a while then died
- 4 runs failed at COMPETITION iteration 1-2 → transitioned phase but died
- All have `error_message: NULL` and `runner_id: NULL`

### Query 3: The 2 "Pending" Runs (Stuck)
```
| id       | status  | phase       | current_iteration | started_at | runner_id | last_heartbeat         |
| 7496e0fa | pending | COMPETITION | 2                 | null       | null      | 2026-02-20 06:16:37+00 |
| 47e5de4b | pending | COMPETITION | 2                 | null       | null      | 2026-02-20 06:17:43+00 |
```
Both use `deepseek-chat` as generation and judge model, `explanation_id: null` (prompt-based runs), `maxIterations: 5`.

### Query 4-5: No Variants or Agent Metrics
- `evolution_variants`: 0 rows (only written on completion)
- `evolution_run_agent_metrics`: 0 rows (only written on completion)

### Query 6: Checkpoints Exist
The 2 pending runs have checkpoints through iteration 2, with agents: generation → outlineGeneration → reflection → flowCritique → iterativeEditing → treeSearch → sectionDecomposition. The pipeline IS executing successfully — it just can't complete.

### Query 7: started_at Confirms Missing Claim
11 of 12 runs have `started_at: NULL`. The `claim_evolution_run` RPC sets `started_at = NOW()`, proving the RPC was never called. The 1 run with `started_at` (Feb 14, id `50140d27`) went through the cron path correctly.

---

## Root Cause Analysis

### The Bug: Missing Claim Step in triggerEvolutionRunAction

**File**: `evolution/src/services/evolutionActions.ts` ~line 592

`triggerEvolutionRunAction` calls `executeFullPipeline` directly without calling `claim_evolution_run` RPC first. The pipeline expects `status='claimed'` to transition to `running`.

#### Bug Chain
```
triggerEvolutionRunAction(runId)
  │ reads run with status='pending'
  │ does NOT call claim_evolution_run RPC   ← BUG
  │
  └─ executeFullPipeline(runId, ...)
       │ UPDATE SET status='running' WHERE status IN ('claimed')   ← silent no-op
       │ pipeline runs agents, writes checkpoints ✓
       │ Vercel timeout approaches...
       │ checkpoint_and_continue RPC WHERE status='running'        ← silent no-op
       │ function dies
       │
       └─ watchdog checks status IN ('claimed','running')          ← misses 'pending'
          run is orphaned forever
```

### Three Cascading Failures

**1. Status never transitions from pending**
- `executeFullPipeline` (pipeline.ts:307): `WHERE status IN ('claimed')` → no-op when pending
- `executeFullPipeline` completion (pipeline.ts:461): `WHERE status IN ('running')` → no-op
- Run stays `pending` from creation to death

**2. Continuation mechanism broken**
- `checkpoint_and_continue` RPC: `WHERE status = 'running'` → throws exception when pending
- Pipeline can't yield at Vercel timeout → function dies silently

**3. Watchdog blind to pending runs**
- Watchdog query: `status IN ('claimed','running') AND last_heartbeat < cutoff`
- Pending runs with stale heartbeats are invisible
- Additionally, freshly queued runs have `last_heartbeat = NULL` → Postgres `< cutoff` evaluates to UNKNOWN for NULL → excluded

### Why error_message is NULL
When any `UPDATE ... WHERE status IN (...)` guard doesn't match the actual status, the entire UPDATE no-ops — including the `error_message` write. Since status is stuck at `pending`, most error-capture paths fail silently.

---

## Dashboard Query Architecture

### Two Dashboard Pages
1. **Pipeline Runs** (`/admin/quality/evolution`) — default 30-day date filter, calls `getEvolutionRunsAction`
2. **Unified Explorer** (`/admin/quality/explorer`) — has article/agent/run unit tabs, calls `getUnifiedExplorerAction`

### Why Articles Tab is Empty
- `getUnifiedExplorerAction` article mode queries `evolution_variants` directly
- This table only has rows for **completed** runs (written by `finalizePipelineRun`)
- 0 completed runs → 0 rows → empty articles tab

### Why Agents Tab is Empty
- Agent/task mode queries `evolution_run_agent_metrics`
- Metrics written at run completion by `finalizePipelineRun`
- 0 completed runs → 0 rows → empty agents tab

### Additional Filters That Could Hide Data
- Matrix and Trend views hardcode `status = 'completed'` filter
- Prompt dropdown filters by `status = 'active'` and `deleted_at IS NULL`
- Strategy dropdown filters by `status = 'active'`
- Pipeline runs page defaults to 30-day date range

---

## Complete Status Guard Map

| Location | File | Guard (WHERE status IN ...) | Transition |
|----------|------|-----------------------------|------------|
| `claim_evolution_run` RPC | migration 20260216000001 | `('pending','continuation_pending')` | → claimed |
| Pipeline start | pipeline.ts:307 | `('claimed')` | → running |
| `checkpoint_and_continue` RPC | migration 20260216000001 | `= 'running'` | → continuation_pending |
| Pipeline completion | pipeline.ts:461 | `('running')` | → completed |
| `markRunFailed` (persistence) | persistence.ts:101 | `('pending','claimed','running','continuation_pending')` | → failed |
| `markRunFailed` (route.ts catch) | route.ts:208 | `('running','claimed')` | → failed |
| Watchdog stale detection | watchdog/route.ts:35 | `('claimed','running')` + `lt(heartbeat)` | detects stale |
| Watchdog fail | watchdog/route.ts:87 | no guard | → failed |
| Watchdog continuation recovery | watchdog/route.ts | `('running','claimed')` | → continuation_pending |

---

## Proposed Fix

### Fix 1: Add claim step to triggerEvolutionRunAction
In `evolution/src/services/evolutionActions.ts` ~line 592, before `executeFullPipeline`:
```typescript
await supabase.from('evolution_runs').update({
  status: 'claimed',
  runner_id: 'inline-trigger',
  last_heartbeat: new Date().toISOString(),
  started_at: new Date().toISOString(),
}).eq('id', runId).eq('status', 'pending');
```

### Fix 2: Recover stuck pending runs
```sql
-- Option A: Mark continuation_pending so cron runner resumes from checkpoint
UPDATE evolution_runs
SET status = 'continuation_pending', last_heartbeat = NOW()
WHERE id IN ('7496e0fa-...', '47e5de4b-...')
AND status = 'pending';

-- Option B: Mark failed and start fresh
UPDATE evolution_runs
SET status = 'failed',
    error_message = 'Manually failed: stuck in pending due to missing claim step',
    completed_at = NOW()
WHERE id IN ('7496e0fa-...', '47e5de4b-...')
AND status = 'pending';
```

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/architecture.md
- docs/feature_deep_dives/search_generation_pipeline.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/agents/generation.md

## Code Files Read
- `evolution/src/services/evolutionActions.ts` — triggerEvolutionRunAction (inline trigger, missing claim), queueEvolutionRunAction (insert path)
- `evolution/src/services/evolutionVisualizationActions.ts` — all dashboard data-fetching actions
- `evolution/src/services/unifiedExplorerActions.ts` — explorer views (table, matrix, trend, article detail)
- `evolution/src/services/promptRegistryActions.ts` — prompt CRUD and dropdown population
- `evolution/src/services/strategyRegistryActions.ts` — strategy CRUD and dropdown population
- `evolution/src/lib/core/pipeline.ts` — executeFullPipeline (claimed→running guard L307, completion guard L461)
- `evolution/src/lib/core/persistence.ts` — markRunFailed, persistCheckpoint (no status guard on heartbeat), checkpointAndMarkContinuationPending
- `src/app/api/cron/evolution-runner/route.ts` — cron runner (correctly calls claim RPC)
- `src/app/api/cron/evolution-watchdog/route.ts` — watchdog (only checks claimed/running, misses pending)
- `src/app/admin/quality/evolution/page.tsx` — pipeline runs page (30-day default filter)
- `src/app/admin/quality/explorer/page.tsx` — unified explorer (article/agent/run tabs)
- `supabase/migrations/20260216000001_add_continuation_pending_status.sql` — claim_evolution_run RPC, checkpoint_and_continue RPC
- `supabase/migrations/20260214000001_claim_evolution_run.sql` — original claim RPC
- `supabase/migrations/20260131000001_evolution_runs.sql` — original schema (last_heartbeat nullable)
- `evolution/scripts/evolution-runner.ts` — batch runner (correctly calls claim RPC)
