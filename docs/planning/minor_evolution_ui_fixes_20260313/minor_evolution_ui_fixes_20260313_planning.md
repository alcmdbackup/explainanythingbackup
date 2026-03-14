# Minor Evolution UI Fixes Plan

## Background
Minor evolution UI polish — small UI fixes and improvements across the evolution admin pages. This project addresses two specific issues: removing the unused "analysis" tab from the evolution dashboard, and fixing the timeline tab on run detail pages so that per-iteration agent invocation details remain visible after a run completes rather than collapsing to "iteration complete".

## Requirements (from GH Issue #697)
1. Eliminate the "analysis" tab and any code that purely supports it in the evolution dashboard
2. Ensure that after a run ends, agents invoked during each iteration remain visible under a run detail page's "timeline" tab, rather than collapsing to just "iteration complete". We can see agents invoked while the run is running, but once it ends timeline gets rid of this and just shows "iteration complete" which isn't helpful.

## Problem
The evolution admin UI has an "Analysis" page (`/admin/evolution/analysis`) providing strategy leaderboards, Pareto charts, agent ROI tables, and cost accuracy panels. This page is unused and should be removed along with its dedicated code.

Separately, the run detail page's Timeline tab shows "iteration_complete" as the only agent per iteration after a run completes. Root cause: `pruneCheckpoints()` runs at finalization and deletes per-agent checkpoints, keeping only the `iteration_complete` checkpoint per iteration. The timeline action (`getEvolutionRunTimelineAction`) builds agent rows from `evolution_checkpoints`, so after pruning it only finds `last_agent='iteration_complete'` rows. The `evolution_agent_invocations` table survives pruning and has all per-agent data, but the timeline action only uses it for enrichment (cost, detail), not as a primary data source. Additionally, `AutoRefreshProvider` doesn't trigger a final refresh when a run completes, so the UI may not even re-fetch data after pruning occurs.

## Options Considered

### Issue 1: Analysis Tab Removal
- **Option A: Delete everything at once** — Remove page, components, actions, navigation in one phase. Simple but large blast radius.
- **Option B: Phased removal** — First relocate shared components, then delete analysis-only code, then clean up navigation/tests. ← **Chosen** — safer, each phase is independently testable.

### Issue 2: Timeline Tab Fix
- **Option A: Fix timeline action to fall back to invocations when checkpoints are pruned** ← **Chosen** — addresses the root cause (data source), not just the symptom. Also skip `iteration_complete` rows in unpruned data. Complementary AutoRefreshProvider fix ensures the UI re-fetches after completion.
- **Option B: Stop pruning per-agent checkpoints** — Would fix the timeline but increases storage ~13x per run. Pruning was added deliberately for storage reduction.
- **Option C: Pre-compute timeline data before pruning** — Store a timeline summary in a new column/table before deleting checkpoints. Over-engineered for this problem.

## Phased Execution Plan

### Phase 1: Fix Timeline Tab for Completed Runs (Issue 2)

**Root cause:** After a run completes, `pruneCheckpoints()` deletes per-agent checkpoints and keeps only the `iteration_complete` checkpoint per iteration. The timeline action (`getEvolutionRunTimelineAction`) builds agent rows from checkpoints, so after pruning it only finds rows with `last_agent='iteration_complete'` and renders that as the sole "agent" per iteration.

The `evolution_agent_invocations` table survives pruning and has all per-agent data (agent_name, cost, execution_detail, iteration, execution_order). The fix: when checkpoints are pruned, fall back to building agent rows from invocations.

**1.1 Update `getEvolutionRunTimelineAction` to handle pruned checkpoints**

File: `evolution/src/services/evolutionVisualizationActions.ts` (lines 444-481)

The current logic iterates over `checkpointGroup` (from `evolution_checkpoints`) to build agent rows. After pruning, each iteration has only one checkpoint with `last_agent='iteration_complete'`.

The invocations query (lines 411-416) already fetches per-agent data but **must be updated** to include `execution_order` in the `.select()` clause (currently selects `id, iteration, agent_name, cost_usd, execution_detail, agent_attribution` — missing `execution_order`). The server-side `.order('execution_order')` sorts the results correctly but the field value isn't available on each row without adding it to `select`. The fix:

For each iteration, check if the checkpoints are pruned (only `iteration_complete` / `continuation_yield` entries). If so, build agent rows from `evolution_agent_invocations` instead:

```typescript
const SYNTHETIC_AGENTS = new Set(['iteration_complete', 'continuation_yield']);

for (const [iteration, checkpointGroup] of sortedIterations) {
  const phase = checkpointGroup[0]?.phase ?? 'EXPANSION';
  const agents: TimelineData['iterations'][number]['agents'] = [];

  // Check if checkpoints are pruned (only iteration_complete/continuation_yield remain)
  const isPruned = checkpointGroup.every(cp => SYNTHETIC_AGENTS.has(cp.last_agent));

  if (isPruned) {
    // Build agent rows from invocations (which survive pruning)
    const iterInvocations = (costInvocations ?? [])
      .filter(inv => inv.iteration === iteration)
      .sort((a, b) => ((a.execution_order as number) ?? 0) - ((b.execution_order as number) ?? 0));

    for (let i = 0; i < iterInvocations.length; i++) {
      const inv = iterInvocations[i];
      const agent = inv.agent_name as string;
      const invKey = `${iteration}-${agent}`;
      const diff = diffMetricsMap.get(invKey) ?? EMPTY_DIFF;

      agents.push({
        name: agent,
        costUsd: Number(inv.cost_usd) || 0,
        variantsAdded: diff.variantsAdded,
        matchesPlayed: diff.matchesPlayed,
        newVariantIds: diff.newVariantIds,
        eloChanges: Object.keys(diff.eloChanges).length > 0 ? diff.eloChanges : undefined,
        critiquesAdded: diff.critiquesAdded > 0 ? diff.critiquesAdded : undefined,
        debatesAdded: diff.debatesAdded > 0 ? diff.debatesAdded : undefined,
        diversityScoreAfter: diff.diversityScoreAfter,
        metaFeedbackPopulated: diff.metaFeedbackPopulated || undefined,
        executionOrder: i,
      });
    }
  } else {
    // Original logic: build from checkpoints (unpruned — run still in progress or legacy)
    let prevSnapshotInIteration = prevIterationFinalSnapshot;
    for (let i = 0; i < checkpointGroup.length; i++) {
      const cp = checkpointGroup[i];
      if (SYNTHETIC_AGENTS.has(cp.last_agent)) continue; // Skip iteration_complete even in unpruned data
      const invKey = `${iteration}-${cp.last_agent}`;
      const diff = diffMetricsMap.get(invKey) ?? diffCheckpoints(prevSnapshotInIteration, cp.state_snapshot);
      agents.push({ /* existing logic */ });
      prevSnapshotInIteration = cp.state_snapshot;
    }
  }
  // ... rest of iteration assembly unchanged
}
```

Also define an `EMPTY_DIFF` constant for the pruned path where no checkpoint diff is possible (note: `diversityScoreAfter` must be `null` not `undefined` per the `DiffMetrics` interface in `evolution/src/lib/types.ts`):
```typescript
const EMPTY_DIFF: DiffMetrics = {
  variantsAdded: 0, matchesPlayed: 0, newVariantIds: [],
  eloChanges: {}, critiquesAdded: 0, debatesAdded: 0,
  diversityScoreAfter: null, metaFeedbackPopulated: false,
};
```

**1.2 Add final refresh to AutoRefreshProvider (complementary fix)**

File: `evolution/src/components/evolution/AutoRefreshProvider.tsx`

Add `useRef` to the React import, then add a separate `useEffect` to trigger one final `refreshKey` increment when `isActive` transitions from `true` to `false`. This ensures tabs re-fetch data after the run completes (picking up the pruned-checkpoint fallback from 1.1):

```typescript
const wasActiveRef = useRef(isActive);

useEffect(() => {
  if (wasActiveRef.current && !isActive) {
    setRefreshKey(k => k + 1);
  }
  wasActiveRef.current = isActive;
}, [isActive]);
```

**1.3 Verify and test**

- Run lint/tsc/build
- Update `evolutionVisualizationActions.test.ts`:
  - Add test: "builds agent rows from invocations when checkpoints are pruned (only iteration_complete)"
  - Add test: "skips iteration_complete rows in unpruned checkpoint data"
- Update `AutoRefreshProvider.test.tsx`:
  - Add test: "triggers final refresh when isActive transitions from true to false"
  - Add negative test: "does NOT trigger refresh when isActive starts as false"
- Run existing TimelineTab tests to ensure no regressions

### Phase 2: Relocate Shared Components (Issue 1, prep)
Move 4 shared components out of the analysis directory before deleting it.

**2.1 Create shared components directory**

Create `src/app/admin/evolution/_components/` directory. This uses Next.js's underscore-prefix convention for private route segments (prevents the directory from being treated as a route). While no other `_components/` directory exists yet under `src/app/`, this follows Next.js best practices and is the natural co-located home for components shared across evolution sub-routes but not used outside `/admin/evolution/`. The alternative (`evolution/src/components/evolution/`) is for pipeline-specific components, not app-router page components.

**2.2 Move shared components**

Move these files from `src/app/admin/evolution/analysis/_components/` to `src/app/admin/evolution/_components/`:
- `StrategyConfigDisplay.tsx` + `StrategyConfigDisplay.test.tsx`
- `ExperimentForm.tsx` + `ExperimentForm.test.tsx`
- `ExperimentStatusCard.tsx`
- `ExperimentHistory.tsx` + `ExperimentHistory.test.tsx`

**2.3 Update all import paths**

Update imports in these consumer files:
- `src/app/admin/evolution/strategies/[strategyId]/StrategyDetailContent.tsx` — imports StrategyConfigDisplay
- `src/app/admin/evolution/start-experiment/page.tsx` — imports ExperimentForm, ExperimentStatusCard
- `src/app/admin/evolution/experiments/page.tsx` — imports ExperimentHistory
- `src/app/admin/evolution/analysis/page.tsx` — temporarily update imports (will be deleted in Phase 3)

**2.4 Verify**

- Run lint/tsc/build
- Run relocated test files
- Run unit tests for consumer components

### Phase 3: Delete Analysis-Only Code (Issue 1, main)

**3.1 Delete analysis page and dedicated components**

Delete the entire directory contents that are analysis-only:
- `src/app/admin/evolution/analysis/page.tsx`
- `src/app/admin/evolution/analysis/_components/StrategyLeaderboard.tsx`
- `src/app/admin/evolution/analysis/_components/StrategyParetoChart.tsx`
- `src/app/admin/evolution/analysis/_components/AgentROILeaderboard.tsx`
- `src/app/admin/evolution/analysis/_components/CostSummaryCards.tsx`
- `src/app/admin/evolution/analysis/_components/CostBreakdownPie.tsx`
- `src/app/admin/evolution/analysis/_components/CostAccuracyPanel.tsx` + `.test.tsx`
- `src/app/admin/evolution/analysis/_components/StrategyDetail.tsx`
- `src/app/admin/evolution/analysis/_components/runFormUtils.ts` + `.test.ts`

After moving shared components in Phase 2, the `analysis/` directory should be empty and can be deleted entirely.

**3.2 Clean up costAnalyticsActions.ts**

`costAnalyticsActions.ts` is NOT entirely analysis-only: `getStrategyAccuracyAction` and `StrategyAccuracyStats` type are imported by the strategy detail page (`src/app/admin/evolution/strategies/[strategyId]/page.tsx` and `StrategyDetailContent.tsx`).

- **Keep**: `getStrategyAccuracyAction`, `StrategyAccuracyStats` type
- **Delete**: `getCostAccuracyOverviewAction`, `CostAccuracyOverview` type (analysis-only)
- **Update** `costAnalyticsActions.test.ts`: Remove `getCostAccuracyOverviewAction` tests, keep `getStrategyAccuracyAction` tests

**3.3 Clean up eloBudgetActions.ts**

Remove analysis-only functions from `evolution/src/services/eloBudgetActions.ts`:
- `getAgentROILeaderboardAction`, `getAgentCostByModelAction`, `getStrategyLeaderboardAction`, `getStrategyParetoAction`
- `getRecommendedStrategyAction`, `getOptimizationSummaryAction`
- `resolveStrategyConfigAction`, `updateStrategyAction` (not the one in strategyRegistryActions)
- `getPromptRunsAction` (only used in tests — firm decision: delete)
- Helper function: `rowToLeaderboardEntry` (analysis-only)
- Types: `AgentROI`, `StrategyLeaderboardEntry`, `ParetoPoint`

**MUST KEEP** (used by retained functions `getStrategyRunsAction`/`getStrategiesPeakStatsAction`):
- `fetchRunVariantStats` — called by `getStrategyRunsAction` (line 606) and `getStrategiesPeakStatsAction` (line 667)
- `computeDurationSecs` — called by `getStrategyRunsAction` (line 621)
- `ActionResult<T>` type — used by all retained exports

Keep:
- `getStrategiesPeakStatsAction` + `StrategyPeakStats` — used by strategies list page
- `getStrategyRunsAction` + `StrategyRunEntry` — used by strategy detail page and RelatedRunsTab

Update `eloBudgetActions.test.ts` — remove tests for deleted functions, keep tests for retained functions.

**3.4 Delete E2E test file**

Delete `src/__tests__/e2e/specs/09-admin/admin-elo-optimization.spec.ts` (entirely analysis-page tests).

**3.5 Verify**

- Run lint/tsc/build
- Run all unit tests
- Run integration tests

### Phase 4: Update Navigation and References

**Note:** Phase 4 MUST be executed atomically with Phase 3 (same commit) to avoid an intermediate state where the sidebar links to a 404.

**4.1 Remove Analysis from sidebar**

File: `src/components/admin/EvolutionSidebar.tsx`
- Remove the `{ href: '/admin/evolution/analysis', label: 'Analysis', ... }` nav item

**4.2 Remove Analysis quick link from dashboard**

File: `src/app/admin/evolution-dashboard/page.tsx`
- Remove the Analysis `QuickLinkCard`

**4.3 Remove next.config.ts redirect to deleted page**

File: `next.config.ts` (line 25)
- Remove: `{ source: '/admin/quality/optimization', destination: '/admin/evolution/analysis', permanent: true }`
- Keep: `{ source: '/admin/quality/optimization/experiment/:experimentId', destination: '/admin/evolution/experiments/:experimentId', permanent: true }` (this one still points to a valid page)

**4.4 Update experiment detail breadcrumbs**

File: `src/app/admin/evolution/experiments/[experimentId]/page.tsx`
- Remove or replace the `{ label: 'Analysis', href: '/admin/evolution/analysis' }` breadcrumb
- Replace with `{ label: 'Experiments', href: '/admin/evolution/experiments' }`

**4.5 Fix E2E test navigation**

File: `src/__tests__/e2e/specs/09-admin/admin-experiment-detail.spec.ts` (note: this suite is `describe.skip`'d — changes are for correctness, not CI-blocking)
- Update navigation start point from `/admin/evolution/analysis` to `/admin/evolution/experiments`
- Replace "Analysis" breadcrumb assertion with "Experiments" breadcrumb assertion (don't just remove — the `text=Analysis` locator could match other UI elements)

**4.6 Update unit test assertions**

- `src/components/admin/EvolutionSidebar.test.tsx` — Remove analysis nav item assertion
- `src/components/admin/SidebarSwitcher.test.tsx` — Remove `/admin/evolution/analysis` from test array
- `src/app/admin/evolution-dashboard/page.test.tsx` — Remove Analysis link assertion
- `src/app/admin/evolution/experiments/[experimentId]/page.test.tsx` — Change breadcrumb assertion from `'Analysis'` → `'Experiments'` with href `/admin/evolution/experiments`
- `src/app/admin/evolution/strategies/[strategyId]/page.test.tsx` — Remove `getCostAccuracyOverviewAction` from the `costAnalyticsActions` mock; keep `getStrategyAccuracyAction` mock intact

**4.7 Verify**

- Run lint/tsc/build
- Run all unit tests
- Run E2E tests

## Testing

### Unit Tests to Add
- `evolutionVisualizationActions.test.ts` — "builds agent rows from invocations when checkpoints are pruned (only iteration_complete)"
- `evolutionVisualizationActions.test.ts` — "skips iteration_complete rows in unpruned checkpoint data"
- `AutoRefreshProvider.test.tsx` — "triggers final refresh when isActive transitions from true to false"
- `AutoRefreshProvider.test.tsx` — "does NOT trigger refresh when isActive starts as false"

### Unit Tests to Update
- `EvolutionSidebar.test.tsx` — Remove analysis nav item expectation
- `SidebarSwitcher.test.tsx` — Remove analysis path from test data
- `evolution-dashboard/page.test.tsx` — Remove Analysis quick link assertion
- `experiments/[experimentId]/page.test.tsx` — Update breadcrumb assertion
- `strategies/[strategyId]/page.test.tsx` — Update mock for costAnalyticsActions if module shape changed
- `eloBudgetActions.test.ts` — Remove tests for deleted functions (including `getAgentCostByModelAction` describe block), keep tests for `getStrategiesPeakStatsAction` and `getStrategyRunsAction`
- `costAnalyticsActions.test.ts` — Remove `getCostAccuracyOverviewAction` tests, keep `getStrategyAccuracyAction` tests

### Unit Tests to Delete
- `CostAccuracyPanel.test.tsx`
- `runFormUtils.test.ts`

### E2E Tests to Delete
- `admin-elo-optimization.spec.ts`

### E2E Tests to Update
- `admin-experiment-detail.spec.ts` — Fix navigation path (note: this suite is `describe.skip`'d)

### Rollback Strategy
All changes are in a single feature branch. Rollback = revert the merge commit on main. Phase 1 gets its own commit, Phase 2 gets its own commit, Phases 3+4 share a single commit (atomic — sidebar/nav must not link to deleted page).

### Manual Verification
1. Navigate to a completed evolution run → Timeline tab should show all agent details per iteration
2. Watch a running evolution run complete → Timeline tab should show final iteration's agents after completion (requires a live run on staging)
3. Verify `/admin/evolution/analysis` returns 404
4. Verify sidebar no longer shows "Analysis" link
5. Verify evolution dashboard no longer shows Analysis quick link
6. Verify experiment detail breadcrumb no longer links to Analysis
7. Verify strategy detail page still shows cost accuracy stats (costAnalyticsActions not fully deleted)

## Documentation Updates
The following docs need updates after this project:
- `evolution/docs/evolution/visualization.md` — Remove "Analysis Page Additions" section (RecommendedStrategyCard, Pareto chart), remove `/admin/evolution/analysis` from Pages table, update AutoRefreshProvider description to mention final refresh behavior
- `evolution/docs/evolution/reference.md` — Remove any references to analysis page or costAnalyticsActions
- `docs/feature_deep_dives/admin_panel.md` — Remove `/admin/quality/optimization` route reference, update EvolutionSidebar item count
