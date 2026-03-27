# Visualization and Admin UI

The Evolution system ships a full admin interface built with Next.js server actions and shared React components. This document covers the 15 admin pages, shared component library, D3 lineage visualization, and the server action architecture that powers data fetching.

For database tables backing these views, see [Data Model](./data_model.md). For system-level concepts, see [Architecture](./architecture.md).

---

## Admin Pages

All pages live under `src/app/admin/evolution/` (Next.js App Router). A shared `layout.tsx` at `src/app/admin/evolution/layout.tsx` wraps all evolution routes with consistent sidebar navigation and layout chrome. Each page fetches data through server actions defined in `evolution/src/services/`.

| Route | Description | Key data |
|---|---|---|
| `/admin/evolution-dashboard` | Aggregate metrics across all runs and experiments. Auto-refreshes every 15 seconds. Cost queries use `evolution_metrics` (the `evolution_run_costs` view was dropped). | Run counts by status, cost totals from `evolution_metrics`, recent activity |
| `/admin/evolution/runs` | Paginated run list with status filtering and "Hide test content" checkbox. Test content filter uses an inner join on `evolution_strategies` to exclude runs whose strategy name contains `[TEST]`. | Status badge, iteration count, cost, created date |
| `/admin/evolution/runs/[runId]` | Run detail with tabs: **Overview**, **Elo**, **Lineage**, **Variants**, **Logs**. Auto-refreshes while run is in progress. | Full run metrics, lineage graph, variant list |
| `/admin/evolution/experiments` | Experiment list with status filter, "Hide test content" checkbox, and standard table layout (ID, Name, Status, Runs, Created, Cancel action columns). | Name, status, run count, created date |
| `/admin/evolution/experiments/[experimentId]` | Experiment detail with tabs: **Overview**, **Analysis**, **Runs**, **Logs**. | Experiment config, cost analysis, linked runs, aggregated logs |
| `/admin/evolution/start-experiment` | Three-step creation wizard: select strategy, configure parameters, confirm and launch. | Strategy registry, prompt templates |
| `/admin/evolution/arena` | Arena topics list showing active matchmaking topics. | Topic name, entry count, match count |
| `/admin/evolution/arena/[topicId]` | Topic leaderboard sorted by Elo rating. Columns: Elo, 95% CI (formatted via `formatEloCIRange(elo, sigma)`), Mu, Sigma, Matches, Cost. Entries below the top 15% eligibility cutoff (mean + 1.04×stdDev of Elo scores) are dimmed. Cutoff logic is in `src/app/admin/evolution/arena/[topicId]/arenaCutoff.ts`. | TrueSkill ratings, match history |
| `/admin/evolution/arena/entries/[entryId]` | Individual arena entry detail with match history and rating trajectory. | Entry metrics, per-match results |
| `/admin/evolution/variants` | Paginated variant list across all runs with "Hide test content" checkbox. Filter uses nested inner join through `evolution_runs` → `evolution_strategies` to exclude variants from test runs. | Variant name, strategy, iteration, Elo |
| `/admin/evolution/variants/[variantId]` | Variant detail with full prompt text, metrics, lineage context, and a **Matches** tab showing match history from arena comparisons. | Prompt content, parent chain, comparison results, match history |
| `/admin/evolution/prompts` | CRUD interface for `evolution_prompts` table. | Prompt name, template text, created/updated dates |
| `/admin/evolution/strategies` | CRUD interface for `evolution_strategies` table. | Strategy name, config JSON, status |
| `/admin/evolution/strategies/[strategyId]` | Strategy detail with tabs: **Overview**, **Runs**, and **Logs**. The **Runs** tab shows runs filtered by `strategy_id`. | Strategy config, linked runs, aggregated logs across all runs using this strategy |
| `/admin/evolution/invocations` | Invocation list with "Hide test content" checkbox. Filter uses nested inner join through `evolution_runs` → `evolution_strategies` to exclude invocations from test runs. | Agent name, iteration, success, cost, duration |
| `/admin/evolution/invocations/[invocationId]` | Invocation detail (server wrapper + `InvocationDetailContent` client component) with **Overview** and **Logs** tabs. | Input/output text, token breakdown, invocation-level logs |

---

## Shared Components

All shared UI components live in `evolution/src/components/evolution/`. They enforce consistent layout and behavior across the 15 pages above.

### EntityListPage

Full list page wrapper combining a title bar, filter controls, `EntityTable`, and pagination. Wrapped in a Card-style container with `paper-texture` and `card-enhanced` styling for visual consistency across the evolution admin area. Used by every top-level list page (runs, variants, experiments, invocations).

Key behavior:
- **Card wrapper**: Content is wrapped in a `rounded-book` container with `paper-texture` and `card-enhanced` CSS classes, matching the Midnight Scholar design system.
- **`showHeader` prop**: When `false`, skips the header section (title, count, actions). Used by `RegistryPage` which renders its own header above. Default `true`.
- **`renderTable` prop**: Optional custom table renderer. When provided, replaces `EntityTable` with custom content (e.g., `RunsTable` for budget progress bars, or experiment rows with cancel buttons). Receives `{ items, loading, emptyMessage, emptySuggestion }`.
- **`columns` prop**: Now optional when `renderTable` is provided. A dev-mode error is thrown if neither `columns` nor `renderTable` is supplied.
- **Filters**: Defined via `FilterDef[]` with `select`, `text`, and `checkbox` types. Filter state is managed by the parent and passed down as `filterValues`.
- **Sorting**: Column-level sort via `onSort` callback. Sort direction toggles between `asc` and `desc`.
- **Pagination**: Sliding-window paginator with `MAX_VISIBLE_PAGES = 7`. When total pages exceed 7, the window centers on the current page. Page size is capped at `MAX_PAGE_SIZE = 100`. Buttons have borders, hover states, and gold accent styling.

### EntityDetailHeader

Header bar for detail pages with:
- **Inline rename**: When `onRename` is provided, the title becomes editable. Clicking the edit icon toggles edit mode; saving calls the async rename handler.
- **Status badge**: Rendered via a `statusBadge` ReactNode slot (typically `EvolutionStatusBadge`).
- **Cross-links**: Array of `EntityLink` objects rendered as navigation chips (e.g., linking from a run to its experiment).
- **Action slots**: Arbitrary `actions` ReactNode for page-specific buttons.

### EntityDetailTabs and useTabState

Tab container with URL-synced tab selection:
- Active tab is stored in the `?tab=<id>` query parameter via `useTabState`.
- Supports a legacy tab map for redirecting old tab IDs to new ones after renames.
- Each tab is lazy-rendered only when selected.
- Accessible markup: the tab bar renders with `role="tablist"`, each tab button has `role="tab"` and `aria-selected`, and arrow key navigation cycles between tabs.

```typescript
// Usage pattern in a detail page
const [activeTab, setActiveTab] = useTabState('overview', LEGACY_TAB_MAP);

return (
  <EntityDetailTabs
    tabs={TAB_DEFS}
    activeTab={activeTab}
    onTabChange={setActiveTab}
  />
);
```

### MetricGrid

Configurable grid for displaying numeric metrics. Used by `EntityMetricsTab` (see below) and inline on detail pages. Three visual variants:

| Variant | Style |
|---|---|
| `default` | Bare layout, no background |
| `card` | Elevated background with padding |
| `bordered` | Border + elevated background |

Each `MetricItem` can include:
- `ci`: Confidence interval displayed as `[lower, upper]` — now populated from `ci_lower`/`ci_upper` in `evolution_metrics`
- `n`: Sample size from the metrics row; when low, an asterisk is appended to signal insufficient data
- `prefix`: Optional prefix string (e.g., "$" for cost values)
- `sigma`: Rating uncertainty carried through from source variant

Columns are configurable (2-5) with responsive breakpoints.

### EntityMetricsTab

Generic metrics tab component that replaces the old run-specific `MetricsTab`. Located in `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx`.

Key differences from the old `MetricsTab`:
- **Entity-agnostic**: Works for any entity type (run, strategy, experiment) by querying `evolution_metrics` with `entity_type` and `entity_id`.
- **CI display**: Renders confidence intervals from the metrics table when available (strategy and experiment metrics with 2+ observations).
- **Stale indicator**: Shows a refresh indicator when metrics have `stale=true`, with a button to trigger recomputation.
- **Grouped layout**: Metrics are grouped by category (cost, quality, efficiency) using a `MetricGrid` per group.

### RunsTable

Specialized table for displaying evolution runs with:
- **Budget visualization**: Color-coded progress bar showing iteration progress against the configured budget. Colors shift from green to yellow to red as budget is consumed.
- **Cost warning indicators**: Visual flags when a run's cost exceeds expected thresholds.
- **Status badges**: Inline `StatusBadge` (variant="run-status") for each run row.

### RegistryPage

Config-driven CRUD page used by the prompts and strategies admin pages. Built on top of `EntityListPage` with dialog orchestration:

- `RegistryPageConfig<T>` defines columns, filters, data loading, row actions, and header actions.
- `RowAction<T>` supports conditional visibility and danger styling for destructive operations.
- Integrates `FormDialog` (field-driven create/edit form) and `ConfirmDialog` (destructive action confirmation).

```typescript
// Simplified config for the prompts registry page
const config: RegistryPageConfig<Prompt> = {
  title: 'Evolution Prompts',
  columns: [...],
  filters: [...],
  loadData: (filters, page, pageSize) => fetchPrompts(filters, page, pageSize),
  rowActions: [
    { label: 'Edit', onClick: (row) => openEditDialog(row) },
    { label: 'Archive', onClick: (row) => confirmArchive(row), danger: true },
  ],
  headerAction: { label: 'Add Prompt', onClick: () => openCreateDialog() },
};
```

### LogsTab

Shared log viewer component (`evolution/src/components/evolution/tabs/LogsTab.tsx`) used on all 4 entity detail pages: run, experiment, strategy, and invocation.

Props:
- `entityType: EntityType` — `'run'`, `'experiment'`, `'strategy'`, or `'invocation'`
- `entityId: string` — UUID of the entity whose logs to display

Features:
- **Filter bar**: Two-row layout. Row 1: log level dropdown, entity type dropdown (hidden for invocation pages), iteration dropdown (values 1-20), phase/agent name text filter. Row 2: message text search (debounced 300ms), variant ID filter. All filters apply server-side via `getEntityLogsAction`.
- **Entity-type badges**: Color-coded badges (blue for run, purple for invocation, green for experiment, amber for strategy) in each log row showing which entity emitted the log.
- **Expandable context**: Clicking a log row toggles a JSON viewer for the `context` JSONB field.
- **Pagination**: Previous/Next pagination with 100 logs per page.
- **Aggregation**: For non-invocation entities, logs include all descendant entity logs (e.g., a run's logs tab shows both run-level and invocation-level logs).

Data is fetched via `getEntityLogsAction` from `evolution/src/services/logActions.ts`.

### EvolutionStatusBadge

Color-coded status pill used across all pages. Maps run/experiment status values to badge colors (e.g., green for completed, yellow for running, red for failed).

### Loading Skeletons

Each evolution route directory includes a `loading.tsx` file that renders a `TableSkeleton` component during page transitions. This reuses the shared `TableSkeleton` from `evolution/src/components/evolution/` to provide consistent loading states (animated placeholder rows) across all evolution list and detail pages.

---

## LineageGraph (D3 DAG Visualization)

The `LineageGraph` component (`evolution/src/components/evolution/visualizations/LineageGraph.tsx`) renders variant ancestry as a directed acyclic graph using D3.

**Key implementation details:**

- **Dynamic import**: D3 is loaded via `await import('d3')` inside the render callback. The component itself is loaded with `next/dynamic` with SSR disabled to avoid server-side DOM access.
- **Layered layout**: Nodes are grouped into horizontal layers by `iterationBorn`. Each layer is spaced vertically, and nodes within a layer are spaced horizontally.
- **Strategy colors**: Nodes are colored using `STRATEGY_PALETTE`, a map from strategy name to hex color, imported from `VariantCard`.
- **Tree search path highlighting**: When `treeSearchPath` is provided, edges along the winning path are rendered in gold with increased stroke width. Non-path edges use the default border color.
- **Zoom and pan**: D3 zoom behavior is attached to the SVG with scale extent `[0.3, 3]`.
- **Node selection**: Clicking a node sets `selectedNode` state, which can display a `VariantCard` overlay with details.

Data is fetched via `evolutionVisualizationActions.ts`, which returns `LineageData` containing `nodes` (with id, name, strategy, iterationBorn) and `edges` (source/target ID pairs).

---

## Server Action Architecture

### adminAction Factory

All admin data fetching flows through the `adminAction` factory defined in `evolution/src/services/adminAction.ts`. This factory wraps every server action with:

1. **Auth**: Calls `requireAdmin()` to verify the caller has admin privileges.
2. **Supabase client**: Creates a service-role client via `createSupabaseServiceClient()`.
3. **Context injection**: Passes an `AdminContext` object (`{ supabase, adminUserId }`) to the handler.
4. **Error handling**: Catches errors, categorizes them via `handleError()`, and returns a typed `ActionResult<T>`.
5. **Logging**: Wraps the action with `withLogging` for automatic request tracing.

```typescript
// From evolution/src/services/adminAction.ts
export function adminAction<I, T>(
  name: string,
  handler: (input: I, ctx: AdminContext) => Promise<T>,
): (input?: I) => Promise<ActionResult<T>>;
```

The factory detects handler arity: single-argument handlers receive only `ctx` (zero-input actions), while two-argument handlers receive `(input, ctx)`.

### Service Files

Nine service files define 50+ server actions total:

| File | Scope |
|---|---|
| `evolutionActions.ts` | Run CRUD, run control (start/stop/cancel) |
| `experimentActionsV2.ts` | Experiment CRUD, experiment-run linking |
| `arenaActions.ts` | Arena topics, entries, matches, leaderboards |
| `evolutionVisualizationActions.ts` | Lineage data, Elo history for graphs |
| `variantDetailActions.ts` | Variant detail, prompt text, parent chain |
| `invocationActions.ts` | Invocation list and detail |
| `strategyRegistryActionsV2.ts` | Strategy CRUD for the registry page |
| `costAnalytics.ts` | Cost aggregation and budget analysis |
| `logActions.ts` | Multi-entity log queries for the LogsTab component |
| `entityActions.ts` | Generic entity action dispatcher (`executeEntityAction`) |

### Pagination Pattern

List endpoints use Supabase range-based pagination:

```typescript
const { data, count } = await ctx.supabase
  .from('evolution_runs')
  .select('*', { count: 'exact' })
  .range(offset, offset + limit - 1)
  .order('created_at', { ascending: false });
```

Maximum page size is capped at 200 items. The `EntityListPage` component enforces a client-side cap of 100.

### Enrichment Pattern

Detail and list pages frequently need related data from multiple tables. The standard pattern is:

1. Fetch the primary list (e.g., runs).
2. Extract foreign key IDs (e.g., experiment IDs, variant IDs).
3. Batch-fetch related records using `.in('id', ids)`.
4. Merge results into a `Map<string, RelatedEntity>` for O(1) lookup during rendering.

This avoids N+1 queries while keeping the Supabase query interface simple.

---

## Data Fetching: Server Actions vs API Routes

The admin UI uses **server actions exclusively** for data fetching. There are no REST API routes for admin pages. This means:

- All data flows through `'use server'` functions invoked directly from client components.
- Auth is handled per-action via `adminAction`, not via middleware.
- Responses are typed end-to-end as `ActionResult<T>` (either `{ success: true, data: T }` or `{ success: false, error: ErrorResponse }`).

API routes exist only for external integrations (webhooks, public endpoints) and are not used by the admin UI. See [Reference](./reference.md) for the full API route inventory.

---

## Auto-Refresh

The `AutoRefreshProvider` (`evolution/src/components/evolution/AutoRefreshProvider.tsx`) provides synchronized polling for pages that display in-progress data (primarily the run detail page).

Key behaviors:
- **Refresh interval**: Configurable, typically 15 seconds for the dashboard and run detail pages.
- **Visibility awareness**: Polling pauses when the browser tab is not visible (using the Page Visibility API) and resumes when the tab regains focus.
- **Shared tick**: All child components consume a `refreshKey` from context. When the key increments, each component re-fetches its data independently.
- **Manual refresh**: The `triggerRefresh()` function allows explicit refresh (e.g., after a user action like cancelling a run).
- **Error reporting**: Components call `reportError(message)` on fetch failure, which displays a toast notification via Sonner.
- **Activation**: Controlled by the `isActive` prop. Typically set to `true` when the run status is `running` and `false` once the run completes.
