# Evolution Pipeline Visualization

## Overview
Visual monitoring and debugging tools for the evolution pipeline. Provides an operational dashboard, per-run timeline/Elo/lineage/budget analysis, and before/after text comparison. Built with Recharts for standard charts and D3.js for the variant lineage DAG.

## Pages

| Route | Purpose |
|-------|---------|
| `/admin/quality/evolution/dashboard` | Ops dashboard: stat cards, runs/spend trends, recent runs |
| `/admin/quality/evolution/run/[runId]` | Run detail: 5-tab deep dive (Timeline, Elo, Lineage, Budget, Variants) |
| `/admin/quality/evolution/run/[runId]/compare` | Before/after text diff, quality radar, stats summary |

## Key Files

### Components (`src/components/evolution/`)
| File | Purpose |
|------|---------|
| `EvolutionStatusBadge.tsx` | Reusable status badge for all 6 run statuses |
| `PhaseIndicator.tsx` | EXPANSION/COMPETITION phase display with iteration progress |
| `AutoRefreshProvider.tsx` | 15s polling context with tab visibility awareness |
| `EloSparkline.tsx` | Tiny inline Recharts sparkline for variant Elo trajectory |
| `VariantCard.tsx` | Compact variant info card + strategy color palette |
| `LineageGraph.tsx` | D3 DAG visualization with zoom/pan and click-to-inspect |
| `tabs/TimelineTab.tsx` | Iteration-by-iteration execution timeline |
| `tabs/EloTab.tsx` | Elo trajectory line chart with top-N filtering |
| `tabs/LineageTab.tsx` | Lineage DAG tab wrapper (dynamic import) |
| `tabs/BudgetTab.tsx` | Cumulative burn curve + agent cost breakdown |
| `tabs/VariantsTab.tsx` | Sortable variant table with sparklines |

### Server Actions (`src/lib/services/evolutionVisualizationActions.ts`)
6 read-only actions following the `withLogging + requireAdmin + serverReadRequestId` pattern:
1. `getEvolutionDashboardDataAction` — System-wide stats, runs/spend trends
2. `getEvolutionRunTimelineAction` — Per-iteration agent execution breakdown
3. `getEvolutionRunEloHistoryAction` — Elo rating trajectories from checkpoints
4. `getEvolutionRunLineageAction` — Variant parentage DAG from latest checkpoint
5. `getEvolutionRunBudgetAction` — Cumulative cost burn + agent breakdown
6. `getEvolutionRunComparisonAction` — Original vs winner text, quality scores

## Architecture Decisions
- **Checkpoint-only lineage**: DB `parent_variant_id` is never populated; lineage uses in-memory `TextVariation.parentIds` from checkpoint data
- **In-memory vs DB IDs**: Checkpoint variant IDs differ from DB UUIDs; lineage/Elo features operate entirely on checkpoint data
- **Auto-polling**: Only the dashboard page polls (15s). Other tabs load data once on selection
- **D3 + React hybrid**: D3 renders SVG via `useRef` + `useEffect`; React handles the side panel
- **SSR disabled**: All chart components use `next/dynamic` with `ssr: false`

## Dependencies
| Package | Purpose |
|---------|---------|
| `recharts` | Line, bar, area, radar charts |
| `d3` + `@types/d3` | DAG rendering, zoom/pan |
| `d3-dag` | Sugiyama layout (ESM-only, mocked in Jest) |
