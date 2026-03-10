# More Evolution UI Cleanup Research

## Problem Statement
A few additional improvements to evolution dashboard UI.

## Requirements (from GH Issue #TBD)
- [ ] Add a metrics tab to runs
- [ ] Set default budget at start of experiment creation to be 0.05
- [ ] Invocation detail page
    - [ ] Variants tab is currently broken in production
    - [ ] All agent types (including iterative editing) should show input and output variants as separate tabs
        - [ ] Each tab should have collapsible bars each containing the variant, which let you expand to read
    - [ ] Overview tab should have a "inputs/outputs" module which shows
        - [ ] Input variants, elo and confidence intervals
        - [ ] Output variants, elo and confidence intervals
- [ ] Strategy overview list
    - [ ] For each run, also show 90p elo and max elo, along with confidence intervals
- [ ] Variants overview list
    - [ ] Should show confidence intervals for elo

## High Level Summary

Research across 12 parallel agents over 3 rounds revealed the following:

1. **Metrics Tab for Runs**: No existing metrics tab. `computeRunMetrics()` in `experimentMetrics.ts` already computes totalVariants, medianElo, p90Elo, maxElo (with sigma), cost, eloPer$, and per-agent costs. Need a new `getRunMetricsAction` server action wrapping it, plus a `MetricsTab` component. MetricGrid component is ready to use.

2. **Default Budget**: Currently `useState(0.50)` on line 41 of `ExperimentForm.tsx`. Simple one-line change to `0.05`.

3. **Invocation Detail Page**: 3-tab structure (overview, variants, execution). Variants tab displays input+output mixed together via `InvocationDetailClient.tsx`. Data is already separated: `inputVariant` (single) and `variantDiffs[]` (outputs). Need to restructure into Input/Output tabs with collapsible variant bars. For CI display, `buildEloLookup()` currently discards sigma — need to thread it through.

4. **Strategy Overview Runs**: Expandable detail in `StrategyDetailRow` shows runs via `getStrategyRunsAction()` which returns `StrategyRunEntry` with only `finalElo`. Need to add p90Elo/maxElo fields by calling `compute_run_variant_stats` RPC or parsing from `run_summary` JSONB.

5. **Variants List CIs**: `evolution_variants` table has `elo_attribution` JSONB column containing `{gain, ci, zScore, deltaMu, sigmaDelta}`. The `ci` field is already a 95% CI width in Elo units. Just need to add `elo_attribution` to the SELECT in `listVariantsAction` and display it.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/experimental_framework.md
- docs/docs_overall/design_style_guide.md

## Code Files Read

### Run Detail & Metrics Tab
- `src/app/admin/evolution/runs/[runId]/page.tsx` — Run detail shell, 5 tabs (timeline/elo/lineage/variants/logs), TABS array pattern
- `evolution/src/components/evolution/EntityDetailTabs.tsx` — Tab component + useTabState hook with URL sync
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` — Reference tab pattern with data loading, autorefresh, collapsible BudgetSection
- `evolution/src/components/evolution/tabs/EloTab.tsx` — Elo chart with sigma bands (CI rendering pattern)
- `evolution/src/components/evolution/tabs/VariantsTab.tsx` — Expandable row pattern
- `evolution/src/components/evolution/MetricGrid.tsx` — Reusable metric grid with CI display support
- `evolution/src/experiments/evolution/experimentMetrics.ts` — computeRunMetrics(), MetricsBag, MetricValue types, bootstrap CI functions
- `evolution/src/services/experimentActions.ts` — getExperimentMetricsAction, getStrategyMetricsAction patterns
- `evolution/src/services/evolutionActions.ts` — getEvolutionRunSummaryAction, getEvolutionVariantsAction, getEvolutionCostBreakdownAction, listVariantsAction
- `src/app/admin/evolution/experiments/[experimentId]/ExperimentAnalysisCard.tsx` — Metrics table pattern
- `src/app/admin/evolution/strategies/[strategyId]/StrategyMetricsSection.tsx` — Aggregate + per-run metrics pattern

### Invocation Detail Page
- `src/app/admin/evolution/invocations/[invocationId]/page.tsx` — Server page, fetches InvocationFullDetail
- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` — 3-tab client component (overview/variants/execution)
- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailClient.tsx` — Variant display: InputArticleSection + variantDiffs with TextDiff
- `evolution/src/components/evolution/InputArticleSection.tsx` — Input variant display with expandable text
- `evolution/src/components/evolution/TextDiff.tsx` — 3-tab diff view (Before/After/Diff), word-level diffing
- `evolution/src/components/evolution/agentDetails/index.tsx` — AgentExecutionDetailView dispatcher (12 agent types)
- `evolution/src/components/evolution/agentDetails/shared.tsx` — StatusBadge, DetailSection, Metric, ShortId, EloDeltaChip, VariantDiffSection
- `evolution/src/components/evolution/agentDetails/IterativeEditingDetail.tsx` — Reference agent detail view
- `evolution/src/components/evolution/agentDetails/GenerationDetail.tsx` — Reference agent detail view
- `evolution/src/components/evolution/agentDetails/ReflectionDetail.tsx` — Reference agent detail view
- `evolution/src/components/evolution/tabs/RelatedVariantsTab.tsx` — Variants tab (note: invocationId filtering not supported)
- `evolution/src/services/evolutionVisualizationActions.ts` — getInvocationFullDetailAction, InvocationFullDetail type, VariantBeforeAfter type, buildEloLookup (discards sigma)

### Strategy Overview
- `src/app/admin/evolution/strategies/page.tsx` — Strategy list with StrategyDetailRow, expandable runs table (5 columns: Run/Topic/Status/Cost/Iters)
- `evolution/src/services/eloBudgetActions.ts` — getStrategyRunsAction, StrategyRunEntry type (has finalElo only)
- `evolution/src/services/strategyRegistryActions.ts` — getStrategiesAction, StrategyConfigRow type
- `evolution/src/components/evolution/EntityListPage.tsx` — List page wrapper
- `evolution/src/components/evolution/EntityTable.tsx` — Generic sortable table

### Variants Overview
- `src/app/admin/evolution/variants/page.tsx` — Variant list with EntityListPage, 8 columns (ID/Run/Agent/Rating/Matches/Gen/Winner/Created)
- `evolution/src/services/evolutionActions.ts` — listVariantsAction (selects 9 columns, no elo_attribution)

### Budget Defaults
- `src/app/admin/evolution/analysis/_components/ExperimentForm.tsx` — Default budget useState(0.50) on line 41, budget range $0.01-$1.00
- `src/app/admin/evolution/start-experiment/page.tsx` — Start experiment entry point
- `evolution/src/lib/config.ts` — MAX_RUN_BUDGET_USD=$1.00, MAX_EXPERIMENT_BUDGET_USD=$10.00

### Elo & CI Infrastructure
- `evolution/src/lib/core/rating.ts` — ordinalToEloScale() function, ELO_SIGMA_SCALE = 400/25
- `evolution/src/lib/core/eloAttribution.ts` — computeEloAttribution(), EloAttribution type
- `evolution/src/lib/core/persistence.ts` — computeAndPersistAttribution() writes elo_attribution JSONB
- `evolution/src/lib/types.ts` — EloAttribution interface {gain, ci, zScore, deltaMu, sigmaDelta}
- `supabase/migrations/20260306000002_compute_run_variant_stats.sql` — RPC for median/p90/max Elo

### Testing
- `evolution/src/components/evolution/MetricGrid.test.tsx` — 8 tests, CI display testing
- `evolution/src/components/evolution/EntityDetailTabs.test.tsx` — 4 tests, tab interaction
- `evolution/src/components/evolution/EntityListPage.test.tsx` — 7 tests, filters/pagination
- `evolution/src/components/evolution/agentDetails/AgentExecutionDetailView.test.tsx` — 12 tests, detail type dispatch
- `evolution/src/components/evolution/tabs/RelatedVariantsTab.test.tsx` — 5 tests, data loading/display
- jest.config.js — moduleNameMapper aliases, mock setup patterns

## Key Findings

1. **computeRunMetrics() exists but has no dedicated server action** — it's called internally by getExperimentMetricsAction and getStrategyMetricsAction but not exposed for single-run queries. A new `getRunMetricsAction` is needed.

2. **elo_attribution JSONB already stores per-variant CI data** — the `ci` field = `1.96 * sigmaDelta * (400/25)`, a 95% CI width in Elo units. Available on finalized runs. No schema changes needed for variants list CI.

3. **buildEloLookup() discards sigma** — used by invocation detail page. The EloTab preserves sigma correctly via `ELO_SIGMA_SCALE`. Need to modify buildEloLookup to return `{elo, sigma}` pairs for invocation CI display.

4. **StrategyRunEntry lacks p90/max Elo** — `getStrategyRunsAction` only extracts `finalElo` from `run_summary`. The RPC `compute_run_variant_stats` can provide p90/max, or they could be parsed from run_summary if persisted there.

5. **Existing collapsible patterns**: TimelineTab's BudgetSection (chevron + toggle), VariantsTab's expandable rows, InputArticleSection's text expansion. Can reuse for invocation variant tabs.

6. **MetricGrid already supports CI display** — `ci?: [number, number]` on MetricItem renders brackets. Also supports `n` for low-sample warnings.

7. **Tab system is straightforward** — TABS array + useTabState hook + conditional rendering. Adding a tab is a ~5-line change per tab definition.

8. **Default budget change is trivial** — single useState default in ExperimentForm.tsx line 41.

## Open Questions

1. **Run metrics tab content**: Should it show run_summary data (stopReason, matchStats, metaFeedback, strategyEffectiveness) in addition to computed metrics (medianElo, p90, maxElo, costs)?
2. **Strategy runs CI source**: Should we call compute_run_variant_stats RPC per run (N queries) or extend run_summary to store p90/max at finalization (0 extra queries)?
3. **Invocation variants broken**: Need to verify what exactly is broken in production — is it data loading, rendering, or the RelatedVariantsTab invocationId filtering limitation?
