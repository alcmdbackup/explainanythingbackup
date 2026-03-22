# Something Went Wrong Experiments Evolution Research

## Problem Statement
Bugs in production - 1. going to experiments page after starting a single experiment gives "something is wrong" error 2. When going to view details for 2e34834a, see that "Run 2e34834a-aa91-4163-9a70-e546d2d65aa4 not foundcolumn evolution_agent_invocations.agent_attribution does not exist" 3. Run 2e34834a itself is marked as completed, but seem to have failed in production when looking at notifications. Please debug what happened.

## Requirements (from GH Issue #729)
1. Going to experiments page after starting a single experiment gives "something is wrong" error
2. When going to view details for 2e34834a, see that "Run 2e34834a-aa91-4163-9a70-e546d2d65aa4 not foundcolumn evolution_agent_invocations.agent_attribution does not exist"
3. Run 2e34834a itself is marked as completed, but seem to have failed in production when looking at notifications. Please debug what happened.

## High Level Summary

All 3 bugs stem from the same root cause: the V2 evolution migration (`20260315000001_evolution_v2.sql`) dropped and recreated all evolution tables with a simplified schema, but the V2 UI code still references V1-only columns/fields that no longer exist.

### Issue 1: Experiments Page "Something Went Wrong"

**Root cause**: `ExperimentHistory.tsx` renders `experiment.spentUsd.toFixed(2)` and `experiment.totalBudgetUsd.toFixed(2)`, but the V2 `listExperimentsAction` returns raw DB rows that have NO `spentUsd` or `totalBudgetUsd` fields. The V2 experiments table only has: `id, name, prompt_id, status, config, created_at, updated_at`. Calling `.toFixed(2)` on `undefined` crashes the component.

**File**: `src/app/admin/evolution/_components/ExperimentHistory.tsx` lines 86, 19-22
**Action**: `evolution/src/services/experimentActionsV2.ts` `listExperimentsAction` (lines 55-75)

**Fix**: Either:
- A) Remove `spentUsd`/`totalBudgetUsd` from ExperimentHistory (simplest, V2 doesn't track per-experiment budget)
- B) Compute them from linked runs in the action

### Issue 2: Run Detail "agent_attribution does not exist"

**Root cause**: `getEvolutionRunTimelineAction` in `evolutionVisualizationActions.ts` selects `agent_attribution` from `evolution_agent_invocations` (line 339), but V2 schema does NOT have this column. The V2 `evolution_agent_invocations` table only has: `id, run_id, agent_name, iteration, execution_order, success, skipped, cost_usd, execution_detail, error_message, duration_ms, created_at`.

The error appears concatenated with "Run not found" because the page loads the run first (succeeds), then Timeline tab auto-loads and fails, and the error message gets combined in the UI.

**Files**:
- `evolution/src/services/evolutionVisualizationActions.ts` line 339: `.select('id, iteration, agent_name, cost_usd, execution_detail, agent_attribution, execution_order')`
- Same file line 966: second query also selects `agent_attribution`

**Fix**: Remove `agent_attribution` from both SELECT queries and the downstream mapping (`agentAttribution` field).

### Issue 3: Run Marked Completed But Failed

**Root cause**: The run was created and queued by the V2 experiment system. Since the V2 runner/pipeline may have completed the run in the DB (status='completed'), but the V2 visualization code crashes when trying to display it (due to issue 2 above), the user sees "something went wrong" when trying to view it. The run itself may have actually completed successfully — the failure is in the display layer, not the pipeline.

Alternatively, the runner may have encountered the `agent_attribution` column error during the finalization step (e.g., `computeAndPersistAttribution`) and the error was caught, allowing the run to be marked completed despite the attribution write failing.

**Note**: We cannot verify the actual run data via `npm run query:prod` because the V2 migration added `deny_all` RLS policies on all evolution tables. The `readonly_local` DB role cannot bypass RLS. Only `service_role` (used by the app) can read these tables.

## Prod DB Investigation

### RLS Blocks Read-Only Access
```sql
-- All evolution tables have deny_all RLS
SELECT tablename, policyname, cmd, qual FROM pg_policies WHERE tablename LIKE 'evolution%';
-- Result: All 10 tables have deny_all policy with qual=false
-- readonly_local role has rolbypassrls=false
```

### V2 Schema Confirmed
```sql
-- evolution_agent_invocations columns (NO agent_attribution)
SELECT column_name FROM information_schema.columns
WHERE table_name = 'evolution_agent_invocations';
-- 12 columns: id, run_id, agent_name, iteration, execution_order, success, skipped, cost_usd, execution_detail, error_message, duration_ms, created_at

-- evolution_experiments columns (NO spentUsd/totalBudgetUsd)
-- 7 columns: id, name, prompt_id, status, config, created_at, updated_at
-- status DEFAULT 'draft', CHECK ('draft','running','completed','cancelled','archived')
```

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/debugging.md — used prod query tool, blocked by RLS
- docs/feature_deep_dives/error_handling.md
- docs/docs_overall/environments.md

### Evolution Pipeline Docs
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/visualization.md

## Code Files Read
- `evolution/src/services/experimentActionsV2.ts` — listExperimentsAction returns raw rows without spentUsd/totalBudgetUsd
- `src/app/admin/evolution/_components/ExperimentHistory.tsx` — crashes on undefined.toFixed(2)
- `src/app/admin/evolution/experiments/page.tsx` — uses ExperimentHistory component
- `evolution/src/services/evolutionVisualizationActions.ts` — lines 339, 966 query agent_attribution column
- `evolution/src/services/evolutionActions.ts` — getEvolutionRunByIdAction works (select *)
- `src/app/admin/evolution/runs/[runId]/page.tsx` — loads run then timeline, error concatenated
- `supabase/migrations/20260315000001_evolution_v2.sql` — V2 schema without agent_attribution

## Key Findings
1. All 3 issues stem from V2 code referencing V1-only DB columns
2. `agent_attribution` column does not exist in V2 `evolution_agent_invocations`
3. `ExperimentHistory` expects `spentUsd`/`totalBudgetUsd` fields that V2 doesn't provide
4. RLS `deny_all` policies prevent read-only prod DB investigation
5. The run itself likely completed successfully — the error is in the display layer

## Open Questions
1. Did the run actually produce variants and a winner? (Cannot verify due to RLS)
2. Should we add a SELECT policy for `readonly_local` on evolution tables? (separate concern)
