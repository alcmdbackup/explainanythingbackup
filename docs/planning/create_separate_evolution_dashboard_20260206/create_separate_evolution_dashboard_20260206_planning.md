# Create Separate Evolution Dashboard Plan

## Background
Evolution pipeline features are spread across 4 separate admin sidebar items (Evolution, Elo Optimization, Article Bank, Quality Scores) under `/admin/quality/*`. The main admin dashboard at `/admin` has 8 quick-link cards but none link to any evolution or quality feature — those are only accessible via sidebar. The user wants a dedicated evolution dashboard with its own sidebar navigation, linked from the main admin dashboard, to consolidate all evolution-related monitoring and management.

## Problem
There is no unified entry point for the evolution pipeline ecosystem. An admin must know to click one of 4 separate sidebar items to find evolution runs, article bank, optimization, or quality scores. The main admin dashboard doesn't surface evolution at all. This makes the evolution features feel disconnected and harder to discover. A separate dashboard with its own sidebar provides a focused workspace for evolution pipeline operations.

## Options Considered

### Option A: Route Groups (restructure files)
Create `(main)/` and `(evolution)/` route groups under `/admin` so each gets its own layout with a different sidebar. **Rejected** — requires moving all 9 existing admin page folders into `(main)/`, a large file restructure with high risk of breaking imports and tests. Codebase has zero route groups currently.

### Option B: Conditional Sidebar Switching (chosen)
Replace `<AdminSidebar />` in the admin layout with a `<SidebarSwitcher />` client component that checks `usePathname()` and renders either `AdminSidebar` or `EvolutionSidebar`. **Chosen** — achieves the same result with minimal new components and a 2-line layout change. No existing files moved. Server/client boundary preserved: layout stays server component (handles auth), sidebar components are already client components.

### Option C: Separate top-level route
Create `/evolution-dashboard` outside `/admin` with its own layout and auth check. **Rejected** — duplicates admin auth logic and breaks the admin URL convention.

---

## Critique Summary

Seven critique agents ran across Architecture, UX, Testing, Implementation Risk, Data Feasibility, Refactoring Soundness, and Plan Completeness. All findings are incorporated below.

---

## Phased Execution Plan

> **IMPORTANT: Phases 1-4 form a single atomic commit/deployment unit.** Do NOT commit or deploy phases individually — cross-phase links would 404. Phase 5 (tests) and Phase 6 (docs) can be separate commits.

### Phase 1: Create BaseSidebar + EvolutionSidebar + SidebarSwitcher

**Create** `src/components/admin/BaseSidebar.tsx`
- `'use client'` — uses `usePathname()` from `next/navigation`
- File comment: `// Shared sidebar shell for admin dashboard variants. Renders nav items, active state, and back link.`
- Export `NavItem` interface: `{ href: string; label: string; icon: string; testId: string }`
- Export `BaseSidebarProps` interface:
  ```typescript
  interface BaseSidebarProps {
    title: string;
    navItems: NavItem[];
    backLink: { label: string; href: string; testId: string };
    activeOverrides?: Record<string, (pathname: string) => boolean>;
  }
  ```
- Extract full rendering from current `AdminSidebar.tsx`: `<aside>`, header, `<nav>`, `<ul>`, Link items with active/inactive classes, bottom back link
- Default `isActive(href)`: `pathname.startsWith(href)` — the generic fallback
- If `activeOverrides[href]` exists, call it instead of the default
- Preserve exact CSS classes: `w-64 bg-[var(--surface-secondary)] border-r border-[var(--border-default)] min-h-screen`, active gold styling, `absolute bottom-4` positioning
- Import: `Link` from `next/link`, `usePathname` from `next/navigation`
- No barrel export needed — import directly

**Refactor** `src/components/admin/AdminSidebar.tsx`
- `'use client'` (keep)
- File comment: `// Admin sidebar navigation. Thin wrapper over BaseSidebar with admin-specific nav items.`
- Import `BaseSidebar`, `NavItem` from `@/components/admin/BaseSidebar`
- Define `navItems` array (13 items initially, reduced to 10 in Phase 2)
- Pass `activeOverrides` for AdminSidebar-specific special cases:
  ```typescript
  activeOverrides: {
    '/admin': (p) => p === '/admin',
    '/admin/content/reports': (p) => p.startsWith('/admin/content/reports'),
    '/admin/content': (p) => p === '/admin/content' || (p.startsWith('/admin/content') && !p.startsWith('/admin/content/reports')),
    '/admin/quality': (p) => p === '/admin/quality',
  }
  ```
- Pass `title="Admin Dashboard"`, `backLink={{ label: '← Back to App', href: '/', testId: 'admin-sidebar-back-to-app' }}`
- Must render **pixel-identical** to current AdminSidebar (same testIds, same classes, same behavior)

**Create** `src/components/admin/EvolutionSidebar.tsx`
- `'use client'`
- File comment: `// Evolution sidebar navigation. Thin wrapper over BaseSidebar with evolution-specific nav items.`
- Import `BaseSidebar`, `NavItem` from `@/components/admin/BaseSidebar`
- Nav items (6):
  - `{ href: '/admin/evolution-dashboard', label: 'Overview', icon: '📊', testId: 'evolution-sidebar-nav-overview' }`
  - `{ href: '/admin/quality/evolution', label: 'Pipeline Runs', icon: '🔄', testId: 'evolution-sidebar-nav-pipeline-runs' }`
  - `{ href: '/admin/quality/evolution/dashboard', label: 'Ops Dashboard', icon: '📈', testId: 'evolution-sidebar-nav-ops-dashboard' }`
  - `{ href: '/admin/quality/optimization', label: 'Elo Optimization', icon: '🎯', testId: 'evolution-sidebar-nav-optimization' }`
  - `{ href: '/admin/quality/article-bank', label: 'Article Bank', icon: '📚', testId: 'evolution-sidebar-nav-article-bank' }`
  - `{ href: '/admin/quality', label: 'Quality Scores', icon: '⭐', testId: 'evolution-sidebar-nav-quality' }`
- Pass `activeOverrides`:
  ```typescript
  activeOverrides: {
    '/admin/evolution-dashboard': (p) => p === '/admin/evolution-dashboard',
    '/admin/quality': (p) => p === '/admin/quality',
    '/admin/quality/evolution': (p) => p === '/admin/quality/evolution' || (p.startsWith('/admin/quality/evolution') && !p.startsWith('/admin/quality/evolution/dashboard')),
  }
  ```
- Pass `title="Evolution Dashboard"`, `backLink={{ label: '← Back to Admin', href: '/admin', testId: 'evolution-sidebar-back-to-admin' }}`

**Create** `src/components/admin/SidebarSwitcher.tsx`
- `'use client'`
- File comment: `// Conditionally renders AdminSidebar or EvolutionSidebar based on current pathname.`
- Import `usePathname` from `next/navigation`
- Import `AdminSidebar` from `@/components/admin/AdminSidebar`
- Import `EvolutionSidebar` from `@/components/admin/EvolutionSidebar`
- Path matching (NOT greedy):
  ```typescript
  // URL-to-sidebar mapping:
  // Evolution sidebar: /admin/evolution-dashboard, /admin/quality, /admin/quality/*
  // Admin sidebar: everything else under /admin/*
  const isEvolutionPath =
    pathname.startsWith('/admin/evolution-dashboard') ||
    pathname === '/admin/quality' ||
    pathname.startsWith('/admin/quality/');
  ```
- Returns `<EvolutionSidebar />` or `<AdminSidebar />`

**Modify** `src/app/admin/layout.tsx` (2-line change)
- Replace `import { AdminSidebar } from '@/components/admin/AdminSidebar'` → `import { SidebarSwitcher } from '@/components/admin/SidebarSwitcher'`
- Replace `<AdminSidebar />` → `<SidebarSwitcher />`
- Layout remains a server component — no `'use client'` needed (server components can render client components as leaf nodes)

Run: lint, tsc, build

### Phase 2: Update AdminSidebar Items

**Modify** `src/components/admin/AdminSidebar.tsx`
- Replace 4 quality items (Evolution, Elo Optimization, Article Bank, Quality Scores) with single:
  ```
  { href: '/admin/evolution-dashboard', label: 'Evolution', icon: '🧬', testId: 'admin-sidebar-nav-evolution' }
  ```
- Remove the `/admin/quality` entry from `activeOverrides` (no longer needed since that item is gone)
- Sidebar goes from 13 items → 10 items

Run: lint, tsc, build

### Phase 3: Extend DashboardData + Auth Fix

**Modify** `src/lib/services/evolutionVisualizationActions.ts`
- Add 3 new fields to `DashboardData` type:
  ```typescript
  previousMonthSpend: number;
  articlesEvolvedCount: number;
  articleBankSize: number;
  ```
- Add 3 new parallel queries to the existing `Promise.all` in `getEvolutionDashboardDataAction()`:
  ```typescript
  // Previous month spend
  supabase.from('content_evolution_runs').select('total_cost_usd').gte('created_at', firstOfPreviousMonth).lt('created_at', firstOfMonth)
  // Articles with completed evolution runs (dedupe explanation_ids in JS — Supabase doesn't support COUNT DISTINCT)
  supabase.from('content_evolution_runs').select('explanation_id').eq('status', 'completed')
  // Article bank size
  supabase.from('article_bank_entries').select('id', { count: 'exact', head: true }).is('deleted_at', null)
  ```
- Process results: sum previous month spend, deduplicate explanation_ids with `new Set()`, read bank count from `.count`

**Modify** `src/lib/services/eloBudgetActions.ts`
- Add `import { requireAdmin } from '@/lib/services/adminAuth'` (same import path used by `evolutionVisualizationActions.ts`)
- Add `await requireAdmin()` as first line of ALL exported server actions in this file (9 total: `getAgentROILeaderboardAction`, `getAgentCostByModelAction`, `getStrategyLeaderboardAction`, `resolveStrategyConfigAction`, `updateStrategyAction`, `getStrategyParetoAction`, `getRecommendedStrategyAction`, `getOptimizationSummaryAction`, `getStrategyRunsAction`). All 9 use `createSupabaseServiceClient` which bypasses RLS — the new EvolutionSidebar makes these pages more discoverable, so the auth gap must be closed now, not deferred.
- Note: `updateStrategyAction` and `resolveStrategyConfigAction` are WRITE operations (`.update()` and `.insert()`) — especially critical to protect

Run: lint, tsc, build

### Phase 4: Create Evolution Dashboard Page + Admin Link

**Create directory** `src/app/admin/evolution-dashboard/`

**Create** `src/app/admin/evolution-dashboard/page.tsx`
- `'use client'`
- File comment: `// Evolution Dashboard overview page. Shows high-level stats and quick links to evolution sub-pages.`
- Imports:
  ```typescript
  import { useState, useCallback } from 'react';
  import { AutoRefreshProvider, RefreshIndicator } from '@/components/evolution';
  import { getEvolutionDashboardDataAction } from '@/lib/services/evolutionVisualizationActions';
  import { getOptimizationSummaryAction } from '@/lib/services/eloBudgetActions';
  import type { DashboardData } from '@/lib/services/evolutionVisualizationActions';
  ```
- **Data loading pattern** — follow existing ops dashboard `useState` + `useCallback` + `onRefresh` pattern (NOT top-level await — client components cannot be async):
  ```typescript
  // State for both data sources
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [optimizationData, setOptimizationData] = useState<OptimizationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // For optimization action return type (anonymous inline type in eloBudgetActions):
  type OptimizationSummary = Awaited<ReturnType<typeof getOptimizationSummaryAction>> extends { data?: infer T } ? NonNullable<T> : never;

  const handleRefresh = useCallback(async () => {
    const [dashResult, optResult] = await Promise.allSettled([
      getEvolutionDashboardDataAction(),
      getOptimizationSummaryAction()
    ]);

    // Two-level unwrap: first check PromiseSettledResult status, then ActionResult shape
    // Dashboard action: ActionResult<T> = { success, data: T | null, error: ErrorResponse | null }
    if (dashResult.status === 'fulfilled' && dashResult.value.success) {
      setDashboardData(dashResult.value.data);  // T | null
    } else if (dashResult.status === 'fulfilled') {
      setError(dashResult.value.error?.message ?? 'Dashboard data failed');
    }
    // Optimization action: ActionResult<T> = { success, data?: T, error?: string }
    if (optResult.status === 'fulfilled' && optResult.value.success) {
      setOptimizationData(optResult.value.data ?? null);  // T | undefined → normalize to null
    } else if (optResult.status === 'fulfilled') {
      setError(optResult.value.error ?? 'Optimization data failed');  // error is plain string
    }

    // Handle rejected promises (action threw instead of returning error result)
    if (dashResult.status === 'rejected') setError(String(dashResult.reason));
    if (optResult.status === 'rejected') setError(String(optResult.reason));
  }, []);
  ```
- Wire `handleRefresh` to `<AutoRefreshProvider onRefresh={handleRefresh}>` — signal param is ignored (matches ops dashboard pattern)
- Stat cards (6) — differentiated from Ops Dashboard:
  1. **Last Completed Run** — filter `recentRuns` for `status === 'completed'`, format `completed_at` as relative time. Edge case: if 20+ non-completed runs exist, the most recent completed run may not be in the array — show "N/A" in this case
  2. **7d Success Rate** — `data.successRate7d` (direct field, integer percentage)
  3. **Monthly Spend** — `data.monthlySpend` (current month) with trend arrow computed from `data.previousMonthSpend`
  4. **Article Bank Size** — `data.articleBankSize` (direct count field)
  5. **Avg Elo/$** — `optimizationData.avgEloPerDollar` (handle `null` case — show "N/A")
  6. **Failed Runs (7d)** — sum `data.runsPerDay.filter(last7d).reduce((sum, d) => sum + d.failed, 0)`
- Quick link cards (5): Pipeline Runs, Ops Dashboard, Elo Optimization, Article Bank, Quality Scores — each with icon and description
- `StatCard` and `DashboardCard` defined inline. Follow the evolution dashboard `StatCard` interface: `{ label, value, testId }` (more test-friendly than admin page's `{ title, value, icon, highlight }`)

**Modify** `src/app/admin/page.tsx`
- Add one `DashboardCard` to the quick links grid:
  ```tsx
  <DashboardCard title="Evolution" description="Content quality pipeline" href="/admin/evolution-dashboard" icon="🧬" />
  ```

Run: lint, tsc, build

### Phase 5: Tests

**Create** `src/components/admin/SidebarSwitcher.test.tsx`
- File comment: `// Tests for SidebarSwitcher conditional sidebar rendering based on pathname.`
- Override global `usePathname` mock using full-replacement pattern (NOT `jest.requireActual` — real `next/navigation` requires React Server Components context that doesn't exist in jsdom):
  ```typescript
  const mockUsePathname = jest.fn();
  jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => mockUsePathname(),
    useSearchParams: () => new URLSearchParams(),
  }));
  ```
- Test: renders AdminSidebar title "Admin Dashboard" for `/admin`, `/admin/users`, `/admin/costs`
- Test: renders EvolutionSidebar title "Evolution Dashboard" for `/admin/evolution-dashboard`, `/admin/quality`, `/admin/quality/evolution`, `/admin/quality/evolution/run/abc-123`
- Test: does NOT render EvolutionSidebar for `/admin/quality-reports` (greedy match edge case)
- Test: `/admin/quality` (no trailing slash) renders EvolutionSidebar

**Create** `src/components/admin/EvolutionSidebar.test.tsx`
- File comment: `// Tests for EvolutionSidebar nav items, active state, and back link.`
- Override `usePathname` mock per test
- Test: renders all 6 nav items with correct hrefs
- Test: highlights correct item for each pathname (positive + negative cases — e.g., `/admin/quality/evolution` does NOT highlight "Quality Scores")
- Test: "Back to Admin" link exists, points to `/admin`, has testId `evolution-sidebar-back-to-admin`
- Test: all items have correct `data-testid` attributes

**Create** `src/components/admin/BaseSidebar.test.tsx`
- File comment: `// Tests for BaseSidebar shared rendering, activeOverrides, and default active state logic.`
- Override `usePathname` mock per test (same full-replacement pattern)
- Test: default active state uses `pathname.startsWith(href)` when no override provided
- Test: `activeOverrides` take precedence over default when provided
- Test: renders title, navItems, and backLink correctly
- Test: renders empty nav gracefully when navItems is `[]`
- Test: active item gets correct CSS class, inactive items get default class

**Create** `src/components/admin/AdminSidebar.test.tsx`
- File comment: `// Tests for AdminSidebar nav items after evolution consolidation.`
- Override `usePathname` mock per test
- Test: renders exactly 10 items (not 13)
- Test: new "Evolution" item has `href="/admin/evolution-dashboard"` and testId `admin-sidebar-nav-evolution`
- Test: none of the removed testIds appear (`admin-sidebar-nav-optimization`, `admin-sidebar-nav-article-bank`, old `admin-sidebar-nav-quality`)

**Create** `src/app/admin/evolution-dashboard/page.test.tsx`
- File comment: `// Tests for Evolution Dashboard overview page stat cards and quick links.`
- Co-located next to the page (matches project convention: `src/app/login/page.test.tsx`, `src/app/page.test.tsx`, etc.)
- Mock server actions:
  - For `getEvolutionDashboardDataAction`: use `createSuccessResponse`/`createErrorResponse` from `@/testing/utils/component-test-helpers` (shape matches: `{ data: T | null, error: ErrorResponse | null }`)
  - For `getOptimizationSummaryAction`: inline mocks with `{ success: true, data: {...} }` / `{ success: false, error: 'message' }` (shape is `{ data?: T, error?: string }` — `createErrorResponse` produces `ErrorResponse` object, NOT plain string)
- Use same full-replacement `jest.mock('next/navigation', ...)` pattern as sidebar tests
- Test: stat cards render with mocked action responses
- Test: quick link cards render with correct hrefs
- Test: handles dashboardAction failure gracefully (shows error, optimization stats still render)
- Test: handles optimizationAction failure gracefully (shows error, dashboard stats still render)
- Test: handles both `ActionResult` shapes correctly (null vs undefined for data/error)
- Test: handles `Promise.allSettled` rejected case (action throws instead of returning error)

**Update** `src/__tests__/e2e/helpers/pages/admin/AdminBasePage.ts`
- The `backToApp` locator (`admin-sidebar-back-to-app`) will not be found on evolution pages (which show `evolution-sidebar-back-to-admin` instead). If any e2e tests navigate through quality pages and call `expectDashboardLoaded()` or check `backToApp`, they would fail. Current analysis: `expectDashboardLoaded()` is only called after navigating to `/admin`, so no regression. But add a note/comment in AdminBasePage.

Run: full test suite (`npm test`)

### Phase 6: Documentation Updates

Update these docs with new routes, components, and sidebar structure:

**`docs/feature_deep_dives/admin_panel.md`**
- Add `/admin/evolution-dashboard` route
- Update sidebar section: AdminSidebar now has 10 items, new EvolutionSidebar has 6 items
- Document SidebarSwitcher pattern
- Add BaseSidebar to component list

**`docs/feature_deep_dives/evolution_pipeline_visualization.md`**
- Add Evolution Dashboard overview page to route listing
- Update component architecture with BaseSidebar, EvolutionSidebar

**`docs/feature_deep_dives/evolution_pipeline.md`**
- Add reference to new unified evolution dashboard entry point

**`docs/feature_deep_dives/comparison_infrastructure.md`**
- Update: Article Bank sidebar item moved from AdminSidebar to EvolutionSidebar

---

## Files Summary

| Action | File | Description |
|--------|------|-------------|
| Create | `src/components/admin/BaseSidebar.tsx` | Shared sidebar shell with `activeOverrides` prop |
| Create | `src/components/admin/EvolutionSidebar.tsx` | Evolution nav items + overrides wrapper |
| Create | `src/components/admin/SidebarSwitcher.tsx` | Pathname-based conditional sidebar renderer |
| Create | `src/app/admin/evolution-dashboard/page.tsx` | Dashboard overview with stats + quick links |
| Create | `src/components/admin/BaseSidebar.test.tsx` | BaseSidebar unit tests |
| Create | `src/components/admin/SidebarSwitcher.test.tsx` | SidebarSwitcher unit tests |
| Create | `src/components/admin/EvolutionSidebar.test.tsx` | EvolutionSidebar unit tests |
| Create | `src/components/admin/AdminSidebar.test.tsx` | AdminSidebar unit tests |
| Create | `src/app/admin/evolution-dashboard/page.test.tsx` | Dashboard page unit tests (co-located) |
| Modify | `src/components/admin/AdminSidebar.tsx` | Refactor to BaseSidebar wrapper + replace 4 items with 1 |
| Modify | `src/app/admin/layout.tsx` | Swap AdminSidebar → SidebarSwitcher (2-line change) |
| Modify | `src/app/admin/page.tsx` | Add Evolution DashboardCard |
| Modify | `src/lib/services/evolutionVisualizationActions.ts` | Extend DashboardData with 3 new fields + queries |
| Modify | `src/lib/services/eloBudgetActions.ts` | Add `requireAdmin()` to ALL 9 exported server actions |

## Key Patterns to Reuse

- `src/components/admin/AdminSidebar.tsx` — extract into BaseSidebar (NavItem interface, rendering, styling)
- `src/app/admin/quality/evolution/dashboard/page.tsx` — `AutoRefreshProvider` + `StatCard` + data loading pattern, `onRefresh` ignores signal param
- `src/app/admin/page.tsx` — `DashboardCard` component pattern
- `src/lib/services/evolutionVisualizationActions.ts` — `getEvolutionDashboardDataAction()`, `DashboardData` type
- `src/lib/services/eloBudgetActions.ts` — `getOptimizationSummaryAction()` (return type is anonymous inline, use `Awaited<ReturnType<typeof getOptimizationSummaryAction>>` or destructure)
- `src/components/evolution/index.ts` — barrel export for `AutoRefreshProvider`, `RefreshIndicator`

## Verification

### Automated
```bash
npm run lint && npx tsc --noEmit && npm run build && npm test
```

### Manual
1. Navigate to `/admin` → see 10 sidebar items including "Evolution" → click "Evolution" card → lands on `/admin/evolution-dashboard` with evolution sidebar
2. From evolution dashboard → click each sidebar link → correct page loads with evolution sidebar persisting
3. Click "← Back to Admin" → returns to `/admin` with admin sidebar
4. Navigate directly to `/admin/quality/evolution` → evolution sidebar shows (not admin sidebar)
5. Navigate to `/admin/content` → admin sidebar shows (not evolution sidebar)
6. All existing admin pages still work with admin sidebar
7. Dashboard stat cards show real data (not all zeros or errors)

## Known Tradeoffs

- **URL structure**: `/admin/evolution-dashboard` (overview) vs `/admin/quality/*` (sub-pages) live at different path hierarchies. Accepted because moving overview to `/admin/quality/overview` would lose the clean entry point naming. Documented in SidebarSwitcher comment.
- **Quality Scores under Evolution umbrella**: Quality Scores could be argued as a standalone content management tool, not purely evolution. Accepted for initial consolidation. Can be revisited.
- **Auth fix scope**: All 9 actions in `eloBudgetActions.ts` get `requireAdmin()` in this PR since the new sidebar makes them more discoverable.
- **N>2 sidebars**: Current binary SidebarSwitcher works for 2 sidebar types. If a 3rd is ever needed, refactor to a registry pattern. YAGNI for now — `activeOverrides` on BaseSidebar already makes adding new sidebar configs trivial.
