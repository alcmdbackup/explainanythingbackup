# Adhoc Evolution Testing Research

## Problem Statement
Evaluate the evolution admin dashboard for UX issues, bugs, and general quality. Navigate through all evolution pages and compile findings for action later.

## High Level Summary
Two rounds of exploratory testing across 15+ evolution admin pages found **51 total issues**: 18 bugs (1 critical, 11 major, 6 minor) and 33 UX issues (13 major, 20 minor).

**Top-priority issues:**
1. **Experiment detail 404** (F32, Critical) — experiment detail pages completely broken, returning 404
2. **"Hide test content" filter broken** (F1, Major) — count shows 0 but rows render on 5+ pages
3. **Failed runs don't show error messages** (F19, Major) — users can't diagnose failures without DB access
4. **Arena match counts always 0** (F38, Major) — despite varied ratings, no match tracking
5. **No cross-links between entities** (F21, F34, F47, Major) — experiments/strategies not clickable from lists
6. **Performance consistently poor** (F5/F23, Major) — 3-10s FCP across all pages
7. **Accessibility gaps** (F4/F22, Major) — empty column headers, wrong ARIA roles for tabs

## User Testing Report - 20260324_223727

### Session Info
- Mode: goal
- Goal: Evaluate the evolution admin dashboard for UX issues and bugs
- Server: http://localhost:3887
- Started: 2026-03-24 22:37:27
- Pages visited: 11 (login, home, dashboard, runs, run detail, experiments, strategies, prompts, arena, variants, invocations)

### Summary
- Total Findings: 11
- Bugs: 4 (Critical: 0, Major: 3, Minor: 1)
- UX Issues: 7 (Major: 3, Minor: 4)

---

## Detailed Findings

### Finding 1: "Hide test content" filter doesn't work on most list pages
- **Category**: Bug-Major
- **Location**: `/admin/evolution/runs`, `/admin/evolution/experiments`, `/admin/evolution/strategies`, `/admin/evolution/variants`, `/admin/evolution/invocations`
- **Description**: When "Hide test content" is checked (default), the item count shows "0 items" and the empty state message appears, but the table still renders data rows with test content visible. The filter appears to affect the count/empty-state logic but not the actual table rendering, or the `renderTable` custom renderer bypasses the filtered data.
- **Steps to Reproduce**:
  1. Navigate to `/admin/evolution/experiments`
  2. Observe "Hide test content" is checked by default
  3. The heading says "0 items" but 6 experiment rows are visible in the table
- **Expected**: Either hide the rows when filter is checked, or show the correct count
- **Actual**: Count says "0 items" but rows are visible; on Runs page it shows empty state while other pages show rows

### Finding 2: Duplicate "Cost" column header on Runs list
- **Category**: Bug-Minor
- **Location**: `/admin/evolution/runs`
- **Description**: The Runs table has two columns both labeled "Cost" — one from the base entity columns and one from the metrics columns. This makes it unclear which cost each column represents.
- **Steps to Reproduce**:
  1. Navigate to `/admin/evolution/runs`
  2. Uncheck "Hide test content"
  3. Observe column headers: "Explanation | Status | Strategy | Cost | Budget | Created | Cost | Max Elo | Decisive Rate | Variants"
- **Expected**: Columns should have unique labels (e.g., "Run Cost" vs "Metric Cost" or merge into one)
- **Actual**: Two columns both labeled "Cost"

### Finding 3: Item count mismatch with displayed data across all RegistryPage/EntityListPage pages
- **Category**: Bug-Major
- **Location**: `/admin/evolution/strategies`, `/admin/evolution/variants`, `/admin/evolution/invocations`, `/admin/evolution/arena`
- **Description**: The "N items" count in the header appears to be driven by a different data source than the table rows. With "Hide test content" checked, the count shows "0 items" but the table body still renders rows with data. The accessibility tree shows rows with empty cells but the visual render shows populated data.
- **Steps to Reproduce**:
  1. Navigate to any entity list page (strategies, variants, invocations)
  2. Observe header count vs table rows
- **Expected**: Count should match the number of visible rows
- **Actual**: Count says "0 items" while 5 rows are rendered

### Finding 4: Column headers missing from accessibility tree on RegistryPage-based pages
- **Category**: Bug-Major
- **Location**: `/admin/evolution/strategies`, `/admin/evolution/prompts`, `/admin/evolution/arena`, `/admin/evolution/variants`, `/admin/evolution/invocations`
- **Description**: The accessibility snapshot shows empty `columnheader` elements on pages using the `RegistryPage` component. Visual rendering shows the headers correctly, suggesting the text is rendered in a way that screen readers cannot access (possibly via CSS pseudo-elements or background images instead of actual text nodes).
- **Steps to Reproduce**:
  1. Navigate to `/admin/evolution/strategies`
  2. Take an accessibility snapshot
  3. Observe columnheader elements have no text content
- **Expected**: Column headers should be accessible to screen readers
- **Actual**: Headers render visually but are empty in the accessibility tree

---

### Finding 5: Poor TTFB and FCP across all evolution pages
- **Category**: UX-Major
- **Location**: All evolution admin pages
- **Description**: Web Vitals show consistently poor Time to First Byte (TTFB) and First Contentful Paint (FCP) across all evolution pages, likely due to server-side data fetching blocking page render.
- **Performance Summary**:
  | Page | TTFB | FCP | Rating |
  |------|------|-----|--------|
  | Dashboard | 3404ms | 3616ms | Poor |
  | Runs | 3744ms | 3848ms | Poor |
  | Run Detail | 7035ms | 7088ms | Poor |
  | Experiments | 2940ms | 3020ms | Poor |
  | Strategies | 4204ms | 4328ms | Poor |
  | Prompts | 5544ms | 5612ms | Poor |
  | Arena | 3679ms | 3792ms | Poor |
  | Variants | 3139ms | 3188ms | Poor |
  | Invocations | 2783ms | 2884ms | Poor |
- **Expected**: FCP under 1800ms (good), TTFB under 800ms (good)
- **Suggestion**: Consider streaming/suspense boundaries so the shell renders immediately while data loads

### Finding 6: Strategy "Label" column displays verbose multi-line config text
- **Category**: UX-Minor
- **Location**: `/admin/evolution/strategies`
- **Description**: The Label column in the Strategies table shows the full config label with line breaks ("Gen: 4.1-mini | Judge: ds-chat | 100 iters"), consuming excessive vertical space per row. This makes the table harder to scan.
- **Expected**: Compact single-line label or truncated with tooltip
- **Actual**: Multi-line text expanding row height significantly

### Finding 7: "Created By" column shows raw UUID
- **Category**: UX-Minor
- **Location**: `/admin/evolution/strategies`
- **Description**: The "Created By" column displays a raw UUID (e.g., "08b3f7d2-196f-4606-83fc-d78b080f3e6f") instead of a human-readable user name or "system".
- **Expected**: Display user name, email, or "system" for system-generated strategies
- **Actual**: Raw UUID string

### Finding 8: Inconsistent breadcrumb root label
- **Category**: UX-Minor
- **Location**: Multiple pages
- **Description**: Some pages use "Dashboard" as the breadcrumb root (Runs, Experiments, Strategies, Variants, Invocations) while Arena uses "Evolution". These should be consistent.
- **Steps to Reproduce**:
  1. Navigate to `/admin/evolution/runs` — breadcrumb: "Dashboard / Runs"
  2. Navigate to `/admin/evolution/arena` — breadcrumb: "Evolution / Arena"
- **Expected**: Consistent root label across all evolution pages
- **Actual**: Mixed "Dashboard" and "Evolution" labels

### Finding 9: "Delete" action on Prompts lacks destructive styling
- **Category**: UX-Minor
- **Location**: `/admin/evolution/prompts`
- **Description**: The "Delete" action on the prompts table row uses the same visual style as "Edit" and "Archive" — no red color, no visual warning. Destructive actions should be visually distinct.
- **Expected**: Delete button/link in red or with a warning icon
- **Actual**: Same style as non-destructive actions

### Finding 10: Dashboard shows test runs that list pages hide
- **Category**: UX-Major
- **Location**: `/admin/evolution-dashboard`
- **Description**: The Evolution Dashboard "Recent Runs" table shows all runs including test content (strategy "Test"), but the Runs list page defaults to hiding test content. This inconsistency means the dashboard gives a different picture than the detail pages.
- **Expected**: Dashboard should respect the same "hide test content" default, or at minimum be consistent with the entity list pages
- **Actual**: Dashboard shows all runs; Runs page hides test content by default

### Finding 11: Sidebar "Variants" and "Back to Admin" overlap at bottom
- **Category**: UX-Major
- **Location**: All evolution pages
- **Description**: The sidebar navigation shows "Variants" and "Back to Admin" text overlapping at the bottom of the sidebar. The avatar/icon for "Variants" partially covers the "Back to Admin" link text. This suggests the sidebar doesn't handle overflow properly at smaller viewport heights.

---

## Console Errors
- **0 errors** across all pages visited
- Notable warnings: GoTrueClient concurrent usage warning (non-blocking)

## Key Observations
1. **No JavaScript errors** — the app is stable, no crashes or uncaught exceptions
2. **"Hide test content" filter is systematically broken** — this is the most impactful bug affecting Runs, Experiments, Strategies, Variants, and Invocations pages
3. **Performance is consistently poor** — all pages exceed 2.5s FCP, with Run Detail at 7s. This is the dev server so production may differ, but the pattern suggests blocking server-side fetches
4. **Accessibility gaps** — column headers invisible to screen readers on RegistryPage-based pages
5. **Sidebar overflow** — consistent layout issue at bottom of sidebar across all pages

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (evolution + testing)
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/arena.md
- evolution/docs/entities.md
- evolution/docs/agents/overview.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/cost_optimization.md
- evolution/docs/metrics.md
- evolution/docs/curriculum.md
- evolution/docs/visualization.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/reference.md
- docs/docs_overall/debugging.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md

## Code Files Read
- (exploratory testing session — no code files read directly)

## Screenshots
Screenshots saved to `test-results/user-testing/`:
- `finding_01_dashboard.png` — Dashboard with test runs visible
- `finding_02_runs_list.png` — Runs list with "Hide test content" checked (empty state)
- `finding_03_runs_with_data.png` — Runs list with filter unchecked
- `finding_04_run_detail_empty.png` — Run detail page (completed run)
- `finding_05_experiments.png` — Experiments showing data despite "0 items"
- `finding_06_strategies.png` — Strategies with verbose label column
- `finding_07_prompts.png` — Prompts with unstyled Delete action
- `finding_08_arena.png` — Arena topics page
- `r2_01_start_experiment.png` — Start Experiment wizard step 1
- `r2_02_strategies_step.png` — Start Experiment wizard step 2
- `r2_03_failed_run_detail.png` — Failed run detail page

---

# Round 2: Deep Exploratory Testing

## Session Info
- Started: 2026-03-25 ~06:10 UTC
- Server: http://localhost:3526 → 3599 (port changed after idle timeout)
- Focus: Detail pages, forms, tab interactions, edge cases, accessibility

## Summary
- New Findings: 40
- Bugs: 14 (Critical: 1, Major: 8, Minor: 5)
- UX Issues: 26 (Major: 10, Minor: 16)

---

## Start Experiment Wizard

### Finding 12: Validation errors shown before user interaction
- **Category**: UX-Minor
- **Location**: `/admin/evolution/start-experiment`
- **Description**: "Enter an experiment name" and "Select a prompt" validation messages display immediately on page load, before the user has attempted to submit. Validation should only trigger after the user clicks "Next" with incomplete fields.

### Finding 13: Only one prompt available as radio button, no inline create option
- **Category**: UX-Minor
- **Location**: `/admin/evolution/start-experiment`
- **Description**: If only one prompt exists, the user has no choice to make. If no prompts exist, the wizard would be completely blocked. There's no "Create new prompt" option inline — user must navigate away to the Prompts page first.

### Finding 14: Step indicator has no text labels
- **Category**: UX-Minor
- **Location**: `/admin/evolution/start-experiment`
- **Description**: The 3-step wizard progress indicator shows colored line segments but no step labels (e.g., "Setup", "Strategies", "Review"). Users can't tell what steps are ahead.

### Finding 15: Excessive Fast Refresh rebuilds on interaction
- **Category**: Bug-Minor
- **Location**: All evolution pages (dev mode)
- **Description**: Every user interaction triggers 20-50+ consecutive Fast Refresh rebuilds (3-4ms each). While this is dev-mode-only, it indicates unnecessary re-renders that would impact production performance. Likely caused by state updates triggering file saves or circular dependency chains.

### Finding 16: No "runs per strategy" control in wizard step 2
- **Category**: UX-Major
- **Location**: `/admin/evolution/start-experiment` (step 2)
- **Description**: The strategy selection step shows strategies as checkboxes but has no way to specify how many runs to create per strategy. The docs say the wizard should allow "configuring how many runs to create per selected strategy" but this control is missing. Shows "0 selected, 0 total runs" with no way to set a count.

### Finding 17: Test strategies visible in wizard without filter
- **Category**: UX-Minor
- **Location**: `/admin/evolution/start-experiment` (step 2)
- **Description**: The "Test" strategy appears in the strategy picker. Unlike list pages which have "Hide test content", the wizard has no such filter. Test/development strategies pollute the selection.

### Finding 18: No "select all" option for strategies
- **Category**: UX-Minor
- **Location**: `/admin/evolution/start-experiment` (step 2)
- **Description**: With many strategies, users must check each individually. A "Select all" checkbox would improve efficiency.

---

## Run Detail Page

### Finding 19: Failed run doesn't display error message
- **Category**: Bug-Major
- **Location**: `/admin/evolution/runs/[runId]`
- **Description**: Failed runs show a red "failed" badge with a tooltip "Run has error details", but the actual error message (`error_message` column) is never displayed on the page. Users must query the database directly to find out why a run failed.
- **Expected**: Error message displayed prominently on failed run detail pages

### Finding 20: Run UUID truncated and not easily copyable
- **Category**: UX-Minor
- **Location**: `/admin/evolution/runs/[runId]`
- **Description**: The sub-heading shows "ce267827-38c…" — the full UUID is truncated. For debugging, users need the full UUID to query the database. Should be copyable on click.

### Finding 21: No cross-links to related entities from run detail header
- **Category**: UX-Major
- **Location**: `/admin/evolution/runs/[runId]`
- **Description**: The run detail header shows no links to the parent strategy, experiment, or prompt. Users must navigate back to the list and find the related entities manually. The variant detail page has a "Run:" cross-link, showing this pattern is implemented elsewhere but missing on runs.

### Finding 22: Tabs use `button` role instead of proper `tab`/`tablist` ARIA pattern
- **Category**: Bug-Minor
- **Location**: `/admin/evolution/runs/[runId]`, variant detail
- **Description**: The tab navigation renders as `button` elements rather than using proper `tablist`/`tab`/`tabpanel` ARIA roles. Screen readers won't announce these as tabs or provide tab-specific keyboard navigation (arrow keys).

### Finding 23: LCP reaches 10.7s on run detail page
- **Category**: UX-Major
- **Location**: `/admin/evolution/runs/[runId]`
- **Description**: Largest Contentful Paint measured 10,776ms on the run detail page. This is 4x worse than the "poor" threshold (2500ms). The page blocks on server-side data fetching with no loading skeleton or progressive rendering.

### Finding 24: Strategy column empty for all variants in run detail
- **Category**: Bug-Major
- **Location**: `/admin/evolution/runs/[runId]?tab=variants`
- **Description**: The Variants tab table has a "Strategy" column that is empty for every variant. The `agent_name` field that should populate this column appears to not be set during pipeline execution.

### Finding 25: "View" vs "Full" variant actions are confusing
- **Category**: UX-Minor
- **Location**: `/admin/evolution/runs/[runId]?tab=variants`
- **Description**: Each variant row has two actions: "View" (a button) and "Full" (a link to variant detail page). The distinction is unclear. "View" likely shows inline content while "Full" navigates away, but the labels don't communicate this.

### Finding 26: Strategy filter dropdown has empty option
- **Category**: Bug-Minor
- **Location**: `/admin/evolution/runs/[runId]?tab=variants`
- **Description**: The strategy filter combobox has an `option` element with no text content after "All strategies". This renders as an empty/blank option in the dropdown.

### Finding 27: No visual indicator that variant data is from a failed/incomplete run
- **Category**: UX-Minor
- **Location**: `/admin/evolution/runs/[runId]?tab=variants`
- **Description**: On a failed run, variants still show with default 1200 ratings and 0 matches, with no indication that this data is partial/meaningless. A banner or dimmed state would help users understand the data isn't useful.

### Finding 28: Extreme HMR loop — 50-100+ rebuilds per interaction
- **Category**: Bug-Minor
- **Location**: All evolution pages (dev mode)
- **Description**: A single tab click on the run detail page triggered 100+ consecutive Fast Refresh rebuilds over several seconds. This amplifies F15 and suggests a serious re-render cascading issue, possibly from state updates in effects that trigger further re-renders.

---

## Logs Tab

### Finding 29: Iteration filter hardcoded to 1-20
- **Category**: UX-Minor
- **Location**: `/admin/evolution/runs/[runId]?tab=logs`
- **Description**: The iteration filter dropdown always shows options 1 through 20, regardless of how many iterations the run actually completed. A run with 1 iteration still shows 20 options. Should dynamically reflect actual iteration count.

### Finding 30: Log timestamps missing date
- **Category**: UX-Minor
- **Location**: `/admin/evolution/runs/[runId]?tab=logs`
- **Description**: Log entries show only the time (e.g., "4:12:22 PM") with no date. When reviewing logs from runs on different days or comparing across runs, users can't determine the actual date without cross-referencing.

---

## Experiments

### Finding 31: Experiment status filter missing "Completed" and "Running" options
- **Category**: Bug-Major
- **Location**: `/admin/evolution/experiments`
- **Description**: The status filter offers only "Active", "Cancelled", and "All". The experiment lifecycle includes "draft", "running", "completed", and "cancelled" statuses, but "Running" and "Completed" have no dedicated filter options. "Active" appears to be a non-standard status combining draft+running.

### Finding 32: Experiment detail page returns 404
- **Category**: Bug-Critical
- **Location**: `/admin/evolution/experiments/[experimentId]`
- **Description**: Navigating to an experiment detail page returns a 404 error with console errors from `getExperiment` action. The experiment list page shows rows but they don't link to detail pages. Direct URL navigation also fails.
- **Console Error**: `[ERROR] Error in adminAction:getExperiment`

### Finding 33: 404 page loses evolution sidebar layout
- **Category**: UX-Major
- **Location**: Any invalid evolution URL
- **Description**: When a 404 occurs within the evolution admin area, the page shows the generic Next.js 404 without the evolution sidebar. Users lose their navigation context and must manually navigate back to the evolution dashboard.

### Finding 34: Experiment list rows not clickable/linked
- **Category**: Bug-Major
- **Location**: `/admin/evolution/experiments`
- **Description**: Unlike the Runs list (which has clickable run ID links) and Arena list (which has linked rows), the Experiments list rows have no links to experiment detail pages. The Cancel action is the only interaction available per row.

---

## Arena

### Finding 35: Arena item count race condition on initial load
- **Category**: Bug-Minor
- **Location**: `/admin/evolution/arena`
- **Description**: Arena Topics page initially shows "0 items" with empty-looking rows, then updates to "1 item" with populated data on subsequent snapshots. This indicates a race condition where the count renders before data arrives.

### Finding 36: Elo values unrounded on leaderboard
- **Category**: UX-Minor
- **Location**: `/admin/evolution/arena/[topicId]`
- **Description**: The Elo column displays raw floating-point values like "1428.539559569149" instead of rounded integers or 1-decimal values. This makes the leaderboard hard to scan and compare at a glance.

### Finding 37: Raw markdown syntax in leaderboard content column
- **Category**: UX-Major
- **Location**: `/admin/evolution/arena/[topicId]`
- **Description**: The Content column shows raw markdown including `#` heading markers (e.g., "# The Federal Reserve: A Concrete Look at..."). The markdown should be stripped or rendered for display, showing just the plain title text.

### Finding 38: All arena entries show 0 matches
- **Category**: Bug-Major
- **Location**: `/admin/evolution/arena/[topicId]`
- **Description**: Despite having 27 entries with varied Elo ratings (1123-1428), every entry shows 0 in the Matches column. The `arena_match_count` field isn't being updated during arena sync, even though comparisons clearly occurred (ratings diverged from the 1200 default).

### Finding 39: No pagination on arena leaderboard
- **Category**: UX-Minor
- **Location**: `/admin/evolution/arena/[topicId]`
- **Description**: All 27 entries render in a single unpaginated table. While manageable at this scale, with hundreds of entries this would become unusable. Other list pages have pagination.

### Finding 40: Empty "Evolution Metrics" section on arena topic detail
- **Category**: UX-Major
- **Location**: `/admin/evolution/arena/[topicId]`
- **Description**: An "Evolution Metrics" heading appears between Topic Details and the Leaderboard with no content below it. This empty section suggests metrics are declared but not computed for prompt-level entities.

### Finding 41: No column sorting on arena leaderboard
- **Category**: UX-Major
- **Location**: `/admin/evolution/arena/[topicId]`
- **Description**: The leaderboard has no clickable column headers for sorting. Users can't sort by Sigma, Matches, Method, or Cost. The table is pre-sorted by Elo but this can't be changed.

### Finding 42: Cost column shows "—" for all arena entries
- **Category**: UX-Minor
- **Location**: `/admin/evolution/arena/[topicId]`
- **Description**: The Cost column displays "—" for every entry, suggesting `cost_usd` is not being populated when variants are synced to the arena. Cost data exists at the run level but isn't flowing to individual arena entries.

---

## Variant Detail

### Finding 43: Agent field empty on variant detail
- **Category**: Bug-Major
- **Location**: `/admin/evolution/variants/[variantId]`
- **Description**: The "Agent" metadata field shows no value. This should display the strategy/agent name that created this variant (e.g., "structural_transform", "crossover", "baseline").

### Finding 44: Breadcrumb root inconsistency — three different values
- **Category**: UX-Major
- **Location**: Multiple detail pages
- **Description**: Breadcrumb root varies by page type:
  - Runs/Experiments/Strategies/Invocations: "Dashboard"
  - Arena: "Evolution"
  - Variants: "Variants" (links to list, not dashboard)

  This makes navigation unpredictable. Should consistently use "Dashboard" or "Evolution".

### Finding 45: Rating formatting inconsistent across pages
- **Category**: UX-Minor
- **Location**: Variant detail vs arena leaderboard
- **Description**: The same variant shows rating "1429" (rounded integer) on its detail page but "1428.539559569149" (15-decimal float) on the arena leaderboard. Rating display should be consistently formatted across all views.

### Finding 46: Default Metrics tab empty on variant detail
- **Category**: UX-Major
- **Location**: `/admin/evolution/variants/[variantId]`
- **Description**: The Metrics tab is the default active tab but shows no content. The Content tab (which has the actual variant text) would be a more useful default. Users land on an empty tab and must click to see useful information.

---

## Strategy Pages

### Finding 47: Strategy list rows not linked to detail pages
- **Category**: UX-Major
- **Location**: `/admin/evolution/strategies`
- **Description**: Strategy rows in the list table have no links to detail pages. The accessibility tree shows the page has a `[strategyId]` route, but there's no way to navigate there from the list. Same issue as experiments (F34).

### Finding 48: 12 columns on strategy list — too wide for viewport
- **Category**: UX-Major
- **Location**: `/admin/evolution/strategies`
- **Description**: The strategy list table has 12 columns (Name, Label, Pipeline, Status, Runs, Avg Elo, Created By, Run Count, Total Cost, Avg Cost, Best Elo, Worst Elo). Many columns are cut off at normal viewport widths. No horizontal scroll indicator is visible.

### Finding 49: Server idle timeout disrupts long testing sessions
- **Category**: UX-Minor
- **Location**: All pages
- **Description**: The dev server shuts down after 5 minutes idle, requiring restart and re-authentication. During admin dashboard review sessions (where a user might read/analyze data for several minutes without clicks), the server disappears without warning.

### Finding 50: No loading skeletons — pages show empty content area during load
- **Category**: UX-Major
- **Location**: All evolution pages
- **Description**: During the 3-8s server-side rendering time, pages show the sidebar and header but an empty main content area. No loading skeleton, spinner, or progressive content is shown. Users see a blank area and must wait with no feedback.

### Finding 51: No keyboard shortcuts for common actions
- **Category**: UX-Minor
- **Location**: All evolution pages
- **Description**: The admin dashboard has no keyboard shortcuts for common workflows like navigating between pages (e.g., pressing "R" for Runs, "E" for Experiments) or switching tabs on detail pages. Power users reviewing many runs would benefit from keyboard navigation.
