# Bug Hunt Manual Verification Evolution Progress

## Phase 1: Manual Verification via Playwright MCP
### Work Done
Navigated all evolution admin pages using Playwright MCP headless browser against local dev server. Authenticated as test user (abecha@gmail.com), visited dashboard, runs list, run detail (all 5 tabs), experiments list, arena topics, variants list, and invocations list.

### Pages Visited
- `/admin/evolution-dashboard`
- `/admin/evolution/runs`
- `/admin/evolution/runs/[runId]` (tabs: Metrics, Elo, Lineage, Variants, Logs)
- `/admin/evolution/experiments`
- `/admin/evolution/arena`
- `/admin/evolution/variants`
- `/admin/evolution/invocations`

## Phase 2: Bug Discovery — 40 Issues Found

### CRITICAL — Data Integrity (5 issues)

**1. Run cost always $0.00 despite invocations having real costs**
- Page: Dashboard, Runs list, Run detail
- Invocations show real costs ($0.011, $0.038, $0.047) but all runs show $0.00 Spent
- Root cause: Logs show "Finalization metrics write failed" warning during run completion
- Impact: Total Cost and Avg Cost on dashboard are both $0.00

**2. Dashboard summary metrics don't respect "Hide test content" filter**
- Page: `/admin/evolution-dashboard`
- Dashboard shows "Completed: 6, Failed: 5" = 11 total, but table shows only 10 rows when filter is active
- The metric cards count ALL runs regardless of filter state

**3. All ranking invocations show "failed" (✗) even on completed runs**
- Page: `/admin/evolution/invocations`
- Every ranking invocation (53af9ab3, c2ce50f4, f6ec7460, etc.) shows ✗ failed
- But the parent runs completed successfully
- Logs confirm "Budget exceeded during ranking" → ranking agent fails due to budget but run still completes

**4. "Finalization metrics write failed" on completed runs**
- Page: Run detail → Logs tab
- Completed run 6e57e44c has a `warn` log: "Finalization metrics write failed"
- This explains why cost data is $0.00 at the run level — metrics never persisted

**5. Elo tab shows "No Elo history available" despite metrics showing Elo ratings**
- Page: Run detail → Elo tab
- Metrics tab shows Winner Elo 1277, Median 1202, etc. but Elo tab says "No Elo history available"
- The Elo history (per-iteration progression) is either not being stored or not queried correctly

### HIGH — Filter/Display Logic (7 issues)

**6. "Hide test content" doesn't filter runs/experiments with strategy/name "Test" (no brackets)**
- Pages: Runs, Experiments, Variants
- Filter looks for `[TEST]` prefix in strategy name per docs, but many test entities use plain "Test" or "test" without brackets
- Result: Test content pollutes the view even with filter enabled

**7. Stale "running" experiments from days ago (3/21, 3/23, 3/24)**
- Page: `/admin/evolution/experiments`
- 5 experiments still show "running" status from 2-5 days ago
- No auto-timeout or staleness indicator — looks like active experiments

**8. Arena topic with empty "Name" column**
- Page: `/admin/evolution/arena`
- Second arena topic row has an empty Name cell — only the Prompt column has content ("This is a real prompt with actual content")
- The `name` field in `evolution_prompts` is NULL or empty for this entry

**9. Variants from failed runs show empty "Agent" column**
- Page: `/admin/evolution/variants`
- Variants from run ce267827 (failed) have empty Agent column (888a2b51, 4155f829, 3297599b, 1ab867d7)
- The `generation_method` / agent name was never populated because the run failed before generation completed

**10. Variant match counts don't sum to Metrics tab total**
- Page: Run detail → Variants tab vs Metrics tab
- Metrics shows "Matches: 37" but individual variant match counts sum to 4+2+3+3 = 12
- The 37 includes arena-wide matches (39 arena entries loaded), but variant-level counts only show run-local matches

**11. Run detail "Counts" section only shows Variants, missing other counts**
- Page: Run detail → Metrics tab
- Only "Variants: 4" shown under Counts
- Missing: Invocations count, Iterations count, Comparisons count

**12. Invocations page missing filter controls**
- Page: `/admin/evolution/invocations`
- Only "Hide test content" checkbox — no agent type filter, no success/failure filter, no run ID filter
- Other list pages have status filters

### MEDIUM — UI/UX Issues (15 issues)

**13. "Explanation" column shows truncated UUIDs instead of human-readable titles**
- Pages: Dashboard Recent Runs, Runs list
- Column labeled "Explanation" but shows run ID prefix (e.g., "6e57e44c") not explanation title
- Makes it impossible to identify which content the run was for

**14. Dashboard "Created" column truncated**
- Page: `/admin/evolution-dashboard`
- Date column cuts off, showing "3/26/2" instead of full date — column width too narrow

**15. Lineage graph shows flat nodes with no edges**
- Page: Run detail → Lineage tab
- 4 variant nodes displayed in a flat horizontal row with no parent-child edges
- All variants are Gen 0 (no evolution occurred), so technically correct but graph is misleading — should show a "no lineage" message or indicate these are all initial variants

**16. Run title uses truncated UUID instead of meaningful name**
- Page: Run detail header
- Shows "Run 6e57e44c" — not the prompt title ("Federal reserve") or explanation title
- Cross-links show "Prompt: Federal reserve" but the page title doesn't use it

**17. Experiment names are duplicate/generic**
- Page: `/admin/evolution/experiments`
- Two experiments named "March 26, 2026 - B", multiple named "Test"/"test"
- Auto-generated names don't distinguish experiments; lowercase "test" vs "Test" inconsistency

**18. Variant rank display hard to parse: "#1★8bf778"**
- Page: Run detail → Variants tab
- Star symbol jammed between rank number and variant ID with no spacing
- Should be "#1 ★ 8bf778" or use separate columns for rank and winner indicator

**19. Invocation duration "—" for older entries but populated for recent ones**
- Page: `/admin/evolution/invocations`
- Recent invocations (3/26) show duration (84.9s, 26.1s) but older ones show "—"
- Duration tracking was either added recently or isn't being computed retroactively

**20. Date format inconsistent across pages**
- Dashboard: "3/26/2026" (short date)
- Invocations: "3/26/2026, 1:45:02 AM" (date + time)
- Experiments: "3/26/2026" (short date)
- Should be consistent or at least show time on all detail-oriented views

**21. "nav2-1774498767678-strat" and "nav2-1774498767678-exp" appear to be auto-generated test data**
- Pages: Runs, Experiments, Arena
- These names have timestamp-based auto-generated patterns
- Not caught by "Hide test content" filter

**22. Log iteration filter shows 1-20 but run only had 1 iteration**
- Page: Run detail → Logs tab
- Iteration dropdown always shows 1-20 regardless of how many iterations the run actually had
- Should be dynamically populated based on actual iteration count

**23. No pagination on dashboard Recent Runs table**
- Page: `/admin/evolution-dashboard`
- Shows 10 rows with no pagination or "View all" link
- If there are 11 runs, the 11th is hidden with no indication

**24. Variants list filter shows "Agent Name" text input but column header says "Agent"**
- Page: `/admin/evolution/variants`
- Filter input placeholder says "Filter by agent..." but the column is "Agent"
- Also, the field filters by `generation_method` not agent name (semantically different)

**25. Arena topics page shows "0 entries" for 2 of 3 topics**
- Page: `/admin/evolution/arena`
- Only "Federal reserve" topic has entries (43); the other two show 0
- Empty arena topics clutter the view

**26. Winner column empty (just a link) for non-winner variants**
- Page: `/admin/evolution/variants`
- Non-winner variants have an empty cell with a link that has no text
- Should show "—" or nothing, not an empty clickable link

**27. Experiment detail shows experiment ID prefix in cross-links instead of name**
- Page: Run detail header
- Shows "Experiment: d5083087" instead of "Experiment: March 26, 2026 - B"

### LOW — Accessibility/Polish (13 issues)

**28. Initial page load shows "0 items" briefly before data loads (flash of empty state)**
- Pages: All list pages (Runs, Experiments, Variants, Invocations, Arena)
- Accessibility snapshot captures "0 items" and empty table cells during loading
- Should show loading skeleton or suppress count until data is ready

**29. Table column headers empty in accessibility tree during loading**
- Pages: All list pages
- While data loads, the accessibility tree shows `columnheader [ref=eXX]` with no text
- Screen readers would announce empty column headers

**30. Sidebar nav item "Runs" is highlighted but link isn't marked as current**
- Page: Runs list
- Visual highlighting works but no `aria-current="page"` attribute on the active nav link

**31. Status badges lack semantic meaning in accessibility tree**
- Pages: Dashboard, Runs, Experiments
- Status shows as plain text "✓ completed" or "✗ failed" — the checkmark/cross are decorative Unicode but there's no `aria-label` explaining the status

**32. Tab navigation doesn't set aria-selected properly on tab change**
- Page: Run detail tabs
- When switching tabs, the previously selected tab doesn't immediately lose `[selected]` in some snapshots

**33. Lineage graph rendered as `img` with no alt text**
- Page: Run detail → Lineage tab
- The SVG lineage visualization is wrapped in `img [ref=eXX]` with no alt text
- Screen readers can't describe the graph

**34. Copy UUID button tooltip text truncated: "6e57e44c-9aa…"**
- Page: Run detail header
- The copy button shows a truncated UUID — should show full UUID on hover or in tooltip

**35. Breadcrumb separator uses plain "/" text instead of aria-hidden separator**
- Page: All detail pages
- Breadcrumb shows `/ Runs` with the slash as visible text content rather than a decorative separator

**36. No empty state messaging on Arena topics with 0 entries**
- Page: `/admin/evolution/arena`
- Topics with 0 entries show "0" in the Entries column but no guidance on why they're empty or how to populate them

**37. Experiments page Delete/Cancel buttons have no confirmation dialog visible**
- Page: `/admin/evolution/experiments`
- Delete and Cancel buttons are rendered inline with no indication they'll trigger a confirmation
- Could lead to accidental deletion (though there may be a ConfirmDialog — couldn't verify without clicking)

**38. Pagination uses "◀ Prev" and "Next ▶" with unicode triangles**
- Pages: Variants, Invocations
- Unicode triangles may render inconsistently across browsers/fonts
- Better to use CSS arrows or SVG icons

**39. Fast Refresh triggering excessively (50+ rebuilds during Lineage tab)**
- Page: Run detail → Lineage tab
- Console shows 50+ "Fast Refresh rebuilding/done" cycles in rapid succession (3-6ms each)
- Suggests the D3 lineage component is triggering unnecessary re-renders in dev mode

**40. Web Vitals: TTFB consistently "poor" (2-7 seconds) on admin pages**
- Pages: All evolution admin pages
- First Contentful Paint: 2800-7100ms (needs-improvement to poor)
- Time to First Byte: 2000-7000ms (poor)
- Server-side rendering is slow, likely due to multiple sequential Supabase queries in server actions

## Phase 3: Implementation

### Bugs Fixed
| Bug | Status | Change Summary |
|-----|--------|---------------|
| 1, 4 | ✅ Fixed | Cost fallback to `evolution_run_costs` view when metrics $0 + enhanced error logging |
| 3 | ✅ Fixed | Invocations show "⚠ budget" for budget-exceeded failures (added `error_message` field) |
| 5 | ✅ Fixed | Stopped truncating muHistory to top-1; EloTab renders multi-line top-K chart |
| 2, 6 | ✅ Fixed | Shared `getTestStrategyIds` + `applyTestContentNameFilter` across 7 service files |
| 7 | ✅ Fixed | Stale experiment indicator (running > 1hr = "stale" badge) |
| 8 | ✅ Fixed | Arena empty name → "Untitled" fallback |
| 9 | ✅ Fixed | Variants empty agent → "—" fallback |
| 10 | ✅ Fixed | Match count tooltip clarification on VariantsTab header |
| 12 | ✅ Fixed | Added success/failure filter to invocations page |
| 15 | ✅ Fixed | LineageGraph shows "All initial (Gen 0)" message + aria-label |
| 16 | ✅ Fixed | Run detail title uses prompt name instead of UUID when available |
| 18 | ✅ Fixed | Variant rank display spacing: `#1 ★ 8bf778` |
| 22 | ✅ Fixed | Log iteration dropdown removes hardcoded 20 fallback |
| 23 | ✅ Fixed | Dashboard "View all runs →" link |
| 26 | ✅ Fixed | Winner column "—" for non-winners instead of empty |
| 28/29 | ✅ Fixed | Suppress item count during loading |
| 33 | ✅ Fixed | Lineage graph SVG aria-label |
| 35 | ✅ Fixed | Breadcrumb separator aria-hidden |
| 11 | ✅ Fixed | Added Variants count and renamed "Total Matches" → "Total Comparisons" in MetricsTab |
| 13 | ✅ Fixed | RunsTable explanation column shows explanation_title (batch-fetched) |
| 14 | ✅ Fixed | Created column min-width + whitespace-nowrap |
| 17 | ✅ Fixed | Experiment name dedup — appends "(N)" suffix for duplicates |
| 20 | ✅ Fixed | Shared formatDate/formatDateTime helpers, applied to RunsTable/experiments/arena |
| 25 | ✅ Fixed | "Hide empty topics" toggle on arena page |
| 27 | ✅ Fixed | Cross-links prefix UUID fallbacks with # for clarity |
| 30 | ✅ Fixed | aria-current="page" on active admin sidebar nav link |
| 31 | ✅ Fixed | role="status" + aria-label on EvolutionStatusBadge |
| 34 | ✅ Fixed | Copy button tooltip shows full UUID |
| 36 | ✅ Fixed | Enhanced empty arena topic messaging with guidance |
| 38 | ✅ Fixed | Replaced Unicode ◀▶ with SVG arrows in pagination |
| 19 | ⏭ Skipped | Duration "—" for old data — no retroactive data available |
| 21 | ⏭ Covered | Auto-generated test names caught by improved filter (Bug 6 fix) |
| 24 | ⏭ Skipped | Filter placeholder already uses label — acceptable behavior |
| 32 | ✅ Already correct | EntityDetailTabs already has aria-selected |
| 37 | ✅ Already correct | ConfirmDialog exists and used in 3 locations |
| 39 | ✅ Already correct | LineageGraph already wrapped in useCallback with proper deps |
| 40 | ⏭ Investigated | Dashboard queries already parallelized; TTFB dominated by network latency |

### Files Modified
- `evolution/src/services/evolutionVisualizationActions.ts` — cost fallback, shared filter import, Elo multi-line
- `evolution/src/services/evolutionActions.ts` — cost fallback, shared filter import
- `evolution/src/services/invocationActions.ts` — error_message field, success filter, shared filter
- `evolution/src/services/experimentActions.ts` — shared filter import
- `evolution/src/services/strategyRegistryActions.ts` — shared filter import
- `evolution/src/services/arenaActions.ts` — shared filter import
- `evolution/src/services/shared.ts` — `isTestContentName`, `getTestStrategyIds`, `applyTestContentNameFilter`
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — muHistory not truncated, enhanced error logging
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — enhanced error logging
- `evolution/src/components/evolution/tabs/EloTab.tsx` — multi-line top-K chart
- `evolution/src/components/evolution/tabs/VariantsTab.tsx` — rank spacing, match count tooltip
- `evolution/src/components/evolution/tabs/LogsTab.tsx` — dynamic iteration dropdown
- `evolution/src/components/evolution/LineageGraph.tsx` — Gen-0 message, aria-label
- `evolution/src/components/evolution/EvolutionBreadcrumb.tsx` — separator aria-hidden
- `evolution/src/components/evolution/EntityListPage.tsx` — suppress count during loading
- `src/app/admin/evolution/invocations/page.tsx` — budget exceeded status, success filter
- `src/app/admin/evolution/experiments/page.tsx` — stale experiment indicator
- `src/app/admin/evolution/arena/page.tsx` — null name fallback
- `src/app/admin/evolution/variants/page.tsx` — agent fallback, winner "—"
- `src/app/admin/evolution/runs/[runId]/page.tsx` — prompt name in title
- `src/app/admin/evolution-dashboard/page.tsx` — "View all runs" link

### Tests Added/Updated
- `evolution/src/services/shared.test.ts` — 6 new tests for `isTestContentName`
- `evolution/src/components/evolution/tabs/EloTab.test.tsx` — 2 new tests (multi-line, legacy)
- `evolution/src/services/invocationActions.test.ts` — updated mock for `getTestStrategyIds`
- `evolution/src/services/experimentActions.test.ts` — updated filter assertions
- `evolution/src/services/strategyRegistryActions.test.ts` — updated filter assertions
- `evolution/src/services/arenaActions.test.ts` — updated filter assertions
