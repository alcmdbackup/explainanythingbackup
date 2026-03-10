# Archive Strategies Progress

## Phase 1: DB Migration
### Work Done
- Created `supabase/migrations/20260309000001_archive_improvements.sql` with:
  - `pre_archive_status TEXT` column on `evolution_experiments`
  - Extended status CHECK to include `'archived'`
  - `archived BOOLEAN DEFAULT false` on `evolution_runs`
  - Partial index on `evolution_runs(archived) WHERE archived = false`
  - RPCs: `get_non_archived_runs`, `archive_experiment`, `unarchive_experiment`
  - Security grants restricted to `service_role`
- Created rollback migration `20260309000001_archive_improvements_down.sql`

## Phase 2: Fix Strategy Archiving
### Work Done
- Removed `is_predefined` guard from `archiveStrategyAction` — all strategies can now be archived
- Added `unarchiveStrategyAction` (sets status back to `'active'`)
- Updated `strategies/page.tsx`: removed `s.is_predefined &&` from archive button, added unarchive button for archived strategies
- Updated tests: 33 tests pass

## Phase 3: Add Experiment Archiving
### Work Done
- Added `archiveExperimentAction` calling `supabase.rpc('archive_experiment', ...)`
- Added `unarchiveExperimentAction` calling `supabase.rpc('unarchive_experiment', ...)`
- Updated `listExperimentsAction` to exclude archived by default (`.neq('status', 'archived')`)
- Added status filter dropdown to `ExperimentHistory.tsx` (Active/Archived/All, default Active)
- Added archive/unarchive buttons on experiment rows (terminal experiments only)
- Added `mockRpc` to experiment test mock setup
- Updated tests: 30 tests pass

## Phase 4: Add Run Archiving
### Work Done
- Added `archived: boolean` to `EvolutionRun` interface
- Added `archiveRunAction` / `unarchiveRunAction` server actions
- Replaced `getEvolutionRunsAction` query with `supabase.rpc('get_non_archived_runs', ...)` with client-side filtering for `explanationId`, `startDate`, `promptId`
- Added `.eq('archived', false)` to all browse/aggregate queries:
  - `evolutionVisualizationActions.ts`: 8 queries in `getEvolutionDashboardDataAction`
  - `costAnalyticsActions.ts`: `getStrategyAccuracyAction`, `getCostAccuracyOverviewAction`
  - `eloBudgetActions.ts`: `getStrategyRunsAction`, `getPromptRunsAction`
- Added "Show archived" checkbox toggle to `runs/page.tsx`
- Added archived badge on run detail page header
- Updated tests: 46 evolution actions tests pass, 69 viz/cost/elo tests pass

## Phase 5: Default Filters to 'active'
### Work Done
- `strategies/page.tsx`: `useState<StatusFilter>('all')` → `useState<StatusFilter>('active')`
- `prompts/page.tsx`: `useState<StatusFilter>('all')` → `useState<StatusFilter>('active')`
- `ExperimentForm.tsx`: `getStrategiesAction()` → `getStrategiesAction({ status: 'active' })`

## Phase 6: Run Metrics Tab
### Work Done
- Added `getRunMetricsAction` in `experimentActions.ts` calling `computeRunMetrics()`
- Created `RunMetricsTab.tsx` with summary card grid (Variants, Median Elo, 90p Elo, Max Elo, Cost, Elo/$) and agent cost breakdown table
- Added `{ id: 'metrics', label: 'Metrics' }` to TABS array in run detail page
- Created `RunMetricsTab.test.tsx` with 4 tests: loading, success, error, empty states

## Verification
- TSC: clean (no errors)
- Lint: 0 errors (pre-existing warnings only)
- Build: success
- Full test suite: 5365 passed, 0 failed, 293 suites
