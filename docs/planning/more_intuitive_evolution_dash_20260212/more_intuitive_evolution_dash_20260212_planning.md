# More Intuitive Evolution Dashboard Plan

## Background
Explore ways to make the evolution dashboard more intuitive and easy to analyze. It should always be possible to deep dive and be cross-linked from run to agent to article involved, etc. This is of paramount importance.

## Requirements (from GH Issue #437)
Explore ways to make the evolution dashboard more intuitive and easy to analyze. It should always be possible to deep dive and be cross-linked from run to agent to article involved, etc. This is of paramount importance.

## Problem

The evolution dashboard spans 12 pages, 7 run detail tabs, 12 agent detail views, and 56 server actions — but cross-linking between entities is partial and navigation is predominantly one-directional. Variant IDs are displayed in 24 locations but are never clickable. Explanation IDs appear in 11 locations but are mostly not linked. There is no reverse navigation from strategies or prompts back to the runs that used them. Duplicate run tables exist on multiple pages, 3 pages serve overlapping "view runs" purposes, and cost/status data is presented inconsistently across the dashboard. When runs fail silently (e.g., serverless timeout), there is no error capture, and debugging paths are blocked by errors hidden in tooltips, no log search, and no variant performance tracing.

## Options Considered

### Approach A: Cross-Link-First (Bottom-Up)
Add clickable links to all 24 variant ID locations, 11 explanation ID locations, and strategy/prompt reverse navigation. Leave page structure unchanged.
- **Pro:** Minimal disruption, each link is a small PR
- **Con:** Doesn't fix the underlying redundancy and page confusion. Adds more links to already-cluttered pages.

### Approach B: Simplify-First (Top-Down)
Consolidate overlapping pages, merge redundant tabs, remove duplicate tables. Then add cross-links to the simplified structure.
- **Pro:** Reduces cognitive load before adding complexity. Cleaner end state.
- **Con:** Larger initial refactor, higher risk of breaking existing workflows.

### Approach C: Phased Hybrid (Recommended)
Phase 1 lays foundation with critical fixes (timeout handling, clickable IDs, shared components). Phase 2 adds high-impact debugging and cross-linking. Phase 3 restructures navigation. Phase 4 polishes readability. Each phase is independently shippable.
- **Pro:** Incremental value delivery. Foundation enables later phases. Risk is distributed.
- **Con:** Full completion takes longer. Some redundancy persists between phases.

**Decision:** Approach C — Phased Hybrid.

---

## Phased Execution Plan

### Phase 1: Critical Foundation (P0)

**Goal:** Fix the worst debugging blind spot, unlock variant navigation, and eliminate the most confusing UI redundancy.

#### 1.1 Fix Silent Timeout Failures
**Research ref:** §23.1 | **Impact:** Debugging

Runs killed by serverless timeout stay in `running` status forever with null `error_message`. No graceful shutdown exists.

**Platform constraint:** Vercel serverless does not reliably deliver SIGTERM before process termination. The existing `/api/cron/evolution-watchdog` cron (runs every 15 minutes, 10-minute staleness threshold) is the correct mechanism for detecting abandoned runs. Do NOT add SIGTERM handlers — they will never fire on the primary deployment platform.

**Tasks:**
- [ ] Enhance the existing try/catch around `executeFullPipeline()` (lines 617-625 in evolutionActions.ts) to persist structured error on failure: `{ iteration, agent, step, message, timestamp }`. The try/catch already exists but the catch block only returns `{ success: false }` without updating the DB.
- [ ] Fix `triggerEvolutionRunAction` error path: when `executeFullPipeline` throws, the server action catch block (evolutionActions.ts:623-625) returns `{ success: false }` but does NOT update the run's status to `failed` in the DB. Add a direct Supabase update in the catch block (matching the watchdog pattern: `supabase.from('evolution_runs').update({ status: 'failed', error_message: structuredError }).eq('id', runId)`) rather than calling `markRunFailed` from pipeline.ts, since `markRunFailed` requires an `agentName` parameter not available in the server action context.
- [ ] Enhance existing evolution-watchdog cron: make staleness threshold configurable via `EVOLUTION_STALENESS_THRESHOLD_MINUTES` env var (default: 10 minutes — keep current default to avoid race condition with 15-minute cron schedule in vercel.json). Add structured error message `"Run abandoned: no heartbeat for N minutes (likely serverless timeout)"`, include last known iteration/phase in error context. **Note:** If reducing threshold below 15 minutes, also update the cron schedule in `vercel.json` to run more frequently (e.g., `*/5` for 5-minute threshold).
- [ ] Add error badge to run list views (evolution page, dashboard) — red dot on status badge if `error_message` is populated

**Files to modify:**
- `src/lib/evolution/core/pipeline.ts` (try/catch with structured error)
- `src/lib/services/evolutionActions.ts` (fix triggerEvolutionRunAction catch block)
- `src/app/api/cron/evolution-watchdog/route.ts` (enhance error messages, reduce threshold)
- `src/app/admin/quality/evolution/page.tsx` (error indicator in table)
- `src/app/admin/evolution-dashboard/page.tsx` (error indicator in table)

#### 1.2 Make Variant IDs Clickable (24 Locations)
**Research ref:** §24.2, §14 | **Impact:** Navigation

Most variant IDs use `ShortId` component (`shared.tsx:53-54`). None are clickable. All call sites have `runId` available in their component tree.

**SVG rendering constraint:** LineageGraph.tsx renders variant IDs inside D3-managed SVG. React `<Link>` components cannot be used inside SVG. TreeTab.tsx line 288 uses raw `id.substring()` (not ShortId). EloTab.tsx line 48 shows variant IDs in Recharts tooltips (Recharts limitation — not clickable). These 3 locations need different handling than the ~20 DOM-based ShortId locations.

**Tasks:**
- [ ] Enhance `ShortId` to accept optional `href` or `onClick` + `runId` props. When provided, render as `<Link>` instead of `<span>`. Keep gold color, add `hover:underline`. This covers ~20 DOM-based call sites.
- [ ] For **LineageGraph** (SVG): The VariantCard is already rendered in React (not SVG) via the side panel. Add a "View Details" link in the VariantCard that navigates to `?tab=variants&variant={id}`. No SVG modification needed.
- [ ] For **TreeTab** node detail panel: Replace raw `id.substring(0, 8)` with `ShortId` component (the panel is rendered in React, not SVG). Add `runId` and `onClick` props.
- [ ] For **EloTab** tooltips: Accept as a known limitation (Recharts tooltips can't contain interactive elements). Add a note in tooltip: "Click variant in Variants tab for details."
- [ ] Create `getVariantDetailAction(runId, variantId)` server action that returns: variant content, Elo, agent, generation, parent chain (up to 10 ancestors via existing traversal pattern from `unifiedExplorerActions.ts:718-789`), match history (from checkpoint deserialization). **Note:** `getEvolutionVariantsAction` uses `.select('*')` which already fetches `parent_variant_id` from DB — extend the `EvolutionVariant` TypeScript interface to include it rather than creating a separate query.
- [ ] Create `VariantDetailPanel` component — usable as both inline expansion (in tabs) and side panel (in graphs), following existing `ArticleDetailPanel` pattern: content preview (256px scroll), parent lineage chain, match history summary, creation agent + cost
- [ ] Update all ~20 DOM-based `ShortId` call sites to pass `runId` and link to `?tab=variants&variant={id}` on the run detail page
- [ ] In `VariantsTab`, handle `initialVariant` URL param to auto-expand the target variant on load

**Files to modify:**
- `src/components/evolution/agentDetails/shared.tsx` (ShortId enhancement)
- `src/lib/services/evolutionVisualizationActions.ts` (new getVariantDetailAction)
- `src/lib/services/evolutionActions.ts` (extend EvolutionVariant interface to include parent_variant_id)
- `src/components/evolution/VariantDetailPanel.tsx` (new component)
- `src/components/evolution/tabs/VariantsTab.tsx` (handle initialVariant param)
- All 10 agent detail files in `src/components/evolution/agentDetails/`
- `src/components/evolution/tabs/TimelineTab.tsx`
- `src/components/evolution/tabs/TreeTab.tsx` (replace raw id.substring with ShortId)
- `src/components/evolution/tabs/EloTab.tsx` (tooltip note only)
- `src/components/evolution/VariantCard.tsx` (add "View Details" link)

#### 1.3 Consolidate Duplicate Run Tables
**Research ref:** §22.1 | **Impact:** Simplification

Dashboard (`page.tsx:181-225`) and Evolution page (`page.tsx:822-940`) have separate run table implementations using the same data source.

**Type mismatch note:** Dashboard uses `DashboardRun` type (from `evolutionVisualizationActions.ts` — includes `started_at`/`completed_at` for ElapsedTime), while Evolution page uses `EvolutionRun` type (from `evolutionActions.ts` — includes `strategy_config_id`, `prompt_id`). The shared `RunsTable` must use a generic type or union type to handle both shapes. Use a generic `RunsTable<T extends BaseRun>` where `BaseRun` contains the common fields, and column definitions specify which fields to render.

**Tasks:**
- [ ] Define `BaseRun` interface with common fields shared by `DashboardRun` and `EvolutionRun`
- [ ] Extract shared `RunsTable<T extends BaseRun>` component to `src/components/evolution/RunsTable.tsx` with props: `runs: T[]`, `columns` (configurable column definitions with accessor functions), `onRowClick`, `compact` (boolean for dashboard mode)
- [ ] Dashboard: use `RunsTable<DashboardRun>` in compact mode (7 columns, no actions, limit 10 rows, read-only)
- [ ] Evolution page: use `RunsTable<EvolutionRun>` in full mode (11 columns, actions column, all rows)
- [ ] Ensure consistent styling, status badges, date formatting across both uses

**Files to modify:**
- `src/components/evolution/RunsTable.tsx` (new shared component)
- `src/app/admin/evolution-dashboard/page.tsx` (replace inline table)
- `src/app/admin/quality/evolution/page.tsx` (replace inline table)

#### 1.4 Differentiate Overlapping Page Purposes
**Research ref:** §22.2 | **Impact:** Simplification

Dashboard, Evolution, and Explorer all show run data with overlapping controls.

**Tasks:**
- [ ] **Dashboard** → Pure metrics: remove runs table (replaced by compact `RunsTable` showing only top 5 recent), add summary cards (Total Runs, Success Rate, Avg Cost, Top Strategy) sourced from existing optimization actions, keep charts (30d runs/spend)
- [ ] **Evolution page** → Operational hub: keep full `RunsTable`, start pipeline card, queue dialog, apply winners, batch dispatch. This is THE place for run management.
- [ ] **Explorer** → Pure analytics: keep dimensional filtering, remove operational actions. Subtitle: "Cross-dimensional analysis of evolution runs, articles, and tasks"
- [ ] Update sidebar descriptions/tooltips to match new positioning

**Files to modify:**
- `src/app/admin/evolution-dashboard/page.tsx` (add summary cards, slim down runs display)
- `src/app/admin/quality/explorer/page.tsx` (add subtitle, remove any operational elements)
- `src/components/admin/EvolutionSidebar.tsx` (update descriptions)

---

### Phase 2: High-Impact Debugging & Cross-Linking (P1)

**Goal:** Make debugging paths complete, add critical cross-links, and standardize data presentation.

**Dependency:** Phase 1 complete (ShortId clickable, shared RunsTable, page differentiation).

#### 2.1 Make Explanation IDs Clickable (11 Locations)
**Research ref:** §24.3, §15 | **Impact:** Navigation

Canonical URL `/results?explanation_id={id}` works but is never used in evolution dashboard.

**Tasks:**
- [ ] Create URL builder utility: `buildExplanationUrl(id: number): string` → `/results?explanation_id=${id}` in `src/lib/utils/evolutionUrls.ts`
- [ ] Also add `buildRunUrl(runId)`, `buildVariantUrl(runId, variantId)`, `buildExplorerUrl(filters?)` to centralize all evolution URL construction
- [ ] Replace plain text explanation IDs with `<Link>` in all 11 locations (see §15 for exact files/lines)
- [ ] Thread `explanation_id` as prop to run detail tab components that need it

**Files to modify:**
- `src/lib/utils/evolutionUrls.ts` (new utility)
- `src/app/admin/quality/evolution/page.tsx` (lines 867-874)
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` (line 241, plus prop threading)
- `src/app/admin/evolution-dashboard/page.tsx` (lines 206-211)
- `src/app/admin/quality/hall-of-fame/[topicId]/page.tsx` (line 457)
- `src/app/admin/quality/optimization/page.tsx` (strategy runs modal)

#### 2.2 Surface Errors Visibly
**Research ref:** §23.2 | **Impact:** Debugging

Errors across all 12 agent detail views are hidden in `title` attribute tooltips.

**Tasks:**
- [ ] Create `AgentErrorBlock` component: red-bordered card with error icon, message, error category (API/format/timeout), and remediation context
- [ ] Replace all `title={error}` patterns in agent detail views with `<AgentErrorBlock>` when error exists
- [ ] In `GenerationDetail`: expand format issue display from count+tooltip to visible list
- [ ] Add error-level filter preset to LogsTab filter bar ("Show errors only" button)

**Files to modify:**
- `src/components/evolution/agentDetails/AgentErrorBlock.tsx` (new component)
- All 10 agent detail files in `src/components/evolution/agentDetails/`
- `src/components/evolution/tabs/LogsTab.tsx` (error filter preset)

#### 2.3 Enhance Log Viewer
**Research ref:** §23.3 | **Impact:** Debugging

LogsTab has 500-entry limit with no pagination, no search, raw JSON context.

**Tasks:**
- [ ] Add pagination UI: "Showing 1-500 of N" with first/prev/next/last buttons. **Note:** `RunLogFilters` already includes `offset?: number` (evolutionActions.ts:895-896) — the server-side pagination support exists. Only the LogsTab UI needs pagination controls to wire up the existing offset parameter.
- [ ] Add search box in filter bar — client-side filter on `message` field within loaded entries
- [ ] Display cost inline on log entries that have cost data in context JSON (show `$0.05` badge)
- [ ] Replace raw JSON dump with collapsible tree view for context expansion (use recursive key-value renderer)
- [ ] Add time-delta column: show seconds since previous log entry

**Files to modify:**
- `src/components/evolution/tabs/LogsTab.tsx` (pagination UI, search, inline cost, tree view)

#### 2.4 Variant Debugging Path
**Research ref:** §23.6 | **Impact:** Debugging

No way to trace why a variant scored poorly. Can't see match history, parent lineage, or creating agent from variant view.

**Tasks:**
- [ ] Extend `VariantDetailPanel` (from 1.2) with:
  - Match history section: opponent ID (clickable ShortId), winner, confidence, dimension scores
  - "Jump to creating agent" button: links to `?tab=timeline&iteration=N&agent=X`
  - Text diff to parent variant (use `diffWordsWithSpace` from existing compare page pattern)
- [ ] Add dimension score display if critique data available (horizontal bars per dimension)
- [ ] In VariantsTab expanded view: add "Why this score?" link that opens VariantDetailPanel

**Files to modify:**
- `src/components/evolution/VariantDetailPanel.tsx` (extend from 1.2)
- `src/components/evolution/tabs/VariantsTab.tsx` (add "Why this score?" link)

#### 2.5 Budget Health Alerts
**Research ref:** §23.7 | **Impact:** Debugging

No warning before budget is exceeded. Runs can be killed silently.

**Tasks:**
- [ ] Add budget health indicator to run detail header: color-coded progress bar (green <70%, amber 70-90%, red >90%)
- [ ] Add budget warning badge to runs in `RunsTable` when cost exceeds 80% of budget
- [ ] In BudgetTab: add "Budget Status" card at top — "On Track" / "At Risk" / "Over Budget" with burn rate estimate
- [ ] Add burn rate display: "~$X.XX/iteration, will hit budget at iteration N"

**Files to modify:**
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` (header budget bar)
- `src/components/evolution/RunsTable.tsx` (budget warning badge)
- `src/components/evolution/tabs/BudgetTab.tsx` (budget status card + burn rate)

#### 2.6 Reverse Navigation (Strategy/Prompt → Runs)
**Research ref:** §24.4, §16 | **Impact:** Navigation

No way to see which runs used a specific strategy or prompt. DB indexes exist but no server actions.

**Tasks:**
- [ ] Create `getRunsByStrategyAction(strategyId, limit?)` — query `evolution_runs WHERE strategy_config_id = ?` (index: `idx_evolution_runs_strategy`)
- [ ] Create `getRunsByPromptAction(promptId, limit?)` — query `evolution_runs WHERE prompt_id = ?` (index: `idx_evolution_runs_prompt`)
- [ ] Add "Runs using this strategy" expandable section in strategy detail row (Strategies page) — show compact `RunsTable` with clickable run IDs
- [ ] Add "Runs using this prompt" expandable section in prompt row (Prompts page)
- [ ] In Optimization page strategy detail modal: make `runId` column clickable → run detail page, make `explanationTitle` clickable → article page

**Files to modify:**
- `src/lib/services/evolutionActions.ts` (new server actions)
- `src/app/admin/quality/strategies/page.tsx` (runs section in expanded row)
- `src/app/admin/quality/prompts/page.tsx` (runs section in expanded row)
- `src/app/admin/quality/optimization/page.tsx` (clickable runId + explanationTitle)

#### 2.7 Standardize Number Formatting
**Research ref:** §25.2 | **Impact:** Readability

Cost formatting ranges from `$0.12` to `$0.0000` across pages. Elo shown as integer in some places, decimal in others.

**Tasks:**
- [ ] Create formatters in `src/lib/utils/formatters.ts`:
  - `formatCost(usd: number): string` → `$0.00` (2 decimals — tables, summaries, headers)
  - `formatCostDetailed(usd: number): string` → `$0.000` (3 decimals — per-agent breakdowns in BudgetTab)
  - `formatCostMicro(usd: number): string` → `$0.0000` (4 decimals — individual LLM call costs in agent detail views, preserving current CostDisplay precision to avoid hiding meaningful differences like $0.0012 vs $0.0018)
  - `formatElo(score: number): string` → integer, no decimals
  - `formatEloDollar(ratio: number): string` → 1 decimal
  - `formatDuration(seconds: number): string` → human-readable (reuse ElapsedTime pattern)
  - `formatPercent(ratio: number): string` → `85%` not `0.85`
  - All formatters must handle null/undefined/NaN inputs gracefully (return `—` or `$0.00`)
- [ ] Search-and-replace all inline `.toFixed()` calls across dashboard pages with shared formatters. **Note:** `CostDisplay` in `shared.tsx` uses `.toFixed(4)` — migrate to `formatCostMicro()` (4 decimals preserved). This component is used by all 10 agent detail views for individual LLM call costs where sub-cent precision matters (e.g., $0.0012 vs $0.0018). Do NOT reduce to 3 decimals.
- [ ] Ensure all cost displays use 2 decimals (`formatCost`), agent-level breakdowns use 3 decimals (`formatCostDetailed`), Elo displays use 0 decimals (`formatElo`)
- [ ] Run exhaustive grep for `.toFixed(` across all evolution files to ensure no inline calls remain

**Files to modify:**
- `src/lib/utils/formatters.ts` (new utility)
- `src/components/evolution/agentDetails/shared.tsx` (migrate CostDisplay to use formatCostMicro — 4 decimals preserved)
- All dashboard pages and evolution components using `.toFixed()`

#### 2.8 Merge Redundant Run Detail Tabs (7→5)
**Research ref:** §22.4 | **Impact:** Simplification

Timeline+Budget overlap on cost data. Lineage+Tree overlap on variant relationships.

**Prerequisite:** Add auto-refresh to TimelineTab BEFORE merging Budget into it. BudgetTab has its own 5s auto-refresh for active runs (lines 97-104). TimelineTab loads once and never auto-refreshes. If Budget is merged into Timeline without adding auto-refresh first, the merged component will lose Budget's real-time update behavior. Therefore, **Phase 3.2 (TimelineTab auto-refresh) must be completed before this task**, or auto-refresh must be added as part of this task.

**Tasks:**
- [ ] **First:** Add auto-refresh to TimelineTab (5s interval for active runs) to match BudgetTab's behavior. This ensures no functionality regression when Budget is merged in.
- [ ] **Merge Budget into Timeline:** Add cost summary section (current spend vs budget bar, agent breakdown) to Timeline header. Move burn chart to collapsible section within Timeline.
- [ ] **Merge Tree into Lineage:** Add toggle in Lineage tab: "Full DAG" vs "Pruned Tree" view. Only show toggle if strategy used tree search.
- [ ] Update tab bar: `Timeline | Elo | Lineage | Variants | Logs` (5 tabs)
- [ ] **Fix tab switching to sync URL:** Currently `setActiveTab` uses `useState` only (line 178) — clicking tabs does NOT update the URL. Add `router.replace` call alongside `setActiveTab` so the URL always reflects the active tab (e.g., `?tab=logs`). This is a prerequisite for breadcrumb tab display (Phase 3.4), manual refresh preserving tab state (Phase 3.2), and backward-compatible URL redirects below.
- [ ] **Backward-compatible URL params:** Add legacy tab name mapping function — `?tab=budget` → `?tab=timeline` (with budget section expanded), `?tab=tree` → `?tab=lineage` (with tree toggle active). Handle in a mapping function BEFORE casting to `TabId`, not in the union type itself. Use `router.replace()` (not `router.push()`) to avoid polluting browser history with redirect hops. Note: grep confirms no existing URLs in src/ construct `?tab=budget` or `?tab=tree`, so this is primarily for external bookmarks.
- [ ] **Update existing tests:** `BudgetTab.test.tsx` has 6 tests that must be migrated to TimelineTab tests:
  1. Auto-refresh test → migrates directly (TimelineTab gains auto-refresh in this task)
  2. Estimate comparison / delta badge test → update selectors for nested budget section within Timeline
  3. Agent budget caps rendering test → update mock shape to combine TimelineData + BudgetData
  4. Loading state test → verify budget skeleton shows within Timeline loading
  5. Error handling test → verify budget error state within Timeline
  6. Cost breakdown chart test → update to find chart within Timeline's collapsible budget section
  E2E spec `admin-evolution-visualization.spec.ts` line 162 asserts `button:has-text("Budget")` — remove this assertion and add assertion for budget content within Timeline tab instead. Note: the spec does NOT assert `button:has-text("Tree")` so Lineage merge only needs functional verification, not E2E test changes.
- [ ] Preserve all functionality — no data loss, just reorganization
- [ ] After confirming all tests pass, remove standalone tab files

**Files to modify:**
- `src/components/evolution/tabs/TimelineTab.tsx` (add auto-refresh, absorb BudgetTab content)
- `src/components/evolution/tabs/LineageTab.tsx` (absorb TreeTab, add toggle)
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` (update tab bar, add legacy URL mapping)
- `src/components/evolution/tabs/__tests__/BudgetTab.test.tsx` (migrate to TimelineTab tests)
- `tests/e2e/admin-evolution-visualization.spec.ts` (update tab assertions)
- Remove (after tests pass): `src/components/evolution/tabs/BudgetTab.tsx`
- Remove (after tests pass): `src/components/evolution/tabs/TreeTab.tsx`

---

### Phase 3: Navigation & Structure (P2)

**Goal:** Improve information architecture, fix staleness, and enhance chart readability.

**Dependency:** Phase 2 complete (URL utility exists, formatters exist, tabs consolidated).

#### 3.1 Reorganize Sidebar
**Research ref:** §24.1 | **Impact:** Navigation

**Architecture note:** `BaseSidebar.tsx` currently has a flat `NavItem[]` interface with no concept of groups or section dividers. To support sidebar grouping, `BaseSidebar` must be extended with a `NavGroup` type (containing a label + `NavItem[]`), OR `EvolutionSidebar` must render sections directly without using `BaseSidebar`'s flat list. Extending `BaseSidebar` is preferred since `AdminSidebar` could also benefit from grouping.

**Tasks:**
- [ ] Extend `BaseSidebar` to accept `NavGroup[]` in addition to flat `NavItem[]`: add `NavGroup` type with `{ label: string; items: NavItem[] }` and render section headers when groups are provided. Ensure backward compatibility — existing flat `NavItem[]` consumers (like `AdminSidebar`) continue working unchanged.
- [ ] Refactor `EvolutionSidebar` to use grouped format:
  ```
  OVERVIEW
    Dashboard
  RUNS
    Pipeline Runs (renamed from "Start Pipeline")
  ANALYSIS
    Explorer
    Elo Optimization
  REFERENCE
    Prompts
    Strategies
    Hall of Fame
  ```
- [ ] Add subtle section headers (muted text, smaller font, `text-[var(--text-muted)]`)
- [ ] Rename "Start Pipeline" → "Pipeline Runs"

**Files to modify:**
- `src/components/admin/BaseSidebar.tsx` (extend with NavGroup support)
- `src/components/admin/EvolutionSidebar.tsx` (use grouped format)

#### 3.2 Enhance Auto-Refresh Across All Tabs
**Research ref:** §23.5 | **Impact:** Debugging

**Note:** Basic TimelineTab auto-refresh is added in Phase 2.8 (prerequisite for Budget merge). This task enhances refresh behavior across ALL tabs.

**Tasks:**
- [ ] Use `AutoRefreshProvider` for shared refresh state across all tabs (currently each tab refreshes independently, causing data inconsistency between tabs)
- [ ] Add "Updated X seconds ago" indicator using existing `RefreshIndicator` component — place in run detail page header (visible regardless of active tab)
- [ ] Add manual refresh button on each tab
- [ ] Add toast notification if refresh fails (currently silent failure)

**Files to modify:**
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` (RefreshIndicator in header)
- `src/components/evolution/tabs/TimelineTab.tsx` (use shared provider)
- `src/components/evolution/tabs/LogsTab.tsx` (use shared provider)
- `src/components/evolution/tabs/EloTab.tsx` (add refresh support)

#### 3.3 Sync Explorer Filters to URL
**Research ref:** §24.5 | **Impact:** Navigation

**Hydration note:** Replacing `useState` with `useSearchParams` in a Next.js App Router client component can cause hydration mismatches if the server and client disagree on initial param values. Wrap the filter-dependent content in a `<Suspense>` boundary with a loading fallback, and provide safe default values for all filter state.

**Tasks:**
- [ ] Replace `useState` filter state with `useSearchParams`-backed state
- [ ] Wrap filter-dependent content in `<Suspense>` boundary with skeleton fallback
- [ ] Sync `promptIds`, `strategyIds`, `pipelineTypes`, `datePreset`, `dateFrom`, `dateTo`, `viewMode`, `unit`, `metric` to URL params
- [ ] On mount, initialize state from URL params (enables deep-linking)
- [ ] Update `buildExplorerUrl(filters)` utility (from 2.1) to construct filtered explorer URLs

**Files to modify:**
- `src/app/admin/quality/explorer/page.tsx` (add Suspense boundary, useSearchParams)
- `src/lib/utils/evolutionUrls.ts` (extend)

#### 3.4 Add Breadcrumbs to All Pages
**Research ref:** §24.6 | **Impact:** Navigation

**Tasks:**
- [ ] Create shared `EvolutionBreadcrumb` component with consistent styling (matching run detail breadcrumb pattern)
- [ ] Add breadcrumbs to: Explorer, Optimization, Hall of Fame (list + topic detail), Strategies, Prompts
- [ ] Include active tab in run detail breadcrumb: `Evolution / Run X / Logs`

**Files to modify:**
- `src/components/evolution/EvolutionBreadcrumb.tsx` (new shared component)
- All 7 evolution dashboard pages

#### 3.5 Improve Chart Readability
**Research ref:** §25.4 | **Impact:** Readability

**Tasks:**
- [ ] **EloTab:** Add horizontal reference line at 1200 (baseline). Add "Top N of M" label. Add variant rank badges at final data points. Fix Y-axis to start from contextual minimum (not hardcoded 800).
- [ ] **BudgetTab burn chart** (now in Timeline): Add budget cap label (`$5.00 budget`). Add predicted spend trend line if estimate exists.
- [ ] **Explorer trend chart:** Add axis labels (metric name). Add "Simplify" button to collapse low-variance series.
- [ ] **HoF scatter chart:** Add quadrant reference lines. Label "Optimal Zone" (high Elo, low cost).

**Files to modify:**
- `src/components/evolution/tabs/EloTab.tsx`
- `src/components/evolution/tabs/TimelineTab.tsx` (budget chart section)
- `src/app/admin/quality/explorer/page.tsx` (trend chart)
- `src/app/admin/quality/hall-of-fame/[topicId]/page.tsx` (scatter chart)

#### 3.6 Reduce Table Column Density
**Research ref:** §25.1 | **Impact:** Readability

**Tasks:**
- [ ] **RunsTable:** Hide Run ID by default (keep in link hover). Combine Cost+Est into single "Spend" column with visual indicator.
- [ ] **VariantsTab:** Move variant ID to tooltip on rank. Widen sparkline column.
- [ ] **HoF Leaderboard:** Stack Method+Model into single cell. Reduce cost to 2 decimals.
- [ ] Add `data-testid` attributes to all new/changed interactive elements

**Files to modify:**
- `src/components/evolution/RunsTable.tsx`
- `src/components/evolution/tabs/VariantsTab.tsx`
- `src/app/admin/quality/hall-of-fame/[topicId]/page.tsx`

#### 3.7 Standardize Status Indicators
**Research ref:** §25.6 | **Impact:** Readability

**Tasks:**
- [ ] Add icon to `EvolutionStatusBadge`: ✓ completed, ✗ failed, ▶ running, ⏳ pending, ⏸ paused
- [ ] Add visual progress bar to run rows showing iteration progress (N/M as filled bar)
- [ ] Ensure consistent badge styling across all tables (dashboard, evolution, explorer, optimization)

**Files to modify:**
- `src/components/evolution/EvolutionStatusBadge.tsx`
- `src/components/evolution/RunsTable.tsx` (progress bar column)

#### 3.8 Add Run Progress Display
**Research ref:** §23.4 | **Impact:** Debugging

**Tasks:**
- [ ] Rename "claimed" → "starting" in status badge
- [ ] Show iteration progress in run detail header: "Running (iteration 3/15)"
- [ ] Add estimated time remaining based on average iteration duration
- [ ] Show budget usage percentage next to cost display

**Files to modify:**
- `src/components/evolution/EvolutionStatusBadge.tsx`
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` (header progress)

---

### Phase 4: Polish & Cleanup (P3)

**Goal:** Streamline remaining rough edges, improve consistency, add advanced observability.

**Dependency:** Phase 3 complete.

#### 4.1 Simplify Explorer Controls
**Research ref:** §22.6 | **Impact:** Simplification

**Tasks:**
- [ ] Default to Table view on page load
- [ ] Collapse Matrix/Trend into "Advanced Views" secondary tab group
- [ ] Hide custom date range picker unless explicitly expanded
- [ ] Reduce default visible table columns to 7-8

**Files to modify:**
- `src/app/admin/quality/explorer/page.tsx`

#### 4.2 Remove Unused Features
**Research ref:** §22.7 | **Impact:** Simplification

**Tasks:**
- [ ] Replace Batch Dispatch Card with a simple "Batch Dispatch" link to documentation or a simpler trigger button
- [ ] Evaluate Queue Dialog vs Start Pipeline Card — if overlapping, consolidate into single inline form
- [ ] Simplify Prompt Bank Coverage Matrix to text summary with coverage percentage

**Files to modify:**
- `src/app/admin/quality/evolution/page.tsx`
- `src/app/admin/quality/hall-of-fame/page.tsx`

#### 4.3 Page Title & Naming Clarity
**Research ref:** §24.7 | **Impact:** Navigation

**Tasks:**
- [ ] Rename "Content Evolution" heading → "Pipeline Runs"
- [ ] Fix run detail heading: show both `Explanation #42` (linked) and `Run {id}` clearly
- [ ] Add heading to compare page: "Before & After Comparison"
- [ ] Add subtitle to Explorer: "Cross-dimensional analysis of runs, articles, and tasks"

**Files to modify:**
- `src/app/admin/quality/evolution/page.tsx`
- `src/app/admin/quality/evolution/run/[runId]/page.tsx`
- `src/app/admin/quality/evolution/run/[runId]/compare/page.tsx`
- `src/app/admin/quality/explorer/page.tsx`

#### 4.4 Loading & Empty State Consistency
**Research ref:** §25.5 | **Impact:** Readability

**Tasks:**
- [ ] Create shared `TableSkeleton` component matching actual table width/columns
- [ ] Create shared `EmptyState` component with icon, message, and suggested action
- [ ] Replace inconsistent loading patterns (text "Loading...", random pulse divs) with `TableSkeleton`
- [ ] Enhance empty states with actionable suggestions ("Run a pipeline to see results here")

**Files to modify:**
- `src/components/evolution/TableSkeleton.tsx` (new)
- `src/components/evolution/EmptyState.tsx` (new)
- All dashboard pages with loading/empty states

#### 4.5 Add Distributed Tracing
**Research ref:** §23.8 | **Impact:** Debugging

**Tasks:**
- [ ] Add `request_id` field to `evolution_run_logs` table (migration)
- [ ] Generate and propagate request IDs through pipeline execution
- [ ] Display request ID in LogsTab entries for tracing
- [ ] Add `cost_usd` and `duration_ms` fields to log entries when available

**Files to modify:**
- `supabase/migrations/` (new migration for log schema)
- `src/lib/evolution/core/pipeline.ts` (request ID generation)
- `src/components/evolution/tabs/LogsTab.tsx` (display request ID)

#### 4.6 Log Export
**Research ref:** §23.3 | **Impact:** Debugging

**Tasks:**
- [ ] Add "Export Logs" button to LogsTab toolbar
- [ ] Export as JSON (full context) or CSV (flattened) — user selects format
- [ ] Include run metadata in export header (run ID, status, dates, strategy, prompt)

**Files to modify:**
- `src/components/evolution/tabs/LogsTab.tsx`

---

## Testing

### Existing Tests That Will Break (Must Update)

These tests must be updated as part of the relevant phase:

| Test File | What Breaks | Phase | Fix |
|-----------|-------------|-------|-----|
| `BudgetTab.test.tsx` | Component removed in tab merge | 2.8 | Migrate test cases to TimelineTab tests |
| `admin-evolution-visualization.spec.ts` line 162 | Asserts `button:has-text("Budget")` | 2.8 | Update to verify budget content within Timeline tab |
| `admin-evolution-visualization.spec.ts` | Asserts `button:has-text("Budget")` (line 162) — button removed | 2.8 | Remove Budget button assertion, add assertion for budget content within Timeline tab |
| `evolution-infrastructure.integration.test.ts` | Heartbeat timeout tests may conflict with enhanced watchdog | 1.1 | Extend existing tests, don't duplicate |

**Note:** All 4 E2E evolution spec files currently use `.describe.skip` ("Skip until evolution DB tables are migrated via GitHub Actions"). They should still be updated to prevent silent drift — when re-enabled, they must pass.

### Unit Tests

**ShortId component (Phase 1.2):**
- Test backward compatibility: no href/onClick props → renders `<span>` (same as before)
- Test clickable mode: with `href` + `runId` → renders `<Link>` with correct URL
- Test with `onClick` callback → fires handler on click
- Test gold color and hover:underline styling in both modes
- Test title attribute shows full ID in both modes

**New server actions (Phase 1.1, 1.2, 2.6):**
- `getVariantDetailAction`: test with valid runId/variantId, test with non-existent variant (returns null), test parent chain traversal (0, 1, 10 ancestors), test match history extraction from checkpoint. Follow existing Supabase chain-mock pattern from `evolutionActions.test.ts`.
- `getRunsByStrategyAction`: test with valid strategyId returns runs sorted by date, test with no matching runs returns empty array, test limit parameter
- `getRunsByPromptAction`: same pattern as strategy action
- `triggerEvolutionRunAction` error path (Phase 1.1): **Note:** `evolutionActions.test.ts` does NOT currently test `triggerEvolutionRunAction` — this is a new test. Mock setup: (a) mock `executeFullPipeline` to throw an error, (b) mock Supabase `.update()` chain for the run status update, (c) verify the server action calls the DB update to set `status: 'failed'` and `error_message` with structured error BEFORE returning `{ success: false }`. The fix is in `evolutionActions.ts` (server action layer), NOT in `pipeline.ts` (pipeline layer) — the pipeline already has its own `markRunFailed` but the server action catch at lines 623-625 currently skips this step. **Important:** The existing try/catch at line 617 already wraps `executeFullPipeline()` — the task is NOT to add a new try/catch but to add `markRunFailed` to the EXISTING catch block.

**Other unit tests:**
- `RunsTable` component: test compact vs full mode, column visibility, row click, type compatibility with both `DashboardRun` and `EvolutionRun` (see note in §1.3)
- `VariantDetailPanel`: test rendering with/without match history, parent chain, creation agent
- `AgentErrorBlock`: test different error categories (API/format/timeout), test with/without remediation context
- URL builder utilities: test all URL construction functions, test with null/undefined IDs, test UUID validation
- Formatters: test `formatCost`, `formatCostDetailed`, `formatElo`, `formatEloDollar`, `formatDuration`, `formatPercent` — including edge cases (0, negative, NaN, Infinity)
- `EvolutionBreadcrumb`: test rendering for each page
- `EvolutionStatusBadge`: test all status states + icons (including renamed "starting")
- Budget health indicator: test color thresholds (green <70%, amber 70-90%, red >90%)
- Log pagination: test offset/limit, search filtering
- Explorer URL sync: test param serialization/deserialization, test Suspense boundary handling
- `BaseSidebar` NavGroup: test grouped rendering, test backward compat with flat NavItem[]

### Integration Tests
- Variant click → detail panel loads correct data
- Explanation ID click → navigates to results page
- Strategy "View Runs" → loads and displays runs
- Log pagination → fetches correct page of results (wire up existing `offset` in `RunLogFilters`)
- Run detail tab switching → URL updates correctly
- Legacy tab URLs → `?tab=budget` maps to timeline, `?tab=tree` maps to lineage
- Explorer filter → URL updates → page reload preserves filters
- Watchdog cron → marks old running runs as failed with structured error message
- Budget alert → shows warning at 80% threshold
- triggerEvolutionRunAction error → run marked as failed in DB

### Manual Verification (on staging)
- [ ] Navigate full user journey: Dashboard → Run → Variant → Agent → Logs
- [ ] Verify all ~20 DOM-based variant ID locations are clickable
- [ ] Verify LineageGraph VariantCard has "View Details" link
- [ ] Verify TreeTab node panel uses clickable ShortId
- [ ] Verify EloTab tooltip shows non-clickable note gracefully
- [ ] Verify all 11 explanation ID locations link correctly
- [ ] Test sidebar navigation with new grouping (verify AdminSidebar still works)
- [ ] Verify charts render correctly with reference lines
- [ ] Test log search with various query patterns
- [ ] Verify budget alerts appear at correct thresholds
- [ ] Check mobile responsiveness of consolidated tables
- [ ] Verify auto-refresh works for all tabs on active runs
- [ ] Test Explorer URL state persistence (filter → refresh → filters preserved)
- [ ] Verify legacy URLs: `?tab=budget` → timeline, `?tab=tree` → lineage
- [ ] Test tab merge: Budget content visible in Timeline, Tree toggle in Lineage

### Rollback Plan

Each phase is independently shippable and can be reverted:

| Phase | Rollback Strategy |
|-------|------------------|
| Phase 1 | Revert commits. ShortId enhancement is backward-compatible (no props = old behavior). RunsTable extraction is isolated. Watchdog enhancement is backward-compatible. |
| Phase 2 | Revert commits. URL utility and formatters are additive. AgentErrorBlock is new file. Tab merge is the highest-risk item — if issues arise, revert the merge commits and restore BudgetTab.tsx/TreeTab.tsx from git history. |
| Phase 3 | Revert commits. Sidebar grouping is backward-compatible (BaseSidebar accepts both flat and grouped). Explorer URL sync can be reverted to useState. Breadcrumbs are additive. |
| Phase 4 | Revert commits. All Phase 4 changes are additive (new components, naming changes). |

**High-risk items requiring extra caution:**
- Phase 2.8 (tab merge): Deploy behind a feature flag if possible, or ship as a separate PR with thorough QA before merging
- Phase 1.1 (watchdog enhancement): Test on staging with an intentionally-stalled run before deploying to production

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/evolution/visualization.md` - Primary doc for dashboard components, tabs, and server actions. Update for merged tabs, new components, URL utilities.
- `docs/evolution/README.md` - Entry point for evolution docs. Update navigation section for sidebar changes.
- `docs/evolution/data_model.md` - Core primitives that drive dashboard displays. Update for new variant detail data model.
- `docs/evolution/rating_and_comparison.md` - Rating system displayed in dashboard. Update for variant debugging path.
- `docs/evolution/architecture.md` - Pipeline architecture shown in timeline/phase indicators. Update for timeout handling.
- `docs/evolution/hall_of_fame.md` - Cross-linked from run detail page. Update for new cross-links.

## New Shared Components Summary

| Component | Purpose | Phase |
|-----------|---------|-------|
| `RunsTable` | Shared configurable runs table | 1 |
| `VariantDetailPanel` | Variant detail with lineage + matches | 1 |
| `AgentErrorBlock` | Visible error display for agent details | 2 |
| `EvolutionBreadcrumb` | Consistent breadcrumbs across pages | 3 |
| `TableSkeleton` | Consistent loading state for tables | 4 |
| `EmptyState` | Consistent empty state with suggested actions | 4 |

## New Utilities Summary

| Utility | Purpose | Phase |
|---------|---------|-------|
| `evolutionUrls.ts` | Centralized URL builders | 2 |
| `formatters.ts` | Consistent number/cost/Elo formatting | 2 |

## New Server Actions Summary

| Action | Purpose | Phase |
|--------|---------|-------|
| `getVariantDetailAction` | Variant content + lineage + matches | 1 |
| `getRunsByStrategyAction` | Runs using a specific strategy | 2 |
| `getRunsByPromptAction` | Runs using a specific prompt | 2 |

**Enhanced (not new):**
| Action/Route | Enhancement | Phase |
|-------------|-------------|-------|
| `triggerEvolutionRunAction` | Fix catch block to mark run as failed in DB | 1 |
| `/api/cron/evolution-watchdog` | Reduce threshold, add structured error messages | 1 |
