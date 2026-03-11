# Archive Strategies Research

## Problem Statement
The evolution dashboard needs improvements to strategy archiving: A) verify archiving works in production, B) hide archived strategies from experiment creation, and C) fix the archive button not appearing next to most strategies.

## Requirements (from GH Issue #TBD)
- [ ] Hide archived strategies from experimentation creation flow
- [ ] Many strategies (created by experiments) cannot be archived in production
- [ ] Should be able to archive strategies, prompts, experiments
    - [ ] Should have filter on each entity overview page and each should start in "active" state so these aren't shown
- [ ] Runs should be archived if underlying experiment is archived
- [ ] Add a metrics tab to runs

## High Level Summary

### 1. Strategy Archiving — Broken for ~95% of Strategies
- Archive guard in `strategyRegistryActions.ts:308-338` requires `is_predefined = true`
- Only admin-created strategies set `is_predefined = true` (via `createStrategyCore`)
- Experiment-created (`created_by: 'experiment'`) and system-created (`created_by: 'system'`) strategies default to `is_predefined = false` via DB schema
- UI archive button condition: `s.is_predefined && s.status === 'active'` — hidden for non-predefined
- **Fix**: Remove `is_predefined` guard from archive action and UI button condition. All strategies should be archivable regardless of origin.
- No `unarchiveStrategyAction` exists (prompts have one). Need to add for consistency.

### 2. Experiment Archiving — Not Implemented
- `evolution_experiments.status` CHECK: `('pending', 'running', 'analyzing', 'completed', 'failed', 'cancelled')` — no `'archived'` value
- No archive/unarchive actions exist in `experimentActions.ts`
- `ExperimentHistory` component fetches all experiments with no status filtering
- **Fix**: Add `'archived'` to status CHECK constraint, create archive/unarchive actions, add status filter to experiments list page

### 3. ExperimentForm Strategy Picker — Shows Archived Strategies
- `ExperimentForm.tsx:53` calls `getStrategiesAction()` with NO status filter
- Prompts are properly filtered: `getPromptsAction({ status: 'active' })` on line 52
- **Fix**: Change to `getStrategiesAction({ status: 'active' })`

### 4. Default Filters — All Default to 'all' Instead of 'active'
| Page | Client Default | Server Default | Line |
|------|---------------|---------------|------|
| Strategies | `'all'` | `'active'` | `strategies/page.tsx:610` |
| Prompts | `'all'` | none | `prompts/page.tsx:281` |
| Experiments | none | none | `ExperimentHistory.tsx` (no filter) |
| Runs | `''` (all) | none | `runs/page.tsx:52` |

- **Fix**: Change all client defaults to `'active'`

### 5. Run Archiving — Not Implemented, Cascade Needed
- `evolution_runs.status` CHECK: `('pending','claimed','running','completed','failed','paused','continuation_pending')` — execution states only, no archive concept
- `experiment_id` FK has NO `ON DELETE CASCADE`
- `cancelExperimentAction` only cascades to pending/claimed runs, not completed ones
- **Options**: A) Add separate `archived` boolean column to runs, B) add `'archived'` to status CHECK. Option A is cleaner since `status` represents execution state.
- Cascade: when experiment is archived, set `archived = true` on all linked runs

### 6. Run Metrics Tab — Infrastructure Exists, Just Needs Wiring
- Run detail page has 5 tabs: Timeline, Rating, Lineage, Variants, Logs — no Metrics tab
- `computeRunMetrics(runId, supabase)` already exists in `experimentMetrics.ts:276-374`
- Returns: totalVariants, medianElo, p90Elo, maxElo, cost, eloPer$, per-agent costs
- Used by `getExperimentMetricsAction` and `getStrategyMetricsAction`
- `compute_run_variant_stats` RPC already exists (migration `20260306000002`)
- `ExperimentAnalysisCard.tsx` renders metrics table with agent cost breakdown — reusable pattern
- **Fix**: Create `getRunMetricsAction`, create `RunMetricsTab.tsx` component, add to TABS array

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/data_model.md — Strategy system, `is_predefined` field, creation paths, archive enforcement
- evolution/docs/evolution/strategy_experiments.md — Experiment workflow, strategy picker, pre-registration
- evolution/docs/evolution/visualization.md — Strategy registry UI, run detail page tabs, experiment analysis card
- evolution/docs/evolution/README.md — Evolution system overview, strategy archiving enforcement note

## Code Files Read
- `evolution/src/services/strategyRegistryActions.ts` — Archive guard (`is_predefined` check), getStrategiesAction (defaults to `status: 'active'`), no unarchive action
- `evolution/src/services/promptRegistryActions.ts` — Archive/unarchive actions, getPromptsAction with status filter
- `evolution/src/services/experimentActions.ts` — No archive concept, deleteExperiment (hard delete pending only), cancelExperiment (partial cascade), listExperiments (no filter)
- `evolution/src/services/strategyResolution.ts` — `resolveOrCreateStrategy` does NOT set `is_predefined` (defaults false)
- `evolution/src/services/evolutionActions.ts` — EvolutionRun type with `experiment_id` FK, getEvolutionRunSummaryAction
- `evolution/src/experiments/evolution/experimentMetrics.ts` — `computeRunMetrics()`, MetricsBag types, bootstrap CI functions
- `evolution/src/lib/core/metricsWriter.ts` — `linkStrategyConfig` creates strategies with `createdBy: 'system'`
- `src/app/admin/evolution/strategies/page.tsx` — Status filter defaults to `'all'` (line 610), archive button condition `s.is_predefined && s.status === 'active'` (line 981)
- `src/app/admin/evolution/prompts/page.tsx` — Status filter defaults to `'all'` (line 281)
- `src/app/admin/evolution/runs/page.tsx` — Status filter defaults to `''` (line 52), no archive concept
- `src/app/admin/evolution/runs/[runId]/page.tsx` — 5 tabs (Timeline, Rating, Lineage, Variants, Logs), no Metrics tab
- `src/app/admin/evolution/analysis/_components/ExperimentForm.tsx` — Strategy picker calls `getStrategiesAction()` without status filter (line 53)
- `src/app/admin/evolution/analysis/_components/ExperimentHistory.tsx` — No status filter, fetches all experiments
- `src/app/admin/evolution/experiments/[experimentId]/ExperimentAnalysisCard.tsx` — Metrics table with agent cost breakdown (reusable pattern)
- `supabase/migrations/20260207000007_strategy_lifecycle.sql` — `status` and `created_by` columns on strategies
- `supabase/migrations/20260222100003_add_experiment_tables.sql` — Experiments table schema
- `supabase/migrations/20260303000001_flatten_experiment_model.sql` — `experiment_id` FK on runs (no ON DELETE CASCADE)
- `supabase/migrations/20260306000002_compute_run_variant_stats.sql` — RPC for variant stats

## Key Findings
1. **Strategy archive is restricted to `is_predefined = true`** — only ~5% of strategies. The guard exists in both the server action and UI.
2. **Experiment archiving doesn't exist** — no status column for archive, no actions, no UI filter.
3. **ExperimentForm shows archived strategies** — missing `{ status: 'active' }` filter on strategy fetch.
4. **All entity pages default to 'all'** instead of 'active' — strategies, prompts, experiments, runs.
5. **Run archiving doesn't exist** — `status` column is for execution state only. Need new `archived` column or similar.
6. **No cascade from experiment archive to runs** — `experiment_id` FK has no ON DELETE CASCADE, and cancel only affects pending/claimed runs.
7. **Run metrics tab is straightforward** — `computeRunMetrics()` exists, `compute_run_variant_stats` RPC exists, just need new action + component.
8. **Strategies have no unarchive action** — prompts do, strategies don't. Inconsistent.

## Open Questions (Resolved)
1. **Should archived experiments cascade-archive their linked strategies too, or just runs?** → No, just runs.
2. **For runs, should we use a separate `archived` boolean or extend the `status` CHECK constraint?** → Separate `archived` boolean column. Status is for execution state.
3. **Should the runs page filter default to showing non-archived runs, or active execution states?** → Show non-archived runs (all execution states, but hide archived).
4. **Run archive semantics**: A run is considered archived if it itself has `archived = true` OR its containing experiment is archived. Queries must check both conditions.
