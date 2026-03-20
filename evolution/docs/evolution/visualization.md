# Evolution Visualization

Admin UI for managing and monitoring evolution experiments. Provides experiment listing, detail views, and experiment creation.

## Pages

V2 has 3 admin pages (down from 15+ in V1):

| Route | Purpose |
|-------|---------|
| `/admin/evolution/experiments` | Experiment list: status filter, run counts, creation dates |
| `/admin/evolution/experiments/[experimentId]` | Experiment detail: overview card, analysis, runs tab, report tab |
| `/admin/evolution/start-experiment` | Create experiment: prompt selection, strategy config, budget |

All V1 pages have been removed: dashboard, runs, variants, invocations, strategies, prompts, arena, and compare pages.

## Experiment Detail Page

The experiment detail page (`experiments/[experimentId]/page.tsx`) provides:

- **ExperimentOverviewCard** — Experiment name, status, prompt, strategy, budget, creation date
- **ExperimentAnalysisCard** — Per-run distribution metrics: max Elo, total cost, Elo/$ efficiency
- **RunsTab** — List of runs with status, iterations, cost, stop reason
- **ReportTab** — Experiment report with summary and analysis

## Key Files

### Page Components (`src/app/admin/evolution/`)

| File | Purpose |
|------|---------|
| `experiments/page.tsx` | Experiment list page |
| `experiments/[experimentId]/page.tsx` | Experiment detail page |
| `experiments/[experimentId]/ExperimentDetailContent.tsx` | Detail page client content |
| `experiments/[experimentId]/ExperimentOverviewCard.tsx` | Overview card with metadata |
| `experiments/[experimentId]/ExperimentAnalysisCard.tsx` | Per-run metrics and analysis |
| `experiments/[experimentId]/RunsTab.tsx` | Runs listing tab |
| `experiments/[experimentId]/ReportTab.tsx` | Report tab |
| `start-experiment/page.tsx` | Experiment creation wizard |

### Shared Components (`src/app/admin/evolution/_components/`)

| File | Purpose |
|------|---------|
| `ExperimentForm.tsx` | Experiment creation form with prompt/strategy selection |
| `ExperimentHistory.tsx` | Experiment history list with Active/Archived/All filter |
| `ExperimentStatusCard.tsx` | Status card for experiment overview |
| `StrategyConfigDisplay.tsx` | Strategy config display with model/iterations info |

### Shared UI Components (`evolution/src/components/evolution/`)

Reusable Entity-based UI components used across experiment pages:

| File | Purpose |
|------|---------|
| `EntityDetailHeader.tsx` | Detail page header with title, entity ID, status badge, actions slot. Optional `onRename` for inline rename |
| `EntityDetailTabs.tsx` | Controlled tab bar with URL sync via useTabState hook |
| `EntityDetailPageClient.tsx` | Detail page client wrapper |
| `EntityListPage.tsx` | List page: title, filter bar, table, pagination |
| `EntityTable.tsx` | Generic sortable table with ColumnDef[], clickable rows, sort indicators |
| `EvolutionStatusBadge.tsx` | Status badge for run statuses |
| `EvolutionBreadcrumb.tsx` | Breadcrumb navigation for evolution admin pages |
| `MetricGrid.tsx` | Metrics display grid with configurable columns, CI support |
| `EmptyState.tsx` | Empty state with message, icon, optional action |
| `TableSkeleton.tsx` | Table loading skeleton |
| `StatusBadge.tsx` | Generic status badge |
| `ConfirmDialog.tsx` | Confirmation dialog |
| `FormDialog.tsx` | Form dialog wrapper |
| `RegistryPage.tsx` | Registry page layout |
| `agentDetails/AgentErrorBlock.tsx` | Error display for agent invocations |
| `tabs/RelatedRunsTab.tsx` | Shared "Runs" tab for detail pages |

### Server Actions (`evolution/src/services/experimentActionsV2.ts`)

7 V2 server actions (replacing 17+ V1 actions), all wrapped by `adminAction` factory:

1. `createExperimentAction` — Create experiment for a prompt
2. `addRunToExperimentAction` — Add run to experiment (auto-transitions draft→running)
3. `getExperimentAction` — Get experiment detail with runs and computed metrics
4. `listExperimentsAction` — List experiments with optional status filter
5. `getPromptsAction` — List active prompts for experiment creation
6. `getStrategiesAction` — List active strategies for experiment creation
7. `cancelExperimentAction` — Cancel experiment + bulk-fail pending/claimed/running runs via RPC

### Experiment Metrics (`v2/experiments.ts`)

- `createExperiment(name, promptId)` — Validates 1-200 chars, inserts experiment
- `addRunToExperiment()` — Transitions draft→running on first run, rejects completed/cancelled
- `computeExperimentMetrics()` — Aggregates maxElo, totalCost, per-run eloPerDollar from winner variants

## Testing

Page component tests:
- `experiments/page.test.tsx` — Experiment list page
- `experiments/[experimentId]/page.test.tsx` — Experiment detail page
- `experiments/[experimentId]/ExperimentDetailContent.test.tsx` — Detail content
- `experiments/[experimentId]/ExperimentOverviewCard.test.tsx` — Overview card
- `experiments/[experimentId]/ExperimentAnalysisCard.test.tsx` — Analysis card
- `experiments/[experimentId]/RunsTab.test.tsx` — Runs tab
- `experiments/[experimentId]/ReportTab.test.tsx` — Report tab
- `start-experiment/page.test.tsx` — Start experiment page

Shared component tests:
- `_components/ExperimentForm.test.tsx` — Experiment form
- `_components/ExperimentHistory.test.tsx` — Experiment history
- `_components/ExperimentStatusCard.test.tsx` — Status card
- `_components/StrategyConfigDisplay.test.tsx` — Strategy config display

## Dependencies

| Package | Purpose |
|---------|---------|
| `recharts` | Charts (if used by analysis cards) |

## Related Documentation

- [Architecture](./architecture.md) — Pipeline orchestration and data flow
- [Operations Overview](./agents/overview.md) — V2 operations: generate, rank, evolve
- [Arena](./arena.md) — Arena integration from experiment pages
- [Cost Optimization](./cost_optimization.md) — Cost tracking and attribution
- [Reference](./reference.md) — Key files, database schema, testing
