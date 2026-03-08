# Standardize List Detail Views Evolution Dash Plan

## Background
The evolution dashboard has grown organically with 6 entity types (Experiment, Prompt, Strategy, Run, Agent Invocation, Variant), each with their own list and detail views built independently. This has led to inconsistent UI patterns, duplicated code, and no cross-linking between related entities. The goal is to standardize all list/detail views with shared components, add entity relationship headers with cross-links (per the entity diagram), and ensure metrics are prominently displayed across all views.

## Requirements (from GH Issue #666)
1. **Shared Detail Header Component**: Create a reusable detail page header with cross-link badges to all related entities per the entity diagram
2. **Cross-link badges**: Reuse the existing badge pattern from the run detail page (the `text-xs border rounded-page px-2 py-0.5` links)
3. **Metrics prominently displayed**: Each detail header shows key metrics in a consistent stat grid
4. **Test coverage**: Add tests for all 6 detail pages (currently only prompt detail has tests)

## Problem
Each detail page independently implements its own header with title, status, metrics, and navigation links. The run detail page has the best cross-linking pattern (3 inline badge links to experiment, prompt, strategy), but no other page reuses this pattern. Five out of six detail pages have zero test coverage. There is no shared component for the detail header, so each page duplicates the same layout structure with subtle inconsistencies (different stat grid columns, different badge styles, missing shadows).

## Options Considered

### Option A: Extract EntityDetailHeader component (CHOSEN)
Create a shared `EntityDetailHeader` component that accepts:
- Title, subtitle, entity ID
- Status badge (render prop)
- Related entity links (array of badge configs)
- Stat grid items (array of label/value pairs)
- Optional action buttons

**Pros**: Maximum reuse, consistent styling, easy to add cross-links
**Cons**: Some entities have unique header needs (run has budget bar, experiment has progress bar)

### Option B: Just extract CrossLinkBadge + MetricGrid as primitives
Extract smaller building blocks and let each page compose them.

**Pros**: More flexible, less risk of breaking existing layouts
**Cons**: Less standardization, pages still diverge

### Decision: Option A with escape hatches
Use EntityDetailHeader for the common structure, but allow `children` slot for entity-specific content (budget bars, phase indicators, etc.).

## Phased Execution Plan

### Phase 1: Create shared components

#### 1a. `EntityDetailHeader` at `evolution/src/components/evolution/EntityDetailHeader.tsx`
- Props: `title`, `entityId?`, `statusBadge?` (ReactNode), `links?` (array of `{prefix, label, href}`), `actions?` (ReactNode)
- **No metrics, no children slot** — metrics and entity-specific widgets (budget bar, progress bar) live in the Overview tab
- Badge styling reuses exact pattern from run detail: `text-xs text-[var(--text-muted)] hover:text-[var(--accent-gold)] border border-[var(--border-default)] rounded-page px-2 py-0.5`
- Card wrapper: `bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 space-y-4 shadow-warm-lg`
- Unit tests: `EntityDetailHeader.test.tsx`

#### 1b. `MetricGrid` at `evolution/src/components/evolution/MetricGrid.tsx`
Shared metrics display component replacing 4 inconsistent patterns: `StatCell` (strategy detail), `MetricCard` (StrategyMetricsSection), `Metric` (agentDetails/shared.tsx), and inline divs (experiment overview).

**Props:**
```tsx
interface MetricItem {
  label: string;
  value: ReactNode;
  ci?: [number, number];       // optional confidence interval
  n?: number;                  // sample size (shows * warning when n=2)
  prefix?: string;             // e.g. "$" prepended to numeric values
}

interface MetricGridProps {
  metrics: MetricItem[];
  columns?: 2 | 3 | 4 | 5;    // grid columns, default 4
  variant?: 'default' | 'card'; // 'card' adds bg + padding per cell (like MetricCard)
  testId?: string;
}
```

**Layout:**
- `variant="default"`: simple label/value stacked divs in a CSS grid (replaces StatCell + inline divs)
- `variant="card"`: each cell gets `p-3 bg-[var(--surface-elevated)] rounded-page` (replaces MetricCard)
- Both variants: label is `text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide`, value is `text-sm font-mono text-[var(--text-primary)]`
- CI display: `[low, high]` in muted text after value, with `*` warning when n=2
- Responsive: `grid-cols-2 sm:grid-cols-{columns}`

**Usage examples:**
```tsx
// Strategy detail header (replaces 5 StatCell divs)
<MetricGrid columns={5} metrics={[
  { label: 'Runs', value: strategy.run_count },
  { label: 'Avg Elo', value: avgElo.toFixed(0) },
  { label: 'Total Cost', value: totalCost.toFixed(2), prefix: '$' },
  { label: 'Avg $/Run', value: avgCost.toFixed(3), prefix: '$' },
  { label: 'Created By', value: strategy.created_by ?? 'system' },
]} />

// StrategyMetricsSection aggregate (replaces MetricCard grid)
<MetricGrid variant="card" columns={3} metrics={[
  { label: 'Max Elo', value: agg.maxElo?.value, ci: agg.maxElo?.ci, n: agg.maxElo?.n },
  { label: 'Avg Cost', value: agg.cost?.value, ci: agg.cost?.ci, prefix: '$' },
  ...
]} />

// Run detail (MetricGrid for stats, BudgetBar + PhaseIndicator in children slot)
<MetricGrid columns={4} metrics={[
  { label: 'Cost', value: formatCost(run.total_cost_usd), prefix: '$' },
  { label: 'Iteration', value: `${run.current_iteration}/${maxIterations}` },
  { label: 'Variants', value: variantCount },
  { label: 'Duration', value: formatDuration(run.started_at) },
]} />

// Experiment overview (replaces inline divs)
<MetricGrid columns={4} metrics={[
  { label: 'Runs', value: `${completed}/${total}` },
  { label: 'Convergence', value: convergenceThreshold },
  { label: 'Created', value: new Date(createdAt).toLocaleDateString() },
]} />
```

- Unit tests: `MetricGrid.test.tsx`
- After integration, delete: `StatCell` from strategy detail, `MetricCard` from StrategyMetricsSection (keep CIBadge logic in MetricGrid), update `Metric` in agentDetails/shared.tsx to re-export or alias

#### 1c. `EntityTable` at `evolution/src/components/evolution/EntityTable.tsx`
Low-level table component reusable in **both** overview list pages and detail page child sections. No expandable rows — rows link to detail pages.

**Props:**
```tsx
interface ColumnDef<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  render: (item: T) => ReactNode;
}

interface EntityTableProps<T> {
  columns: ColumnDef<T>[];
  items: T[];
  loading?: boolean;
  getRowHref?: (item: T) => string;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  emptyMessage?: string;
  emptySuggestion?: string;
  testId?: string;
}
```

**Features:**
- Renders `<table>` with sortable column headers (▲/▼ indicators)
- Rows are clickable links via `getRowHref` — no expandable rows
- Reuses `TableSkeleton` for loading, `EmptyState` for empty
- Hover state: `hover:bg-[var(--surface-secondary)]`
- Design system: `text-xs font-ui`, muted header text, mono values
- Unit tests: `EntityTable.test.tsx`

#### 1d. `EntityListPage` at `evolution/src/components/evolution/EntityListPage.tsx`
Full overview page component that wraps `EntityTable` with title, filters, pagination. Used by top-level list pages (e.g. `/admin/evolution/runs`).

**Props:**
```tsx
interface FilterDef {
  key: string;
  label: string;
  type: 'select' | 'text';
  options?: { value: string; label: string }[];  // for select filters
  placeholder?: string;                           // for text filters
}

interface EntityListPageProps<T> {
  title: string;
  filters?: FilterDef[];
  columns: ColumnDef<T>[];           // passed through to EntityTable
  items: T[];
  loading: boolean;
  totalCount?: number;
  filterValues?: Record<string, string>;
  onFilterChange?: (key: string, value: string) => void;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  getRowHref?: (item: T) => string;
  actions?: ReactNode;                // e.g. "Create Strategy" button
  emptyMessage?: string;
  emptySuggestion?: string;
}
```

**Layout:**
```
┌──────────────────────────────────────────────┐
│ Title (h1)                     [Action btn]  │
│ "123 items"                                  │
├──────────────────────────────────────────────┤
│ [Filter 1 ▾]  [Filter 2 ▾]  [Search____]   │
├──────────────────────────────────────────────┤
│              <EntityTable />                 │
├──────────────────────────────────────────────┤
│              ◀ 1 2 3 ... 5 ▶                │
└──────────────────────────────────────────────┘
```

**Key decisions:**
- Composes `EntityTable` internally — all table logic lives in one place
- Filter bar renders select or text inputs from `FilterDef[]` array
- Pagination: simple prev/next + page numbers, controlled by parent
- Card wrapper: `bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book shadow-warm-lg`
- Unit tests: `EntityListPage.test.tsx`

#### 1e. `EntityDetailTabs` at `evolution/src/components/evolution/EntityDetailTabs.tsx`
Shared tab bar for detail pages. All child entity sections live in tabs — no inline sections below the header. Extracts the duplicated tab pattern from run detail and experiment detail.

**Props:**
```tsx
interface TabDef {
  id: string;
  label: string;
}

interface EntityDetailTabsProps {
  tabs: TabDef[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  children: ReactNode;          // parent renders active tab content
}
```

**Styling:** Reuses exact pattern from run detail + experiment tabs:
```
flex gap-1 border-b border-[var(--border-default)]
Active:   text-[var(--accent-gold)] border-b-2 border-[var(--accent-gold)]
Inactive: text-[var(--text-muted)] hover:text-[var(--text-secondary)]
```

No count badges on tabs — counts are already shown in MetricGrid to avoid duplication.

- Unit tests: `EntityDetailTabs.test.tsx`

#### 1f. Standard detail page layout
Every detail page follows this structure — header is identity only, **everything else lives in tabs**, starting with Overview:

```
┌──────────────────────────────────────────────┐
│ <EntityDetailHeader />                       │
│   Title, status badge, cross-link badges     │
├──────────────────────────────────────────────┤
│ <EntityDetailTabs />                         │
│  [▪Overview ]  [ Tab B ]  [ Tab C ]         │
├──────────────────────────────────────────────┤
│ Active tab content                           │
└──────────────────────────────────────────────┘
```

Every entity has **Overview as the first/default tab**. Overview always contains MetricGrid + entity-specific summary widgets. Other tabs contain child entity tables or specialized views.

**Tabs per entity:**

| Entity | Overview tab content | Other tabs |
|--------|---------------------|------------|
| **Run** | MetricGrid (Cost, Iteration, Variants, Duration) + BudgetBar + PhaseIndicator + ETA | Metrics (MetricGrid only), Timeline, Rating, Variants, Lineage, Logs |
| **Strategy** | MetricGrid (Runs, Avg Elo, Total Cost, Avg $/Run, Created By) + description | Config, Metrics (StrategyMetricsSection with CIs), Runs |
| **Experiment** | MetricGrid (Runs completed/total, Budget, Convergence, Created) + progress bar + factors table | Analysis, Runs, Report, Logs |
| **Prompt** | MetricGrid (Status, Difficulty, Created, Tags) + prompt text preview | Content, Runs |
| **Variant** | MetricGrid (Elo, Agent, Generation, Matches) + content preview | Content, Match History, Lineage |
| **Invocation** | MetricGrid (Iteration, Cost, Variants Added, Matches Played) + error message | Variants Produced, Execution Detail, Logs |

Child entity tabs use shared tab components where possible, or `EntityTable` directly for entity-specific lists. Specialized views (charts, diffs, lineage trees) remain as custom components.

#### 1g. `RelatedRunsTab` at `evolution/src/components/evolution/tabs/RelatedRunsTab.tsx`
Shared "Runs" tab used on 3 detail pages (Strategy, Experiment, Prompt). Fetches and displays runs related to a parent entity using `EntityTable`.

**Props:**
```tsx
interface RelatedRunsTabProps {
  strategyId?: string;      // filter by strategy
  experimentId?: string;    // filter by experiment
  promptId?: string;        // filter by prompt
}
```

Exactly one filter prop should be provided. Internally:
- `strategyId` → calls `getStrategyRunsAction(strategyId, 50)`
- `experimentId` → calls `getExperimentRunsAction({ experimentId })`
- `promptId` → calls `getEvolutionRunsAction({ promptId })` (or existing prompt runs fetch)

**Standard columns** (superset — all shown unless data unavailable):
- Run ID (linked via `buildRunUrl`), Status (colored badge), Elo, Cost, Iterations, Created
- Optional context columns shown per parent: Topic (strategy), Strategy (experiment), Explanation (prompt)

Replaces: `RunsTab` in experiment detail, inline runs table in strategy detail, inline runs table in prompt detail.

- Unit tests: `RelatedRunsTab.test.tsx`

#### 1h. `RelatedVariantsTab` at `evolution/src/components/evolution/tabs/RelatedVariantsTab.tsx`
Shared "Variants" tab used on 2 detail pages (Run, Invocation). Fetches and displays variants related to a parent entity using `EntityTable`.

**Props:**
```tsx
interface RelatedVariantsTabProps {
  runId?: string;           // filter by run
  invocationId?: string;    // filter by invocation
}
```

Exactly one filter prop should be provided. Internally:
- `runId` → calls `listVariantsAction({ runId })`
- `invocationId` → uses variants from invocation detail data

**Standard columns:**
- Variant ID (linked via `buildVariantDetailUrl`), Agent, Elo, Generation, Winner (badge), Created
- Optional: Elo Delta (for invocation context)

Replaces: `VariantsTab` in run detail, variant diffs list in invocation detail.

- Unit tests: `RelatedVariantsTab.test.tsx`

**Example usage:**
```tsx
// Strategy detail
<EntityDetailHeader title={strategy.name} statusBadge={<StatusBadge status={strategy.status} />} />
<EntityDetailTabs tabs={[
  { id: 'overview', label: 'Overview' },
  { id: 'config', label: 'Config' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'runs', label: 'Runs' },
]} activeTab={activeTab} onTabChange={setActiveTab}>
  {activeTab === 'overview' && (
    <>
      <MetricGrid columns={5} metrics={[
        { label: 'Runs', value: strategy.run_count },
        { label: 'Avg Elo', value: avgElo.toFixed(0) },
        { label: 'Total Cost', value: totalCost.toFixed(2), prefix: '$' },
        { label: 'Avg $/Run', value: avgCost.toFixed(3), prefix: '$' },
        { label: 'Created By', value: strategy.created_by ?? 'system' },
      ]} />
      {strategy.description && <p>{strategy.description}</p>}
    </>
  )}
  {activeTab === 'config' && <StrategyConfigDisplay config={strategy.config} />}
  {activeTab === 'metrics' && <StrategyMetricsSection strategyConfigId={id} />}
  {activeTab === 'runs' && <RelatedRunsTab strategyId={id} />}
</EntityDetailTabs>

// Run detail
<EntityDetailHeader
  title={`Run ${id.substring(0,8)}`}
  links={[
    { prefix: 'Experiment', label: experimentName, href: buildExperimentUrl(run.experiment_id) },
    { prefix: 'Prompt', label: promptTitle, href: buildArenaTopicUrl(run.prompt_id) },
    { prefix: 'Strategy', label: strategy.label, href: buildStrategyUrl(run.strategy_config_id) },
  ]}
  statusBadge={<EvolutionStatusBadge status={run.status} />}
  actions={<Link href={`...compare`}>Compare</Link>}
/>
<EntityDetailTabs tabs={[
  { id: 'overview', label: 'Overview' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'rating', label: 'Rating' },
  { id: 'lineage', label: 'Lineage' },
  { id: 'variants', label: 'Variants' },
  { id: 'logs', label: 'Logs' },
]} activeTab={activeTab} onTabChange={setActiveTab}>
  {activeTab === 'overview' && (
    <>
      <MetricGrid columns={4} metrics={[
        { label: 'Cost', value: formatCost(run.total_cost_usd) },
        { label: 'Iteration', value: `${run.current_iteration}/${max}` },
        { label: 'Variants', value: variantCount },
        { label: 'Duration', value: formatDuration(run.started_at) },
      ]} />
      <BudgetBar spent={run.total_cost_usd} budget={run.budget_cap_usd} />
      <PhaseIndicator phase={run.phase} iteration={run.current_iteration} maxIterations={max} />
    </>
  )}
  {activeTab === 'timeline' && <TimelineTab runId={id} />}
  {activeTab === 'rating' && <EloTab runId={id} />}
  {activeTab === 'lineage' && <LineageTab runId={id} />}
  {activeTab === 'variants' && <RelatedVariantsTab runId={id} />}
  {activeTab === 'logs' && <LogsTab runId={id} />}
</EntityDetailTabs>
```

### Phase 2: Integrate shared components into each entity + add tests

#### Detail pages
For each entity, replace the inline header with `EntityDetailHeader` and add cross-link badges:

**2a. Variant detail** (`variants/[variantId]/page.tsx`)
- Header: title, links (Run, Invocation, Explanation, Parent Variant if exists), status badge, winner/attribution badges
- Overview: MetricGrid (Elo, Agent, Generation, Matches) + content preview (truncated)
- Tabs: Overview, Content, Match History (EntityTable replacing VariantMatchHistory inline table), Lineage
- Add page test

**2b. Invocation detail** (`invocations/[invocationId]/page.tsx`)
- Header: title (agent name), links (Run, Experiment, Prompt — derived from run data), status badge
- Overview: MetricGrid (Iteration, Cost, Variants Added, Matches Played) + error message if any
- Tabs: Overview, Variants Produced (RelatedVariantsTab), Execution Detail, Logs
- Logs tab: reuse existing `LogsTab` pre-filtered with `runId`, `initialAgent`, `initialIteration` from invocation data (no new server action needed)
- Add page test

**2c. Prompt detail** (`prompts/[promptId]/page.tsx`)
- Header: title (no links — all relationships are 1:N)
- Overview: MetricGrid (Status, Difficulty, Created, Tags) + prompt text preview (truncated)
- Tabs: Overview, Content (full prompt text), Runs (RelatedRunsTab)
- Update existing test

**2d. Strategy detail** (`strategies/[strategyId]/page.tsx`)
- Header: title, status badge
- Overview: MetricGrid (Runs, Avg Elo, Total Cost, Avg $/Run, Created By) + description
- Tabs: Overview, Config (StrategyConfigDisplay), Metrics (StrategyMetricsSection — refactor to use MetricGrid variant="card" for aggregate cards + EntityTable for per-run table), Runs (RelatedRunsTab)
- Add page test

**2e. Experiment detail** (`experiments/[experimentId]/page.tsx`)
- Header: title, links (Prompt), status badge, cancel button in actions
- Overview: MetricGrid (Runs completed/total, Budget, Convergence, Created) + progress bar + factors table
- Tabs: Overview, Analysis (refactor ExperimentAnalysisCard to use MetricGrid for summary cards), Runs (RelatedRunsTab), Report, Logs
- Logs tab: new `getExperimentLogsAction(experimentId, filters)` server action that JOINs `evolution_run_logs` through `evolution_runs` WHERE `experiment_id = ?`. Reuse `LogsTab` with new `experimentId` prop + add Run ID column to log entries for context.
- Add page test

**2f. Run detail** (`runs/[runId]/page.tsx`)
- Header: title, links (Experiment, Prompt, Strategy), status badge, compare button in actions
- Overview: MetricGrid (Cost, Iteration, Variants, Duration) + BudgetBar + PhaseIndicator + ETA
- Tabs: Overview, Metrics (MetricGrid only), Timeline, Rating, Variants (RelatedVariantsTab), Lineage, Logs
- Add page test

#### List pages
For each entity, replace the inline list/table with `EntityListPage`. Remove all expandable row patterns — link to detail pages instead.

**2g. Runs list** (`runs/page.tsx`)
- Filters: Status (select), Date range (select)
- Columns: Explanation, Status, Phase, Iteration, Cost, Duration, Created
- Sort: Created (default desc), Cost, Iteration
- Row link: `buildRunUrl(run.id)`
- Pagination: yes (replace unbounded load)

**2h. Invocations list** (`invocations/page.tsx`)
- Filters: Run ID (text), Agent (text), Status (select: All/Success/Failed)
- Columns: Run, Agent, Iteration, Status, Cost, Variants, Created
- Sort: Created (default desc), Cost
- Row link: `buildInvocationUrl(inv.id)`
- Pagination: yes (replace limit:50)

**2i. Variants list** (`variants/page.tsx`)
- Filters: Run ID (text), Agent (text), Winner (select: All/Winners/Non-winners)
- Columns: Run, Agent, Elo, Generation, Winner, Created
- Sort: Elo (default desc), Created
- Row link: `buildVariantDetailUrl(v.id)`
- Pagination: yes (replace limit:50)

**2j. Strategies list** (`strategies/page.tsx`)
- Filters: Status (select: All/Active/Archived), Created By (select: All/System/Admin/Experiment/Batch)
- Columns: Name, Status, Runs, Avg Elo, Total Cost, Created By, Created
- Sort: Created (default desc), Avg Elo, Total Cost, Runs
- Row link: `buildStrategyUrl(s.id)`
- Actions: Create Strategy button
- Remove: expandable detail rows, inline edit dialogs (use detail page instead)
- Pagination: yes

**2k. Experiments list** (`experiments/page.tsx`)
- Filters: Status (select)
- Columns: Prompt, Status, Runs (completed/total), Budget, Best Elo, Created
- Sort: Created (default desc)
- Row link: `buildExperimentUrl(e.id)`
- Remove: card-based ExperimentHistory layout, replace with table
- Pagination: yes

**2l. Prompts list** (`prompts/page.tsx`)
- Filters: Status (select)
- Columns: Title, Status, Difficulty, Runs, Avg Elo, Created
- Sort: Created (default desc), Avg Elo
- Row link: `buildPromptUrl(p.id)`
- Remove: expandable runs rows, inline CRUD dialogs
- Pagination: yes

### Phase 3: Cleanup, export, and docs

#### Components replaced by standardized equivalents (delete or refactor):
- `StatCell` in strategy detail page → replaced by MetricGrid
- `MetricCard` + `CIBadge` in StrategyMetricsSection → replaced by MetricGrid variant="card"
- `Metric` in agentDetails/shared.tsx → re-export from MetricGrid or alias
- `VariantOverviewCard` → replaced by EntityDetailHeader + MetricGrid in Overview tab
- `VariantMatchHistory` inline table → replaced by EntityTable
- `ExperimentDetailTabs` → replaced by EntityDetailTabs
- `RunsTab` in experiment detail → replaced by RelatedRunsTab
- Run detail custom tab bar (lines 272-287) → replaced by EntityDetailTabs
- `ExperimentAnalysisCard` summary cards → refactor to use MetricGrid
- StrategyMetricsSection per-run table → refactor to use EntityTable
- Strategy detail inline Run History table → replaced by RelatedRunsTab
- Prompt detail inline Run History table → replaced by RelatedRunsTab

#### Export from barrel + update docs

## Testing

### New test files to create:
- `evolution/src/components/evolution/EntityDetailHeader.test.tsx` - shared component tests
- `evolution/src/components/evolution/MetricGrid.test.tsx` - shared metrics component tests
- `evolution/src/components/evolution/EntityTable.test.tsx` - shared table component tests
- `evolution/src/components/evolution/EntityListPage.test.tsx` - shared list page component tests
- `evolution/src/components/evolution/EntityDetailTabs.test.tsx` - shared tab bar tests
- `evolution/src/components/evolution/tabs/RelatedRunsTab.test.tsx` - shared runs tab tests
- `evolution/src/components/evolution/tabs/RelatedVariantsTab.test.tsx` - shared variants tab tests
- `src/app/admin/evolution/variants/[variantId]/page.test.tsx` - variant detail page
- `src/app/admin/evolution/invocations/[invocationId]/page.test.tsx` - invocation detail page
- `src/app/admin/evolution/strategies/[strategyId]/page.test.tsx` - strategy detail page
- `src/app/admin/evolution/experiments/[experimentId]/page.test.tsx` - experiment detail page
- `src/app/admin/evolution/runs/[runId]/page.test.tsx` - run detail page

### Test pattern (following existing prompt detail test):
- Mock `next/navigation` (useRouter, useParams, useSearchParams)
- Mock server actions with fixture data
- Test: renders title, renders breadcrumb, renders cross-link badges with correct hrefs, renders metrics, renders entity-specific content

### Update existing test:
- `src/app/admin/evolution/prompts/[promptId]/page.test.tsx` - add cross-link badge assertions

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/visualization.md` - Add EntityDetailHeader to component list
- `evolution/docs/evolution/entity_diagram.md` - Note that cross-links are now implemented in UI
- `docs/feature_deep_dives/admin_panel.md` - Update component patterns section
