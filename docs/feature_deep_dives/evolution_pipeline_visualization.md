# Evolution Pipeline Visualization

## Overview
Visual monitoring and debugging tools for the evolution pipeline. Provides an operational dashboard, per-run timeline/rating/lineage/budget analysis, and before/after text comparison. Built with Recharts for standard charts and D3.js for the variant lineage DAG. Rating data uses OpenSkill ordinal values (mu - 3*sigma), mapped to the legacy 0-3000 Elo scale for display via `ordinalToEloScale()`.

## Pages

| Route | Purpose |
|-------|---------|
| `/admin/evolution-dashboard` | Evolution overview: quick links, run/spend charts, recent runs table |
| `/admin/quality/evolution` | Run management: queue new runs via Start Run card (prompt + strategy + budget selector), filter by status/date, variant panel, apply winner, rollback, cost charts |
| `/admin/quality/evolution/run/[runId]` | Run detail: 6-tab deep dive (Timeline, Elo, Lineage, Tree, Budget, Variants) + Add to Hall of Fame dialog |
| `/admin/quality/evolution/run/[runId]/compare` | Before/after text diff, stats summary (includes generationDepth) |

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
| `tabs/TimelineTab.tsx` | Iteration-by-iteration execution timeline with expandable per-agent detail panels |
| `tabs/EloTab.tsx` | Rating trajectory line chart with top-N filtering (ordinal values mapped to Elo scale) |
| `tabs/LineageTab.tsx` | Lineage DAG tab wrapper (dynamic import) |
| `tabs/BudgetTab.tsx` | Cumulative burn curve + agent cost breakdown |
| `tabs/VariantsTab.tsx` | Sortable variant table with sparklines and step score expansion |
| `StepScoreBar.tsx` | Horizontal bar chart showing per-step scores for outline variants |
| `tabs/TreeTab.tsx` | Tree search visualization: depth-layered beam search tree with winning path highlighting, pruned branch dimming, and node detail panel |

### Server Actions (`src/lib/services/evolutionVisualizationActions.ts`)
8 read-only actions following the `withLogging + requireAdmin + serverReadRequestId` pattern:
1. `getEvolutionDashboardDataAction` — System-wide stats, runs/spend trends
2. `getEvolutionRunTimelineAction` — Per-iteration agent execution breakdown with checkpoint diffing for accurate per-agent metrics (variants added, matches played, rating changes) and timestamp-based cost attribution
3. `getEvolutionRunEloHistoryAction` — Rating trajectories from checkpoints (reads both new `ratings` and legacy `eloRatings` snapshot formats, mapped to Elo scale via `ordinalToEloScale`)
4. `getEvolutionRunLineageAction` — Variant parentage DAG from latest checkpoint (augmented with `treeSearchPath` for path highlighting and per-node `treeDepth`/`revisionAction`)
5. `getEvolutionRunBudgetAction` — Cumulative cost burn + agent breakdown
6. `getEvolutionRunComparisonAction` — Original vs winner text, Elo delta, `generationDepth` (max variant version in pool)
7. `getEvolutionRunStepScoresAction` — Per-variant step scores for outline variants (returns `VariantStepData[]` with step names, scores, costs, and weakest step)
8. `getEvolutionRunTreeSearchAction` — Tree search state: full tree nodes with depth/pruning/actions for the Tree tab

Additionally, the run detail page uses `getEvolutionRunSummaryAction(runId)` from `evolutionActions.ts` to display the validated `EvolutionRunSummary` (stop reason, Elo/diversity history, match stats, baseline rank).

### Run Detail Features
- **Add to Hall of Fame dialog**: Modal on the run detail page that exports the winner variant (and optionally the baseline) to the Hall of Fame. Prompts for a topic description and calls `addToHallOfFameAction()`.
- **Compare button**: Links to the `/compare` sub-route for before/after text diff with stats summary and generation depth.

### Timeline Tab - Per-Agent Detail

The Timeline tab shows all agents that executed in each iteration. The admin UI trigger (`triggerEvolutionRunAction`) uses the full pipeline with all agents.

**Agent count by phase**:

| Phase | Agent Count | Agents |
|-------|-------------|--------|
| EXPANSION | 3 | Generation, Calibration, Proximity |
| COMPETITION | 11 | Generation, OutlineGeneration*, Reflection, IterativeEditing*, TreeSearch*, SectionDecomposition*, Debate*, Evolution*, Tournament/Calibration, Proximity, MetaReview |

\* Agents marked with asterisk can be disabled via feature flags.

**Metrics shown per agent**:
- Variants added (pool growth from checkpoint diff)
- Matches played (for ranking agents only — Generation/Reflection/etc. show 0)
- Cost in USD (timestamp-correlated from llmCallTracking)
- Diversity score after execution
- New variant IDs (expandable list)
- Elo changes per variant (color-coded +/-)

**Data computation**: Uses sequential checkpoint diffing within each iteration to compute accurate per-agent metrics. The first agent in an iteration diffs against the previous iteration's final checkpoint.

**Cost attribution**: Uses timestamp correlation between LLM calls and checkpoint boundaries. May be imprecise for concurrent runs (logged warning).

**Expandable detail**: Click any agent row to see full metrics including new variant IDs, Elo changes, and error messages.

### Step Score Visualization

The Variants tab displays step-level scores for outline variants via the `StepScoreBar` component:

- **Trigger**: When a variant row is expanded, step score data is fetched via `getEvolutionRunStepScoresAction`
- **Display**: Horizontal bar chart with one bar per step (outline, expand, polish, verify)
- **Color coding**: Green (score >= 0.8), yellow (0.5-0.8), red (< 0.5)
- **Weakest step**: Highlighted with the `--status-error` design token color
- **Conditional**: Only rendered for variants where `isOutlineVariant()` returns true; regular `TextVariation` variants show no step bars

The step score data is fetched in `Promise.all` alongside existing variant data to avoid waterfall requests.

## Architecture Decisions
- **Checkpoint-first lineage**: Lineage visualization uses in-memory `TextVariation.parentIds` from checkpoint data. DB `parent_variant_id` is now populated by the local CLI runner (`run-evolution-local.ts`) which preserves pipeline-generated variant UUIDs on insert, but production runs via `evolution-runner.ts` may still have NULL parent IDs
- **In-memory vs DB IDs**: Checkpoint variant IDs differ from DB UUIDs; lineage/Elo features operate entirely on checkpoint data
- **Auto-polling**: Only the dashboard page polls (15s). Other tabs load data once on selection
- **D3 + React hybrid**: D3 renders SVG via `useRef` + `useEffect`; React handles the side panel
- **SSR disabled**: All chart components use `next/dynamic` with `ssr: false`

## Testing

Component unit tests (45 total):
- `EvolutionStatusBadge.test.tsx` — 7 tests (status style mapping)
- `AutoRefreshProvider.test.tsx` — 6 tests (polling, visibility pause, manual refresh)
- `EloSparkline.test.tsx` — 4 tests (sparkline rendering)
- `LineageGraph.test.tsx` — 4 tests (DAG rendering, node selection)
- `StepScoreBar.test.tsx` — 10 tests (step bar rendering, color coding, weakest step highlight, empty/missing data)
- `TimelineTab.test.tsx` — 14 tests (expandable rows, agent detail panel, error states)

Server action unit tests:
- `evolutionVisualizationActions.test.ts` — 7 tests (checkpoint diffing, cost attribution, edge cases)

Integration tests:
- `src/__tests__/integration/evolution-visualization.integration.test.ts` — 8 tests (visualization actions with real Supabase)

E2E tests:
- `src/__tests__/e2e/specs/09-admin/admin-evolution-visualization.spec.ts` — 5 tests (skip-gated)

Jest mocks: d3 and d3-dag mocked via `moduleNameMapper` in jest.config.js.

## Dependencies
| Package | Purpose |
|---------|---------|
| `recharts` | Line, bar, area charts |
| `d3` + `@types/d3` | DAG rendering, zoom/pan |
| `d3-dag` | Sugiyama layout (ESM-only, mocked in Jest) |
| `diff` | Word-level text diffing on the compare page |
