# Evolution Pipeline Visualization

## Overview
Visual monitoring and debugging tools for the evolution pipeline. Provides an operational dashboard, per-run timeline/rating/lineage/budget analysis, and before/after text comparison. Built with Recharts for standard charts and D3.js for the variant lineage DAG. Rating data uses OpenSkill ordinal values (mu - 3*sigma), mapped to the legacy 0-3000 Elo scale for display via `ordinalToEloScale()`.

## Pages

| Route | Purpose |
|-------|---------|
| `/admin/quality/evolution` | Run management: queue new runs, filter by status/date, variant panel, apply winner, rollback, cost/quality charts |
| `/admin/quality/evolution/dashboard` | Ops dashboard: stat cards, runs/spend trends, recent runs |
| `/admin/quality/evolution/run/[runId]` | Run detail: 5-tab deep dive (Timeline, Elo, Lineage, Budget, Variants) + Add to Bank dialog |
| `/admin/quality/evolution/run/[runId]/compare` | Before/after text diff, quality radar, stats summary (includes generationDepth) |

## Key Files

### Components (`src/components/evolution/`)
| File | Purpose |
|------|---------|
| `EvolutionStatusBadge.tsx` | Reusable status badge for all 6 run statuses |
| `PhaseIndicator.tsx` | EXPANSION/COMPETITION phase display with iteration progress |
| `AutoRefreshProvider.tsx` | 15s polling context with tab visibility awareness. Exports `AutoRefreshProvider`, `RefreshIndicator` component, and `useAutoRefresh()` hook. Supports AbortController for in-flight request cancellation |
| `EloSparkline.tsx` | Tiny inline Recharts sparkline for variant rating trajectory (displays ordinal mapped to Elo scale) |
| `VariantCard.tsx` | Compact variant info card + strategy color palette |
| `LineageGraph.tsx` | D3 DAG visualization with zoom/pan and click-to-inspect |
| `tabs/TimelineTab.tsx` | Iteration-by-iteration execution timeline |
| `tabs/EloTab.tsx` | Rating trajectory line chart with top-N filtering (ordinal values mapped to Elo scale) |
| `tabs/LineageTab.tsx` | Lineage DAG tab wrapper (dynamic import) |
| `tabs/BudgetTab.tsx` | Cumulative burn curve + agent cost breakdown |
| `tabs/VariantsTab.tsx` | Sortable variant table with sparklines |

### Server Actions (`src/lib/services/evolutionVisualizationActions.ts`)
6 read-only actions following the `withLogging + requireAdmin + serverReadRequestId` pattern:
1. `getEvolutionDashboardDataAction` — System-wide stats, runs/spend trends
2. `getEvolutionRunTimelineAction` — Per-iteration agent execution breakdown
3. `getEvolutionRunEloHistoryAction` — Rating trajectories from checkpoints (reads both new `ratings` and legacy `eloRatings` snapshot formats)
4. `getEvolutionRunLineageAction` — Variant parentage DAG from latest checkpoint
5. `getEvolutionRunBudgetAction` — Cumulative cost burn + agent breakdown
6. `getEvolutionRunComparisonAction` — Original vs winner text, quality scores, `generationDepth` (max variant version in pool)

Additionally, the run detail page uses `getEvolutionRunSummaryAction(runId)` from `evolutionActions.ts` to display the validated `EvolutionRunSummary` (stop reason, Elo/diversity history, match stats, baseline rank).

### Run Detail Features
- **Add to Bank dialog**: Modal on the run detail page that exports the winner variant (and optionally the baseline) to the article bank. Prompts for a topic description and calls `addToBankAction()`.
- **Compare button**: Links to the `/compare` sub-route for before/after text diff with quality radar and generation depth.

## Architecture Decisions
- **Checkpoint-first lineage**: Lineage visualization uses in-memory `TextVariation.parentIds` from checkpoint data. DB `parent_variant_id` is now populated by the local CLI runner (`run-evolution-local.ts`) which preserves pipeline-generated variant UUIDs on insert, but production runs via `evolution-runner.ts` may still have NULL parent IDs
- **In-memory vs DB IDs**: Checkpoint variant IDs differ from DB UUIDs; lineage/Elo features operate entirely on checkpoint data
- **Auto-polling**: Only the dashboard page polls (15s). Other tabs load data once on selection
- **D3 + React hybrid**: D3 renders SVG via `useRef` + `useEffect`; React handles the side panel
- **SSR disabled**: All chart components use `next/dynamic` with `ssr: false`

## Testing

Component unit tests (21 total):
- `EvolutionStatusBadge.test.tsx` — 7 tests (status style mapping)
- `AutoRefreshProvider.test.tsx` — 6 tests (polling, visibility pause, manual refresh)
- `EloSparkline.test.tsx` — 4 tests (sparkline rendering)
- `LineageGraph.test.tsx` — 4 tests (DAG rendering, node selection)

Integration tests:
- `src/__tests__/integration/evolution-visualization.integration.test.ts` — 8 tests (visualization actions with real Supabase)

E2E tests:
- `src/__tests__/e2e/specs/09-admin/admin-evolution-visualization.spec.ts` — 5 tests (skip-gated)

Jest mocks: d3 and d3-dag mocked via `moduleNameMapper` in jest.config.js.

## Dependencies
| Package | Purpose |
|---------|---------|
| `recharts` | Line, bar, area, radar charts |
| `d3` + `@types/d3` | DAG rendering, zoom/pan |
| `d3-dag` | Sugiyama layout (ESM-only, mocked in Jest) |
| `diff` | Word-level text diffing on the compare page |
