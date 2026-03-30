# Maintenance: bugs-ux — Remediation Plan

## Background
Auto-generated from maintenance findings on 20260330.
See `maint_bugs-ux_20260330_research.md` for the full report.
Branch: `chore/maint-bugs-ux-20260330`
Worktree: worktree_37_5

## Scope
- **7 bugs** (all)
- **Top 20 UX improvements** (out of 43 total UX issues)
- **27 items total**

## Problem
The evolution admin dashboard has 7 real bugs (broken data, missing pages, malformed HTML) and numerous UX gaps (missing pagination, layout shifts, poor accessibility, form usability). No critical bugs — all pages load and basic functionality works.

---

## Phase 1: Bugs (all 7, prioritized by impact)

### P0 — Data correctness bugs
- [ ] **B1.** Dashboard Total Cost / Avg Cost show $0.00 with 299 completed runs (#15)
  - Files: `src/app/admin/evolution-dashboard/page.tsx` or dashboard data action
  - Likely: cost aggregation query not summing correctly, or field not populated in DB
- [ ] **B2.** Dashboard "Recent Runs" shows only Pending, not most recent by time (#16)
  - Files: dashboard page — query likely sorted by status instead of `created_at DESC`
- [ ] **B3.** "stale" experiment status exists in data but not in filter dropdown (#10)
  - Files: `src/app/admin/evolution/experiments/page.tsx` — add "Stale" to filter options

### P1 — Structural bugs
- [ ] **B4.** Nested table in runs list accessibility tree (#7)
  - Files: `src/app/admin/evolution/runs/page.tsx` — `<table>` rendered inside a `<td>`
- [ ] **B5.** `/admin/evolution` returns 404 — missing index page (#5)
  - Fix: add `src/app/admin/evolution/page.tsx` that redirects to `/admin/evolution-dashboard`
- [ ] **B6.** Duplicate checkbox elements for "Remember me" on login (#33)
  - Files: `src/app/login/page.tsx` or login form component
- [ ] **B7.** Item count sometimes missing on initial render — hydration timing (#36)
  - Files: affected list pages — likely race between skeleton unmount and count render

---

## Phase 2: Top 20 UX Improvements (prioritized by impact x effort)

### Tier A — High impact, low effort (fixes multiple issues each)
- [ ] **U1.** Fix TableSkeleton padding to match EntityTable (fixes #1, #2, #3)
  - `evolution/src/components/evolution/tables/TableSkeleton.tsx`: py-2→py-1 headers, py-2.5→py-2 rows
- [ ] **U2.** Add page-specific `<title>` tags to all evolution admin pages (#11)
  - Each `page.tsx` or `layout.tsx` — use Next.js `metadata` export
- [ ] **U3.** Add pagination to runs list page (#6, #48)
  - Follow invocations/variants pattern: `EntityListPage` with `PAGE_SIZE=20`
- [ ] **U4.** Add pagination to arena detail page (#4)
  - Add `limit`/`offset` to `getArenaEntriesAction`, use `EntityListPage`
- [ ] **U5.** Add `role="alert"` to start-experiment validation errors (#9)
  - `src/app/admin/evolution/start-experiment/page.tsx` — wrap error list in `role="alert"`
- [ ] **U6.** Add accessible labels to strategy checkboxes (#8)
  - Add `aria-label={strategyName}` to each checkbox in step 2

### Tier B — Medium impact, low-medium effort
- [ ] **U7.** Add horizontal scroll wrapper to wide tables (#12, #47)
  - `EntityTable.tsx` or `EntityListPage.tsx` — wrap table in `overflow-x-auto` container
- [ ] **U8.** Add breadcrumb to dashboard page (#13)
  - Match pattern used by all other evolution pages
- [ ] **U9.** Persist filter state in URL search params (#21)
  - Use `useSearchParams` + `router.replace` when filters change
- [ ] **U10.** Make empty state messages context-aware per filter (#20, #22, #25)
  - Draft: "No drafts. Create one with the experiment wizard." (with link)
  - Cancelled: "No cancelled experiments."
  - Running: "No experiments running."
- [ ] **U11.** Link "Use the experiment wizard" to `/admin/evolution/start-experiment` (#23)
  - Simple `<Link>` addition in experiments empty state
- [ ] **U12.** Replace plain "Loading..." with skeleton/spinner on start-experiment (#26)
  - Add a proper loading.tsx or inline skeleton

### Tier C — Medium impact, medium effort
- [ ] **U13.** Make stepper tabs clickable for completed steps (#27)
  - Allow clicking "Setup" from step 2, and "Setup"/"Strategies" from step 3
- [ ] **U14.** Add tooltip to disabled "Review" button explaining requirement (#34)
  - "Select at least one strategy to continue"
- [ ] **U15.** Add confirmation dialog before "Create Experiment" (#42)
  - Simple "Are you sure?" modal since experiment creation triggers pipeline runs
- [ ] **U16.** Make strategy configs collapsible in review step (#40)
  - Wrap each strategy config in an accordion/disclosure component
- [ ] **U17.** Show inline validation errors next to fields (#28, #31)
  - Move error messages from bottom list to beneath each invalid field
- [ ] **U18.** Add "Contact admin to reset password" link or action (#32)
  - Either mailto: link or remove the text if no action exists
- [ ] **U19.** Fix "Back to Evolution Dashboard" on 404 pages to use referrer (#50)
  - Or change to "Back to Runs" / "Back to Experiments" based on URL context
- [ ] **U20.** Show "Showing X of Y" on dashboard Recent Runs (#18)
  - Add count indicator: "Showing 10 most recent of 416 runs"

---

## Testing

### Unit tests
- [ ] TableSkeleton padding matches EntityTable (snapshot or computed style test)
- [ ] Experiments filter includes "Stale" option
- [ ] Dashboard cost aggregation returns correct values
- [ ] Arena entries action accepts limit/offset params
- [ ] Validation errors container has role="alert"
- [ ] Strategy checkboxes have aria-labels

### E2E tests (Playwright)
- [ ] `/admin/evolution` redirects to dashboard
- [ ] Runs list paginates (shows max 20 items per page)
- [ ] Arena detail paginates
- [ ] Filter state persists in URL on page refresh
- [ ] Start experiment wizard: validation → fix → advance → review → back navigation
- [ ] CLS < 0.1 on invocations, variants, arena pages

---

## Verification
- [ ] All 7 bugs confirmed fixed via manual testing
- [ ] CLS scores improved on invocations/variants/arena (< 0.1)
- [ ] Accessibility audit: no unlabeled form controls, all errors announced
- [ ] All existing unit tests pass
- [ ] All existing E2E critical tests pass
- [ ] Lint + TypeScript + Build pass
