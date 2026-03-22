# Evolution Visualization

Admin UI for managing and monitoring evolution experiments, runs, variants, and arena. Provides experiment management, operational dashboard, per-run metrics/rating/lineage analysis, and entity CRUD pages.

## Pages

| Route | Purpose |
|-------|---------|
| `/admin/evolution-dashboard` | Evolution overview: active runs, queue depth, costs, recent runs table |
| `/admin/evolution/runs` | Runs list: filter by status, archived toggle, cost and budget display |
| `/admin/evolution/runs/[runId]` | Run detail: tabs for Metrics, Elo, Lineage, Variants, Logs |
| `/admin/evolution/variants` | Variants list: filterable by agent name and winner status |
| `/admin/evolution/variants/[variantId]` | Variant detail: content, parent/child lineage, match history |
| `/admin/evolution/invocations` | Invocations list: agent name, iteration, cost, duration |
| `/admin/evolution/invocations/[invocationId]` | Invocation detail: execution_detail JSONB display |
| `/admin/evolution/strategies` | Strategy Registry: RegistryPage-based CRUD with clone, archive/delete |
| `/admin/evolution/strategies/[strategyId]` | Strategy detail: config display, aggregate metrics, run history |
| `/admin/evolution/prompts` | Prompt Registry: RegistryPage-based CRUD |
| `/admin/evolution/prompts/[promptId]` | Prompt detail: full text, metadata |
| `/admin/evolution/experiments` | Experiments list: status filter, run counts |
| `/admin/evolution/start-experiment` | Start Experiment: prompt + strategy + budget selection |
| `/admin/evolution/experiments/[experimentId]` | Experiment detail: overview, analysis, runs, report tabs |
| `/admin/evolution/arena` | Arena topics list: entry counts, status filter |
| `/admin/evolution/arena/[topicId]` | Arena topic: leaderboard sorted by elo_score |
| `/admin/evolution/arena/variants/[variantId]` | Arena variant detail: elo stats, variant_content, generation info |

## Key Files

### Shared UI Components (`evolution/src/components/evolution/`)

| File | Purpose |
|------|---------|
| `EvolutionStatusBadge.tsx` | Status badge for all run statuses |
| `AutoRefreshProvider.tsx` | Polling context (15s dashboard interval). Exports `AutoRefreshProvider`, `RefreshIndicator`, `useAutoRefresh()` |
| `EloSparkline.tsx` | Tiny inline sparkline for rating trajectory |
| `VariantCard.tsx` | Compact variant info card + strategy color palette |
| `LineageGraph.tsx` | D3 DAG visualization with zoom/pan and click-to-inspect |
| `TextDiff.tsx` | Word-level text diff component |
| `InputArticleSection.tsx` | Input variant display with strategy badge, Elo rating, text preview |
| `RunsTable.tsx` | Configurable runs table with strategy name, cost, budget columns |
| `ElapsedTime.tsx` | Live elapsed time display for running pipelines |
| `VariantDetailPanel.tsx` | Inline variant detail panel showing parent lineage and content preview |
| `tabs/MetricsTab.tsx` | Run metrics from `run_summary` JSONB: iterations, duration, match stats, top variants, strategy effectiveness, agent cost breakdown |
| `tabs/EloTab.tsx` | SVG line chart of mu history from `run_summary.muHistory` |
| `tabs/LineageTab.tsx` | Variant lineage DAG from `getEvolutionRunLineageAction` |
| `tabs/VariantsTab.tsx` | Sortable variant table with strategy filtering and content expansion |
| `variant/VariantContentSection.tsx` | Full variant content with optional parent diff toggle |
| `variant/VariantLineageSection.tsx` | Parent/child variant navigation with lineage chain |
| `variant/VariantMatchHistory.tsx` | Match results table for a variant |
| `RegistryPage.tsx` | Config-driven list page with CRUD dialog orchestration (strategies, prompts) |
| `FormDialog.tsx` | Reusable form dialog with configurable field types |
| `ConfirmDialog.tsx` | Confirmation dialog for destructive actions |
| `EntityDetailHeader.tsx` | Detail page header with title, entity ID, status badge, actions slot |
| `EntityDetailTabs.tsx` | Controlled tab bar with URL sync via useTabState hook |
| `EntityListPage.tsx` | List page: title, filter bar, table, pagination |
| `EntityTable.tsx` | Generic sortable table with ColumnDef[], clickable rows, sort indicators |
| `EvolutionBreadcrumb.tsx` | Breadcrumb navigation for evolution admin pages |
| `MetricGrid.tsx` | Metrics display grid with configurable columns, CI support |
| `EmptyState.tsx` | Empty state with message, icon, optional action |
| `TableSkeleton.tsx` | Table loading skeleton |
| `tabs/RelatedRunsTab.tsx` | Shared "Runs" tab for detail pages |

### Experiment Components (`src/app/admin/evolution/_components/`)

| File | Purpose |
|------|---------|
| `ExperimentForm.tsx` | Experiment creation form with prompt/strategy selection |
| `ExperimentHistory.tsx` | Experiment history list with Active/Archived/All filter |
| `ExperimentStatusCard.tsx` | Status card for experiment overview |
| `StrategyConfigDisplay.tsx` | Strategy config display with model/iterations info |

### Server Actions

**Experiments (`evolution/src/services/experimentActionsV2.ts`)**
7 V2 actions: createExperiment, addRunToExperiment, getExperiment, listExperiments, getPrompts, getStrategies, cancelExperiment.

**Visualization (`evolution/src/services/evolutionVisualizationActions.ts`)**
3 actions: getEvolutionDashboardData, getEvolutionRunEloHistory (from `run_summary.muHistory`), getEvolutionRunLineage (variant DAG).

**Run Management (`evolution/src/services/evolutionActions.ts`)**
11 actions for run CRUD, variant listing, cost breakdown (via `evolution_run_costs` view), and logs.

**Variant Detail (`evolution/src/services/variantDetailActions.ts`)**
5 actions: getVariantFullDetail, getVariantParents, getVariantChildren, getVariantMatchHistory, getVariantLineageChain.

**Arena (`evolution/src/services/arenaActions.ts`)**
7 actions for topic/entry listing and CRUD.

**Strategy Registry (`evolution/src/services/strategyRegistryActionsV2.ts`)**
7 actions for strategy CRUD with `hashStrategyConfig`.

**Prompt Registry (`evolution/src/services/promptRegistryActionsV2.ts`)**
6 actions for prompt CRUD on `evolution_prompts`.

**Invocations (`evolution/src/services/invocationActions.ts`)**
2 actions for paginated invocation listing and detail.

### Experiment Metrics (`v2/experiments.ts`)

- `createExperiment(name, promptId)` — Validates 1-200 chars, inserts experiment
- `addRunToExperiment()` — Transitions draft→running on first run, rejects completed/cancelled
- `computeExperimentMetrics()` — Aggregates maxElo, totalCost, per-run eloPerDollar from winner variants

## Architecture Decisions

- **V2 cost queries**: Uses `evolution_run_costs` view (SUM of invocation costs) and `get_run_total_cost` SQL function instead of stored `total_cost_usd` column
- **Run summary**: All metrics/elo/phase data comes from `run_summary` JSONB on `evolution_runs` — no checkpoint dependency
- **RegistryPage pattern**: Strategy and prompt CRUD pages use the generic `RegistryPage` component with `loadData` adapters
- **Auto-polling**: Dashboard polls at 15s intervals via `AutoRefreshProvider`
- **D3 + React hybrid**: D3 renders SVG via `useRef` + `useEffect`; React handles side panels
- **SSR disabled**: All chart components use `next/dynamic` with `ssr: false`

## Testing

Component unit tests:
- `EvolutionStatusBadge.test.tsx`, `AutoRefreshProvider.test.tsx`, `EloSparkline.test.tsx`, `LineageGraph.test.tsx`
- `EloTab.test.tsx`, `MetricsTab.test.tsx`, `VariantsTab.test.tsx`, `LineageTab.test.tsx`
- `EntityDetailHeader.test.tsx`, `MetricGrid.test.tsx`, `EntityTable.test.tsx`, `EntityListPage.test.tsx`
- `EntityDetailTabs.test.tsx`, `useTabState.test.tsx`, `RelatedRunsTab.test.tsx`
- `RegistryPage.test.tsx`, `FormDialog.test.tsx`, `ConfirmDialog.test.tsx`
- `RunsTable.test.tsx`, `VariantDetailPanel.test.tsx`, `VariantMatchHistory.test.tsx`

Page tests:
- `evolution-dashboard/page.test.tsx`, `runs/page.test.tsx`, `runs/[runId]/page.test.tsx`
- `variants/page.test.tsx`, `invocations/page.test.tsx`
- `arena/page.test.tsx`, `arena/[topicId]/page.test.tsx`, `arena/arenaBudgetFilter.test.ts`
- `strategies/page.test.tsx`, `prompts/page.test.tsx`
- `experiments/page.test.tsx`, `start-experiment/page.test.tsx`

Server action tests:
- `evolutionActions.test.ts`, `variantDetailActions.test.ts`, `arenaActions.test.ts`
- `strategyRegistryActionsV2.test.ts`, `promptRegistryActionsV2.test.ts`
- `evolutionVisualizationActions.test.ts`

## Related Documentation

- [Architecture](./architecture.md) — Pipeline orchestration and data flow
- [Operations Overview](./agents/overview.md) — V2 operations: generate, rank, evolve
- [Arena](./arena.md) — Arena integration from experiment pages
- [Cost Optimization](./cost_optimization.md) — Cost tracking and attribution
- [Reference](./reference.md) — Key files, database schema, testing
- [Strategy Experiments](./strategy_experiments.md) — Experiment framework
