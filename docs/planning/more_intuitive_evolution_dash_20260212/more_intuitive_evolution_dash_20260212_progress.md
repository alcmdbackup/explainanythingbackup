# More Intuitive Evolution Dashboard Progress

## Phase 1: Critical Foundation (P0) — COMPLETE

### 1.1 Fix Silent Timeout Failures — DONE
**Files modified:**
- `src/lib/services/evolutionActions.ts` — `triggerEvolutionRunAction` catch block now marks run as failed in DB with structured error JSON `{ message, source, timestamp }`
- `src/app/api/cron/evolution-watchdog/route.ts` — configurable threshold via `EVOLUTION_STALENESS_THRESHOLD_MINUTES` env var (default: 10), per-run structured error messages with `lastIteration`, `lastPhase`, `lastHeartbeat`
- `src/components/evolution/EvolutionStatusBadge.tsx` — new `hasError` prop renders red dot indicator
- `src/lib/services/evolutionVisualizationActions.ts` — added `error_message` to `DashboardRun` type and query
- `src/app/admin/evolution-dashboard/page.tsx` — passes `hasError` to badge
- `src/app/admin/quality/evolution/page.tsx` — passes `hasError` to badge
- `src/app/admin/evolution-dashboard/page.test.tsx` — mock data includes `error_message: null`

### 1.2 Make Variant IDs Clickable — DONE
**Files modified:**
- `src/components/evolution/agentDetails/shared.tsx` — ShortId enhanced with `runId` prop that auto-constructs `/admin/quality/evolution/run/{runId}?tab=variants&variant={id}` URL
- `src/components/evolution/agentDetails/AgentExecutionDetailView.tsx` — threads `runId` to all detail components
- All 12 agent detail views — accept `runId` prop, pass to ShortId instances
- `src/components/evolution/tabs/TimelineTab.tsx` — threads runId to AgentDetailPanel and ExecutionDetailContent, replaces raw `id.substring(0,8)` with clickable ShortId
- `src/components/evolution/tabs/VariantsTab.tsx` — uses ShortId with onClick for expand/collapse, supports `?variant=` URL param for auto-expand via `useSearchParams`
- `src/components/evolution/tabs/TreeTab.tsx` — uses ShortId in node detail panel, threads runId through TreeGraph
- `src/components/evolution/tabs/EloTab.tsx` — tooltip note: "click in Variants tab for details" (Recharts tooltip limitation)

### 1.3 Consolidate Duplicate Run Tables — DONE
**Files modified:**
- `src/components/evolution/RunsTable.tsx` — new shared generic `RunsTable<T extends BaseRun>` component with column definitions, compact/full modes, maxRows
- `src/app/admin/evolution-dashboard/page.tsx` — uses `RunsTable<DashboardRun>` in compact mode (maxRows=5)
- `src/app/admin/quality/evolution/page.tsx` — uses `RunsTable<EvolutionRun>` with custom columns + actions

### 1.4 Differentiate Overlapping Page Purposes — DONE
**Files modified:**
- `src/app/admin/evolution-dashboard/page.tsx` — added summary metric cards (Active Runs, Success Rate, Avg Cost, Monthly Spend) with computed metrics from existing DashboardData; reduced maxRows from 10 to 5; updated subtitle
- `src/components/admin/EvolutionSidebar.tsx` — renamed "Start Pipeline" to "Pipeline Runs", added `description` tooltips to all nav items
- `src/components/admin/BaseSidebar.tsx` — added optional `description` field to `NavItem` interface, renders as `title` attribute on links
- `src/components/admin/EvolutionSidebar.test.tsx` — updated test to match "Pipeline Runs" label rename

### Unit Tests — DONE
**New test files:**
- `src/components/evolution/agentDetails/shared.test.tsx` — 12 tests for ShortId (URL construction, runId, href priority, onClick, button/span/link rendering), StatusBadge, CostDisplay, Metric, DetailSection

**Updated test files:**
- `src/components/evolution/EvolutionStatusBadge.test.tsx` — 3 new tests for `hasError` prop (error dot rendering, absence, with non-failed status)
- `src/app/admin/evolution-dashboard/page.test.tsx` — 3 new tests for summary metric cards (data display, loading placeholders, maxRows=5 "View all")
- `src/components/admin/EvolutionSidebar.test.tsx` — updated label assertion for "Pipeline Runs"

### Issues Encountered
- **Workflow hook blocking edits**: Branch `feat/more_intuitive_evolution_dash_20260212` but project folder at `docs/planning/more_intuitive_evolution_dash_20260212/` (no `feat/` prefix). Fixed with symlink.
- **Unused `useRouter` import**: After RunsTable consolidation, `router` became unused in evolution page. Removed import and variable.
- **Sidebar test assertion**: After renaming "Start Pipeline" → "Pipeline Runs", existing test needed updating.

### Final Verification
- tsc: clean (no errors)
- lint: clean (no warnings or errors)
- evolution tests: 70 suites, 1172 tests — all passing
- dashboard tests: 6/6 passing
- sidebar tests: 6/6 passing

## Phase 2: High-Impact Debugging & Cross-Linking (P1)

### 2.1 Make Explanation IDs Clickable — DONE
**Files created:**
- `src/lib/utils/evolutionUrls.ts` — centralized URL builders: `buildExplanationUrl`, `buildRunUrl`, `buildVariantUrl`, `buildExplorerUrl`
- `src/lib/utils/evolutionUrls.test.ts` — 6 tests for all URL builder functions

**Files modified:**
- `src/components/evolution/RunsTable.tsx` — explanation column now links to `/results?explanation_id=X` (was linking to run page); uses `buildRunUrl` for row navigation
- `src/app/admin/quality/evolution/page.tsx` — custom explanation column uses `<Link>` with `buildExplanationUrl` instead of plain `<span>`; variant dialog header links explanation ID
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — h1 header "Explanation #N" is now a clickable Link
- `src/app/admin/quality/hall-of-fame/[topicId]/page.tsx` — run selector shows ↗ link to explanation (uses `<a>` with `stopPropagation` since it's inside a `<button>`)

### 2.2 Surface Errors Visibly — DONE
**Files created:**
- `src/components/evolution/agentDetails/AgentErrorBlock.tsx` — categorized error display component (inline/block variants) with auto-categorization (API/format/timeout/unknown), expandable for long errors, optional format issues list
- `src/components/evolution/agentDetails/AgentErrorBlock.test.tsx` — 9 tests for categorization, inline/block variants, expand behavior, format issues

**Files modified:**
- `src/components/evolution/agentDetails/GenerationDetail.tsx` — replaced `title={s.error}` tooltip + `title={formatIssues.join}` tooltip with `<AgentErrorBlock>`
- `src/components/evolution/agentDetails/EvolutionDetail.tsx` — replaced `title={m.error}` tooltip with `<AgentErrorBlock>`
- `src/components/evolution/agentDetails/DebateDetail.tsx` — replaced `title={formatIssues.join}` tooltip with `<AgentErrorBlock>` with format issues list
- `src/components/evolution/agentDetails/IterativeEditingDetail.tsx` — replaced `title={c.formatIssues.join}` tooltip with `<AgentErrorBlock>` with format issues list
- `src/components/evolution/tabs/LogsTab.tsx` — added "Errors only" filter preset button
- `src/components/evolution/agentDetails/AgentExecutionDetailView.test.tsx` — updated assertion to use regex matcher for split text nodes

### 2.3 Enhance Log Viewer — DONE
**Files created:**
- `src/components/evolution/tabs/LogsTab.test.tsx` — 11 tests for pagination, search, time-delta, inline cost, tree view, error/empty states

**Files modified:**
- `src/components/evolution/tabs/LogsTab.tsx` — 5 enhancements:
  1. **Pagination UI** — First/Prev/Next/Last buttons wiring up existing server-side `offset` parameter; "1–500 of N" display
  2. **Search box** — client-side filter on message field; clears with other filters
  3. **Time-delta column** — shows +5.0s / +1m5s between entries; amber highlight for gaps >10s
  4. **Inline cost badge** — extracts cost from context JSON (cost/costUsd/cost_usd/totalCost/total_cost fields); shows $0.0035 badge
  5. **Collapsible tree view** — recursive `ContextTree`/`ContextTreeNode` components replace raw `JSON.stringify`; syntax highlighting per type; independently collapsible nested nodes

### 2.4 Variant Debugging Path — DONE
**Files created:**
- `src/components/evolution/VariantDetailPanel.tsx` — debugging panel with match history (W/L, confidence, opponent ShortId), dimension score bars, parent lineage with word-level TextDiff, "Jump to agent" link, cost display
- `src/components/evolution/VariantDetailPanel.test.tsx` — 8 tests for all sections, error state, empty matches

**Files modified:**
- `src/lib/services/evolutionVisualizationActions.ts` — added `VariantDetail` interface and `getVariantDetailAction` server action (extracts per-variant data from checkpoint state)
- `src/components/evolution/tabs/VariantsTab.tsx` — added "Why this score?" toggle in expanded view; renders VariantDetailPanel inline

### 2.5 Budget Health Alerts — DONE
**Files modified:**
- `src/components/evolution/RunsTable.tsx` — added `budget_cap_usd` to `BaseRun` interface; budget warning badge (! at 80%, !! at 90%) in cost column
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — replaced plain cost text with `BudgetBar` component (green <70%, amber 70-90%, red >90%)
- `src/components/evolution/tabs/BudgetTab.tsx` — added `BudgetStatusCard` at top showing "On Track"/"At Risk"/"Over Budget" with burn rate (~$X.XXX/iteration, iterations until budget)

### 2.6 Reverse Navigation — DONE
**Files modified:**
- `src/lib/services/eloBudgetActions.ts` — added `getPromptRunsAction(promptId, limit?)` querying `evolution_runs WHERE prompt_id = ?`
- `src/lib/services/eloBudgetActions.test.ts` — 3 new tests for `getPromptRunsAction`
- `src/app/admin/quality/strategies/page.tsx` — expandable "Show runs using this strategy" section in `StrategyDetailRow` with clickable run/explanation links
- `src/app/admin/quality/prompts/page.tsx` — expandable runs section per prompt row; click to see runs using that prompt
- `src/app/admin/quality/optimization/_components/StrategyDetail.tsx` — Date column links to run detail, Topic column links to explanation

### 2.7 Standardize Number Formatting — DONE
**Files created:**
- `src/lib/utils/formatters.ts` — 9 formatter functions: formatCost (2dp), formatCostDetailed (3dp), formatCostMicro (4dp), formatElo (integer), formatEloDollar (1dp), formatPercent, formatDuration, formatScore (2dp), formatScore1 (1dp). All handle null/undefined/NaN.
- `src/lib/utils/formatters.test.ts` — 20 tests covering all formatters + edge cases

**Files modified (22 files):**
- `src/components/evolution/agentDetails/shared.tsx` — CostDisplay uses formatCostMicro
- `src/components/evolution/agentDetails/CalibrationDetail.tsx` — formatScore1/formatScore
- `src/components/evolution/agentDetails/IterativeEditingDetail.tsx` — formatScore1/formatScore
- `src/components/evolution/agentDetails/MetaReviewDetail.tsx` — formatScore/formatElo
- `src/components/evolution/agentDetails/OutlineGenerationDetail.tsx` — formatScore
- `src/components/evolution/agentDetails/ReflectionDetail.tsx` — formatScore/formatScore1
- `src/components/evolution/agentDetails/TournamentDetail.tsx` — formatScore
- `src/components/evolution/tabs/BudgetTab.tsx` — formatCost/formatCostDetailed
- `src/components/evolution/tabs/TimelineTab.tsx` — formatCostMicro/formatScore/formatCostDetailed
- `src/components/evolution/tabs/LogsTab.tsx` — formatCostMicro
- `src/components/evolution/RunsTable.tsx` — formatCost
- `src/components/evolution/StepScoreBar.tsx` — formatScore
- `src/components/evolution/VariantDetailPanel.tsx` — formatCostMicro/formatScore1
- `src/app/admin/evolution-dashboard/page.tsx` — formatCost
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — formatCost
- `src/app/admin/quality/optimization/_components/CostAccuracyPanel.tsx` — formatCostDetailed/formatCost
- `src/app/admin/quality/optimization/_components/CostBreakdownPie.tsx` — formatCost
- `src/app/admin/quality/optimization/_components/CostSummaryCards.tsx` — formatCost/formatElo
- `src/app/admin/quality/optimization/_components/StrategyDetail.tsx` — formatElo/formatCostDetailed
- `src/app/admin/quality/optimization/_components/StrategyParetoChart.tsx` — formatCost/formatElo/formatCostDetailed
- `src/app/admin/quality/prompts/page.tsx` — formatCostDetailed

**Intentionally kept inline:** ProximityDetail .toFixed(3) (non-cost 3dp), Recharts chart callbacks, LogsTab formatTimeDelta helper, VariantDetailPanel confidence percentage

### 2.8 Merge Redundant Tabs (7→5) — DONE
**Tab merges:**
- **Budget → Timeline:** BudgetSection embedded as self-contained sub-component with own data loading, auto-refresh, and collapsible details toggle. BudgetStatusCard always visible at top.
- **Tree → Lineage:** TreeGraph and TreeContent moved into LineageTab. Toggle between "Full DAG" and "Pruned Tree" views; toggle only shown when tree search data exists.

**URL sync:**
- Tab switching now calls `router.replace()` to keep URL in sync with active tab
- Legacy tab mapping: `?tab=budget` → `?tab=timeline` (budget expanded), `?tab=tree` → `?tab=lineage` (tree view active)
- Legacy URLs immediately replaced via `router.replace()` to avoid polluting history

**Auto-refresh:**
- TimelineTab now auto-refreshes timeline data every 5s for active runs (matches former BudgetTab behavior)
- BudgetSection auto-refreshes independently

**Files modified:**
- `src/components/evolution/tabs/TimelineTab.tsx` — absorbed BudgetTab content as BudgetSection; added runStatus/initialBudgetExpanded props; added auto-refresh
- `src/components/evolution/tabs/LineageTab.tsx` — absorbed TreeTab content (TreeGraph, TreeContent); added initialView prop and view toggle
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — removed BudgetTab/TreeTab imports; updated TabId (5 tabs); added mapLegacyTab, handleTabChange with URL sync; passes runStatus to TimelineTab
- `src/components/evolution/tabs/BudgetTab.test.tsx` — migrated to render TimelineTab; 7 tests (all passing)
- `src/components/evolution/tabs/TimelineTab.test.tsx` — added next/dynamic mock, getEvolutionRunBudgetAction mock; updated waitFor selectors for merged structure; 18 tests
- `src/__tests__/e2e/specs/09-admin/admin-evolution-visualization.spec.ts` — removed Budget button assertion; added Logs button + budget-tab testid assertions

**Files removed:**
- `src/components/evolution/tabs/BudgetTab.tsx`
- `src/components/evolution/tabs/TreeTab.tsx`

### Verification (Phase 2 complete)
- tsc: clean (no errors)
- lint: clean (only pre-existing design system warnings)
- 233 test suites, 4536 tests — all passing

## Phase 3: Navigation & Structure (P2)

### 3.1 Reorganize Sidebar — DONE (commit `5e0323ef`)
**Files modified:**
- `src/components/admin/BaseSidebar.tsx` — added `NavGroup` interface and `isNavGroupArray()` type guard; renders grouped sections with headers when `NavGroup[]` provided, flat list for `NavItem[]` (backward compatible)
- `src/components/admin/EvolutionSidebar.tsx` — restructured nav items into 4 groups: Overview, Runs, Analysis, Reference; added `description` tooltips and `activeOverrides`

### 3.2 Enhance Auto-Refresh — DONE (commit `02a0b9b1`)
**Files modified:**
- `src/components/evolution/AutoRefreshProvider.tsx` — complete rewrite from `onRefresh` callback to shared `refreshKey`-based context; `RefreshIndicator` component with "Updated Xs ago" + manual refresh; tab visibility handling
- `src/components/evolution/AutoRefreshProvider.test.tsx` — 10 tests for new API
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — split into provider wrapper + consumer content; removed internal 5s interval; uses shared context
- `src/components/evolution/tabs/TimelineTab.tsx` — uses `refreshKey` from context; `initialLoad` ref pattern for first load vs refresh distinction
- `src/components/evolution/tabs/EloTab.tsx` — added auto-refresh via `refreshKey` context
- `src/components/evolution/tabs/LogsTab.tsx` — removed internal auto-refresh interval; uses shared context
- `src/app/admin/evolution-dashboard/page.tsx` — split into provider wrapper + consumer; 15s interval for dashboard
- `src/app/admin/evolution-dashboard/page.test.tsx` — updated mock for new `useAutoRefresh` API
- `src/components/evolution/tabs/BudgetTab.test.tsx` — wrapped in `AutoRefreshProvider`; fixed timer cleanup

### 3.3 Sync Explorer Filters to URL — DONE (commit `bfd09b4c`)
**Files modified:**
- `src/app/admin/quality/explorer/page.tsx` — split into Suspense wrapper + `ExplorerContent` with `useSearchParams`-backed state; `syncToUrl()` helper for shallow URL replacement; per-filter sync wrappers; default values omitted from URL
- `src/lib/utils/evolutionUrls.ts` — extended `buildExplorerUrl` with `ExplorerUrlFilters` interface; handles arrays (comma-joined), omits empty values
- `src/lib/utils/evolutionUrls.test.ts` — 3 new tests for array joining, empty value omission

### Phase 3 Batch 1 Verification
- tsc: clean (no errors)
- lint: clean
- 74 evolution test suites, 1212 tests — all passing
- evolutionUrls: 8/8 tests passing

### 3.4 Add Breadcrumbs — DONE (commit `a3202544`)
**Files created:**
- `src/components/evolution/EvolutionBreadcrumb.tsx` — shared breadcrumb component with `BreadcrumbItem[]` interface, aria-label, data-testid
- `src/components/evolution/EvolutionBreadcrumb.test.tsx` — 6 tests for empty, single, 2-level, 3-level, separators, accessibility

**Files modified:**
- `src/components/evolution/index.ts` — exported `EvolutionBreadcrumb` and `BreadcrumbItem`
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — replaced inline breadcrumb with shared component, includes active tab name
- `src/app/admin/quality/hall-of-fame/[topicId]/page.tsx` — replaced inline breadcrumb with shared component
- `src/app/admin/quality/explorer/page.tsx` — added breadcrumb (Dashboard > Explorer)
- `src/app/admin/quality/optimization/page.tsx` — added breadcrumb (Dashboard > Elo Optimization)
- `src/app/admin/quality/hall-of-fame/page.tsx` — added breadcrumb (Dashboard > Hall of Fame)
- `src/app/admin/quality/strategies/page.tsx` — added breadcrumb (Dashboard > Strategy Registry)
- `src/app/admin/quality/prompts/page.tsx` — added breadcrumb (Dashboard > Prompt Registry)

### 3.5 Improve Chart Readability — DONE (commit `a2dcecee`)
**Files modified:**
- `src/components/evolution/tabs/EloTab.tsx` — ReferenceLine at baseline 1200, contextual Y-axis min (rounded down to nearest 50), axis labels (Iteration/Elo), "Top N of M" display
- `src/components/evolution/tabs/TimelineTab.tsx` — BurnChart: axis labels (Step/Cost), budget cap label improved to "$X.XX budget", estimated total reference line when prediction data exists
- `src/app/admin/quality/explorer/page.tsx` — TrendChart: Y-axis label showing active metric name, axis date label
- `src/app/admin/quality/hall-of-fame/[topicId]/page.tsx` — CostEloScatter: median quadrant reference lines (cost/elo medians), "Optimal" zone highlight (low cost, high Elo)

### 3.6 Reduce Table Column Density — DONE (commit `7a02b3db`)
**Files modified:**
- `src/components/evolution/RunsTable.tsx` — compact mode uses `px-2 py-1.5` padding (was `p-3`)
- `src/components/evolution/tabs/VariantsTab.tsx` — merged ID into rank cell with 6-char inline display + title tooltip; removed standalone ID column; widened sparkline column (w-28); removed unused ShortId import
- `src/components/evolution/tabs/VariantsTab.test.tsx` — updated ID assertions for 6-char truncation
- `src/app/admin/quality/hall-of-fame/[topicId]/page.tsx` — stacked Method+Model into single cell; used formatCost; reduced to 9 columns; tighter padding

### Phase 3 Batch 2 Verification
- tsc: clean (no errors)
- lint: clean
- 75 evolution test suites, 1218 tests — all passing

### 3.7 Standardize Status Indicators — DONE (commit `e7b25555`)
**Files modified:**
- `src/components/evolution/EvolutionStatusBadge.tsx` — added `STATUS_ICONS` map with Unicode symbols (checkmark, X, play, hourglass, pause); icon rendered alongside status text
- `src/components/evolution/EvolutionStatusBadge.test.tsx` — added icon rendering test for all 6 statuses
- `src/components/evolution/RunsTable.tsx` — added budget-based progress bar to iteration column for active runs (green/amber/red thresholds)

### 3.8 Add Run Progress Display — DONE (commit `542c0b43`)
**Files modified:**
- `src/components/evolution/EvolutionStatusBadge.tsx` — "claimed" status displays as "starting" for user clarity
- `src/components/evolution/EvolutionStatusBadge.test.tsx` — updated "claimed" assertion to expect "starting"
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — PhaseIndicator uses real `strategy.config.iterations` instead of hardcoded 15; added budget usage percentage; added ETA estimate for active runs (avg iteration duration extrapolation)

### Phase 3 Batch 3 Verification (Phase 3 COMPLETE)
- tsc: clean (no errors)
- lint: clean
- 75 evolution test suites, 1219 tests — all passing

## Phase 4: Polish & Cleanup (P3)

### 4.1 Simplify Explorer Controls — DONE
**Files modified:**
- `src/app/admin/quality/explorer/page.tsx` — replaced flat ButtonGroup for Table/Matrix/Trend with split UI: Table is default with "Advanced Views ›" link; advanced mode shows Matrix/Trend with "‹ Back to Table" link. Removed unused `VIEW_MODES` constant.

### 4.2 Remove Unused Features — DONE
**Files modified:**
- `src/app/admin/quality/evolution/page.tsx` — replaced `StartBatchCard` (full card with parallel, max runs, dry run inputs) with compact `BatchDispatchButtons` (inline buttons for dispatch + trigger all pending)
- `src/app/admin/quality/hall-of-fame/page.tsx` — replaced `PromptBankCoverage` (detailed grid matrix + method summary table) with `PromptBankSummary` (compact text summary with coverage percentages and method stat chips)

### 4.3 Page Title & Naming Clarity — DONE
**Files modified:**
- `src/app/admin/quality/evolution/page.tsx` — renamed heading "Content Evolution" → "Pipeline Runs" with new subtitle
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — heading shows both "Run {shortId}" and linked "Explanation #{id}" side-by-side; breadcrumb updated to "Pipeline Runs"
- `src/app/admin/quality/evolution/run/[runId]/compare/page.tsx` — replaced inline breadcrumb with shared `EvolutionBreadcrumb`; heading changed to "Before & After Comparison"
- `src/__tests__/e2e/specs/09-admin/admin-evolution.spec.ts` — updated assertion from "Content Evolution" to "Pipeline Runs"

### 4.4 Loading & Empty State Consistency — DONE
**Files created:**
- `src/components/evolution/TableSkeleton.tsx` — shared table loading skeleton with `columns` and `rows` props
- `src/components/evolution/TableSkeleton.test.tsx` — 4 tests
- `src/components/evolution/EmptyState.tsx` — shared empty state with `message`, `suggestion`, `icon`, `action` props
- `src/components/evolution/EmptyState.test.tsx` — 6 tests

**Files modified:**
- `src/components/evolution/index.ts` — exported TableSkeleton and EmptyState
- `src/components/evolution/RunsTable.tsx` — uses TableSkeleton and EmptyState
- `src/app/admin/quality/hall-of-fame/page.tsx` — uses TableSkeleton and EmptyState
- `src/app/admin/quality/strategies/page.tsx` — uses TableSkeleton and EmptyState
- `src/app/admin/quality/prompts/page.tsx` — uses TableSkeleton and EmptyState

### 4.5 Add Distributed Tracing — DONE
**Files created:**
- `supabase/migrations/20260215000001_evolution_logs_tracing.sql` — added `request_id`, `cost_usd`, `duration_ms` columns + index

**Files modified:**
- `src/lib/evolution/core/logger.ts` — extended LogEntry with 3 new fields; LogBuffer.append extracts from context; createDbEvolutionLogger generates requestId per invocation
- `src/lib/evolution/core/logger.test.ts` — updated assertions for new fields
- `src/lib/services/evolutionActions.ts` — extended RunLogEntry with new fields; updated select query
- `src/components/evolution/tabs/LogsTab.tsx` — inline badges for cost_usd, duration_ms, request_id (6-char prefix)
- `src/components/evolution/tabs/LogsTab.test.tsx` — updated makeEntry helper with new field defaults

### 4.6 Log Export — DONE
**Files modified:**
- `src/components/evolution/tabs/LogsTab.tsx` — ExportButton dropdown with JSON (full context) and CSV (flattened) export; run metadata in export header; client-side Blob download; RFC 4180 CSV escaping
- `src/components/evolution/tabs/LogsTab.test.tsx` — 5 new tests for export button visibility, dropdown options, JSON/CSV download triggers

### Phase 4 Verification (Phase 4 COMPLETE)
- tsc: clean (no errors)
- lint: clean
- 236 test suites, 4551 tests — all passing
