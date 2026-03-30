# Maintenance: bugs-ux (20260330)

## Problem Statement
Automated UX/bug audit of the evolution admin dashboard at `/admin/evolution/*` using Playwright MCP headless browser testing.

## Executive Summary
- **All 8 evolution admin pages load and function** — no hard crashes or broken pages
- **Poor CLS (0.30-0.44) on 3 list pages** (invocations, variants, arena) due to skeleton/content height mismatch
- **Arena detail page has no pagination** — renders all 97 entries at once, unlike other list pages
- **No index page at `/admin/evolution`** — returns 404 (requires knowing sub-routes)
- **Table column truncation** on several pages when viewport is narrow
- **Skill SKILL.md has wrong URL paths** — references `/admin/quality/evolution/*` but actual routes are `/admin/evolution/*`

## Findings

### Critical

None.

### High

#### H1. Poor CLS on Invocations, Variants, Arena List Pages
- **Pages:** `/admin/evolution/invocations` (CLS: 0.42), `/admin/evolution/variants` (CLS: 0.44), `/admin/evolution/arena` (CLS: 0.30)
- **Root Cause:** All three pages are `'use client'` components that fetch data via `useEffect`. The `TableSkeleton` (loading.tsx) uses `py-2`/`py-2.5` padding while `EntityTable` uses `py-1`/`py-2` — the skeleton is taller than the real table, causing content to shift upward when data loads.
- **Key Files:**
  - `src/app/admin/evolution/invocations/page.tsx` — client-side fetch
  - `src/app/admin/evolution/variants/page.tsx` — client-side fetch
  - `src/app/admin/evolution/arena/page.tsx` — client-side fetch
  - `evolution/src/components/evolution/tables/TableSkeleton.tsx` — oversized skeleton (py-2, py-2.5)
  - `evolution/src/components/evolution/tables/EntityTable.tsx` — smaller actual table (py-1, py-2)
- **Fix Options:**
  1. *Quick fix:* Align `TableSkeleton` padding to match `EntityTable` (py-2 → py-1 for headers, py-2.5 → py-2 for rows)
  2. *Better fix:* Convert pages to SSR (async server components) to eliminate the skeleton/data swap entirely

#### H2. Arena Detail Page Has No Pagination
- **Page:** `/admin/evolution/arena/[topicId]`
- **Issue:** Renders ALL entries (97 items) in a single page with no pagination. The invocations and variants pages use `EntityListPage` with `PAGE_SIZE=20` and server-side offset/limit pagination.
- **Root Cause:** `getArenaEntriesAction` accepts no `limit`/`offset` parameters, returning all matching entries.
- **Key Files:**
  - `src/app/admin/evolution/arena/[topicId]/page.tsx` — renders all entries
  - `evolution/src/services/arenaActions.ts` — `getArenaEntriesAction` has no pagination params
  - `evolution/src/components/evolution/EntityListPage.tsx` — existing pagination component (lines 292-325)
- **Fix:** Add `limit`/`offset` to `getArenaEntriesAction`, refactor arena detail to use `EntityListPage`

### Medium

#### M1. No Index Page at `/admin/evolution`
- **Issue:** Navigating to `/admin/evolution` returns a 404. Users must know to go directly to `/admin/evolution-dashboard` or a specific sub-route.
- **Impact:** Confusing for first-time admin users; sidebar "Dashboard" link goes to `/admin/evolution-dashboard` (different route prefix)
- **Fix:** Either add a `page.tsx` at `src/app/admin/evolution/` that redirects to the dashboard, or make it a landing page

#### M2. Table Column Truncation on Narrow Viewports
- **Pages:** Runs (columns after Strategy cut off), Invocations ("Duration" truncated to "Dura..."), Variants (last column "G..." truncated)
- **Issue:** Tables have many columns but no horizontal scroll or responsive behavior — columns are simply cut off
- **Note:** This may be acceptable for an admin dashboard that's always viewed on desktop, but impacts readability

### Low

#### L1. Skill SKILL.md References Wrong URL Paths
- **File:** `.claude/skills/maintenance/bugs-ux/SKILL.md`
- **Issue:** Scope says "Pages: `/admin/quality/evolution/*`, `/admin/quality/arena/*`, `/admin/quality/experiments/*`" but actual routes are `/admin/evolution/*`, `/admin/evolution/arena/*`, `/admin/evolution/experiments/*`
- **Fix:** Update SKILL.md to match actual routes

#### L2. Dashboard Shows Misleading Zeros When All Data Is Test Content
- **Page:** `/admin/evolution-dashboard`
- **Issue:** With "Hide test content" checked (default), all stats show zero (Active Runs: 0, Completed Runs: 0, Total Cost: $0.00) because all data in the system is test data. "Recent Runs" shows "No runs found".
- **Impact:** Could confuse users into thinking the system is broken rather than just filtered

#### L3. Web Vitals: FCP and TTFB Consistently "Needs Improvement" to "Poor"
- **All pages:** FCP ranges 1800-7200ms, TTFB ranges 1750-7200ms
- **Note:** This is in local dev mode (Next.js dev server with hot reload) so likely NOT representative of production performance. Including for completeness only.

## Recommendations

1. **Fix TableSkeleton padding** to match EntityTable (quick win, immediate CLS improvement)
2. **Add pagination to arena detail page** using existing EntityListPage component
3. **Add redirect from `/admin/evolution` to `/admin/evolution-dashboard`**
4. **Update bugs-ux SKILL.md** with correct URL paths
5. **Consider SSR conversion** for list pages (long-term, eliminates CLS entirely)

## Files Examined

### Admin Pages (Playwright browser testing)
- `/admin/evolution-dashboard` — Dashboard with stats cards
- `/admin/evolution/experiments` — Experiment list (4 items)
- `/admin/evolution/experiments/[id]` — Experiment detail with Metrics/Analysis/Runs/Logs tabs
- `/admin/evolution/prompts` — Prompt list (1 item)
- `/admin/evolution/strategies` — Strategy list (5 items)
- `/admin/evolution/runs` — Runs list (399 items with test content)
- `/admin/evolution/invocations` — Invocation list (424 items, paginated)
- `/admin/evolution/variants` — Variant list (379 items, paginated)
- `/admin/evolution/arena` — Arena topics (1 non-test topic)
- `/admin/evolution/arena/[topicId]` — Arena detail (97 entries, no pagination)
- `/admin/evolution/start-experiment` — Experiment creation wizard

### Source Code (Agent research)
- `src/app/admin/evolution/invocations/page.tsx`
- `src/app/admin/evolution/variants/page.tsx`
- `src/app/admin/evolution/arena/page.tsx`
- `src/app/admin/evolution/arena/[topicId]/page.tsx`
- `src/app/admin/evolution/*/loading.tsx` (skeleton files)
- `evolution/src/components/evolution/tables/EntityTable.tsx`
- `evolution/src/components/evolution/tables/TableSkeleton.tsx`
- `evolution/src/components/evolution/EntityListPage.tsx`
- `evolution/src/services/arenaActions.ts`
- `.claude/skills/maintenance/bugs-ux/SKILL.md`
- `src/middleware.ts` / `src/lib/utils/supabase/middleware.ts` (auth flow)

## Agent Research Log

### Round 1: Discovery (Playwright browser scan)
- Authenticated via Supabase API + browser cookie injection
- Visited all 11 evolution admin pages systematically
- Captured screenshots and console errors for each page
- Recorded Web Vitals (CLS, LCP, FCP, TTFB) from console
- **Key findings:** Poor CLS on 3 pages, arena no pagination, no index page, column truncation

### Round 2: Deep Dive (Code analysis via agents)
- **Agent 1 (CLS investigation):** Traced CLS to `TableSkeleton` vs `EntityTable` padding mismatch. Skeleton headers use `py-2` vs `py-1`, skeleton rows use `py-2.5` vs `py-2`. All affected pages are `'use client'` with `useEffect` data loading.
- **Agent 2 (Arena pagination):** Confirmed `getArenaEntriesAction` has no limit/offset params. Invocations/variants use `EntityListPage` with `PAGE_SIZE=20` and server-side pagination. Fix is straightforward — add pagination params to action, use existing EntityListPage component.

### Rounds 3-4: Skipped
- Cross-reference and synthesis rounds skipped because findings were consistent across all agents with no conflicting data.
