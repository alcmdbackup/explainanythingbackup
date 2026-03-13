# Minor Evolution UI Fixes Plan

## Background
Minor evolution UI polish — small UI fixes and improvements across the evolution admin pages. This project addresses two specific issues: removing the unused "analysis" tab from the evolution dashboard, and fixing the timeline tab on run detail pages so that per-iteration agent invocation details remain visible after a run completes rather than collapsing to "iteration complete".

## Requirements (from GH Issue #697)
1. Eliminate the "analysis" tab and any code that purely supports it in the evolution dashboard
2. Ensure that after a run ends, agents invoked during each iteration remain visible under a run detail page's "timeline" tab, rather than collapsing to just "iteration complete". We can see agents invoked while the run is running, but once it ends timeline gets rid of this and just shows "iteration complete" which isn't helpful.

## Problem
The evolution admin UI has an "Analysis" page (`/admin/evolution/analysis`) providing strategy leaderboards, Pareto charts, agent ROI tables, and cost accuracy panels. This page is unused and should be removed along with its dedicated code.

Separately, the run detail page's Timeline tab stops refreshing data when a run transitions from "running" to "completed". The `AutoRefreshProvider` stops incrementing `refreshKey` when `isActive` becomes false, so the `TimelineTab`'s `useEffect` never triggers a final data fetch. This leaves the UI showing stale data from the last polling cycle, missing the final iteration's agent details. The data layer (`getEvolutionRunTimelineAction`) has no status filtering and always returns complete data when called.

## Options Considered

### Issue 1: Analysis Tab Removal
- **Option A: Delete everything at once** — Remove page, components, actions, navigation in one phase. Simple but large blast radius.
- **Option B: Phased removal** — First relocate shared components, then delete analysis-only code, then clean up navigation/tests. ← **Chosen** — safer, each phase is independently testable.

### Issue 2: Timeline Tab Fix
- **Option A: Final refresh in AutoRefreshProvider** — Track `isActive` transition from true→false using a ref, trigger one final `refreshKey` increment. ← **Chosen** — fixes all tabs at once (Timeline, Rating, Logs, Metrics), minimal code change.
- **Option B: Per-tab completion detection** — Each tab watches run status and refetches independently. Duplicates logic across 6 tabs.
- **Option C: Server-sent events for completion** — Over-engineered for this problem.

## Phased Execution Plan

### Phase 1: Fix Timeline Tab Refresh (Issue 2)
Small, focused change with high user impact.

**1.1 Add final refresh to AutoRefreshProvider**

File: `evolution/src/components/evolution/AutoRefreshProvider.tsx`

First, add `useRef` to the existing React import (line 6-13 of AutoRefreshProvider.tsx — `useRef` is not currently imported):

```typescript
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
```

Then add a ref to track previous `isActive` value. When `isActive` transitions from `true` to `false`, increment `refreshKey` one final time. Place this **before** the existing polling `useEffect`:

```typescript
const wasActiveRef = useRef(isActive);

useEffect(() => {
  if (wasActiveRef.current && !isActive) {
    // Run just completed — trigger one final refresh so all tabs fetch final data
    setRefreshKey(k => k + 1);
  }
  wasActiveRef.current = isActive;
}, [isActive]);
```

This is a separate `useEffect` from the existing polling interval effect, so they don't interfere. Note: if `isActive` starts as `false` (navigating directly to a completed run), `wasActiveRef.current` is already `false`, so no spurious refresh fires — tabs handle their own initial mount load.

**1.2 Verify and test**

- Run lint/tsc/build
- Update `AutoRefreshProvider.test.tsx` to add a test for the transition behavior:
  - Render with `isActive=true`, verify polling starts
  - Change to `isActive=false`, verify one final `refreshKey` increment
  - Verify no further increments after that
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
- `src/app/admin/evolution/experiments/[experimentId]/page.test.tsx` — Update breadcrumb assertion
- `src/app/admin/evolution/strategies/[strategyId]/page.test.tsx` — Update mock for `costAnalyticsActions` if module shape changed

**4.7 Verify**

- Run lint/tsc/build
- Run all unit tests
- Run E2E tests

## Testing

### Unit Tests to Add
- `AutoRefreshProvider.test.tsx` — New test: "triggers final refresh when isActive transitions from true to false"
- `AutoRefreshProvider.test.tsx` — Negative test: "does NOT trigger refresh when isActive starts as false" (no false→true spurious refresh)

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
All changes are in a single feature branch. Rollback = revert the merge commit on main. Each phase has its own commit for granular revert if needed.

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
