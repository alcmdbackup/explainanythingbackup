# Minor Evolution UI Fixes Research

## Problem Statement
Minor evolution UI polish — small UI fixes and improvements across the evolution admin pages. This project addresses two specific issues: removing the unused "analysis" tab from the evolution dashboard, and fixing the timeline tab on run detail pages so that per-iteration agent invocation details remain visible after a run completes rather than collapsing to "iteration complete".

## Requirements (from GH Issue #697)
1. Eliminate the "analysis" tab and any code that purely supports it in the evolution dashboard
2. Ensure that after a run ends, agents invoked during each iteration remain visible under a run detail page's "timeline" tab, rather than collapsing to just "iteration complete". We can see agents invoked while the run is running, but once it ends timeline gets rid of this and just shows "iteration complete" which isn't helpful.

## High Level Summary

### Issue 1: Analysis Tab Removal
The analysis page (`/admin/evolution/analysis`) is a self-contained dashboard with strategy leaderboards, Pareto charts, agent ROI tables, cost breakdowns, and cost accuracy panels. Most of its code is isolated, but 4 components under `analysis/_components/` are shared with other pages and must be relocated before deletion.

### Issue 2: Timeline Tab Agent Details After Run Completion
The root cause is in the refresh mechanism. The `AutoRefreshProvider` stops incrementing `refreshKey` when `isActive` becomes false (run completes). The `TimelineTab` depends on `refreshKey` changes to trigger data fetches. However, the **initial mount load works fine** — navigating to a completed run shows data correctly. The issue is specifically when a user is watching a running run and it transitions to completed: the last refresh may not capture the final iteration's agent data. The text "iteration complete" was not found in the codebase — the actual symptom may be stale/incomplete data from the last refresh before polling stopped.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/visualization.md — Analysis page refs, Timeline tab architecture, all component inventory
- evolution/docs/evolution/arena.md — Arena architecture (not directly affected)
- evolution/docs/evolution/data_model.md — Run status lifecycle, variant model
- evolution/docs/evolution/rating_and_comparison.md — Rating system (not directly affected)
- evolution/docs/evolution/reference.md — Feature flags, config, DB schema
- docs/docs_overall/design_style_guide.md — UI patterns
- docs/feature_deep_dives/admin_panel.md — Admin routes, sidebar switching

## Code Files Read

### Analysis Tab (Issue 1)
- `src/app/admin/evolution/analysis/page.tsx` — Main analysis page with 4 tabs (Strategy/Agent/Cost/Cost Accuracy)
- `src/app/admin/evolution/analysis/_components/*.tsx` — 12 components: 6 analysis-only, 4 shared, 2 utility
- `evolution/src/services/eloBudgetActions.ts` — Server actions: ~8 analysis-only functions, 3 shared functions
- `evolution/src/services/costAnalyticsActions.ts` — 2 analysis-only cost accuracy actions
- `src/components/admin/EvolutionSidebar.tsx` — Has "Analysis" nav item in Overview section
- `src/app/admin/evolution-dashboard/page.tsx` — Has Analysis quick link card
- `src/app/admin/evolution/experiments/[experimentId]/page.tsx` — Has "Analysis" breadcrumb
- `src/__tests__/e2e/specs/09-admin/admin-elo-optimization.spec.ts` — Entirely analysis-page tests (6 tests)
- `src/__tests__/e2e/specs/09-admin/admin-experiment-detail.spec.ts` — Navigates from analysis page

### Timeline Tab (Issue 2)
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` — Timeline rendering, useEffect depends on refreshKey
- `evolution/src/components/evolution/AutoRefreshProvider.tsx` — Polling stops when isActive=false, no final refresh
- `src/app/admin/evolution/runs/[runId]/page.tsx` — Run detail: isActive = status === 'running' || 'claimed'
- `evolution/src/services/evolutionVisualizationActions.ts` — getEvolutionRunTimelineAction: no status filtering, always returns full data

## Key Findings

### Issue 1: Analysis Tab — Complete Deletion Inventory

**Safe to delete (analysis-only):**
1. `src/app/admin/evolution/analysis/page.tsx`
2. `src/app/admin/evolution/analysis/_components/StrategyLeaderboard.tsx`
3. `src/app/admin/evolution/analysis/_components/StrategyParetoChart.tsx`
4. `src/app/admin/evolution/analysis/_components/AgentROILeaderboard.tsx`
5. `src/app/admin/evolution/analysis/_components/CostSummaryCards.tsx`
6. `src/app/admin/evolution/analysis/_components/CostBreakdownPie.tsx`
7. `src/app/admin/evolution/analysis/_components/CostAccuracyPanel.tsx` + test
8. `src/app/admin/evolution/analysis/_components/StrategyDetail.tsx`
9. `evolution/src/services/costAnalyticsActions.ts` + test
10. `src/__tests__/e2e/specs/09-admin/admin-elo-optimization.spec.ts` (entire file)

**Functions to delete from eloBudgetActions.ts:**
- `getAgentROILeaderboardAction`, `getStrategyLeaderboardAction`, `getStrategyParetoAction`
- `getRecommendedStrategyAction`, `getOptimizationSummaryAction`
- `resolveStrategyConfigAction`, `updateStrategyAction` (unused outside analysis)
- Types: `AgentROI`, `StrategyLeaderboardEntry`, `ParetoPoint`

**Functions to KEEP in eloBudgetActions.ts:**
- `getStrategiesPeakStatsAction` + `StrategyPeakStats` — used by strategies list page
- `getStrategyRunsAction` + `StrategyRunEntry` — used by strategy detail page and RelatedRunsTab
- `getPromptRunsAction` — used in tests (could delete but low priority)

**Shared components to RELOCATE (not delete):**
- `StrategyConfigDisplay.tsx` → `src/app/admin/evolution/_components/` (used by strategy detail page)
- `ExperimentForm.tsx` → `src/app/admin/evolution/_components/` (used by start-experiment page)
- `ExperimentStatusCard.tsx` → `src/app/admin/evolution/_components/` (used by start-experiment page)
- `ExperimentHistory.tsx` → `src/app/admin/evolution/_components/` (used by experiments page)
- `runFormUtils.ts` — unused outside analysis, can delete or keep with ExperimentForm

**Navigation/UI to update:**
- `EvolutionSidebar.tsx` — Remove "Analysis" nav item
- `evolution-dashboard/page.tsx` — Remove Analysis quick link card
- `experiments/[experimentId]/page.tsx` — Remove "Analysis" breadcrumb
- `EvolutionSidebar.test.tsx`, `SidebarSwitcher.test.tsx`, `page.test.tsx` — Update assertions
- `admin-experiment-detail.spec.ts` — Fix navigation start point

### Issue 2: Timeline Tab — Root Cause & Fix

**Root cause:** When a run completes, `isActive` becomes false → `AutoRefreshProvider` stops incrementing `refreshKey` → `TimelineTab`'s useEffect never triggers a final refetch → UI shows stale data from the last polling cycle.

**Key insight:** Initial mount load works fine (completed runs load correctly when navigated to directly). The issue is only the active→inactive transition during a live session.

**Fix approach:** Add a "final refresh" mechanism in `AutoRefreshProvider` that triggers one last `refreshKey` increment when `isActive` transitions from `true` to `false`. This ensures all tabs (Timeline, Rating, Logs, Metrics) get one final data fetch after run completion.

**Data layer is correct:** `getEvolutionRunTimelineAction` has no status-based filtering — it always returns all iterations with all agent details from `evolution_checkpoints` and `evolution_agent_invocations`.

**Note on "iteration complete" text:** This exact string was NOT found in the codebase. The user's observation may describe stale/incomplete iteration data from the last refresh before polling stopped, rather than a literal "iteration complete" label.

## Open Questions
1. Should the shared components tests (ExperimentForm.test.tsx, ExperimentHistory.test.tsx, StrategyConfigDisplay.test.tsx) be relocated alongside their source files, or kept in the analysis _components directory? → Relocate with source files
2. Should `runFormUtils.ts` be kept (it's legacy) or deleted? → Delete along with its test since nothing imports it
3. Should the eloBudgetActions.test.ts file be kept (tests remain for getStrategiesPeakStatsAction, getStrategyRunsAction) or partially trimmed? → Keep tests for retained functions, delete tests for removed functions
