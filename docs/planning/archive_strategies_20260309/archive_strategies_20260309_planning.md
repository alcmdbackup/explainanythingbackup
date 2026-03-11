# Archive Strategies Plan

## Background
The evolution dashboard needs improvements to strategy archiving: A) verify archiving works in production, B) hide archived strategies from experiment creation, and C) fix the archive button not appearing next to most strategies.

## Requirements (from GH Issue #TBD)
- [ ] Hide archived strategies from experimentation creation flow
- [ ] Many strategies (created by experiments) cannot be archived in production
- [ ] Should be able to archive strategies, prompts, experiments
    - [ ] Should have filter on each entity overview page and each should start in "active" state so these aren't shown
- [ ] Runs should be archived if underlying experiment is archived
- [ ] Add a metrics tab to runs

## Problem
The evolution dashboard has inconsistent archiving support. Strategy archiving exists but is restricted to `is_predefined = true` (~5% of strategies), blocking most experiment/system-created strategies from being archived. Experiment archiving doesn't exist at all — no DB column, no actions, no UI. Run archiving also doesn't exist. Entity list pages all default to showing everything instead of active items, cluttering the UI with old/irrelevant entries. Additionally, the run detail page lacks a metrics tab despite the computation infrastructure already existing.

## Options Considered

### Run archive approach
- **A) Extend `status` CHECK** — Add `'archived'` to the existing status enum. Rejected: `status` represents execution state, mixing in lifecycle state is semantically wrong.
- **B) Separate `archived` boolean column** — Add `archived BOOLEAN DEFAULT false`. Chosen: clean separation of concerns, simple queries with `WHERE archived = false`.

### Experiment archive approach
- **A) Add `'archived'` to existing status CHECK + `pre_archive_status` column** — Chosen: experiments already have a lifecycle-oriented `status` column (pending→running→completed), so `archived` fits naturally as a terminal state. A `pre_archive_status` column preserves the original terminal state for unarchiving.
- **B) Separate `archived` boolean** — Not needed since experiment `status` is already lifecycle-oriented.

### Run archive semantics
A run is considered "archived" if: `run.archived = true` OR `run.experiment.status = 'archived'`. Queries must LEFT JOIN experiments and use `WHERE (e.status IS NULL OR e.status != 'archived') AND r.archived = false` to correctly handle standalone runs (NULL experiment_id).

## Phased Execution Plan

### Phase 1: DB Migrations
**Migration: `20260309000001_archive_improvements.sql`**

```sql
BEGIN;

-- 1. Add pre_archive_status column to preserve state before archiving
ALTER TABLE evolution_experiments
  ADD COLUMN IF NOT EXISTS pre_archive_status TEXT;

-- 2. Drop and recreate CHECK constraint to add 'archived' (in single transaction)
-- Constraint name: evolution_experiments_status_check (from 20260303000001)
ALTER TABLE evolution_experiments
  DROP CONSTRAINT IF EXISTS evolution_experiments_status_check;
ALTER TABLE evolution_experiments
  ADD CONSTRAINT evolution_experiments_status_check
  CHECK (status IN ('pending', 'running', 'analyzing', 'completed', 'failed', 'cancelled', 'archived'));

-- 3. Add archived boolean to runs (separate from execution status)
ALTER TABLE evolution_runs
  ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;

COMMIT;

-- 4. Index for filtering non-archived runs (common query path)
-- CONCURRENTLY cannot be inside a transaction block
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evolution_runs_not_archived
  ON evolution_runs(archived) WHERE archived = false;

-- 5. RPC for fetching non-archived runs (Supabase JS client cannot express LEFT JOIN)
CREATE OR REPLACE FUNCTION get_non_archived_runs(
  p_status TEXT DEFAULT NULL,
  p_include_archived BOOLEAN DEFAULT false
)
RETURNS SETOF evolution_runs
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_include_archived THEN
    IF p_status IS NOT NULL THEN
      RETURN QUERY SELECT r.* FROM evolution_runs r WHERE r.status = p_status;
    ELSE
      RETURN QUERY SELECT r.* FROM evolution_runs r;
    END IF;
  ELSE
    IF p_status IS NOT NULL THEN
      RETURN QUERY
        SELECT r.* FROM evolution_runs r
        LEFT JOIN evolution_experiments e ON r.experiment_id = e.id
        WHERE r.archived = false
          AND (e.status IS NULL OR e.status != 'archived')
          AND r.status = p_status;
    ELSE
      RETURN QUERY
        SELECT r.* FROM evolution_runs r
        LEFT JOIN evolution_experiments e ON r.experiment_id = e.id
        WHERE r.archived = false
          AND (e.status IS NULL OR e.status != 'archived');
    END IF;
  END IF;
END;
$$;

-- 6. RPC for archiving experiment + cascading to runs (atomic)
CREATE OR REPLACE FUNCTION archive_experiment(p_experiment_id UUID)
RETURNS void
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only terminal experiments can be archived
  IF NOT EXISTS (
    SELECT 1 FROM evolution_experiments
    WHERE id = p_experiment_id AND status IN ('completed', 'failed', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'Only terminal experiments (completed/failed/cancelled) can be archived';
  END IF;

  -- Save current status and archive
  UPDATE evolution_experiments
  SET pre_archive_status = status,
      status = 'archived',
      updated_at = NOW()
  WHERE id = p_experiment_id;

  -- Cascade: archive linked runs
  UPDATE evolution_runs
  SET archived = true
  WHERE experiment_id = p_experiment_id AND archived = false;
END;
$$;

-- 7. RPC for unarchiving experiment + restoring runs (atomic)
CREATE OR REPLACE FUNCTION unarchive_experiment(p_experiment_id UUID)
RETURNS void
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM evolution_experiments
    WHERE id = p_experiment_id AND status = 'archived'
  ) THEN
    RAISE EXCEPTION 'Experiment is not archived';
  END IF;

  -- Restore previous status
  UPDATE evolution_experiments
  SET status = COALESCE(pre_archive_status, 'completed'),
      pre_archive_status = NULL,
      updated_at = NOW()
  WHERE id = p_experiment_id;

  -- Unarchive all linked runs
  UPDATE evolution_runs
  SET archived = false
  WHERE experiment_id = p_experiment_id AND archived = true;
END;
$$;

-- 8. Security: restrict RPC access to service_role only (matches claim_evolution_run pattern)
REVOKE ALL ON FUNCTION get_non_archived_runs(TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_non_archived_runs(TEXT, BOOLEAN) TO service_role;

REVOKE ALL ON FUNCTION archive_experiment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION archive_experiment(UUID) TO service_role;

REVOKE ALL ON FUNCTION unarchive_experiment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unarchive_experiment(UUID) TO service_role;

-- 9. Notify PostgREST to pick up new RPCs
NOTIFY pgrst, 'reload schema';
```

**Rollback migration: `20260309000001_archive_improvements_down.sql`**
```sql
-- Revert RPCs
DROP FUNCTION IF EXISTS unarchive_experiment(UUID);
DROP FUNCTION IF EXISTS archive_experiment(UUID);
DROP FUNCTION IF EXISTS get_non_archived_runs(TEXT, BOOLEAN);

-- Revert: unarchive any archived experiments first (must happen before dropping column)
UPDATE evolution_experiments SET status = COALESCE(pre_archive_status, 'completed')
  WHERE status = 'archived';

BEGIN;
ALTER TABLE evolution_experiments DROP COLUMN IF EXISTS pre_archive_status;
ALTER TABLE evolution_experiments DROP CONSTRAINT IF EXISTS evolution_experiments_status_check;
ALTER TABLE evolution_experiments ADD CONSTRAINT evolution_experiments_status_check
  CHECK (status IN ('pending', 'running', 'analyzing', 'completed', 'failed', 'cancelled'));
ALTER TABLE evolution_runs DROP COLUMN IF EXISTS archived;
COMMIT;

DROP INDEX IF EXISTS idx_evolution_runs_not_archived;
```

**Migration safety notes:**
- `ALTER TABLE ADD COLUMN` with DEFAULT is safe in Postgres 11+ (no table rewrite)
- `DROP/ADD CONSTRAINT` wrapped in transaction to prevent constraint-less window
- `CREATE INDEX CONCURRENTLY` outside transaction (Postgres requirement), avoids blocking writes
- Archive/unarchive RPCs ensure atomicity — experiment status + run cascade in single transaction
- `get_non_archived_runs` RPC solves Supabase JS client limitation (cannot express LEFT JOIN)
- Verify constraint name before applying: `SELECT conname FROM pg_constraint WHERE conrelid = 'evolution_experiments'::regclass;`

**Files modified:**
- `supabase/migrations/20260309000001_archive_improvements.sql` (new)

### Phase 2: Fix Strategy Archiving (Remove is_predefined Guard)
1. **`strategyRegistryActions.ts`**: Remove `is_predefined` check from `archiveStrategyAction` — all strategies can be archived regardless of origin
2. **`strategyRegistryActions.ts`**: Add `unarchiveStrategyAction` (matching prompt pattern — set `status = 'active'`)
3. **`strategies/page.tsx`**: Remove `s.is_predefined &&` condition from archive button (line ~981). Add unarchive button for archived strategies. Both actions follow `requireAdmin` pattern.

**Files modified:**
- `evolution/src/services/strategyRegistryActions.ts`
- `src/app/admin/evolution/strategies/page.tsx`

### Phase 3: Add Experiment Archiving
1. **`experimentActions.ts`**: Add `archiveExperimentAction` — calls `supabase.rpc('archive_experiment', { p_experiment_id })`. The RPC (Phase 1) atomically saves pre_archive_status, sets status='archived', and cascades archived=true to linked runs. Only terminal experiments allowed (enforced in RPC).
2. **`experimentActions.ts`**: Add `unarchiveExperimentAction` — calls `supabase.rpc('unarchive_experiment', { p_experiment_id })`. The RPC atomically restores status from pre_archive_status and sets archived=false on all linked runs.
3. **`ExperimentHistory.tsx`**: Add status filter dropdown (all/non-archived/archived), default to non-archived (exclude `'archived'` status)
4. **`experimentActions.ts`**: Update `listExperimentsAction` to exclude archived by default when no status filter provided

**Edge case — independent run archiving before experiment archiving:**
- Unarchive always restores all linked runs to `archived = false`. If a run was independently archived before, the user can re-archive it. This is the simplest UX and matches the mental model of "undo the experiment archive."

**Files modified:**
- `evolution/src/services/experimentActions.ts`
- `src/app/admin/evolution/analysis/_components/ExperimentHistory.tsx`
- `src/app/admin/evolution/experiments/page.tsx` (if needed)

### Phase 4: Add Run Archiving
1. **`evolutionActions.ts`**: Add `archiveRunAction` / `unarchiveRunAction` — toggle `archived` boolean. Both require `requireAdmin`. Update `EvolutionRun` interface to include `archived: boolean` field.
2. **`evolutionActions.ts`**: Update run list queries to use `supabase.rpc('get_non_archived_runs', { p_status, p_include_archived })` for the main runs list. For simpler queries that just need `.eq('archived', false)`, add that filter directly.

**Query site audit — all `.from('evolution_runs')` call sites:**

| File | Query Sites | Action |
|------|-------------|--------|
| `evolutionActions.ts` | Run list, getEvolutionRunsAction | Use `get_non_archived_runs` RPC |
| `evolutionActions.ts` | getEvolutionRunAction (single run by ID) | No change (viewing specific run is always allowed) |
| `evolutionActions.ts` | queueEvolutionRunAction, killEvolutionRunAction | No change (mutations on specific runs) |
| `evolutionVisualizationActions.ts` | getEvolutionDashboardDataAction (counts, cost sums) | Add `.eq('archived', false)` filter |
| `evolutionVisualizationActions.ts` | Per-run detail queries (timeline, elo, lineage, etc.) | No change (viewing specific run) |
| `costAnalyticsActions.ts` | Strategy accuracy, cost overview | Add `.eq('archived', false)` filter |
| `eloBudgetActions.ts` | getStrategyRunsAction, getPromptRunsAction | Add `.eq('archived', false)` filter. Note: these are entity-scoped list queries (runs for a strategy/prompt). The `.eq('archived', false)` filter catches directly-archived runs but NOT experiment-cascaded archives. This is acceptable because experiment-cascaded archiving is an edge case for these views, and the alternative (extending `get_non_archived_runs` RPC with strategy/prompt filters or creating a view) adds complexity. Runs archived via experiment cascade will still appear in strategy/prompt run lists but will show an "archived" badge (Phase 4 step 4). |
| `eloBudgetActions.ts` | Budget/cost aggregate queries | Add `.eq('archived', false)` filter |
| `experimentActions.ts` | getExperimentRunsAction, experiment status queries | No change (scoped to specific experiment, archived experiments show their runs) |
| `experimentActions.ts` | getExperimentMetricsAction, getStrategyMetricsAction | No change (metrics should include all runs for that entity) |
| `evolutionRunnerCore.ts` | Runner status updates, heartbeat, claim | No change (execution infrastructure, not UI queries) |
| `arenaActions.ts` | Run lookup by ID list | No change (entity-scoped lookup) |
| `variantDetailActions.ts` | Run lookup by run_id | No change (entity-scoped lookup) |
| `promptRegistryActions.ts` | Run existence check for deletion guard | No change (existence check) |

**Principle**: List/aggregate queries that users browse should exclude archived. Single-entity lookups, mutations, and pipeline infrastructure should not filter. Entity-scoped list queries (strategy/prompt run history) filter by `archived = false` directly — this catches most cases; experiment-cascaded archives are shown with a badge rather than hidden.

3. **`runs/page.tsx`**: Add "Show archived" toggle, default off
4. **Run detail page**: Show archived badge if run is archived (directly or via experiment)

**Files modified:**
- `evolution/src/services/evolutionActions.ts`
- `evolution/src/services/evolutionVisualizationActions.ts`
- `evolution/src/services/costAnalyticsActions.ts`
- `evolution/src/services/eloBudgetActions.ts`
- `src/app/admin/evolution/runs/page.tsx`
- `src/app/admin/evolution/runs/[runId]/page.tsx`

### Phase 5: Default Filters to 'active'
1. **`strategies/page.tsx`**: Change `useState<StatusFilter>('all')` → `useState<StatusFilter>('active')` (line 610). Note: `getStrategiesAction` already defaults to `'active'` server-side, but the client currently overrides with `'all'`.
2. **`prompts/page.tsx`**: Change `useState<StatusFilter>('all')` → `useState<StatusFilter>('active')` (line 281)
3. **`ExperimentForm.tsx`**: Change `getStrategiesAction()` → `getStrategiesAction({ status: 'active' })` (line 53). `getStrategiesAction` already accepts `{ status }` filter parameter.

**Files modified:**
- `src/app/admin/evolution/strategies/page.tsx`
- `src/app/admin/evolution/prompts/page.tsx`
- `src/app/admin/evolution/analysis/_components/ExperimentForm.tsx`

### Phase 6: Run Metrics Tab
1. **`experimentActions.ts`**: Add `getRunMetricsAction(runId)` — calls existing `computeRunMetrics()`. Follows `withLogging + requireAdmin + serverReadRequestId` pattern. Input `runId` validated as UUID.
2. **`RunMetricsTab.tsx`** (new): Client component showing median Elo, p90 Elo, max Elo, cost, Elo/$, per-agent cost breakdown. Reuse metric rendering patterns from `ExperimentAnalysisCard.tsx`. Differentiation from Rating tab: Rating shows Elo trajectory over time (line chart), Metrics shows aggregate statistics and cost breakdown.
3. **`runs/[runId]/page.tsx`**: Add `{ id: 'metrics', label: 'Metrics' }` to TABS array, render `RunMetricsTab`

**Files modified:**
- `evolution/src/services/experimentActions.ts`
- `src/app/admin/evolution/runs/[runId]/RunMetricsTab.tsx` (new)
- `src/app/admin/evolution/runs/[runId]/page.tsx`

## Testing

### Unit Tests (to write/update during implementation)
All test files below already exist in the codebase. New test cases will be **added** to the existing test suites.

- `strategyRegistryActions.test.ts` — **Add**: archive works for non-predefined strategies (`is_predefined = false`), unarchive action restores to 'active', input validation (invalid UUID rejected)
- `experimentActions.test.ts` — **Add**: archiveExperimentAction calls `archive_experiment` RPC, unarchiveExperimentAction calls `unarchive_experiment` RPC, rejects non-terminal experiments, archive/unarchive server actions require admin
- `evolutionActions.test.ts` — **Add**: archiveRunAction/unarchiveRunAction toggle archived boolean, getEvolutionRunsAction passes `p_include_archived` to RPC, EvolutionRun interface includes `archived` field
- `evolutionVisualizationActions.test.ts` — **Add**: getEvolutionDashboardDataAction query includes `.eq('archived', false)` filter (verify mock chain)
- `costAnalyticsActions.test.ts` — **Add**: cost accuracy/overview queries include `.eq('archived', false)` filter
- `eloBudgetActions.test.ts` — **Add**: budget/strategy/prompt run queries include `.eq('archived', false)` filter
- `RunMetricsTab.test.tsx` — **New file**: renders metrics grid, handles loading/error/empty-data states, displays per-agent cost breakdown
- `ExperimentHistory.test.tsx` — **Add**: status filter renders with default non-archived, archive/unarchive buttons with confirmation dialogs

### Integration Tests
- `evolution-archive.integration.test.ts` (new) — Tests with real Supabase:
  - Archive strategy (predefined and non-predefined) → verify status change
  - Archive experiment → verify cascade sets runs.archived=true
  - Unarchive experiment → verify runs.archived restored to false, experiment status restored from pre_archive_status
  - Run list query correctly excludes: directly archived runs, experiment-archived runs, but includes standalone runs
  - LEFT JOIN correctness: standalone runs (null experiment_id) are NOT excluded

### Migration Testing
- Dry-run migration on a Supabase branch DB before applying to production
- Verify constraint name: `SELECT conname FROM pg_constraint WHERE conrelid = 'evolution_experiments'::regclass;`
- Verify existing rows: all experiments should keep their current status, all runs get `archived = false`
- Verify rollback script restores original schema

### E2E Tests
- Evolution admin E2E tests are skip-gated in CI. Add smoke tests to existing `admin-evolution-visualization.spec.ts`:
  - Navigate to strategies page → verify defaults to 'active' filter
  - Archive a strategy → verify it disappears from list
  - Switch filter to 'archived' → verify it appears

### Manual Verification on Stage
- [ ] Archive a non-predefined strategy → verify it disappears from active list and experiment creation picker
- [ ] Archive an experiment → verify linked runs are hidden from runs page
- [ ] Unarchive experiment → verify runs reappear and experiment status is restored correctly
- [ ] Archive a run independently, then archive its experiment, then unarchive experiment → verify the run is now unarchived
- [ ] Verify all entity pages default to showing active/non-archived items
- [ ] Verify standalone runs (no experiment) are shown normally
- [ ] Verify metrics tab on run detail page shows correct data for a completed run

### Rollback Plan
- Apply down migration `20260309000001_archive_improvements_down.sql` to revert schema changes
- Revert code changes via git (single feature branch)
- No data loss: archived boolean defaults to false, pre_archive_status is additive

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/data_model.md` — Update strategy archiving section (remove `is_predefined` restriction), add experiment archiving with `pre_archive_status`, add run `archived` column, document archive semantics (run archived if direct OR experiment archived)
- `evolution/docs/evolution/strategy_experiments.md` — Update experiment lifecycle states to include `archived`, document pre_archive_status preservation
- `evolution/docs/evolution/visualization.md` — Add Metrics tab to run detail tabs list, update filter defaults, document archive UI on experiments/runs
