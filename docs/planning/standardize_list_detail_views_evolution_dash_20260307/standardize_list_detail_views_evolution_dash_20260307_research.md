# Standardize List Detail Views Evolution Dash Research

## Problem Statement
The evolution dashboard has grown organically with 6 entity types (Experiment, Prompt, Strategy, Run, Agent Invocation, Variant), each with their own list and detail views built independently. This has led to inconsistent UI patterns, duplicated code, and no cross-linking between related entities. The goal is to standardize all list/detail views with shared components, add entity relationship headers with cross-links (per the entity diagram), and ensure metrics are prominently displayed across all views.

## Requirements (from GH Issue #666)
1. **Shared List Component**: Create a reusable list/table component used by all 6 entity list views (experiments, prompts, strategies, runs, invocations, variants) with consistent filtering, sorting, pagination, and empty states
2. **Shared Detail Header Component**: Create a reusable detail page header that shows:
   - Entity name/title and status badge
   - Cross-links to all related entities based on the entity relationship diagram:
     - Experiment -> Prompt, Runs
     - Prompt -> Experiments, Runs
     - Strategy -> Runs
     - Run -> Experiment, Prompt, Strategy, Invocations, Variants
     - Agent Invocation -> Run, Variants produced
     - Variant -> Run, Parent Variant, Child Variants
   - Key metrics for that entity prominently displayed
3. **Metrics Display**: Each entity's list and detail view should prominently display relevant metrics:
   - Experiment: total runs, completed count, total spend, best Elo
   - Prompt: run count, avg Elo, best Elo, difficulty tier
   - Strategy: run count, avg Elo, cost efficiency (Elo/$), agent selection
   - Run: status, cost, iteration count, winner Elo, variant count
   - Agent Invocation: agent type, cost, duration, variants produced, Elo delta
   - Variant: Elo rating, parent lineage depth, is_winner status, agent creator
4. **Consistent Styling**: Use design system tokens (Midnight Scholar theme) consistently across all views
5. **Breadcrumb Navigation**: Ensure EvolutionBreadcrumb covers all entity pages consistently
6. **Empty/Loading States**: Use shared TableSkeleton and EmptyState components across all list views

## High Level Summary

Research conducted over 3 rounds with 12 parallel agents. Key findings:

1. **6 entity list pages exist** with wildly inconsistent patterns: different table components, filter UIs, sorting approaches, pagination, and error handling
2. **7 entity detail pages exist** (6 + Arena topic) with no shared header component; each builds its own title/status/metrics layout
3. **Cross-entity linking is partial**: Run detail links to 3 entities (experiment, prompt, strategy) via inline badges, but most other pages have minimal cross-links
4. **RunsTable is 60% generic / 40% domain-specific** and could be generalized into an EntityTable, but requires refactoring BaseRun type contract
5. **Shared components already exist** (TableSkeleton, EmptyState, EvolutionStatusBadge, EvolutionBreadcrumb) but are used inconsistently
6. **Design system compliance is ~79%**: CSS variables used correctly, but shadows missing on detail headers, badge radius inconsistent, stat grid layouts vary
7. **All URL builders centralized** in evolutionUrls.ts (9 functions), making cross-link changes easy to propagate
8. **Server action data already includes cross-link IDs**: run data has experiment_id, prompt_id, strategy_config_id; variant data has run_id; invocation data has run_id
9. **Test coverage**: List pages all have basic tests, but 6/7 detail pages have NO tests

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- docs/docs_overall/design_style_guide.md

### Relevant Docs
- evolution/docs/evolution/visualization.md - all dashboard pages, components, server actions
- evolution/docs/evolution/architecture.md - pipeline phases, agent framework, data flow
- evolution/docs/evolution/data_model.md - entity primitives, relationships, migrations
- evolution/docs/evolution/README.md - documentation index, reading order
- evolution/docs/evolution/entity_diagram.md - 6 entities with FK relationships
- docs/feature_deep_dives/admin_panel.md - admin routes, sidebar, design patterns

## Code Files Read

### List Pages
- `src/app/admin/evolution/experiments/page.tsx` - card-based via ExperimentHistory, no direct table
- `src/app/admin/evolution/prompts/page.tsx` - custom HTML table, CRUD dialogs, expandable runs
- `src/app/admin/evolution/strategies/page.tsx` - 1049 LOC, richest page: sorting, filtering, expandable detail rows, CRUD dialogs
- `src/app/admin/evolution/runs/page.tsx` - delegates to RunsTable component
- `src/app/admin/evolution/invocations/page.tsx` - minimal custom table, limit:50, no pagination UI
- `src/app/admin/evolution/variants/page.tsx` - minimal custom table, limit:50, no pagination UI

### Detail Pages
- `src/app/admin/evolution/runs/[runId]/page.tsx` - 341 LOC, most complex: 5 tabs, auto-refresh, 3 cross-link badges, budget bar, phase indicator
- `src/app/admin/evolution/experiments/[experimentId]/page.tsx` - server component + client tabs, ExperimentOverviewCard
- `src/app/admin/evolution/strategies/[strategyId]/page.tsx` - 189 LOC, server component, 5-column stat grid, StrategyMetricsSection
- `src/app/admin/evolution/prompts/[promptId]/page.tsx` - client component, 4-column stat grid, run history table
- `src/app/admin/evolution/invocations/[invocationId]/page.tsx` - server-rendered, 4-column stat grid, variant diffs
- `src/app/admin/evolution/variants/[variantId]/page.tsx` - server-rendered, VariantOverviewCard, lineage, match history
- `src/app/admin/evolution/arena/[topicId]/page.tsx` - client component, leaderboard, scatter chart, text diff

### Shared Components
- `evolution/src/components/evolution/RunsTable.tsx` - 267 LOC, generic column pattern but BaseRun-coupled
- `evolution/src/components/evolution/TableSkeleton.tsx` - fully generic, configurable columns/rows
- `evolution/src/components/evolution/EmptyState.tsx` - fully generic, message/suggestion/icon/action
- `evolution/src/components/evolution/EvolutionStatusBadge.tsx` - 7 run statuses with color/icon mapping
- `evolution/src/components/evolution/EvolutionBreadcrumb.tsx` - generic items array with optional hrefs
- `evolution/src/components/evolution/ElapsedTime.tsx` - live duration display
- `evolution/src/components/evolution/EloSparkline.tsx` - tiny recharts line chart
- `evolution/src/components/evolution/AttributionBadge.tsx` - Elo attribution with z-score coloring
- `evolution/src/components/evolution/PhaseIndicator.tsx` - EXPANSION/COMPETITION phase display
- `evolution/src/components/evolution/VariantCard.tsx` - compact variant info with strategy color
- `evolution/src/components/evolution/StepScoreBar.tsx` - horizontal bar chart for step scores
- `evolution/src/components/evolution/agentDetails/shared.tsx` - StatusBadge, DetailSection, Metric, CostDisplay, ShortId, EloDeltaChip

### Navigation
- `src/components/admin/EvolutionSidebar.tsx` - 3 nav groups (Overview/Entities/Results), 10 items
- `src/components/admin/BaseSidebar.tsx` - shared sidebar with activeOverrides
- `src/components/admin/SidebarSwitcher.tsx` - pathname-based sidebar selection
- `evolution/src/lib/utils/evolutionUrls.ts` - 9 URL builders for all entity types

### Server Actions
- `evolution/src/services/experimentActions.ts` - listExperimentsAction, getExperimentStatusAction, getExperimentMetricsAction
- `evolution/src/services/promptRegistryActions.ts` - getPromptsAction, getPromptTitleAction
- `evolution/src/services/strategyRegistryActions.ts` - getStrategiesAction, getStrategyDetailAction
- `evolution/src/services/evolutionActions.ts` - getEvolutionRunsAction, getEvolutionRunByIdAction, getEvolutionRunSummaryAction
- `evolution/src/services/evolutionVisualizationActions.ts` - listInvocationsAction, listVariantsAction, getInvocationFullDetailAction, 14 total actions
- `evolution/src/services/variantDetailActions.ts` - getVariantFullDetailAction, parents, children, lineage, match history
- `evolution/src/services/costAnalyticsActions.ts` - getStrategyAccuracyAction, getCostAccuracyOverviewAction

## Key Findings

### 1. List View Inconsistencies
| Feature | Experiments | Prompts | Strategies | Runs | Invocations | Variants |
|---------|-------------|---------|------------|------|-------------|----------|
| Component | Card-based | HTML table | HTML table | RunsTable | HTML table | HTML table |
| Sorting | None | None | 4 fields | None | None | None |
| Filters | None | 1 (status) | 3 (status, pipeline, origin) | 2 (status, date) | 3 (run, agent, status) | 3 (run, agent, winner) |
| Pagination | None | None | None | None | limit:50 | limit:50 |
| Empty State | Spinner | EmptyState | EmptyState | EmptyState | EmptyState | EmptyState |
| Error Display | Internal | Banner+toast | Banner+toast | Banner | Toast only | Toast only |
| Row Expansion | Yes | Yes (runs) | Yes (detail) | No | No | No |

### 2. Detail View Header Patterns
All detail pages use a variation of this pattern but with no shared component:
- Title (h1) + status badge + ID
- Optional cross-link badges
- Stat grid (usually 4-column: `grid-cols-2 sm:grid-cols-4 gap-4`)
- Optional action buttons

Specific patterns per entity:
- **Run**: Most complex - 3 cross-link badges (experiment, prompt, strategy), budget bar, phase indicator, auto-refresh
- **Strategy**: 5-column stat grid, run history, aggregate metrics with CIs
- **Experiment**: Overview card with budget progress, factor table
- **Variant**: VariantOverviewCard with 4 stats, winner badge, attribution
- **Invocation**: 4-stat grid (iteration, cost, variants added, matches)
- **Prompt**: 4-stat grid (status, difficulty, created, tags)

### 3. Cross-Link Coverage
| From Entity | Links To | Currently Implemented |
|-------------|----------|----------------------|
| Experiment | Prompt, Runs | Prompt link in overview, runs in tab |
| Prompt | Arena, Runs, Explanations | Arena button, runs in table |
| Strategy | Runs | Runs in detail table |
| Run | Experiment, Prompt, Strategy | All 3 as inline badges |
| Invocation | Run, Variants | Run in breadcrumb, variants in diffs |
| Variant | Run, Explanation, Parents, Children | Run + explanation buttons, lineage section |

**Missing cross-links**: Strategy -> Experiments, Arena -> Experiments, Invocations -> Variant detail links

### 4. Metrics Available But Not Displayed
- **Experiment**: min/max Elo variance, per-iteration cost trajectory, convergence rate
- **Strategy**: Elo percentiles, cost variance, run success rate
- **Run**: agent-level cost breakdown (hidden in timeline tab), token usage
- **Variant**: Elo CI, Elo delta from parent, match win percentage
- **Invocation**: token counts, latency, model used
- **Prompt**: run success rate, average Elo improvement, cost per run average

### 5. Design System Compliance (79%)
- CSS variables: 98% compliant
- Border radius: 75% (mix of rounded-page, rounded-book, rounded-full on badges)
- Shadows: 45% (most detail header cards missing shadow-warm-lg)
- Fonts: 95% compliant
- Spacing: 85% (minor grid gap variations: gap-2, gap-3, gap-4)
- Surface tokens: 80% (confused surface-elevated vs surface-secondary)

### 6. RunsTable Generalization Assessment
RunsTable is 60% generic (column definitions, actions, row clicks, loading/empty states) and 40% run-specific (BaseRun type, getBaseColumns, hardcoded navigation). **Recommended approach**: Create new EntityTable component with same column pattern but generic BaseEntity type, then have RunsTable extend it.

### 7. Shared Component Inventory
Already reusable across all entities:
- `TableSkeleton` (columns, rows props)
- `EmptyState` (message, suggestion, icon, action props)
- `EvolutionBreadcrumb` (items array)
- `agentDetails/shared.tsx` → Metric, DetailSection, ShortId, StatusBadge, CostDisplay, EloDeltaChip

Need to create:
- `EntityDetailHeader` - shared header with title, status, cross-links, stat grid
- `EntityTable` - generic data table with column definitions, sorting, filtering, pagination
- `MetricCard` - consistent metric display (exists in strategies but not exported)
- `CrossLinkBadge` - inline entity link badge (pattern exists in run detail but not extracted)
- `FilterBar` - unified filter UI component

### 8. URL & Navigation Structure
- 9 URL builders in evolutionUrls.ts covering all entities
- EvolutionSidebar has all 6 entity list pages + Dashboard + Analysis + Arena + Start Experiment
- Prefix-based active state detection works for most entities
- Gap: Prompts sidebar item doesn't highlight when viewing prompt detail (no prefix matcher)

## Open Questions
1. Should prompt detail redirect to Arena topic, or should prompts have their own dedicated detail page?
2. How should the EntityTable handle entity-specific CRUD actions (strategies have edit/clone/archive, others are read-only)?
3. Should the shared detail header be a server or client component? (Run detail needs auto-refresh, others don't)
4. What's the priority order for standardizing entities? (Suggest: simplest first - invocations/variants, then prompts/strategies, then experiments/runs)
