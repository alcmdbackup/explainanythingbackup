# Evolution Visualization

Visual monitoring and debugging tools for the evolution pipeline. Provides an operational dashboard, per-run timeline/rating/lineage/budget analysis, and before/after text comparison.

Built with Recharts for standard charts and D3.js for the variant lineage DAG. Rating data uses OpenSkill ordinal values (mu - 3*sigma), mapped to the legacy 0-3000 Elo scale for display via `ordinalToEloScale()`.

## Pages

| Route | Purpose |
|-------|---------|
| `/admin/evolution-dashboard` | Evolution overview: quick links, run/spend charts, recent runs table |
| `/admin/evolution/runs` | Run management: queue new runs via Start Run card (prompt + strategy + budget selector), filter by status/date, variant panel, apply winner, rollback, cost charts |
| `/admin/evolution/runs/[runId]` | Run detail: 5-tab deep dive (Timeline, Elo, Lineage, Variants, Logs) + Add to Arena dialog. Budget is embedded in Timeline; tree search is a toggle within Lineage. |
| `/admin/evolution/runs/[runId]/compare` | Before/after text diff, stats summary (includes generationDepth) |
| `/admin/evolution/variants/[variantId]` | Variant detail: full metadata, content, parent/child lineage, match history, attribution badge |
| `/admin/evolution/invocations/[invocationId]` | Invocation detail: agent execution deep-dive with before/after text diffs, Elo deltas, input article preview. Linked from Timeline tab "View Details" |
| `/admin/evolution/strategies/[strategyId]` | Strategy detail: config, stats, run history |
| `/admin/evolution/experiments/[experimentId]` | Experiment detail: overview card with budget/factors, 3 tabs (Rounds, Runs, Report). See [Strategy Experiments](./strategy_experiments.md) |

## Key Files

### Components (`evolution/src/components/evolution/`)
| File | Purpose |
|------|---------|
| `EvolutionStatusBadge.tsx` | Reusable status badge for all 7 run statuses (includes `continuation_pending` → "Resuming" with ↻ icon, accent-gold) |
| `PhaseIndicator.tsx` | EXPANSION/COMPETITION phase display with iteration progress |
| `AutoRefreshProvider.tsx` | Polling context with tab visibility awareness (default 5s interval; dashboard overrides to 15s). Exports `AutoRefreshProvider`, `RefreshIndicator` component, and `useAutoRefresh()` hook |
| `EloSparkline.tsx` | Tiny inline Recharts sparkline for variant rating trajectory (displays ordinal mapped to Elo scale) |
| `AttributionBadge.tsx` | Elo attribution badge showing `+N ± CI` with z-score color coding (grey < 1.0, amber 1.0-2.0, green/red ≥ 2.0). Also exports `AgentAttributionSummary` for agent-level aggregates |
| `VariantCard.tsx` | Compact variant info card + strategy color palette |
| `LineageGraph.tsx` | D3 DAG visualization with zoom/pan and click-to-inspect |
| `tabs/TimelineTab.tsx` | Iteration-by-iteration execution timeline with expandable per-agent detail panels and lazy-loaded execution detail views |
| `agentDetails/index.tsx` | `AgentExecutionDetailView` — discriminated union dispatcher that renders the correct detail component based on `detailType` |
| `agentDetails/shared.tsx` | Shared UI primitives (`StatusBadge`, `DetailSection`, `Metric`, `CostDisplay`, `ShortId`, `EloDeltaChip`, `VariantDiffSection`) used across all detail views |
| `agentDetails/*.tsx` | 12 agent-specific detail views (one per agent type) showing structured execution metrics |
| `TextDiff.tsx` | Reusable word-level text diff component with Before/After/Diff tabs, ~300 char preview with expand toggle. Uses `diffWordsWithSpace` from `diff` package |
| `InputArticleSection.tsx` | Input variant display with ShortId, strategy badge, Elo rating, and expandable text preview |
| `tabs/EloTab.tsx` | Rating trajectory line chart with top-N filtering (ordinal values mapped to Elo scale) |
| `tabs/LineageTab.tsx` | Lineage DAG + tree search toggle (Full DAG / Pruned Tree views). Absorbed former TreeTab. |
| `tabs/VariantsTab.tsx` | Sortable variant table with sparklines, step score expansion, and per-variant attribution badges |
| `VariantDetailPanel.tsx` | Inline variant detail panel showing match history, parent lineage, dimension scores, and content preview. Links to full variant detail page |
| `variant/VariantOverviewCard.tsx` | Variant detail header: metadata, stats, attribution badge, navigation links |
| `variant/VariantContentSection.tsx` | Full variant content with optional parent diff toggle |
| `variant/VariantLineageSection.tsx` | Parent/child variant navigation with lineage chain |
| `variant/VariantMatchHistory.tsx` | Match results table for a variant |
| `tabs/LogsTab.tsx` | Structured log viewer with search, time-delta, inline cost/duration badges, context tree, pagination, and JSON/CSV export |
| `StepScoreBar.tsx` | Horizontal bar chart showing per-step scores for outline variants |
| `TableSkeleton.tsx` | Shared table loading skeleton with configurable columns and rows |
| `EmptyState.tsx` | Shared empty state with message, suggestion, icon, and optional action |

### Server Actions (`evolution/src/services/evolutionVisualizationActions.ts`)

13 read-only actions following the `withLogging + requireAdmin + serverReadRequestId` pattern:

1. `getEvolutionDashboardDataAction` — System-wide stats, runs/spend trends
2. `getEvolutionRunTimelineAction` — Per-iteration agent execution breakdown using `_diffMetrics` from agent invocations for per-agent metrics (variants added, matches played, rating changes) with checkpoint-diff fallback for legacy runs, and timestamp-based cost attribution
3. `getEvolutionRunEloHistoryAction` — Rating trajectories from checkpoints (reads both new `ratings` and legacy `eloRatings` snapshot formats, mapped to Elo scale via `ordinalToEloScale`)
4. `getEvolutionRunLineageAction` — Variant parentage DAG from latest checkpoint (augmented with `treeSearchPath` for path highlighting and per-node `treeDepth`/`revisionAction`)
5. `getEvolutionRunBudgetAction` — Cumulative cost burn + agent breakdown + cost estimate/prediction fields
6. `getEvolutionRunComparisonAction` — Original vs winner text, Elo delta, `generationDepth` (max variant version in pool)
7. `getEvolutionRunStepScoresAction` — Per-variant step scores for outline variants (returns `VariantStepData[]` with step names, scores, costs, and weakest step)
8. `getEvolutionRunTreeSearchAction` — Tree search state: full tree nodes with depth/pruning/actions for the Tree tab
9. `getAgentInvocationDetailAction` — Lazy-loaded per-agent execution detail from `evolution_agent_invocations`. Returns typed `AgentExecutionDetail` discriminated union keyed by `detailType`
10. `getIterationInvocationsAction` — All agent invocations for a specific iteration
11. `getAgentInvocationsForRunAction` — All invocations for a run, grouped by iteration
12. `getVariantDetailAction` — Full variant detail with lineage and rating history
13. `getInvocationFullDetailAction` — Full invocation detail with before/after variant diffs, Elo deltas, input variant, and eloHistory for sparklines

### Variant Detail Actions (`evolution/src/services/variantDetailActions.ts`)

4 read-only actions for the variant detail page:

1. `getVariantFullDetailAction(variantId)` — Full variant metadata with lineage context
2. `getVariantParentsAction(variantId)` — Parent chain
3. `getVariantChildrenAction(variantId)` — Direct children
4. `getVariantMatchHistoryAction(variantId)` — Match results

Additionally, the run detail page uses:
- `getEvolutionRunSummaryAction(runId)` from `evolutionActions.ts` to display the validated `EvolutionRunSummary` (stop reason, Elo/diversity history, match stats, baseline rank)
- `getEvolutionVariantsAction(runId)` from `evolutionActions.ts` for the Variants tab, which includes checkpoint fallback via `buildVariantsFromCheckpoint()` when the DB table has no rows (common for local CLI runs)

### Run Detail Features

- **Add to Arena dialog**: Modal on the run detail page that exports the winner variant (and optionally the baseline) to the [Arena](./arena.md). Prompts for a topic description and calls `addToArenaAction()`.
- **Compare button**: Links to the `/compare` sub-route for before/after text diff with stats summary and generation depth.

### Timeline Tab - Per-Agent Detail

The Timeline tab shows all agents that executed in each iteration.

**Agent count by phase**:

| Phase | Agent Count | Agents |
|-------|-------------|--------|
| EXPANSION | 3 | Generation, Calibration, Proximity |
| COMPETITION | 12 | Generation, OutlineGeneration*, Reflection, FlowCritique*, IterativeEditing*, TreeSearch*, SectionDecomposition*, Debate*, Evolution*, Tournament/Calibration, Proximity, MetaReview |

\* Agents marked with asterisk can be disabled via [feature flags](./reference.md#feature-flags).

**Metrics shown per agent**:
- Variants added (pool growth from checkpoint diff)
- Matches played (for ranking agents only — Generation/Reflection/etc. show 0)
- Cost in USD (per-iteration deltas from cumulative `cost_usd` in `evolution_agent_invocations`)
- Diversity score after execution
- New variant IDs (expandable list)
- Elo changes per variant (color-coded +/-)

**Data computation**: Reads pre-computed `_diffMetrics` from `evolution_agent_invocations.execution_detail` for each agent. Falls back to sequential checkpoint diffing for legacy runs without `_diffMetrics` — the fallback uses `buildEloLookup()` which reads OpenSkill `{mu,sigma}` ratings (preferred) or legacy `eloRatings` snapshots. Diff metrics include variants added, matches played, Elo changes, critiques/debates added, diversity score, and meta-feedback population.

**Cost attribution**: Uses `evolution_agent_invocations` table with exact `run_id` join. `cost_usd` is incremental per-invocation (not cumulative), so per-agent costs are summed directly. No time-window correlation needed — accurate even for concurrent/paused runs.

**Expandable detail**: Click any agent row to see full metrics including new variant IDs, Elo changes, and error messages.

**View Details link**: Each expanded agent row shows a "View Details →" link (when `invocationId` is available) that navigates to the full invocation detail page at `/admin/evolution/invocations/[invocationId]`.

**Execution detail views**: When `hasExecutionDetail` is true on an agent row, expanding it lazy-loads the structured `AgentExecutionDetail` from `evolution_agent_invocations` via `getAgentInvocationDetailAction`. The `AgentExecutionDetailView` component dispatches to 12 type-specific views based on `detailType`:

| Detail Type | Agent | Key Metrics Shown |
|-------------|-------|-------------------|
| `generation` | GenerationAgent | Per-strategy status (ACCEPT/REJECT), variant IDs, strategy names |
| `outlineGeneration` | OutlineGenerationAgent | Step scores (outline/expand/polish/verify), step costs, weakest step |
| `calibration` | CalibrationRanker | Match results, rating changes per variant |
| `tournament` | Tournament | Rounds, matches per round, rating deltas, ties |
| `evolution` | EvolutionAgent | Children with mutation types (mutate/crossover/creative), parent IDs |
| `reflection` | ReflectionAgent | Critiqued variant IDs, dimension scores, critique text |
| `iterativeEditing` | IterativeEditingAgent | Edit rounds, accepted/rejected count, judge verdicts |
| `sectionDecomposition` | SectionDecompositionAgent | Sections parsed, per-section edit status, stitch method |
| `debate` | DebateAgent | Debate turns, synthesis variant ID, debated variant IDs |
| `proximity` | ProximityAgent | Diversity score, similarity matrix stats, embedding count |
| `metaReview` | MetaReviewAgent | Strategy performance rankings, recommendations |
| `treeSearch` | TreeSearchAgent | Nodes explored, depth reached, beam width, pruned count |

Detail data is persisted by the two-phase invocation lifecycle: `createAgentInvocation()` inserts the row before execution, `updateAgentInvocation()` writes cost/status/detail after completion. Data is truncated to 100KB max with non-blocking error handling.

### Budget Tab - Pre-run Estimate vs Final Cost

When a completed run has `cost_estimate_detail` and `cost_prediction`, the Budget tab shows a "Pre-run Estimate vs Final Cost" comparison panel:
- Summary delta badge (color-coded: ≤10% green, ≤30% amber, >30% red)
- Per-agent comparison bars (estimated outline vs actual solid, with dollar amounts)
- Confidence badge from the pre-run estimate

The runs table also displays an "Est." column showing `estimated_cost_usd` with the same color-coding scheme applied to completed runs by comparing estimate accuracy.

### Cost Analytics Actions (`evolution/src/services/costAnalyticsActions.ts`)

Separate from visualization actions, this file provides system-wide cost accuracy analytics:
- `getStrategyAccuracyAction()` — Per-strategy avg delta %, std dev, run count
- `getCostAccuracyOverviewAction()` — Delta trend, per-agent accuracy, confidence calibration, outliers

These power the strategy detail row accuracy display and the Cost Accuracy tab on the optimization dashboard.

### Step Score Visualization

The Variants tab displays step-level scores for outline variants via the `StepScoreBar` component:

- **Trigger**: When a variant row is expanded, step score data is fetched via `getEvolutionRunStepScoresAction`
- **Display**: Horizontal bar chart with one bar per step (outline, expand, polish, verify)
- **Color coding**: Green (score >= 0.8), yellow (0.5-0.8), red (< 0.5)
- **Weakest step**: Highlighted with the `--status-error` design token color
- **Conditional**: Only rendered for variants where `isOutlineVariant()` returns true

The step score data is fetched in `Promise.all` alongside existing variant data to avoid waterfall requests.

## Architecture Decisions

- **Checkpoint-first lineage**: Lineage visualization uses in-memory `TextVariation.parentIds` from checkpoint data. DB `parent_variant_id` is now populated by the local CLI runner, but production runs may still have NULL parent IDs
- **In-memory vs DB IDs**: Checkpoint variant IDs differ from DB UUIDs; lineage/Elo features operate entirely on checkpoint data
- **Auto-polling**: The dashboard page polls at 15s intervals. The run detail page also polls at 5s intervals. Timeline, Elo, and Logs tabs poll via `useAutoRefresh`; only Variants and Lineage load data once on selection
- **D3 + React hybrid**: D3 renders SVG via `useRef` + `useEffect`; React handles the side panel
- **SSR disabled**: All chart components use `next/dynamic` with `ssr: false`

## Testing

Component unit tests (61 total):
- `EvolutionStatusBadge.test.tsx` — 7 tests (status style mapping)
- `AutoRefreshProvider.test.tsx` — 6 tests (polling, visibility pause, manual refresh)
- `EloSparkline.test.tsx` — 4 tests (sparkline rendering)
- `LineageGraph.test.tsx` — 4 tests (DAG rendering, node selection)
- `StepScoreBar.test.tsx` — 10 tests (step bar rendering, color coding, weakest step highlight, empty/missing data)
- `TimelineTab.test.tsx` — 18 tests (expandable rows, agent detail panel, execution detail loading, error states)
- `AgentExecutionDetailView.test.tsx` — 12 tests (discriminated union dispatch, all 12 detail types render correctly)

Server action unit tests:
- `evolutionVisualizationActions.test.ts` — 7 tests (diff metrics reading, checkpoint-diff fallback, cost attribution, edge cases)

Integration tests:
- `src/__tests__/integration/evolution-visualization.integration.test.ts` — 8 tests (visualization actions with real Supabase)

E2E tests:
- `src/__tests__/e2e/specs/09-admin/admin-evolution-visualization.spec.ts` — 5 tests (skip-gated)
- `src/__tests__/e2e/specs/09-admin/admin-article-variant-detail.spec.ts` — 9 tests (skip-gated, article/variant detail pages)
- `src/__tests__/e2e/specs/09-admin/admin-experiment-detail.spec.ts` — 5 tests (skip-gated, experiment detail page)

Jest mocks: d3 and d3-dag mocked via `moduleNameMapper` in jest.config.js.

## Dependencies

| Package | Purpose |
|---------|---------|
| `recharts` | Line, bar, area charts |
| `d3` + `@types/d3` | DAG rendering, zoom/pan |
| `d3-dag` | Sugiyama layout (ESM-only, mocked in Jest) |
| `diff` | Word-level text diffing on the compare page |

## Related Documentation

- [Architecture](./architecture.md) — Pipeline orchestration and data flow
- [Agent Overview](./agents/overview.md) — Agent interaction patterns shown in Timeline tab
- [Generation Agents](./agents/generation.md) — Step score visualization for outline variants
- [Tree Search Agent](./agents/tree_search.md) — Tree tab visualization details
- [Arena](./arena.md) — "Add to Arena" integration from run detail
- [Cost Optimization](./cost_optimization.md) — Budget tab and cost attribution
- [Reference](./reference.md) — Key files, database schema, testing
