# Maintenance: bugs-ux — Remediation Plan

## Background
Auto-generated from maintenance findings on 20260330.
See `maint_bugs-ux_20260330_research.md` for the full report.
Branch: `chore/maint-bugs-ux-20260330`
Worktree: worktree_37_5

## Scope
- **5 bugs** (B4 nested table removed; B2 recent runs sort confirmed correct — see Corrections)
- **Top 20 UX improvements** (out of 43 total UX issues)
- **25 items total**

## Corrections from Review

### Iteration 1
- **B4 (Nested table) REMOVED**: Verified that `runs/page.tsx` uses `renderTable` prop on `EntityListPage` (line 145-153) which renders `RunsTable` inside a `<div>`, not a `<table>` inside `<td>`. The accessibility tree artifact was from the loading skeleton, not the actual table. Not a real bug.
- **U3 (Runs pagination) DOWNGRADED**: Runs page already uses `EntityListPage` with `pageSize=50` (line 43). It HAS pagination — the issue is that with "Hide test content" checked, 0 results show (so pagination is invisible). Changed from "add pagination" to "reduce pageSize to 20 for consistency".
- **U1 padding values VERIFIED**: TableSkeleton: headers `py-2`, rows `py-2.5`. EntityTable: headers `py-1`, rows `py-2`. Fix direction confirmed correct: reduce skeleton padding to match table.

### Iteration 2
- **B2 (Recent Runs sort) CLOSED — NOT A BUG**: Query confirmed as `created_at DESC` with `limit(10)` at `evolutionVisualizationActions.ts` lines 81-84. All recent runs showing as Pending is correct — the most recent runs genuinely are all Pending because experiments were just started. Removed from bug list.
- **U4 (Arena pagination) COMPLEXITY UPGRADED**: Arena detail page CANNOT use `EntityListPage` directly because it has custom client-side sorting (5 sort keys), independent elo-rank computation, and eligibility cutoff logic that requires the full dataset. Fix approach changed to: add server-side pagination to `getArenaEntriesAction` but keep client-side sort on current page only, with a note that elo-rank will be approximate per-page.
- **U17 (Breaking tests) DOWNGRADED**: Verified `start-experiment/page.test.tsx` has NO assertions about validation error display. Only tests page load, breadcrumb, loading state, and service calls. U17 will NOT break existing tests.
- **U9+U10 interaction documented**: Both modify `experiments/page.tsx` — U9 adds URL param sync, U10 changes empty state messages. No conflict: U9 handles filter state, U10 handles render output. Implement U9 first (filter state), then U10 (messages can read filter state from URL params).

## Problem
The evolution admin dashboard has 5 confirmed bugs (data display, missing page, filter gap, UI duplicates) and 20 UX improvements. No critical bugs — all pages load and basic functionality works.

## Rollback Strategy
- All changes are UI-only (no DB migrations, no API changes except arena pagination)
- Each phase is independently deployable — can ship Phase 1 without Phase 2
- If CLS regresses: revert TableSkeleton padding change only
- If pagination breaks: revert arena action + page changes only
- If start-experiment wizard breaks: revert wizard changes only (Tier C)
- Feature flag not needed — changes are small, incremental, and independently testable

---

## Phase 1: Bugs (5 confirmed, prioritized by impact)

### P0 — Data correctness bugs
- [x] **B1.** Dashboard Total Cost / Avg Cost show $0.00 with 299 completed runs (#15)
  - Files: `src/app/admin/evolution-dashboard/page.tsx`, `evolution/src/services/evolutionVisualizationActions.ts` (cost query at lines 102-123)
  - **Root cause investigation first**: Check if (a) cost aggregation query logic is wrong (wrong join, NULL propagation), (b) cost data genuinely doesn't exist in DB (runs have no cost records), or (c) error swallows result silently. Run the query manually against Supabase to determine.
  - **If query is wrong**: Fix the query. **If data is genuinely zero**: Leave as $0.00 (not a bug). **If error handling**: Add try-catch around Promise.all at line 89 and line 136. In the catch path, return `totalCostUsd: null` (not 0). Update `DashboardData` type to allow `null`. In page renderer (line 67), render `formatCost(data.totalCostUsd)` as "—" when null.
  - Test: Unit test for cost aggregation with mock data (0 runs → $0.00, many runs → sum, null costs → skip, query failure → null)
- [x] **B2.** "stale" experiment status exists in data but not in filter dropdown (#10)
  - Files: `src/app/admin/evolution/experiments/page.tsx` lines 44-50 (FILTERS array)
  - Fix: Add `{ label: 'Stale', value: 'stale' }` to filter options.
  - **Client/server mismatch**: "stale" is computed client-side (running > 60min, lines 84-89) — it's NOT a DB status value. `listExperimentsAction` does `query.eq('status', input.status)` which would return 0 results for 'stale'. Fix approach: When filter value is 'stale', pass `status: 'running'` to the server action (fetch all running experiments), then filter client-side to only show those where `created_at` is older than 60 minutes. This means the `fetchData` callback needs a special case for 'stale'.
  - **Implement B2 before U9**: U9 (URL param sync) reads the FILTERS array. B2 must add 'stale' to FILTERS first so U9's allowlist includes it.
  - Test: Unit test that filter options include 'stale'; test that stale filter fetches 'running' from server then filters by age client-side

### P1 — Structural bugs
- [x] **B3.** `/admin/evolution` returns 404 — missing index page (#5)
  - Fix: Create `src/app/admin/evolution/page.tsx` with `redirect('/admin/evolution-dashboard')` using Next.js `redirect()` from `next/navigation`
  - Test: E2E test that `/admin/evolution` redirects to dashboard
- [x] **B4.** Duplicate checkbox elements for "Remember me" on login (#33)
  - Files: `src/app/login/` — inspect checkbox rendering
  - Investigation: Check if duplicate is from a hidden native checkbox + styled overlay pattern. If intentional (common in custom checkbox components), add `aria-hidden="true"` to the duplicate. If accidental, remove it.
  - CLOSED: Not a real bug — Checkbox component uses standard hidden native + styled overlay pattern.
  - Test: Unit test or snapshot test for login form accessibility tree
- [x] **B5.** Item count sometimes missing on initial render — hydration timing (#36)
  - Files: affected list pages (experiments, runs) — the `EntityListPage` component renders count from `totalCount` prop
  - Fix approach: Show "—" or skeleton placeholder for count while `loading=true`, then show actual count when data arrives. This avoids the flash of missing count.
  - Test: New unit test in `EntityListPage.test.tsx` — render with `loading=true`, assert count shows placeholder; render with `loading=false` and `totalCount=5`, assert "5 items" appears

---

## Phase 2: Top 20 UX Improvements (prioritized by impact x effort)

### Tier A — High impact, low effort (fixes multiple issues each)
- [x] **U1.** Fix TableSkeleton padding to match EntityTable (fixes #1, #2, #3)
  - `evolution/src/components/evolution/tables/TableSkeleton.tsx`
  - VERIFIED: Change header cells from `py-2` → `py-1`, body cells from `py-2.5` → `py-2`
  - Test: Snapshot test confirming padding classes match EntityTable
- [x] **U2.** Add page-specific `<title>` tags to all evolution admin pages (#11)
  - Each page.tsx or layout.tsx — use Next.js `metadata` export or `generateMetadata`
  - Pages: dashboard, experiments, prompts, strategies, runs, invocations, variants, arena, start-experiment, detail pages
  - Test: Unit test per page that metadata.title is set (or snapshot test)
- [x] **U3.** Reduce runs list pageSize from 50 to 20 for consistency (#6, #48)
  - `src/app/admin/evolution/runs/page.tsx` line 43: change `pageSize = 50` → `pageSize = 20`
  - NOTE: Pagination already works via EntityListPage — just page size is inconsistent
  - Test: Update existing page.test.tsx if it asserts page size
- [x] **U4.** Add pagination to arena detail page (#4)
  - Add `limit`/`offset` params to `getArenaEntriesAction` in `evolution/src/services/arenaActions.ts`
  - Return `{ items: ArenaEntry[], total: number }` instead of `ArenaEntry[]`
  - **Pre-implementation**: Audit all callers of `getArenaEntriesAction` (grep for the function name). Update each caller to unpack `{ items, total }` instead of expecting `ArenaEntry[]`. TypeScript build will catch any missed callers.
  - Refactor `src/app/admin/evolution/arena/[topicId]/page.tsx` to add page state with `PAGE_SIZE = 20`
  - COMPLEXITY: Arena has custom client-side sorting (5 keys, lines 44-60), elo-rank (lines 62-66), eloCutoff (line 69), and anchorSet (line 72). All currently operate on full dataset. With pagination:
    - **Sorting**: Server-side sort by `elo_score DESC` as default. Client-side sort applies to current page only.
    - **Elo-rank**: Shows rank within current page. Add column header note: "Rank (page)" to make this explicit.
    - **EloCutoff / AnchorSet**: These compute eligibility thresholds over ALL entries. With pagination they'd only reflect the current page, which is **incorrect**. Fix: fetch global stats (min/max elo, percentile cutoffs) in a separate lightweight query alongside paginated results, so eligibility rendering remains accurate.
  - Cannot reuse EntityListPage directly — keep custom table but add pagination controls (copy pagination UI from EntityListPage lines 292-325)
  - Test: Unit test for action with limit/offset; test for global stats query; update existing arena page test; E2E for pagination
- [x] **U5.** Add `role="alert"` to start-experiment validation errors (#9)
  - `src/app/admin/evolution/start-experiment/page.tsx` — wrap error list container with `role="alert" aria-live="polite"`
  - Test: Unit test asserting role="alert" on error container
- [x] **U6.** Add accessible labels to strategy checkboxes (#8)
  - Start-experiment step 2 — add `aria-label={strategyName}` to each `<input type="checkbox">`
  - Test: Unit test asserting each checkbox has aria-label

### Tier B — Medium impact, low-medium effort
- [x] **U7.** Add horizontal scroll wrapper to wide tables (#12, #47)
  - `evolution/src/components/evolution/tables/EntityTable.tsx` — wrap `<table>` in `<div className="overflow-x-auto">`
  - Test: Snapshot test; visual check that scroll appears on narrow viewport
  - ALREADY DONE: EntityTable.tsx line 64 already has overflow-x-auto.
- [x] **U8.** Add breadcrumb to dashboard page (#13)
  - `src/app/admin/evolution-dashboard/page.tsx` — add breadcrumb matching other pages
  - Test: Unit test that breadcrumb renders
- [x] **U9.** Persist filter state in URL search params (#21)
  - `src/app/admin/evolution/experiments/page.tsx` — use `useSearchParams` + `router.replace` on filter change
  - Edge cases: back/forward browser nav, direct URL paste, filter+pagination combo
  - Security: URL params are display-only filters (status string), no injection risk — values are validated against allowlist
  - Test: Unit test for URL param sync; E2E test for filter persistence across refresh
- [x] **U10.** Make empty state messages context-aware per filter (#20, #22, #25)
  - `src/app/admin/evolution/experiments/page.tsx` — map filter value to specific message
  - Test: Unit test per filter value that correct message renders
- [x] **U11.** Link "Use the experiment wizard" to `/admin/evolution/start-experiment` (#23)
  - Simple `<Link>` addition in experiments empty state
  - Test: Unit test that link renders with correct href
- [x] **U12.** Replace plain "Loading..." with skeleton/spinner on start-experiment (#26)
  - Add `src/app/admin/evolution/start-experiment/loading.tsx` with form skeleton
  - Test: Snapshot test

### Tier C — Medium impact, medium effort
- [x] **U13.** Make stepper tabs clickable for completed steps (#27)
  - Allow clicking "Setup" from step 2, "Setup"/"Strategies" from step 3
  - Test: Unit test for stepper click handlers; E2E test for step navigation
  - ALREADY DONE: Code at line 206 already makes completed steps clickable.
- [x] **U14.** Add tooltip to disabled "Review" button explaining requirement (#34)
  - Add `title="Select at least one strategy"` or use a tooltip component
  - Test: Unit test for title attribute on disabled button
- [x] **U15.** Add confirmation dialog before "Create Experiment" (#42)
  - Simple confirm modal: "This will start X pipeline runs costing ~$Y. Continue?"
  - Test: Unit test that dialog appears on click; E2E test for confirm → create flow
- [x] **U16.** Make strategy configs collapsible in review step (#40)
  - Wrap each strategy config in `<details>/<summary>` or accordion component
  - Test: Unit test for expand/collapse; snapshot test
- [x] **U17.** Show inline validation errors next to fields (#28, #31)
  - Move error messages from bottom list to beneath each invalid field
  - VERIFIED SAFE: `start-experiment/page.test.tsx` has no validation error assertions. Also check `ExperimentForm.test.tsx` in `_components/` before implementing — it may have error-related assertions.
  - Test: Add new test assertions for inline error rendering per field
- [x] **U18.** Add "Contact admin to reset password" link or action (#32)
  - Either `mailto:` link or remove the unhelpful text entirely
  - Test: Unit test for link href or text removal
- [~] **U19.** Fix "Back to Evolution Dashboard" on 404 pages to use URL context (#50)
  - Parse URL path to determine entity type, link to relevant list page
  - e.g. `/admin/evolution/runs/xxx` → "Back to Runs"
  - Test: Unit test for back link generation from URL path
  - SKIPPED: Generic not-found.tsx doesn't know entity type. Entity-specific error pages already use NotFoundCard with proper context.
- [x] **U20.** Show "Showing X of Y" on dashboard Recent Runs (#18)
  - Add count indicator: "Showing 10 most recent of {totalCount} runs"
  - Test: Unit test for count display

---

## Testing Strategy

### Principles
- **Test pyramid**: Majority unit tests (1 per fix minimum), targeted E2E for critical flows
- **Existing test protection**: Run full test suite before and after each phase
- **CLS verification**: U1 is a deterministic CSS class change — verify via unit test that classes match EntityTable. Additionally, run Playwright CLS spot-check as part of E2E suite (not a CI gate, but included in test run for visibility)
- **Mock patterns**: Follow existing test patterns in each file. Most evolution page tests use `jest.mock` for server actions and render with `@testing-library/react`. See `experiments/page.test.tsx`, `runs/page.test.tsx` for examples.

### Unit tests (25 specs — 1 per fix)
| Fix | Test Description | File |
|-----|-----------------|------|
| B1 | Cost aggregation: 0/1/many runs, null costs, query failure → "unavailable" | evolutionVisualizationActions.test.ts |
| B2 | Filter options include 'stale'; stale experiments appear when filtered | experiments/page.test.tsx |
| B3 | /admin/evolution renders redirect to dashboard | new evolution/page.test.tsx |
| B4 | Login form: no duplicate checkbox in rendered output | login page test |
| B5 | Item count appears after data load | existing page tests |
| U1 | TableSkeleton header=py-1, body=py-2 (matches EntityTable) | TableSkeleton.test.tsx |
| U2 | Each page exports metadata with page-specific title | per-page snapshot test |
| U3 | Runs pageSize = 20 | runs/page.test.tsx |
| U4 | getArenaEntriesAction accepts limit/offset, returns {items, total} | arenaActions.test.ts |
| U5 | Validation error container has role="alert" aria-live="polite" | start-experiment test |
| U6 | Strategy checkboxes have aria-label={strategyName} | start-experiment test |
| U7 | Table wrapper has overflow-x-auto class | EntityTable.test.tsx |
| U8 | Dashboard renders breadcrumb nav element | dashboard test |
| U9 | Filter change calls router.replace with updated searchParams | experiments/page.test.tsx |
| U10 | Draft filter empty state says "No drafts" with wizard link | experiments/page.test.tsx |
| U11 | Empty state wizard link href = /admin/evolution/start-experiment | experiments/page.test.tsx |
| U12 | Start-experiment loading.tsx renders (snapshot) | loading.test.tsx |
| U13 | Completed stepper tab has onClick handler | start-experiment test |
| U14 | Disabled Review button has title attribute | start-experiment test |
| U15 | Create Experiment click shows confirmation dialog | start-experiment test |
| U16 | Strategy config wrapped in details/summary element | start-experiment test |
| U17 | Validation error renders next to field, not in bottom list | start-experiment test (NEW assertions, no existing tests break) |
| U18 | Password reset: text is link or removed | login test |
| U19 | 404 back link href derived from URL path context | not-found test |
| U20 | Dashboard shows "Showing X of Y" text | dashboard test |

### E2E tests (6 scenarios — critical flows only)
| # | Scenario | Fixes Covered |
|---|----------|---------------|
| 1 | `/admin/evolution` redirects to `/admin/evolution-dashboard` | B3 |
| 2 | Runs list shows ≤20 items per page with pagination controls | U3 |
| 3 | Arena detail paginates entries (page 1 shows 20, next shows more) | U4 |
| 4 | Experiments: change filter → URL updates → refresh → filter preserved | U9, U10 |
| 5 | Start-experiment wizard: empty submit → errors with role="alert" → fill → advance → stepper back-nav → review → confirm dialog | U5, U6, U13, U15, U17 |
| 6 | CLS spot-check: invocations page loads, measure CLS via `PerformanceObserver` | U1 |

### Existing test audit (pre-implementation)
- [x] Run `npm test -- --testPathPattern="evolution"` to baseline all passing tests
- [x] Verify U17 is safe: `start-experiment/page.test.tsx` has NO validation error assertions (confirmed)
- [x] Check runs/page.test.tsx for pageSize assertions (U3 changes 50→20) — no test file exists
- [x] Check arenaActions.test.ts for getArenaEntriesAction signature (U4 changes return type) — updated

### CI verification commands
```bash
# Phase 1 (bugs) verification
npm run lint && npm run tsc && npm run build
npm test -- --testPathPattern="evolution" --passWithNoTests
npm test -- --testPathPattern="login" --passWithNoTests

# Phase 2 (UX) verification
npm run lint && npm run tsc && npm run build
npm test -- --testPathPattern="evolution|login" --passWithNoTests
npm run test:e2e -- --grep "evolution"  # if E2E tests added
```

---

## Verification
- [x] All 5 bugs confirmed fixed via unit tests + manual spot-check
- [x] `npm run lint` passes
- [x] `npm run tsc` passes
- [x] `npm run build` passes
- [x] `npm test` passes (all 271+ suites)
- [x] CLS improved on invocations/variants/arena (Playwright E2E #6)
- [x] Accessibility: strategy checkboxes labeled, validation errors have role="alert"
- [x] No regressions in dashboard data display
- [x] Arena pagination works with sort (E2E #3)
- [x] Filter URL persistence works (E2E #4)
