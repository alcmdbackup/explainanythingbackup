# Create Separate Evolution Dashboard Research

## Problem Statement
The evolution pipeline functionality is currently spread across multiple admin sub-pages under `/admin/quality/` — Evolution runs at `/admin/quality/evolution`, an ops dashboard nested at `/admin/quality/evolution/dashboard`, article bank at `/admin/quality/article-bank`, Elo optimization at `/admin/quality/optimization`, and quality scores at `/admin/quality`. The goal is to create a single, dedicated evolution dashboard that consolidates monitoring and management into one cohesive experience, linked directly from the main admin dashboard.

## High Level Summary
The current admin panel has 13 sidebar nav items, with 4 quality-related items (Evolution, Elo Optimization, Article Bank, Quality Scores) that are separate entries. The main admin dashboard (`/admin`) has 8 quick-link cards but **none** link to evolution/quality features — those are only accessible via sidebar. The evolution visualization system consists of 12 components (6 core + 6 tab views), powered by 7 read-only visualization actions, 9 run management actions, and 14 article bank actions. All components are client-side, use CSS variables for theming, and follow established patterns (Recharts for charts, D3 for DAGs, dynamic imports with SSR disabled).

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/feature_deep_dives/evolution_pipeline_visualization.md
- docs/feature_deep_dives/evolution_pipeline.md
- docs/feature_deep_dives/comparison_infrastructure.md
- docs/feature_deep_dives/admin_panel.md

## Code Files Read

### Pages (routing structure)
- `src/app/admin/layout.tsx` — Server component, admin auth check + sidebar layout
- `src/app/admin/page.tsx` — Main admin dashboard with stats and 8 quick-link cards
- `src/app/admin/quality/page.tsx` — Quality scores with Article Scores + Eval Runs tabs
- `src/app/admin/quality/evolution/page.tsx` — Run management: queue, filter, variant panel, apply/rollback
- `src/app/admin/quality/evolution/dashboard/page.tsx` — Ops dashboard: stat cards, trends, recent runs
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — Run detail with 6 tabs + Add to Bank dialog
- `src/app/admin/quality/evolution/run/[runId]/compare/page.tsx` — Before/after text diff + quality radar
- `src/app/admin/quality/article-bank/page.tsx` — Topic list, cross-topic summary, prompt bank coverage
- `src/app/admin/quality/article-bank/[topicId]/page.tsx` — Topic detail: leaderboard, scatter, match history, diff
- `src/app/admin/quality/optimization/page.tsx` — Strategy/agent/cost analysis with 3 tabs

### Components
- `src/components/admin/AdminSidebar.tsx` — 13-item flat nav with smart active state logic
- `src/components/admin/AdminLayoutClient.tsx` — Client wrapper with Toaster
- `src/components/evolution/AutoRefreshProvider.tsx` — 15s polling with tab visibility awareness
- `src/components/evolution/EloSparkline.tsx` — Tiny inline Recharts sparkline (60×20px)
- `src/components/evolution/EvolutionStatusBadge.tsx` — Status badge for 6 run statuses
- `src/components/evolution/PhaseIndicator.tsx` — EXPANSION/COMPETITION phase display
- `src/components/evolution/VariantCard.tsx` — Variant info card + STRATEGY_PALETTE color mapping
- `src/components/evolution/LineageGraph.tsx` — D3 DAG with zoom/pan and click-to-inspect
- `src/components/evolution/tabs/TimelineTab.tsx` — Iteration timeline with expandable agent details
- `src/components/evolution/tabs/EloTab.tsx` — Rating trajectory chart with top-N filtering
- `src/components/evolution/tabs/LineageTab.tsx` — DAG tab wrapper (dynamic import)
- `src/components/evolution/tabs/BudgetTab.tsx` — Burn curve + agent cost breakdown
- `src/components/evolution/tabs/VariantsTab.tsx` — Sortable variant table with sparklines
- `src/components/evolution/tabs/TreeTab.tsx` — Beam search tree visualization

### Server Actions
- `src/lib/services/evolutionVisualizationActions.ts` — 7 read-only visualization actions
- `src/lib/services/evolutionActions.ts` — 9 run management actions
- `src/lib/services/articleBankActions.ts` — 14 article bank CRUD/comparison actions
- `src/lib/services/contentQualityActions.ts` — 5 quality eval actions
- `src/lib/services/eloBudgetActions.ts` — 5 strategy/agent optimization actions

### Optimization Sub-Components
- `src/app/admin/quality/optimization/_components/StrategyLeaderboard.tsx`
- `src/app/admin/quality/optimization/_components/StrategyParetoChart.tsx`
- `src/app/admin/quality/optimization/_components/AgentROILeaderboard.tsx`
- `src/app/admin/quality/optimization/_components/CostSummaryCards.tsx`
- `src/app/admin/quality/optimization/_components/CostBreakdownPie.tsx`
- `src/app/admin/quality/optimization/_components/StrategyConfigDisplay.tsx`
- `src/app/admin/quality/optimization/_components/StrategyDetail.tsx`

### Test Files
- `src/components/evolution/AutoRefreshProvider.test.tsx` — 28 tests
- `src/components/evolution/EloSparkline.test.tsx` — 10 tests
- `src/components/evolution/EvolutionStatusBadge.test.tsx` — 4 tests
- `src/components/evolution/LineageGraph.test.tsx` — 13 tests
- `src/components/evolution/tabs/TimelineTab.test.tsx` — 70 tests
- `src/lib/services/evolutionActions.test.ts` — 34 tests
- `src/lib/services/evolutionVisualizationActions.test.ts` — 51 tests
- `src/lib/services/articleBankActions.test.ts` — 128 tests
- `src/__tests__/e2e/specs/09-admin/admin-evolution.spec.ts` — 60 E2E tests
- `src/__tests__/e2e/specs/09-admin/admin-evolution-visualization.spec.ts` — 83 E2E tests
- `src/__tests__/integration/evolution-*.integration.test.ts` — 6 files, 473 tests
- `src/testing/utils/evolution-test-helpers.ts` — Shared test factories

---

## Detailed Findings

### 1. Current Route Structure

All evolution-related pages live under `/admin/quality/`:

| Route | Page File | Purpose |
|-------|-----------|---------|
| `/admin` | `admin/page.tsx` | Main dashboard — 8 quick links, **none** for evolution |
| `/admin/quality` | `quality/page.tsx` | Quality scores: Article Scores + Eval Runs tabs |
| `/admin/quality/evolution` | `quality/evolution/page.tsx` | Run management: queue, filter, variant panel, apply/rollback |
| `/admin/quality/evolution/dashboard` | `quality/evolution/dashboard/page.tsx` | Ops dashboard: stat cards, run/spend trends, recent runs |
| `/admin/quality/evolution/run/[runId]` | `quality/evolution/run/[runId]/page.tsx` | Run detail: 6-tab deep dive + Add to Bank |
| `/admin/quality/evolution/run/[runId]/compare` | `quality/evolution/run/[runId]/compare/page.tsx` | Before/after text diff + quality radar |
| `/admin/quality/optimization` | `quality/optimization/page.tsx` | Elo optimization: strategy/agent/cost analysis |
| `/admin/quality/article-bank` | `quality/article-bank/page.tsx` | Topic list, cross-topic summary, prompt bank coverage |
| `/admin/quality/article-bank/[topicId]` | `quality/article-bank/[topicId]/page.tsx` | Topic detail: leaderboard, scatter chart, match history, diff |

### 2. Admin Sidebar Navigation

The sidebar (`AdminSidebar.tsx`) contains 13 flat nav items. The quality-related items are:

| # | Label | Icon | Route | testId |
|---|-------|------|-------|--------|
| 6 | Evolution | 🧬 | `/admin/quality/evolution` | `admin-sidebar-nav-evolution` |
| 7 | Elo Optimization | 🎯 | `/admin/quality/optimization` | `admin-sidebar-nav-optimization` |
| 8 | Article Bank | 🏦 | `/admin/quality/article-bank` | `admin-sidebar-nav-article-bank` |
| 9 | Quality Scores | 📈 | `/admin/quality` | `admin-sidebar-nav-quality` |

Active state logic (`isActive()` function):
- Dashboard: exact match only (`pathname === '/admin'`)
- Quality Scores: exact match only (won't highlight on sub-pages)
- All other quality items: prefix match (`pathname.startsWith(href)`) — so Evolution highlights when on any `/admin/quality/evolution/*` page

### 3. Main Admin Dashboard (`/admin`)

The main dashboard currently shows:
- **Stats cards**: Total Explanations, Pending Reports, LLM Costs (30d), Active Users
- **8 quick-link cards**: Content, Reports Queue, Users, Costs, Whitelist, Audit Log, Settings, Dev Tools
- **Quick actions**: Review Pending Reports, View Recent Activity, Check Cost Analytics

**Key observation**: There is NO quick-link card for Evolution, Article Bank, Quality, or any quality-related feature. These are only accessible through the sidebar.

### 4. Evolution Ops Dashboard (`/admin/quality/evolution/dashboard`)

Currently a sub-page of the evolution section, accessed via a "Dashboard" button on `/admin/quality/evolution`. It uses `AutoRefreshProvider` (15s polling) and displays:
- **4 stat cards**: Active runs, Queue depth, 7-day success rate, Monthly spend
- **2 charts**: Runs per day (30d area chart), Daily spend (30d bar chart)
- **Recent runs table**: Last 20 runs with links to run detail

### 5. Evolution Components Inventory (12 total)

**Core components** (reusable across pages):

| Component | Purpose | Dependencies |
|-----------|---------|--------------|
| `AutoRefreshProvider` | 15s polling context with tab visibility | React only |
| `EloSparkline` | Tiny inline rating chart (60×20px) | Recharts (dynamic) |
| `EvolutionStatusBadge` | Status badge for 6 run statuses | CSS vars only |
| `PhaseIndicator` | EXPANSION/COMPETITION phase display | CSS vars only |
| `VariantCard` | Variant info card + `STRATEGY_PALETTE` | None |
| `LineageGraph` | D3 DAG with zoom/pan, click-to-inspect | D3 (dynamic) |

**Tab components** (self-loading, accept `runId` prop):

| Tab | Visualization | Server Action |
|-----|--------------|---------------|
| `TimelineTab` | Iteration blocks with expandable agent details | `getEvolutionRunTimelineAction` |
| `EloTab` | Rating trajectory LineChart, top-N filter | `getEvolutionRunEloHistoryAction` |
| `LineageTab` | DAG wrapper (dynamic import of LineageGraph) | `getEvolutionRunLineageAction` |
| `BudgetTab` | Burn AreaChart + agent BarChart | `getEvolutionRunBudgetAction` |
| `VariantsTab` | Sortable table with sparklines | `getEvolutionVariantsAction` + Elo history |
| `TreeTab` | D3 beam search tree with depth layers | `getEvolutionRunTreeSearchAction` |

All components use the Midnight Scholar design system via CSS variables (`--accent-gold`, `--surface-elevated`, etc.) and Tailwind.

### 6. Server Actions Catalog

**Visualization actions** (7, all read-only in `evolutionVisualizationActions.ts`):
1. `getEvolutionDashboardDataAction()` — System-wide stats, run/spend trends, recent runs
2. `getEvolutionRunTimelineAction(runId)` — Per-iteration agent execution via checkpoint diffing
3. `getEvolutionRunEloHistoryAction(runId)` — Rating trajectories from checkpoints
4. `getEvolutionRunLineageAction(runId)` — Variant parentage DAG
5. `getEvolutionRunBudgetAction(runId)` — Cumulative cost burn + agent breakdown
6. `getEvolutionRunComparisonAction(runId)` — Original vs winner text + quality scores
7. `getEvolutionRunTreeSearchAction(runId)` — Tree search state for Tree tab

**Run management actions** (9 in `evolutionActions.ts`):
1. `queueEvolutionRunAction` — Queue new run (creates DB row)
2. `getEvolutionRunsAction` — List runs with filters (status, date, explanationId)
3. `getEvolutionVariantsAction` — Variants for a run, sorted by Elo desc
4. `applyWinnerAction` — Apply winning variant to article
5. `triggerEvolutionRunAction` — Execute full pipeline inline
6. `getEvolutionRunSummaryAction` — Parsed run_summary JSON
7. `getEvolutionCostBreakdownAction` — Cost by agent name
8. `getEvolutionHistoryAction` — Content history for rollback
9. `rollbackEvolutionAction` — Revert to previous content

**Article bank actions** (14 in `articleBankActions.ts`):
1. `addToBankAction` — Upsert topic + insert entry + init Elo
2. `getBankTopicAction` — Single topic
3. `getBankEntriesAction` — Entries for topic
4. `getBankEntryDetailAction` — Full entry detail
5. `getBankLeaderboardAction` — Elo-ranked entries
6. `runBankComparisonAction` — Swiss-style pairwise with LLM judge
7. `getCrossTopicSummaryAction` — Cross-topic method aggregation
8. `deleteBankEntryAction` — Soft-delete entry + cascade
9. `deleteBankTopicAction` — Soft-delete topic + cascade
10. `generateAndAddToBankAction` — Generate via LLM + add
11. `getBankTopicsAction` — All topics with stats
12. `getBankMatchHistoryAction` — Comparison records for topic
13. `getPromptBankCoverageAction` — Coverage matrix: prompts × methods
14. `getPromptBankMethodSummaryAction` — Per-method aggregated stats

**Quality eval actions** (5 in `contentQualityActions.ts`):
1. `getQualityScoresAction` — All scores for an explanation
2. `getArticleQualitySummariesAction` — Per-article quality summaries
3. `getEvalRunsAction` — Last 20 eval runs
4. `triggerEvalRunAction` — Trigger batch evaluation
5. `getEvolutionComparisonAction` — Before/after quality score partitioning

### 7. Design Patterns Observed

- **All feature pages are client components** (`'use client'`) for interactivity
- **Only the root admin layout is server-side** for authentication
- **Recharts** for standard charts (Line, Area, Bar, Radar, Scatter) — always dynamically imported with `ssr: false`
- **D3** for DAG/tree visualizations — also dynamically imported
- **ActionResult<T>** pattern: all actions return `{ success, data, error }`
- **Toast notifications** via Sonner for user feedback
- **data-testid** convention: `admin-{section}-{element}[-{id}]`
- **Breadcrumb navigation** in nested pages (evolution dashboard, run detail, compare)
- **No shared layout** for quality sub-pages — each page manages its own header and navigation

### 8. Cross-Linking Between Pages

| From | To | Mechanism |
|------|----|-----------|
| Evolution page | Dashboard | "Dashboard" button in header |
| Evolution page | Run detail | Row click in runs table |
| Run detail | Compare | "Compare" button |
| Run detail | Article Bank | "Add to Bank" dialog |
| Article Bank topic | Run detail | Evolution entry links to run detail |
| Sidebar | Each quality page | Direct nav links |
| Main admin dashboard | Quality pages | **None** (only via sidebar) |

### 9. Elo Optimization Page (Deep Dive)

`/admin/quality/optimization` has 3 tabs and is powered by 5 server actions in `eloBudgetActions.ts`:

**Server Actions:**
1. `getStrategyLeaderboardAction(filters?)` — Strategies from `evolution_strategy_configs` table, sorted by Elo/$
2. `getStrategyParetoAction(filters?)` — Pareto-optimal strategies (cost vs Elo tradeoff)
3. `getAgentROILeaderboardAction(filters?)` — Agent efficiency from `evolution_run_agent_metrics` table
4. `getOptimizationSummaryAction()` — Summary stats (total runs, spend, best strategy, top agent)
5. `getStrategyRunsAction(strategyId, limit)` — Run history for a specific strategy

**Sub-Components** (all in `_components/` folder):

| Component | Purpose | Chart Type |
|-----------|---------|------------|
| `StrategyLeaderboard` | Sortable table with expandable config rows | HTML table |
| `StrategyParetoChart` | Pareto frontier scatter plot | Custom SVG (not Recharts) |
| `AgentROILeaderboard` | Agent efficiency ranking with bar visualization | HTML table + custom bars |
| `CostSummaryCards` | 4 or 6 metric cards (normal/expanded mode) | Cards only |
| `CostBreakdownPie` | Cost distribution by agent | Custom SVG donut chart |
| `StrategyConfigDisplay` | Config JSON viewer (formatted or raw) | Text layout |
| `StrategyDetail` | Modal with run history table | Modal + table |

**Data sources**: `evolution_strategy_configs` and `evolution_run_agent_metrics` tables (separate from the main evolution tables).

**Key detail**: Uses custom SVG charts (not Recharts) for Pareto and pie charts — a different pattern from the evolution visualization pages.

### 10. Page Implementation Patterns (Deep Dive)

**File sizes and complexity:**

| Page | Lines | Inline Components | Modals | useState Hooks |
|------|-------|-------------------|--------|----------------|
| `evolution/page.tsx` | 678 | 5 (SummaryCards, AgentCostChart, QualityComparison, QueueDialog, VariantPanel) | 2 | 10 |
| `evolution/dashboard/page.tsx` | 186 | 5 (StatCard, ChartSkeleton, EmptyChart, RunsChart, SpendChart) | 0 | 2 |
| `article-bank/page.tsx` | 725 | 5 (MethodBadge, CrossTopicSummary, PromptBankCoverage, NewTopicDialog, GenerateArticleDialog) | 2 | 11 |

**Common state management pattern:**
```
useState hooks: data array(s) + loading + error + actionLoading + modal booleans
useCallback for loadData() with filter dependencies
useEffect([loadCallback]) triggers initial load
```

**Dashboard page is the simplest** — only 2 state variables (`data`, `error`), no modals, auto-refresh via `AutoRefreshProvider` context. This is the closest pattern to what the new unified dashboard should follow.

**Modal pattern (evolution + article-bank):**
- Boolean state controls visibility
- Form state in separate useState calls
- Submit validates → toast success/error → close/stay open
- Confirmation dialogs use native `confirm()` for destructive actions

**Data loading pattern:**
- `useCallback` wraps async function that calls server actions
- `Promise.all` for parallel independent fetches (article-bank loads 4 actions in parallel)
- `loading` boolean set before/after
- Error displayed as banner or toast
- Manual refresh via action callbacks that re-call `loadData()`

### 11. Testing Patterns (Deep Dive)

**Test inventory: ~954 tests across 16 files**

| Category | Tests | Files | Framework |
|----------|-------|-------|-----------|
| Component unit tests | 125 | 5 | Jest + React Testing Library |
| Server action unit tests | 213 | 3 | Jest + Supabase chain mocking |
| E2E tests | 143 | 2 | Playwright + `adminTest` fixture |
| Integration tests | 473 | 6 | Jest + real Supabase |

**Server action mocking pattern:**
```typescript
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));
// Chained query mock: all methods return the mock itself
```

**Component test pattern:**
```typescript
jest.mock('@/lib/services/evolutionVisualizationActions', () => ({
  getEvolutionRunTimelineAction: jest.fn(),
}));
// Render + waitFor + assert data-testid
```

**Integration test pattern:**
- Real Supabase, mock LLM client
- `beforeAll`: check `evolutionTablesExist()`, skip if not migrated
- `afterAll`: `cleanupEvolutionData()` with FK-safe deletion order
- Shared helpers from `src/testing/utils/evolution-test-helpers.ts`

**E2E pattern:**
- `adminTest` fixture for pre-authenticated admin sessions
- Database seeding via service role key
- No page object models for evolution (inline Playwright API)

**Key test helpers** (`evolution-test-helpers.ts`):
- `createMockEvolutionLLMClient()` — Mock LLM with `.complete()` + `.completeStructured()`
- `createTestEvolutionRun()` — Factory with overrides
- `createTestVariant()` — Factory with valid variant text
- `createTestCheckpoint()` — Factory with serialized pipeline state
- `evolutionTablesExist()` — Migration check (error code 42P01)
- `cleanupEvolutionData()` — FK-safe deletion: checkpoints → variants → runs
