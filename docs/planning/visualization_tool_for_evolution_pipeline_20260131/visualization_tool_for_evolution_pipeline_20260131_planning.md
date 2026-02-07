# Visualization Tool For Evolution Pipeline Plan

## Background
The evolution pipeline is a genetic-algorithm-inspired system for optimizing article content through iterative variant generation, Elo-ranked pairwise comparison, and multi-phase progression (EXPANSION → COMPETITION). It runs 7 agent types across up to 15 iterations, producing 15-30+ text variants per run. The existing admin page (`/admin/quality/evolution`) provides basic run listing, variant tables, cost bars, and quality comparison — but lacks visual representations of pipeline execution, Elo trajectories, variant lineage, and operational health. This project adds dedicated visualization sub-pages using Recharts for standard charts and D3.js for the variant lineage DAG.

## Problem
When an evolution run produces unexpected results, fails mid-execution, or consumes too much budget, there is no way to visually trace what happened at each step. Admins must manually inspect checkpoint JSON and database rows to understand pipeline behavior. There is also no operational dashboard showing system-wide health — active runs, queue depth, success rates, and spend trends. This makes it difficult to monitor the evolution system at scale, debug individual runs, and understand which strategies and phases produce the best outcomes.

## Options Considered

### Visualization Library
1. **Recharts only** — Lightweight, declarative, covers line/bar/area/radar charts. Cannot render DAGs.
2. **D3.js only** — Maximum flexibility for all visualizations including DAGs. More code to maintain.
3. **Recharts + D3 hybrid (chosen)** — Recharts for 80% of charts (Elo curves, budget burn, radar), D3 only for the variant lineage DAG. Best ratio of simplicity to capability.

### Page Architecture
1. **Enhance existing page** — Would bloat the already-large `page.tsx` (665 lines).
2. **New dedicated sub-pages (chosen)** — Clean separation: dashboard for ops, run detail for deep dive, compare for before/after.
3. **Standalone route outside admin** — Unnecessary; evolution is admin-only functionality.

### Data Refresh Strategy
1. **Manual refresh only** — Too slow for monitoring active runs.
2. **Auto-polling at 15s interval (chosen)** — Matches pipeline execution pace (agents take seconds to minutes). Pauses when tab is hidden.
3. **Supabase Realtime** — Over-engineered for this use case; runs are long-lived.

### Variant Lineage Data Source
1. **DB-only lineage (content_evolution_variants.parent_variant_id)** — The DB has a `parent_variant_id` FK column, but it is never populated by current code and only supports single-parent. Cannot represent crossover (2 parents).
2. **Checkpoint-only lineage (chosen)** — Deserialize the latest checkpoint's `pool: TextVariation[]` to get `parentIds[]` arrays. This is the only source of multi-parent lineage data. All IDs in the lineage graph are in-memory IDs from `TextVariation.id`, not DB UUIDs. The lineage graph is self-contained within checkpoint data.

**Key insight:** In-memory variant IDs (used in checkpoints) differ from DB-generated UUIDs (in `content_evolution_variants`). The variant insert code (`evolutionActions.ts:352-360`) does NOT persist the in-memory `TextVariation.id`. Therefore, the lineage and rating history features must operate entirely on checkpoint data, using in-memory IDs. DB variant rows are only used for the Variants tab table (sorted by ordinal/elo_score) and winner detection (`is_winner` flag). The two ID spaces are never joined.

### Text Diff Rendering Approach
1. **Reuse markdownASTdiff CriticMarkup** — `RenderCriticMarkupFromMDAstDiff()` returns a CriticMarkup string (`{--del--}`, `{++ins++}`), designed for Lexical editor integration, not React rendering. Would require building a CriticMarkup→React parser.
2. **Use `diff` package directly (chosen)** — The `diff@8.0.2` package is already installed. Use `diffWordsWithSpace()` to produce change arrays, then render inline with `<span>` elements styled green (insert) / red (delete). Simple, no parser needed, works natively in React. The `markdownASTdiff` infrastructure is not used.

## Phased Execution Plan

### Phase 1: Dependencies & Shared Components

**Goal:** Install charting libraries, create reusable components used across all pages.

**Done when:** All shared components render in isolation (Storybook-style manual check or unit test), `EvolutionStatusBadge` replaces inline `statusColor()` in existing page, and lint/tsc/build pass.

**Dependencies to install:**
- `recharts` — Standard charts (line, bar, area, radar)
- `d3` + `@types/d3` — DAG layout for lineage tree
- `d3-dag` — Sugiyama layout algorithm for directed acyclic graphs

**SSR & Bundle Size:** D3, d3-dag, and Recharts are browser-only. All components using them must include `'use client'` directive. The `LineageGraph` component (Phase 5) must be loaded via `next/dynamic` with `{ ssr: false }` to avoid SSR crashes. Recharts components should also use dynamic import to avoid shipping chart code to non-admin pages.

**d3-dag ESM Compatibility:** `d3-dag` is ESM-only since v1.0. For Jest unit tests, the `LineageGraph` component will be mocked entirely (see Testing section). For the component itself, the `next/dynamic` wrapper naturally handles ESM. Add `d3-dag` to `jest.config.js` `moduleNameMapper` pointing to a stub mock.

**New shared components** in `src/components/evolution/`:

1. **`EvolutionStatusBadge.tsx`** — Extracts existing `statusColor()` from `page.tsx` into a reusable component. Props: `status: EvolutionRunStatus`. Returns a styled span badge. Must handle all 6 statuses including `'claimed'` (currently falls through to default gray in existing code — add explicit blue-gray styling).

2. **`PhaseIndicator.tsx`** — Shows `EXPANSION` / `COMPETITION` with iteration context. Props: `phase: PipelinePhase`, `iteration: number`, `maxIterations: number`.

3. **`AutoRefreshProvider.tsx`** — Context wrapper managing polling. Provides `{ lastUpdated, refresh, isRefreshing }`. Configurable interval (default 15s). Pauses on `document.hidden` via `visibilitychange` event listener. Uses `useRef` for timer ID to avoid stale closures. Uses `AbortController` to cancel in-flight fetch requests on unmount or tab hide. Renders a small "Last updated X seconds ago · ↻" indicator.

4. **`EloSparkline.tsx`** — Tiny inline Recharts `LineChart` (60x20px) showing a variant's Elo trajectory. Props: `data: { iteration: number; elo: number }[]`. Loaded via dynamic import.

5. **`VariantCard.tsx`** — Compact card: variant short ID, Elo, strategy badge, iteration born. Used in tooltips and side panels.

**Modify existing page:**
- Extract `statusColor()` into `EvolutionStatusBadge` and import it back
- Add navigation links: "Dashboard" button in header, run rows link to `/admin/quality/evolution/run/[runId]`

**Files created:**
- `src/components/evolution/EvolutionStatusBadge.tsx`
- `src/components/evolution/PhaseIndicator.tsx`
- `src/components/evolution/AutoRefreshProvider.tsx`
- `src/components/evolution/EloSparkline.tsx`
- `src/components/evolution/VariantCard.tsx`
- `src/components/evolution/index.ts` (barrel export)

**Files modified:**
- `src/app/admin/quality/evolution/page.tsx` (extract `statusColor`, add nav links)

---

### Phase 2: Data Layer — Visualization Server Actions

**Goal:** Create read-only server actions that aggregate existing data for the visualization pages.

**Done when:** All 6 actions pass integration tests with seeded checkpoint, variant, and llmCallTracking data. Lint/tsc pass.

**New file:** `src/lib/services/evolutionVisualizationActions.ts`

All actions follow the existing `withLogging` + `serverReadRequestId` pattern from `evolutionActions.ts`. **Every action must call `requireAdmin()` as its first line** (matching all 6 existing evolution actions).

**Checkpoint Loading Strategy (Performance):** Actions #2 and #3 load checkpoints from `evolution_checkpoints`. A 15-iteration, 7-agent run produces ~105 checkpoints, each containing the full variant pool text (potentially 50-200KB per snapshot). To avoid O(n*m) memory pressure:
- **Selective column loading:** For rating history (action #3), only select `iteration, last_agent, state_snapshot->'ratings'` (with fallback to `state_snapshot->'eloRatings'` for legacy checkpoints) using Supabase JSONB path extraction, avoiding deserializing the entire pool text.
- **Iteration-level sampling:** For timeline (action #2), load only one checkpoint per iteration (the last agent's checkpoint), not all 7. This reduces rows from ~105 to ~15.
- **No polling on checkpoint actions:** Timeline and Elo tabs load data once on tab switch, not on the 15s auto-poll cycle. Only the dashboard page auto-polls.
- **Lazy tab loading:** Each tab fetches its data only when selected, not all at once on page load.

**Cost Column Note:** The existing `getEvolutionCostBreakdownAction` has a bug using `estimated_cost` instead of the correct column name `estimated_cost_usd` on the `llmCallTracking` table. New actions must use `estimated_cost_usd`. (The pre-existing bug in `evolutionActions.ts:397` should also be fixed as a drive-by.)

**Cost Attribution Limitation:** `llmCallTracking` has no `run_id` column. Cost is attributed via time-window correlation (`started_at`/`completed_at` + `call_source LIKE 'evolution_%'`). Concurrent evolution runs will have overlapping cost attribution. This is a known limitation documented in the code comments.

1. **`getEvolutionDashboardDataAction()`**
   Returns: `{ activeRuns: number, queueDepth: number, successRate7d: number, monthlySpend: number, runsPerDay: { date: string, completed: number, failed: number, paused: number }[], dailySpend: { date: string, amount: number }[], recentRuns: EvolutionRun[] }`
   Implementation: Batched queries on `content_evolution_runs` with date aggregation. Queue depth = `WHERE status = 'pending'` count. Monthly spend = `SUM(total_cost_usd) WHERE created_at >= first-of-month`. Recent runs limited to 20.

2. **`getEvolutionRunTimelineAction(runId: string)`**
   Returns: `{ iterations: { iteration: number, phase: PipelinePhase, agents: { name: string, costUsd: number, variantsAdded: number, matchesPlayed: number, strategy?: string, error?: string }[] }[], phaseTransitions: { afterIteration: number, reason: string }[] }`
   Implementation: Load **one checkpoint per iteration** (the last agent's checkpoint per iteration, identified by `MAX(last_agent)` group) from `evolution_checkpoints`. Deserialize each using `deserializeState()` from `src/lib/evolution/core/state.ts`. Diff sequential iteration snapshots (pool size delta = variants added, matchHistory length delta = matches played). Supplement with `llmCallTracking` (using `estimated_cost_usd`) for per-agent costs via time-window correlation.

3. **`getEvolutionRunEloHistoryAction(runId: string)`**
   Returns: `{ variants: { id: string, shortId: string, strategy: string, iterationBorn: number }[], history: { iteration: number, ratings: Record<string, number> }[] }`
   Implementation: Use Supabase JSONB extraction: `SELECT iteration, COALESCE(state_snapshot->'ratings', state_snapshot->'eloRatings') as ratings FROM evolution_checkpoints WHERE run_id = $1 ORDER BY iteration`. Extract only the ratings map without deserializing full snapshots. New checkpoints store `ratings` as `{mu, sigma}` objects; legacy checkpoints store `eloRatings` as numbers. The action handles both formats, converting to ordinal-scaled Elo for display. Variant metadata (strategy, iterationBorn) extracted from the latest checkpoint's full pool deserialization (single snapshot).

4. **`getEvolutionRunLineageAction(runId: string)`**
   Returns: `{ nodes: { id: string, shortId: string, strategy: string, elo: number, iterationBorn: number, isWinner: boolean }[], edges: { source: string, target: string }[] }`
   Implementation: Deserialize **only the latest checkpoint** to access the full `pool: TextVariation[]` with `parentIds`. All node IDs and edge source/target use in-memory `TextVariation.id` (not DB UUIDs). Winner detection: find the DB variant with `is_winner = true`, match it to the in-memory pool by `variant_content` text equality. Build edge list from `parentIds[]` → child `id`. This is a single-checkpoint load, not a multi-checkpoint scan.

5. **`getEvolutionRunBudgetAction(runId: string)`**
   Returns: `{ agentBreakdown: AgentCostBreakdown[], cumulativeBurn: { step: number, agent: string, cumulativeCost: number, budgetCap: number }[] }`
   Implementation: Query `llmCallTracking` using `estimated_cost_usd` (correct column name) ordered by `created_at` to build chronological cumulative series. Time-window filtered by run's `started_at`/`completed_at`.

6. **`getEvolutionRunComparisonAction(runId: string)`**
   Returns: `{ originalText: string, winnerText: string | null, winnerStrategy: string | null, winnerElo: number | null, eloImprovement: number | null, qualityScores: { dimension: string, before: number, after: number }[] | null, totalIterations: number, totalCost: number, variantsExplored: number, generationDepth: number }`
   Implementation: Join run → variants (winner via `is_winner = true`) → latest checkpoint for `allCritiques`. **Quality scores are nullable:** `allCritiques` is only populated when the optional ReflectionAgent runs (gated by feature flags and Slice C). For minimal pipeline runs, quality scores will be null and the radar chart section in the compare page gracefully shows "No quality data available."

**Input validation:** All actions validate `runId` is a valid UUID format before querying Supabase to avoid unnecessary DB round-trips and provide clear error messages.

**Files created:**
- `src/lib/services/evolutionVisualizationActions.ts`

**Files modified:**
- `src/lib/services/evolutionActions.ts` (fix `estimated_cost` → `estimated_cost_usd` in `getEvolutionCostBreakdownAction` at line 397)

---

### Phase 3: Dashboard Page

**Goal:** Operational monitoring page showing system-wide evolution health.

**Done when:** Dashboard loads with stat cards, both charts render with mock or real data, auto-polling works, and page follows Midnight Scholar theme. Lint/tsc/build pass.

**New file:** `src/app/admin/quality/evolution/dashboard/page.tsx`

Must include `'use client'` directive. Recharts components loaded via `next/dynamic` with `{ ssr: false }`.

**Layout (top to bottom):**

1. **Header row** — "Evolution Dashboard" title + AutoRefreshProvider indicator + breadcrumb: Evolution → Dashboard
2. **4 stat cards** — Active Runs, Queue Depth, 7-Day Success Rate, Monthly Spend. Create new `StatCard` component locally (the existing `SummaryCards` is a local function in `page.tsx`, not importable — build fresh following the same card pattern with `var(--surface-elevated)`, `var(--border-default)` CSS variables).
3. **2 charts side-by-side:**
   - **Runs Over Time** — Recharts `AreaChart`, stacked areas for completed/failed/paused per day, last 30 days
   - **Daily Spend** — Recharts `BarChart`, daily cost from `content_evolution_runs.total_cost_usd`, last 30 days
4. **Recent Runs table** — Last 20 runs. Columns: explanation ID (linked to run detail), status badge, phase, iterations, cost, duration, created date. Each row links to `/admin/quality/evolution/run/[runId]`.

**Data fetching:** Single call to `getEvolutionDashboardDataAction()` wrapped in `AutoRefreshProvider` (15s interval). Dashboard is the only page that auto-polls.

**Files created:**
- `src/app/admin/quality/evolution/dashboard/page.tsx`

---

### Phase 4: Run Detail Page — Timeline & Budget Tabs

**Goal:** Single-run deep dive with execution timeline and budget analysis.

**Done when:** Run detail page loads for a given runId, Timeline tab renders iteration blocks with agent entries, Budget tab renders both charts, tab switching works. Lint/tsc/build pass.

**Architecture:** The run detail page is a thin shell with header and tab bar. **Each tab is a separate component file** to avoid a monolithic page:

- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — Shell: header, tab bar, lazy tab loader
- `src/components/evolution/tabs/TimelineTab.tsx` — Timeline visualization
- `src/components/evolution/tabs/BudgetTab.tsx` — Budget charts
- `src/components/evolution/tabs/EloTab.tsx` (Phase 5)
- `src/components/evolution/tabs/LineageTab.tsx` (Phase 5)
- `src/components/evolution/tabs/VariantsTab.tsx` (Phase 6)

Must include `'use client'` directive. All tab components loaded lazily (only fetch data when their tab is selected).

**Page Shell (`page.tsx`):**
- **Header** — Run ID, explanation ID (linked), status badge, phase indicator, cost/budget summary
- **Breadcrumb** — Evolution → Run #[runId]
- **Tab bar** — Timeline | Elo | Lineage | Budget | Variants (using simple state-driven tabs, no routing)
- Each tab renders its component only when selected (conditional rendering, not hidden CSS)

**TimelineTab:**
- Vertical timeline, grouped by iteration
- Each iteration shows: phase badge, agent execution blocks with cost, variants added, matches played
- Expandable agent blocks reveal: strategy used, input/output summary, token counts, errors
- Phase transition markers between iterations with transition reason
- Failed runs highlight the failure point in red with error message
- Data source: `getEvolutionRunTimelineAction(runId)` — loaded once on tab selection, no auto-poll

**BudgetTab:**
- **Cumulative Burn Curve** — Recharts `AreaChart` (via `next/dynamic`). X-axis: chronological agent steps. Y-axis: cumulative USD. Horizontal dashed line at budget cap. Area color transitions: green → yellow (>75%) → red (>90%).
- **Agent Cost Breakdown** — Recharts horizontal `BarChart`. One bar per agent type, sorted by cost descending. Labels: USD + percentage.
- Data source: `getEvolutionRunBudgetAction(runId)` — loaded once on tab selection, no auto-poll

**Files created:**
- `src/app/admin/quality/evolution/run/[runId]/page.tsx`
- `src/components/evolution/tabs/TimelineTab.tsx`
- `src/components/evolution/tabs/BudgetTab.tsx`

---

### Phase 5: Run Detail Page — Elo & Lineage Tabs

**Goal:** Quality insight visualizations showing variant performance and ancestry.

**Done when:** Elo tab renders line chart with strategy colors and top-N filtering. Lineage tab renders interactive DAG with zoom/pan and click-to-inspect. Lint/tsc/build pass.

**EloTab (`src/components/evolution/tabs/EloTab.tsx`):**
- Recharts `LineChart` (via `next/dynamic`). X-axis: iteration. Y-axis: Elo (800–1800 range).
- Each variant = one line, color-coded by strategy:
  - Blue: `structural_transform`
  - Green: `lexical_simplify`
  - Orange: `grounding_enhance`
  - Purple: evolution operators (`mutate_clarity`, `crossover`, etc.)
- Top 5 by final Elo = solid prominent lines. Rest = faded thin gray.
- Hover highlights a line, tooltip shows variant ID, strategy, current Elo.
- Toggle: "Top N" slider (default 5) vs "Show all".
- Winner line has star marker at final point.
- Data source: `getEvolutionRunEloHistoryAction(runId)` — loaded once on tab selection

**LineageTab (`src/components/evolution/tabs/LineageTab.tsx`):**
- Wraps `LineageGraph` component loaded via `next/dynamic` with `{ ssr: false }`.

**LineageGraph (`src/components/evolution/LineageGraph.tsx`):**
- D3-in-React component using `useRef` + `useEffect` for D3 rendering, React for the side panel.
- Directed acyclic graph rendered with D3 + `d3-dag` sugiyama layout.
- Nodes = variants (circles). Size scales with final Elo. Color = strategy (same palette as Elo).
- Root node = original text (top). Edges = parentIds → child.
- Crossover variants have 2 incoming edges.
- Click node → side panel with variant text, Elo, strategy, iteration.
- Winner node has gold ring highlight.
- Zoom/pan via `d3-zoom`. Minimap in corner for large graphs (30+ nodes).
- **D3-rendered SVG nodes** must include `data-testid` attributes via `.attr('data-testid', 'lineage-node-' + id)` for E2E testing.
- Data source: `getEvolutionRunLineageAction(runId)` — loaded once on tab selection

**Files created:**
- `src/components/evolution/LineageGraph.tsx`
- `src/components/evolution/tabs/EloTab.tsx`
- `src/components/evolution/tabs/LineageTab.tsx`

---

### Phase 6: Variants Tab & Compare Page

**Goal:** Detailed variant inspection and before/after comparison.

**Done when:** Variants tab renders sortable table with sparklines and expandable text. Compare page renders word-level diff, radar chart (when data exists), and stats summary. Lint/tsc/build pass.

**VariantsTab (`src/components/evolution/tabs/VariantsTab.tsx`):**
- Sortable table: Rank, ID (short), Elo, Matches, Strategy, Iteration, Parents, [View] button
- Default sort: Elo descending
- Filters: strategy dropdown, iteration range slider, minimum Elo threshold
- [View] expands row to show full variant text
- Checkbox selection for side-by-side diff (select 2 → "Compare" button)
- Winner pinned to top with gold badge
- Each row includes `EloSparkline` component
- "Full Compare" button navigates to compare page with original vs winner
- **XSS protection:** Variant text is LLM-generated. All variant text rendering uses plain `<pre>` tags with `textContent` semantics (no `dangerouslySetInnerHTML`). Text is never interpreted as HTML or markdown.

**Compare Page:** `src/app/admin/quality/evolution/run/[runId]/compare/page.tsx`

Must include `'use client'` directive. Breadcrumb: Evolution → Run #[runId] → Compare.

Three sections:
1. **Side-by-side text diff** — Uses the already-installed `diff@8.0.2` package (`diffWordsWithSpace()`) to produce change arrays. Renders inline with styled `<span>` elements: green background for insertions, red background with strikethrough for deletions, unstyled for equal segments. **No HTML interpretation** — all text rendered as plaintext to prevent XSS from LLM-generated content.
2. **Quality Radar Chart** — Recharts `RadarChart` (via `next/dynamic`) plotting ReflectionAgent dimensional scores (clarity, structure, engagement, precision, coherence) for both original and winner as overlapping polygons. **Graceful null handling:** When `qualityScores` is null (minimal pipeline runs without ReflectionAgent), show "Quality scores not available for this run" message instead of the radar chart.
3. **Stats Summary** — Card grid: Elo delta, total iterations, total cost, variants explored, winning strategy, generation depth.

Data source: `getEvolutionRunComparisonAction(runId)`

**Files created:**
- `src/app/admin/quality/evolution/run/[runId]/compare/page.tsx`
- `src/components/evolution/tabs/VariantsTab.tsx`

---

### Phase 7: Polish & Integration

**Goal:** Wire everything together, add loading/error states, and ensure design system compliance.

**Done when:** All pages render correctly with loading states, error boundaries catch per-tab failures, all components use Midnight Scholar CSS variables (no raw Tailwind color classes that would trigger `no-tailwind-color-classes` ESLint rule), responsive behavior verified. Full build/lint/tsc pass.

**Tasks:**
- Add loading skeletons for all chart areas (use existing shimmer pattern from admin pages)
- Add error boundaries per tab so one failed query doesn't break the whole page
- Ensure all components use Midnight Scholar theme CSS variables (`var(--surface-elevated)`, `var(--text-primary)`, `var(--status-success)`, etc.) — no raw Tailwind colors like `bg-yellow-800`
- Add `data-testid` attributes to all interactive elements (React and D3) for E2E testing
- Verify responsive behavior (charts resize properly, tables scroll horizontally)
- Add breadcrumb navigation: Evolution → Dashboard / Evolution → Run #X → Compare
- Update existing evolution page to link run rows to `/admin/quality/evolution/run/[runId]`

**Rollback plan:** Navigation links to dashboard and run detail pages are the only changes to the existing evolution page. If the new pages cause issues, revert those links — all new pages are additive routes that don't affect existing functionality. Dependencies (recharts, d3, d3-dag) are only imported in the new components.

**Files modified:**
- All files created in phases 1-6 (polish pass)
- `src/app/admin/quality/evolution/page.tsx` (add run detail links)

## Testing

### Unit Tests (colocated with source)

Following the project's dominant convention of colocating tests next to source files (185 existing colocated tests):

- `src/components/evolution/EvolutionStatusBadge.test.tsx` — Renders correct color/classes for all 6 statuses including `claimed`.
- `src/components/evolution/AutoRefreshProvider.test.tsx` — Verify polling interval fires, pause on `document.hidden` (mock `document.hidden` and dispatch synthetic `visibilitychange` events since jsdom lacks Page Visibility API), manual refresh callback, AbortController cancellation on unmount.
- `src/components/evolution/EloSparkline.test.tsx` — Renders SVG with correct data points.
- `src/components/evolution/LineageGraph.test.tsx` — **Mock D3 entirely** (LineageGraph does DOM manipulation via D3 which jsdom can't handle). Test that the component calls the expected D3 setup functions and that the React side panel renders variant info on node selection. Mock `d3` and `d3-dag` in `jest.config.js` `moduleNameMapper`.
- `src/lib/services/evolutionVisualizationActions.test.ts` — Test all 6 new server actions with mocked Supabase responses. Verify: correct aggregation logic, JSONB extraction for Elo history, edge list construction from parentIds, null handling for missing qualityScores, UUID validation, `requireAdmin()` is called.

**Jest config changes:**
- Add `moduleNameMapper` entry: `'^d3-dag$': '<rootDir>/src/testing/mocks/d3-dag.ts'`
- Add `moduleNameMapper` entry: `'^d3$': '<rootDir>/src/testing/mocks/d3.ts'`
- Create mock files:
  - `src/testing/mocks/d3.ts` — Export stubs for `select`, `selectAll`, `attr`, `style`, `append`, `call`, `datum`, `on` using `jest.fn().mockReturnThis()` to support D3's fluent chaining API (e.g., `d3.select('svg').append('g').attr('class', 'node')`). Export simple `jest.fn()` stubs for `zoom`, `zoomIdentity` (not chained). Follows the Supabase mock's `.mockReturnThis()` chaining pattern.
  - `src/testing/mocks/d3-dag.ts` — Export `jest.fn()` stub for `dagStratify` and `sugiyama` layout. Returns mock node/link arrays with minimal shape.

**AutoRefreshProvider AbortController testing:** Mock `global.fetch` and verify the `AbortSignal` is passed as the `signal` option. On unmount, verify `AbortController.abort()` is called. Alternatively, test the `abort()` call directly without full fetch integration.

### Integration Tests

- `src/__tests__/integration/evolution-visualization.integration.test.ts`

**Mock setup:** Follow existing pattern from `evolution-pipeline.integration.test.ts` — mock `instrumentation` (NOOP_SPAN), `requireAdmin`, `serverReadRequestId`, `withLogging`, `auditLog` before imports.

**Table guard:** Use `evolutionTablesExist()` from `evolution-test-helpers.ts` to auto-skip when evolution schema not migrated.

**Test data seeding:** Extend `src/testing/utils/evolution-test-helpers.ts` with two new helpers:

1. **`createTestCheckpoint()`** — Creates an `evolution_checkpoints` row with a realistic `stateSnapshot` JSON. Takes: `runId`, `iteration`, `lastAgent`, and partial `SerializedPipelineState` overrides (eloRatings, pool, matchHistory). Builds valid `SerializedPipelineState` with sensible defaults.

2. **`createTestLLMCallTracking()`** — Creates an `llmCallTracking` row. Takes: `callSource` (e.g., `'evolution_generation'`), `estimatedCostUsd`, `createdAt` timestamp. Used to seed budget/cost data.

**Test scenarios:**
- Timeline reconstruction: seed 3 iterations with 2 agents each → verify 3 iteration groups with correct agent counts
- Elo history extraction: seed checkpoints with known Elo ratings → verify history array matches
- Lineage edge construction: seed checkpoint with variants having parentIds → verify edges
- Budget cumulative burn: seed llmCallTracking rows → verify chronological accumulation
- Dashboard aggregation: seed multiple runs with different statuses → verify stat counts
- Null quality scores: seed run without ReflectionAgent → verify graceful null return

### E2E Tests

- `src/__tests__/e2e/specs/09-admin/admin-evolution-visualization.spec.ts`

Uses `adminTest` fixture from `src/__tests__/e2e/fixtures/admin-auth.ts`. Uses inline seeding pattern (matching `admin-evolution.spec.ts`): Supabase service role client creates topic → explanation → run → variants → checkpoints in `beforeAll`, FK-safe cleanup in `afterAll`.

**E2E checkpoint seeding:** E2E tests cannot import TypeScript types from `src/lib/evolution/types.ts`. Checkpoint `state_snapshot` is seeded as raw JSON objects matching the `SerializedPipelineState` shape, not via typed helpers. Minimal example:
```json
{ "iteration": 2, "originalText": "...", "pool": [{ "id": "v1", "text": "...", "version": 1, "parentIds": [], "strategy": "structural_transform", "createdAt": 0, "iterationBorn": 1 }], "ratings": { "v1": { "mu": 28.75, "sigma": 4.0 } }, "matchCounts": { "v1": 5 }, "matchHistory": [], "newEntrantsThisIteration": [], "dimensionScores": null, "allCritiques": null, "similarityMatrix": null, "diversityScore": null, "metaFeedback": null }
```

**Conditionally skipped** via `adminTest.describe.skip` pattern (matching existing convention) unless evolution tables are confirmed present.

**Test scenarios:**
- Navigate to `/admin/quality/evolution/dashboard`, verify stat cards render via `data-testid="stat-card-*"`
- Click a run row, verify run detail page loads with tab bar
- Switch between tabs, verify each tab renders content (use `data-testid` on chart containers)
- Navigate to compare page, verify diff section renders
- Verify D3 lineage nodes are present via `data-testid="lineage-node-*"` selectors

**D3 testability note:** Playwright can query SVG elements rendered by D3 using CSS selectors on `data-testid` attributes set via `.attr('data-testid', ...)` in D3 code.

### Manual Verification
- Queue an evolution run on staging, let it complete
- Verify dashboard stats update via auto-polling
- Navigate to run detail, check all 5 tabs render correctly
- Verify lineage DAG is interactive (click node, zoom/pan)
- Verify compare page shows meaningful text diff and radar chart (or "not available" message for minimal runs)

## Documentation Updates

### New Documentation
- `docs/feature_deep_dives/evolution_pipeline_visualization.md` — Already created (template). Will be populated with: overview, page structure, component catalog, data flow, server action reference.

### Updated Documentation
- `docs/docs_overall/architecture.md` — Add evolution visualization to Feature Documentation section
- `.claude/doc-mapping.json` — Already updated with `evolution*.ts` and `components/evolution/**` patterns

## Files Summary

### New Files (23)
| File | Purpose |
|------|---------|
| `src/components/evolution/EvolutionStatusBadge.tsx` | Reusable status badge |
| `src/components/evolution/EvolutionStatusBadge.test.tsx` | Badge unit tests |
| `src/components/evolution/PhaseIndicator.tsx` | Phase + iteration display |
| `src/components/evolution/AutoRefreshProvider.tsx` | Polling context wrapper |
| `src/components/evolution/AutoRefreshProvider.test.tsx` | Polling unit tests |
| `src/components/evolution/EloSparkline.tsx` | Inline Elo trajectory |
| `src/components/evolution/EloSparkline.test.tsx` | Sparkline unit tests |
| `src/components/evolution/LineageGraph.tsx` | D3 DAG visualization |
| `src/components/evolution/LineageGraph.test.tsx` | DAG unit tests (D3 mocked) |
| `src/components/evolution/index.ts` | Barrel exports |
| `src/components/evolution/tabs/TimelineTab.tsx` | Timeline tab component |
| `src/components/evolution/tabs/EloTab.tsx` | Elo chart tab component |
| `src/components/evolution/tabs/LineageTab.tsx` | Lineage DAG tab wrapper |
| `src/components/evolution/tabs/BudgetTab.tsx` | Budget charts tab component |
| `src/components/evolution/tabs/VariantsTab.tsx` | Variants table tab component |
| `src/lib/services/evolutionVisualizationActions.ts` | 6 read-only server actions |
| `src/lib/services/evolutionVisualizationActions.test.ts` | Server action unit tests |
| `src/app/admin/quality/evolution/dashboard/page.tsx` | Ops dashboard |
| `src/app/admin/quality/evolution/run/[runId]/page.tsx` | Run detail shell (tab bar) |
| `src/app/admin/quality/evolution/run/[runId]/compare/page.tsx` | Before/after compare |
| `src/testing/mocks/d3.ts` | D3 Jest mock |
| `src/testing/mocks/d3-dag.ts` | d3-dag Jest mock |
| `src/__tests__/e2e/specs/09-admin/admin-evolution-visualization.spec.ts` | E2E tests |

### New Integration Test Files (1)
| File | Purpose |
|------|---------|
| `src/__tests__/integration/evolution-visualization.integration.test.ts` | Integration tests for server actions |

### Modified Files (5)
| File | Change |
|------|--------|
| `src/app/admin/quality/evolution/page.tsx` | Extract statusColor, add nav links to dashboard + run detail |
| `src/lib/services/evolutionActions.ts` | Fix `estimated_cost` → `estimated_cost_usd` at line 397 |
| `src/testing/utils/evolution-test-helpers.ts` | Add `createTestCheckpoint()` and `createTestLLMCallTracking()` |
| `docs/feature_deep_dives/evolution_pipeline_visualization.md` | Populate with implementation details |
| `docs/docs_overall/architecture.md` | Add viz to feature index |

### Config Changes (1)
| File | Change |
|------|--------|
| `jest.config.js` | Add `moduleNameMapper` entries for `d3` and `d3-dag` mocks |

### Dependencies Added (3)
| Package | Purpose |
|---------|---------|
| `recharts` | Line, bar, area, radar charts |
| `d3` + `@types/d3` | DAG rendering, zoom/pan |
| `d3-dag` | Sugiyama layout for lineage tree |
