# Maintenance: bugs-ux — Remediation Plan

## Background
Auto-generated from maintenance findings on 20260330.
See `maint_bugs-ux_20260330_research.md` for the full report.
Branch: `chore/maint-bugs-ux-20260330`
Worktree: worktree_37_5

## Scope
- **6 bugs** (B4 removed after verification — see Corrections below)
- **Top 20 UX improvements** (out of 43 total UX issues)
- **26 items total**

## Corrections from Review (Iteration 1)
- **B4 (Nested table) REMOVED**: Verified that `runs/page.tsx` uses `renderTable` prop on `EntityListPage` (line 145-153) which renders `RunsTable` inside a `<div>`, not a `<table>` inside `<td>`. The accessibility tree artifact was from the loading skeleton, not the actual table. Not a real bug.
- **U3 (Runs pagination) DOWNGRADED**: Runs page already uses `EntityListPage` with `pageSize=50` (line 43). It HAS pagination — the issue is that with "Hide test content" checked, 0 results show (so pagination is invisible). Changed from "add pagination" to "reduce pageSize to 20 for consistency".
- **B2 (Recent Runs sort) NEEDS VERIFICATION**: Code appears to use `created_at DESC`. The observed behavior (all Pending) may be because the most recent runs genuinely ARE all pending. Will verify during implementation and downgrade to non-bug if confirmed.
- **U1 padding values VERIFIED**: TableSkeleton: headers `py-2`, rows `py-2.5`. EntityTable: headers `py-1`, rows `py-2`. Fix direction confirmed correct: reduce skeleton padding to match table.

## Problem
The evolution admin dashboard has 6 confirmed bugs (data display, missing page, filter gap, UI duplicates) and 20 UX improvements. No critical bugs — all pages load and basic functionality works.

## Rollback Strategy
- All changes are UI-only (no DB migrations, no API changes except arena pagination)
- Each phase is independently deployable — can ship Phase 1 without Phase 2
- If CLS regresses: revert TableSkeleton padding change only
- If pagination breaks: revert arena action + page changes only
- If start-experiment wizard breaks: revert wizard changes only (Tier C)
- Feature flag not needed — changes are small, incremental, and independently testable

---

## Phase 1: Bugs (6 confirmed, prioritized by impact)

### P0 — Data correctness bugs
- [ ] **B1.** Dashboard Total Cost / Avg Cost show $0.00 with 299 completed runs (#15)
  - Files: `src/app/admin/evolution-dashboard/page.tsx`, dashboard data action in `evolution/src/services/`
  - Investigation: Check if cost aggregation query sums correctly. Add error handling with logging if both `evolution_metrics` and `evolution_run_costs` sources fail — log error, show "Cost unavailable" instead of misleading $0.00.
  - Test: Unit test for cost aggregation with mock data (0 runs, 1 run, many runs, null costs)
- [ ] **B2.** Dashboard "Recent Runs" may show misleading order (#16)
  - Files: dashboard page data action
  - Investigation: Verify sort order is `created_at DESC`. If code is correct and all recent runs genuinely are Pending, downgrade to non-bug and close.
  - Test: Unit test for sort order of returned runs
- [ ] **B3.** "stale" experiment status exists in data but not in filter dropdown (#10)
  - Files: `src/app/admin/evolution/experiments/page.tsx` lines 44-50
  - Fix: Add `{ label: 'Stale', value: 'stale' }` to filter options. Stale is computed dynamically (running > 60min) at lines 84-89 — verify filter works with computed status.
  - Test: Unit test that filter options include 'stale'; test that stale experiments appear when filter selected

### P1 — Structural bugs
- [ ] **B4.** `/admin/evolution` returns 404 — missing index page (#5)
  - Fix: Create `src/app/admin/evolution/page.tsx` with `redirect('/admin/evolution-dashboard')` using Next.js `redirect()` from `next/navigation`
  - Test: E2E test that `/admin/evolution` redirects to dashboard
- [ ] **B5.** Duplicate checkbox elements for "Remember me" on login (#33)
  - Files: `src/app/login/` — inspect checkbox rendering
  - Investigation: Check if duplicate is from a hidden native checkbox + styled overlay pattern. If intentional (common in custom checkbox components), add `aria-hidden="true"` to the duplicate. If accidental, remove it.
  - Test: Unit test or snapshot test for login form accessibility tree
- [ ] **B6.** Item count sometimes missing on initial render — hydration timing (#36)
  - Files: affected list pages (experiments, runs)
  - Investigation: Check if count renders before data loads. May need to show count in loading skeleton or defer count display until data arrives.
  - Test: Verify in existing page tests that item count appears after data load

---

## Phase 2: Top 20 UX Improvements (prioritized by impact x effort)

### Tier A — High impact, low effort (fixes multiple issues each)
- [ ] **U1.** Fix TableSkeleton padding to match EntityTable (fixes #1, #2, #3)
  - `evolution/src/components/evolution/tables/TableSkeleton.tsx`
  - VERIFIED: Change header cells from `py-2` → `py-1`, body cells from `py-2.5` → `py-2`
  - Test: Snapshot test confirming padding classes match EntityTable
- [ ] **U2.** Add page-specific `<title>` tags to all evolution admin pages (#11)
  - Each page.tsx or layout.tsx — use Next.js `metadata` export or `generateMetadata`
  - Pages: dashboard, experiments, prompts, strategies, runs, invocations, variants, arena, start-experiment, detail pages
  - Test: Unit test per page that metadata.title is set (or snapshot test)
- [ ] **U3.** Reduce runs list pageSize from 50 to 20 for consistency (#6, #48)
  - `src/app/admin/evolution/runs/page.tsx` line 43: change `pageSize = 50` → `pageSize = 20`
  - NOTE: Pagination already works via EntityListPage — just page size is inconsistent
  - Test: Update existing page.test.tsx if it asserts page size
- [ ] **U4.** Add pagination to arena detail page (#4)
  - Add `limit`/`offset` params to `getArenaEntriesAction` in `evolution/src/services/arenaActions.ts`
  - Return `{ items: ArenaEntry[], total: number }` instead of `ArenaEntry[]`
  - Refactor `src/app/admin/evolution/arena/[topicId]/page.tsx` to use pagination state
  - NOTE: Arena detail has custom sorting/elo-rank logic — pagination must be server-side to preserve sort order
  - Test: Unit test for action with limit/offset; update existing arena page test
- [ ] **U5.** Add `role="alert"` to start-experiment validation errors (#9)
  - `src/app/admin/evolution/start-experiment/page.tsx` — wrap error list container with `role="alert" aria-live="polite"`
  - Test: Unit test asserting role="alert" on error container
- [ ] **U6.** Add accessible labels to strategy checkboxes (#8)
  - Start-experiment step 2 — add `aria-label={strategyName}` to each `<input type="checkbox">`
  - Test: Unit test asserting each checkbox has aria-label

### Tier B — Medium impact, low-medium effort
- [ ] **U7.** Add horizontal scroll wrapper to wide tables (#12, #47)
  - `evolution/src/components/evolution/tables/EntityTable.tsx` — wrap `<table>` in `<div className="overflow-x-auto">`
  - Test: Snapshot test; visual check that scroll appears on narrow viewport
- [ ] **U8.** Add breadcrumb to dashboard page (#13)
  - `src/app/admin/evolution-dashboard/page.tsx` — add breadcrumb matching other pages
  - Test: Unit test that breadcrumb renders
- [ ] **U9.** Persist filter state in URL search params (#21)
  - `src/app/admin/evolution/experiments/page.tsx` — use `useSearchParams` + `router.replace` on filter change
  - Edge cases: back/forward browser nav, direct URL paste, filter+pagination combo
  - Security: URL params are display-only filters (status string), no injection risk — values are validated against allowlist
  - Test: Unit test for URL param sync; E2E test for filter persistence across refresh
- [ ] **U10.** Make empty state messages context-aware per filter (#20, #22, #25)
  - `src/app/admin/evolution/experiments/page.tsx` — map filter value to specific message
  - Test: Unit test per filter value that correct message renders
- [ ] **U11.** Link "Use the experiment wizard" to `/admin/evolution/start-experiment` (#23)
  - Simple `<Link>` addition in experiments empty state
  - Test: Unit test that link renders with correct href
- [ ] **U12.** Replace plain "Loading..." with skeleton/spinner on start-experiment (#26)
  - Add `src/app/admin/evolution/start-experiment/loading.tsx` with form skeleton
  - Test: Snapshot test

### Tier C — Medium impact, medium effort
- [ ] **U13.** Make stepper tabs clickable for completed steps (#27)
  - Allow clicking "Setup" from step 2, "Setup"/"Strategies" from step 3
  - Test: Unit test for stepper click handlers; E2E test for step navigation
- [ ] **U14.** Add tooltip to disabled "Review" button explaining requirement (#34)
  - Add `title="Select at least one strategy"` or use a tooltip component
  - Test: Unit test for title attribute on disabled button
- [ ] **U15.** Add confirmation dialog before "Create Experiment" (#42)
  - Simple confirm modal: "This will start X pipeline runs costing ~$Y. Continue?"
  - Test: Unit test that dialog appears on click; E2E test for confirm → create flow
- [ ] **U16.** Make strategy configs collapsible in review step (#40)
  - Wrap each strategy config in `<details>/<summary>` or accordion component
  - Test: Unit test for expand/collapse; snapshot test
- [ ] **U17.** Show inline validation errors next to fields (#28, #31)
  - Move error messages from bottom list to beneath each invalid field
  - BREAKING: Existing tests may assert error list below form — update page.test.tsx assertions
  - Test: Update existing tests to assert inline errors; add test for each field error state
- [ ] **U18.** Add "Contact admin to reset password" link or action (#32)
  - Either `mailto:` link or remove the unhelpful text entirely
  - Test: Unit test for link href or text removal
- [ ] **U19.** Fix "Back to Evolution Dashboard" on 404 pages to use URL context (#50)
  - Parse URL path to determine entity type, link to relevant list page
  - e.g. `/admin/evolution/runs/xxx` → "Back to Runs"
  - Test: Unit test for back link generation from URL path
- [ ] **U20.** Show "Showing X of Y" on dashboard Recent Runs (#18)
  - Add count indicator: "Showing 10 most recent of {totalCount} runs"
  - Test: Unit test for count display

---

## Testing Strategy

### Principles
- **Test pyramid**: Majority unit tests (1 per fix minimum), targeted E2E for critical flows
- **Existing test protection**: Run full test suite before and after each phase. Audit tests that may break (especially U17 validation refactor).
- **No CLS in CI**: CLS measurement requires real browser rendering. Verify via manual Playwright check post-deploy, not CI gate. Skeleton padding fix (U1) is deterministic — if classes are correct, CLS improves.

### Unit tests (26 specs — 1 per fix)
| Fix | Test Description | File |
|-----|-----------------|------|
| B1 | Cost aggregation: 0/1/many runs, null costs, both sources fail → "unavailable" | dashboard action test |
| B2 | Recent runs sorted by created_at DESC | dashboard action test |
| B3 | Filter options include 'stale'; stale experiments returned when filtered | experiments/page.test.tsx |
| B4 | /admin/evolution redirects (integration test via page render) | new page.test.tsx |
| B5 | Login form: no duplicate checkbox in rendered output | login page test |
| B6 | Item count appears after data load | existing page tests |
| U1 | TableSkeleton padding classes = py-1 (header), py-2 (body) | TableSkeleton.test.tsx |
| U2 | Each page exports metadata with page-specific title | per-page test |
| U3 | Runs pageSize = 20 | runs/page.test.tsx |
| U4 | getArenaEntriesAction accepts limit/offset, returns {items, total} | arenaActions.test.ts |
| U5 | Validation error container has role="alert" | start-experiment test |
| U6 | Strategy checkboxes have aria-label | start-experiment test |
| U7 | Table wrapper has overflow-x-auto class | EntityTable.test.tsx |
| U8 | Dashboard renders breadcrumb | dashboard test |
| U9 | Filter change updates URL search params | experiments/page.test.tsx |
| U10 | Each filter value renders context-specific empty message | experiments/page.test.tsx |
| U11 | Empty state links to /admin/evolution/start-experiment | experiments/page.test.tsx |
| U12 | Start-experiment loading.tsx renders skeleton | snapshot test |
| U13 | Completed stepper tabs are clickable | start-experiment test |
| U14 | Disabled Review button has title attribute | start-experiment test |
| U15 | Create Experiment shows confirmation dialog | start-experiment test |
| U16 | Strategy configs are collapsible (details/summary) | start-experiment test |
| U17 | Inline validation errors render next to fields | start-experiment test (UPDATE existing) |
| U18 | Password reset text is link or removed | login test |
| U19 | 404 back link uses URL-based context | not-found test |
| U20 | Dashboard shows "Showing X of Y" count | dashboard test |

### E2E tests (6 scenarios — critical flows only)
| # | Scenario | Fixes Covered |
|---|----------|---------------|
| 1 | `/admin/evolution` redirects to dashboard | B4 |
| 2 | Runs list shows ≤20 items per page with pagination controls | U3 |
| 3 | Arena detail paginates entries | U4 |
| 4 | Experiments: change filter → URL updates → refresh → filter preserved | U9 |
| 5 | Start-experiment wizard: empty submit → errors with role="alert" → fill → advance → stepper back-nav → review → confirm dialog | U5, U6, U13, U15, U17 |
| 6 | CLS spot-check: invocations page loads with CLS < 0.25 | U1 |

### Existing test audit (pre-implementation)
- [ ] Run `npm test -- --testPathPattern="evolution"` to baseline passing tests
- [ ] Identify tests that assert validation error list structure (U17 will change this)
- [ ] Identify tests that assert pageSize=50 for runs (U3 changes this)
- [ ] Identify tests for arena entries action signature (U4 changes this)

---

## Verification
- [ ] All 6 bugs confirmed fixed via manual testing
- [ ] CLS visually improved on invocations/variants/arena (Playwright spot-check)
- [ ] Accessibility: no unlabeled form controls, validation errors announced
- [ ] All existing unit tests pass (271 suites)
- [ ] All existing E2E critical tests pass
- [ ] Lint + TypeScript + Build pass
- [ ] No regressions in dashboard data display
