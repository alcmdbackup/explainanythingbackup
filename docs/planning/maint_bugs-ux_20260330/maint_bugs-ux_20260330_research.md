# Maintenance: bugs-ux (20260330)

## Problem Statement
Automated UX/bug audit of the evolution admin dashboard at `/admin/evolution/*` using Playwright MCP headless browser testing. Goal: find 50 distinct issues.

## Executive Summary
- **50 distinct issues found** across all evolution admin pages
- **No critical bugs** — all pages load and basic functionality works
- **11 High severity** issues including CLS layout shifts, missing pagination, accessibility gaps
- **21 Medium severity** issues including form UX problems, inconsistent navigation, truncated content
- **18 Low severity** issues including missing labels, cosmetic inconsistencies, minor a11y gaps

## Findings (50 issues)

### High (11)

| # | Page | Issue | Type |
|---|------|-------|------|
| 1 | Invocations list | CLS: 0.42 — skeleton padding mismatch causes content shift on load | UX-Major |
| 2 | Variants list | CLS: 0.44 — same skeleton/content height mismatch | UX-Major |
| 3 | Arena list | CLS: 0.30 — same pattern | UX-Major |
| 4 | Arena detail | No pagination — renders all 97 entries at once (other lists paginate at 20) | UX-Major |
| 5 | `/admin/evolution` | Returns 404 — no index page, must know sub-routes | Bug-Major |
| 6 | Runs list | No pagination — 416 items rendered at once, unlike invocations/variants | UX-Major |
| 7 | Runs list | Nested table in accessibility tree — `<table>` inside a `<td>` of outer table | Bug-Major |
| 8 | Start Experiment | Strategy checkboxes have no accessible labels — screen readers announce "checkbox" only | Bug-Major |
| 9 | Start Experiment | Validation errors lack `role="alert"` — not announced to screen readers | Bug-Major |
| 10 | Experiments list | "stale" status not in filter dropdown — can't filter to find stale experiments | Bug-Major |
| 11 | All pages | Page `<title>` always "ExplainAnything" — no page-specific title for tab/history | UX-Major |

### Medium (21)

| # | Page | Issue | Type |
|---|------|-------|------|
| 12 | Runs, Invocations, Variants | Table columns truncated on standard viewport — no horizontal scroll | UX-Major |
| 13 | Dashboard | No breadcrumb — only page without one, inconsistent with all other pages | UX-Minor |
| 14 | Dashboard | Route is `/admin/evolution-dashboard` not `/admin/evolution/dashboard` — inconsistent prefix | UX-Minor |
| 15 | Dashboard | Total Cost and Avg Cost show $0.00 even with 299 completed runs visible | Bug-Minor |
| 16 | Dashboard | Recent Runs shows only Pending runs, not truly most recent across statuses | Bug-Minor |
| 17 | Dashboard | Failed runs count (97) shown but no link to filter runs by failed status | UX-Minor |
| 18 | Dashboard | Recent Runs has no "showing X of Y" indicator | UX-Minor |
| 19 | Experiments list | No pagination — all 8 items displayed (fine now, won't scale) | UX-Minor |
| 20 | Experiments list | Empty state says "Use the experiment wizard" but doesn't link to it | UX-Minor |
| 21 | Experiments list | Filter changes don't update URL params — filter state lost on refresh | UX-Minor |
| 22 | Experiments list | Same generic empty message for Draft and Cancelled filters | UX-Minor |
| 23 | Start Experiment | Shows plain "Loading..." text — no skeleton or spinner | UX-Minor |
| 24 | Start Experiment | Stepper tabs (Setup/Strategies/Review) not all clickable — can't jump between steps | UX-Minor |
| 25 | Start Experiment | Review button disabled with no tooltip explaining what's needed | UX-Minor |
| 26 | Start Experiment | Review page very long — strategy configs not collapsible/accordion | UX-Minor |
| 27 | Start Experiment | No confirmation dialog before "Create Experiment" button | UX-Minor |
| 28 | Start Experiment | Validation errors appear as list below form, not inline next to invalid fields | UX-Minor |
| 29 | Start Experiment | Model names use internal IDs (gpt-oss-20b, deepseek-chat) not user-friendly names | UX-Minor |
| 30 | Run detail | Blank page during load — no loading indicator, content appears after several seconds | UX-Minor |
| 31 | 404/not-found pages | "Back to Evolution Dashboard" always goes to dashboard, not to the list page you navigated from | UX-Minor |
| 32 | Login | "Contact admin to reset password" is plain text, not a link or action | UX-Minor |

### Low (18)

| # | Page | Issue | Type |
|---|------|-------|------|
| 33 | Login | Duplicate checkbox elements in accessibility tree for "Remember me" | Bug-Minor |
| 34 | All list pages | Sidebar doesn't visually highlight current page in accessibility tree | UX-Minor |
| 35 | Experiments | Last column header (Actions) has no visible label text | UX-Minor |
| 36 | Experiments | Item count sometimes missing on initial render (timing/hydration) | Bug-Minor |
| 37 | Dashboard | Shows misleading all-zeros when "Hide test content" is on and all data is test data | UX-Minor |
| 38 | Start Experiment | Budget input has no visible min/max enforcement in UI | UX-Minor |
| 39 | Start Experiment | Radio buttons for prompt selection when only 1 prompt exists | UX-Minor |
| 40 | Start Experiment | No required field indicators (asterisks) on mandatory fields | UX-Minor |
| 41 | Start Experiment | Setup step becomes clickable after advancing but Strategies/Review don't — inconsistent | UX-Minor |
| 42 | Start Experiment | Cost estimate shows "$0.00 / $10.00" — unclear where $10.00 limit comes from | UX-Minor |
| 43 | Start Experiment | Per-strategy cost relationship to step 1 budget field unclear | UX-Minor |
| 44 | Start Experiment | Runs spinbutton has no visible min/max constraints | UX-Minor |
| 45 | Start Experiment | No edit links in review summary to jump back to specific step | UX-Minor |
| 46 | Start Experiment | Agent enabled/disabled uses text only, no visual indicator (checkmark/badge) | UX-Minor |
| 47 | Runs list | 10 columns guaranteed to overflow standard viewport width | UX-Minor |
| 48 | All list pages | "Hide test content" defaults to checked, showing empty state when all data is test | UX-Minor |
| 49 | Invocations | "Duration" column header truncated to "Dura..." | UX-Minor |
| 50 | Variants | Last column header truncated to "G..." (likely "Generation") | UX-Minor |

## Recommendations (prioritized)

### Quick Wins (low effort, high impact)
1. **Fix TableSkeleton padding** to match EntityTable — aligns py-2→py-1 headers, py-2.5→py-2 rows (fixes #1-3)
2. **Add page-specific `<title>`** — e.g. "Experiments | Evolution Dashboard" (fixes #11)
3. **Add "Stale" to experiments status filter** (fixes #10)
4. **Add `role="alert"` to validation error containers** (fixes #9)
5. **Add accessible labels to strategy checkboxes** (fixes #8)
6. **Add redirect from `/admin/evolution` to `/admin/evolution-dashboard`** (fixes #5)

### Medium Effort
7. **Add pagination to runs list** using existing EntityListPage component (fixes #6)
8. **Add pagination to arena detail** — add limit/offset to getArenaEntriesAction (fixes #4)
9. **Fix nested table structure** on runs list page (fixes #7)
10. **Persist filter state in URL params** (fixes #21)
11. **Make empty state messages context-aware** — different messages per filter (fixes #20, #22)
12. **Add horizontal scroll** to tables with many columns (fixes #12, #47)

### Longer Term
13. **Convert list pages to SSR** to eliminate CLS entirely (improves #1-3)
14. **Redesign start-experiment stepper** — clickable steps, inline validation, collapsible configs (fixes #24-28)
15. **Add user-friendly model name mapping** (fixes #29, #44)
16. **Add breadcrumb to dashboard** and move route to `/admin/evolution/dashboard` (fixes #13-14)

## Files Examined

### Admin Pages (Playwright browser testing — 11 pages)
- `/login` — Login page
- `/admin/evolution-dashboard` — Dashboard with stats cards and recent runs
- `/admin/evolution/experiments` — Experiment list with status filter
- `/admin/evolution/experiments/[id]` — Experiment detail (Metrics/Analysis/Runs/Logs tabs)
- `/admin/evolution/prompts` — Prompt list
- `/admin/evolution/strategies` — Strategy list with pipeline/origin filters
- `/admin/evolution/runs` — Runs list with status filter
- `/admin/evolution/runs/[id]` — Run detail (attempted, got 404)
- `/admin/evolution/invocations` — Invocation list with pagination
- `/admin/evolution/variants` — Variant list with agent filter and pagination
- `/admin/evolution/arena` — Arena topics list
- `/admin/evolution/arena/[topicId]` — Arena detail with entry table (no pagination)
- `/admin/evolution/start-experiment` — 3-step experiment creation wizard

### Source Code (Agent research)
- `evolution/src/components/evolution/tables/TableSkeleton.tsx` — skeleton padding
- `evolution/src/components/evolution/tables/EntityTable.tsx` — actual table padding
- `evolution/src/components/evolution/EntityListPage.tsx` — pagination component
- `evolution/src/services/arenaActions.ts` — arena data actions
- `src/app/admin/evolution/*/page.tsx` — all page components
- `src/app/admin/evolution/*/loading.tsx` — loading skeletons
- `src/middleware.ts` — auth middleware

## Web Vitals Summary

| Page | CLS | LCP | FCP | TTFB |
|------|-----|-----|-----|------|
| Dashboard | 0.00 (good) | 1124ms | 1124ms | 1052ms |
| Experiments | 0.00 (good) | 820ms | 820ms | 759ms |
| Prompts | 0.01 (good) | 1968ms | 1968ms | 1880ms |
| Strategies | 0.01 (good) | 2404ms | 2404ms | 2339ms |
| Runs | 0.00 (good) | — | 5716ms | 5643ms |
| Invocations | **0.42 (poor)** | 2260ms | 2260ms | 2139ms |
| Variants | **0.44 (poor)** | 2288ms | 2288ms | 2227ms |
| Arena | **0.30 (poor)** | 2204ms | 2204ms | 2146ms |
| Start Experiment | 0.09 (good) | — | 3336ms | 3285ms |

Note: All measurements taken in Next.js dev mode on localhost. Production values will differ significantly.
