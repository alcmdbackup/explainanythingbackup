# More Evolution UI Cleanup Plan

## Background
A few additional improvements to the evolution dashboard UI: adding a metrics tab to run detail pages, fixing and enhancing the invocation detail page, adding confidence intervals to variant/strategy displays, and adjusting the default experiment budget.

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

## Problem
The evolution dashboard lacks a per-run metrics summary (users must cross-reference experiment/strategy pages to see variant distribution stats). The invocation detail page's variants tab is broken in production and doesn't clearly separate input from output variants or show confidence intervals. The strategy overview's per-run expandable section only shows finalElo without p90/max or uncertainty. The variants list page shows point-estimate Elo without any CI indicator despite elo_attribution data being available in the DB.

## Rollback Plan
All changes are additive UI enhancements — no schema migrations, no data model changes. Each phase is independently deployable and revertable via `git revert` of the phase's commit(s). The highest-risk change (Phase 4b: `buildEloLookupWithSigma`) is isolated to a new function that doesn't modify any existing function signatures, so reverting it leaves all existing functionality intact.

## Options Considered

### Metrics Tab Data Source
- **Option A: New `getRunMetricsAction` wrapping `computeRunMetrics()`** — Reuses proven code from experimentMetrics.ts. 3 DB queries (RPC + checkpoint + invocations). Cleanest separation.
- **Option B: Combine existing actions** — Call `getEvolutionRunSummaryAction` + `getEvolutionCostBreakdownAction` from the client. Avoids new action but requires client-side data merging and lacks p90/median Elo.
- **Chosen: Option A** — computeRunMetrics already computes exactly the metrics we need (totalVariants, medianElo, p90Elo, maxElo with sigma, cost, eloPer$, per-agent costs).

### Strategy Runs Elo Source
- **Option A: Call `compute_run_variant_stats` RPC per run** — N queries for N runs. Always fresh but slower.
- **Option B: Parse from `run_summary` JSONB** — Already fetched, zero extra queries. But run_summary currently stores `finalTopElo` only, not p90/max with sigma.
- **Option C: Extend `getStrategyRunsAction` to call computeRunMetrics per run** — Returns full MetricsBag per run. N*3 queries but reuses existing code.
- **Chosen: Option A** — Single RPC per run is lightweight (SQL aggregation), and getStrategyRunsAction fetches up to 20 runs (default limit). Note: `compute_run_variant_stats` returns point estimates only (no sigma), so p90Elo and maxElo will be displayed without CI bounds. This is acceptable — CI requires bootstrap aggregation across multiple runs and is only meaningful at the strategy/experiment aggregate level, not per-run.

### Variant List CI Source
- **Option A: Use `elo_attribution.ci`** — Already in DB, just add to SELECT. The `ci` field is attribution CI (gain uncertainty from parent), not rating CI.
- **Option B: Store mu/sigma in evolution_variants** — Schema change, backfill needed.
- **Chosen: Option A** — Use `elo_attribution` data, reusing the canonical `EloAttribution` type from `@evolution/lib/types`. The `ci` field (1.96 * sigmaDelta * ELO_SCALE) provides a meaningful uncertainty range. Display as `Rating ± ci`. No schema changes needed.

### Invocation CI Source
- **Option A: Modify `buildEloLookup` to return sigma** — Threading sigma through existing code path. Breaking change to 7+ callers.
- **Option B: Create new `buildEloLookupWithSigma()` function** — Non-breaking. Only used where sigma is needed (invocation detail). Existing `buildEloLookup` unchanged.
- **Chosen: Option B** — Create `buildEloLookupWithSigma()` returning `Record<string, { elo: number; sigma: number }>`. Keeps existing `buildEloLookup()` intact (returns `Record<string, number>`). Only the invocation detail code path calls the new function. Handles legacy `eloRatings` format by returning `sigma: 0` (no uncertainty data available). CI computed as `elo ± 1.96 * sigma * ELO_SIGMA_SCALE`. Note: `ELO_SIGMA_SCALE` (= 400/25 = 16) is currently a local const in `evolutionVisualizationActions.ts:525`; extract it to `rating.ts` as an exported constant for shared use.

### CI Type Distinction
Two different CI types are displayed in this project:
- **Attribution CI** (variants list, Phase 1): `elo_attribution.ci` from DB — measures uncertainty of the variant's *improvement* over its parent. Displayed as `±N` with tooltip "Attribution uncertainty".
- **Rating CI** (invocation overview, Phase 4b): `1.96 * sigma * ELO_SIGMA_SCALE` — measures uncertainty of the variant's *absolute rating*. Displayed as `[lower, upper]` with tooltip "95% confidence interval".
These are semantically different and should be visually distinguished. Attribution CI uses `±` format; rating CI uses `[lower, upper]` bracket format.

## Phased Execution Plan

### Phase 1: Default Budget + Variants List CI (Quick Wins)
**Files modified:**
- `src/app/admin/evolution/analysis/_components/ExperimentForm.tsx` — Change `useState(0.50)` to `useState(0.05)` (intentional 10x reduction; $0.05 is within the valid range $0.01-$1.00)
- `evolution/src/services/evolutionActions.ts` — Add `elo_attribution` to SELECT in `listVariantsAction`; extend `VariantListEntry` interface with `elo_attribution?: EloAttribution | null` (reusing the canonical `EloAttribution` type from `@evolution/lib/types`)
- `src/app/admin/evolution/variants/page.tsx` — Update Rating column render to show `±ci` when `elo_attribution?.ci` is available

**Tests (written in this phase):**
- Extend `evolutionActions.test.ts` — 2-3 tests verifying `listVariantsAction` returns `elo_attribution` field, CI data present for finalized variants, null for non-finalized
- Verify variants page Rating column renders `±ci` when `elo_attribution` present, with tooltip "Attribution uncertainty"
- Add 1 test for `ExperimentForm` verifying default budget renders as `0.05` (simple render + check input value)

**Verification:** Lint, tsc, build, run unit tests.

### Phase 2: Run Detail Metrics Tab
**Files created:**
- `evolution/src/components/evolution/tabs/MetricsTab.tsx` — New tab component
- `evolution/src/components/evolution/tabs/MetricsTab.test.tsx` — 6-8 tests

**Files modified:**
- `evolution/src/services/experimentActions.ts` — Export new `getRunMetricsAction(runId)` wrapping `computeRunMetrics()`. Returns `ActionResult<{ metrics: MetricsBag; agentBreakdown: Array<{ agent: string; costUsd: number; calls: number }> }>`. Agent breakdown fetched via the same `evolution_agent_invocations` query already used by `computeRunMetrics`. Uses `requireAdmin()` + `withLogging` + `serverReadRequestId` pattern consistent with all other actions in the file.
- `src/app/admin/evolution/runs/[runId]/page.tsx` — Add `{ id: 'metrics', label: 'Metrics' }` to TABS array, import and render `MetricsTab`

**MetricsTab design:**
```
┌─ MetricGrid (columns=4) ──────────────────────────┐
│ Total Variants │ Median Elo │ P90 Elo │ Max Elo   │
│                │            │         │ (±sigma)  │
├────────────────┤────────────┤─────────┤───────────┤
│ Total Cost     │ Elo/$      │         │           │
└────────────────────────────────────────────────────┘
┌─ Agent Cost Breakdown (table) ────────────────────┐
│ Agent     │ Cost ($) │ Calls │ Cost/Call           │
│ generation│ $0.123   │ 45    │ $0.003              │
│ ...       │ ...      │ ...   │ ...                 │
└────────────────────────────────────────────────────┘
```

Data loading pattern: `useEffect` + `useState` for loading/data/error. Integrate with `useAutoRefresh` for live updates on active runs. Errors shown via `toast.error()` from sonner (matching existing tab pattern). Loading skeleton matches other tabs (`h-[400px] bg-[var(--surface-elevated)] rounded-book animate-pulse`).

**Tests:**
- `MetricsTab.test.tsx`: Loading state, data display with MetricGrid, agent cost table rendering, empty state (no metrics), error state (action failure), verify `getRunMetricsAction` called with correct runId

**Verification:** Lint, tsc, build, run unit tests.

### Phase 3: Strategy Overview Runs Enhancement
**Files modified:**
- `evolution/src/services/eloBudgetActions.ts` — Extend `StrategyRunEntry` with `p90Elo: number | null`, `maxElo: number | null`. In `getStrategyRunsAction`, for each completed run, call `compute_run_variant_stats` RPC to populate these fields. If RPC fails for a run, set both to `null` (graceful degradation, no action-level failure). Also update `getPromptRunsAction` which returns the same `StrategyRunEntry[]` type for consistency.
- `src/app/admin/evolution/strategies/page.tsx` — Add "P90 Elo" and "Max Elo" columns to the runs table in `StrategyDetailRow`. Display values with `?.toFixed(0)` formatting, dash for null. Note: these are point estimates without CI (see Options Considered — CI only meaningful at aggregate level).

**Tests (written in this phase):**
- Extend `eloBudgetActions.test.ts` — 3-4 tests: getStrategyRunsAction returns p90Elo/maxElo for completed runs, returns null for running/pending runs, handles RPC failure gracefully. Also 1 test for getPromptRunsAction returning p90Elo/maxElo (same pattern).

**Verification:** Lint, tsc, build, run unit tests.

### Phase 4: Invocation Detail Page Overhaul

**Phase 4-prereq: Write baseline tests for existing behavior**
Before any refactoring, write baseline tests to catch regressions:
- Create `InvocationDetailContent.test.tsx` — 4-5 tests covering current 3-tab structure, overview metrics rendering, variants tab data pass-through, execution detail rendering
- Create `InvocationDetailClient.test.tsx` — 3-4 tests covering current InputArticleSection rendering, variant diffs rendering, empty state

**Sub-phase 4a: Fix variants tab + restructure into Input/Output tabs**

**Files modified:**
- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` — Replace single "Variants Produced" tab with "Input Variant" (singular — data model has exactly one `inputVariant` per invocation) and "Output Variants" tabs:
  ```typescript
  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'input', label: 'Input Variant' },
    { id: 'outputs', label: 'Output Variants' },
    { id: 'execution', label: 'Execution Detail' },
  ];
  ```
  The "Input Variant" tab renders the single `inputVariant` data (variant ID, strategy, Elo, full text with expand/collapse). The "Output Variants" tab renders `variantDiffs[]` as collapsible bars.

- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailClient.tsx` — Refactor to export `InputVariantSection` (singular) and `OutputVariantsSection` components. Each output variant rendered as a collapsible bar using the TimelineTab BudgetSection pattern (chevron icon with CSS rotate transition + boolean toggle state):
  ```
  ┌─ ▶ Variant abc123 │ structural_transform │ Elo 1450 ──┐
  └──────────────────────────────────────────────────────────┘
  (click to expand:)
  ┌─ ▼ Variant abc123 │ structural_transform │ Elo 1450 ──┐
  │ [Before | After | Diff tabs]                           │
  │ Full text content here...                              │
  │ Elo trajectory: 1200 → 1350 → 1450                    │
  └────────────────────────────────────────────────────────┘
  ```

**Tests (update baseline tests):**
- Update `InvocationDetailContent.test.tsx` — Verify 4 tabs rendered, Input Variant tab shows inputVariant data, Output Variants tab shows variantDiffs
- Update `InvocationDetailClient.test.tsx` — Test collapsible expand/collapse via `fireEvent.click` (matching EntityDetailTabs.test.tsx pattern), verify expanded content includes TextDiff

**Verification:** Lint, tsc, build, run unit tests.

**Sub-phase 4b: Add inputs/outputs module to Overview tab with CI**

**Files modified:**
- `evolution/src/services/evolutionVisualizationActions.ts` — Create NEW function `buildEloLookupWithSigma(snapshot)` returning `Record<string, { elo: number; sigma: number }>`. Existing `buildEloLookup()` remains unchanged (no breaking change to 7+ existing callers). The new function handles legacy `eloRatings` format by returning `{ elo, sigma: 0 }`. Update `getInvocationFullDetailAction` to use the new function. Extend `inputVariant` type to include `sigma: number | null`. Extend `VariantBeforeAfter` to include `sigmaAfter: number | null`.
- `evolution/src/lib/core/rating.ts` — Extract `ELO_SIGMA_SCALE = 400 / 25` as exported constant (currently a local const in `evolutionVisualizationActions.ts:525`). Update the existing usage in `evolutionVisualizationActions.ts` to import from `rating.ts`.
- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` — Add "Inputs / Outputs" section to overview tab below MetricGrid. Shows:
  ```
  ┌─ Inputs / Outputs ─────────────────────────────────┐
  │ Input Variant                                       │
  │  • abc123 │ Elo 1250 ± 48 │ [1154, 1346]           │
  │                                                     │
  │ Output Variants                                     │
  │  • def456 │ Elo 1450 ± 32 │ [1387, 1513] │ Δ+200   │
  │  • ghi789 │ Elo 1380 ± 40 │ [1302, 1458] │ Δ+130   │
  └─────────────────────────────────────────────────────┘
  ```
  CI computed using the existing `ELO_SIGMA_SCALE` constant from `rating.ts`: `elo ± 1.96 * sigma * ELO_SIGMA_SCALE`. When sigma is 0 or null, CI is not displayed.

**Tests:**
- Add tests to `InvocationDetailContent.test.tsx` — Overview tab shows inputs/outputs module, CI values displayed when sigma available, CI hidden when sigma is 0/null
- Add tests for `buildEloLookupWithSigma` in `evolutionVisualizationActions.test.ts` — Returns elo+sigma pairs, handles legacy format, handles missing ratings

**Verification:** Lint, tsc, build, run unit tests.

### Phase 5: Documentation
- Update `evolution/docs/evolution/visualization.md` — Add MetricsTab to Pages table, add MetricsTab.tsx to Key Files, update invocation detail page description (4 tabs: Overview with inputs/outputs module, Input Variant, Output Variants, Execution Detail), document new columns in strategy/variant list, add getRunMetricsAction to actions list, add buildEloLookupWithSigma to key functions
- Update `evolution/docs/evolution/reference.md` — Add getRunMetricsAction, update StrategyRunEntry fields with p90Elo/maxElo
- Update `evolution/docs/evolution/experimental_framework.md` — Note default budget change from $0.50 to $0.05

## Testing

### Unit Tests Summary
| Test File | Tests | Phase | Coverage |
|-----------|-------|-------|----------|
| `evolutionActions.test.ts` (extend) | 2-3 | 1 | listVariantsAction returns elo_attribution |
| `ExperimentForm.test.tsx` (new or extend) | 1 | 1 | Default budget renders as 0.05 |
| `MetricsTab.test.tsx` (new) | 6-8 | 2 | Loading, data display, agent costs, empty/error states |
| `experimentActions.test.ts` (extend) | 2-3 | 2 | getRunMetricsAction wrapping computeRunMetrics |
| `eloBudgetActions.test.ts` (extend) | 3-4 | 3 | getStrategyRunsAction + getPromptRunsAction p90Elo/maxElo, RPC failure |
| `InvocationDetailContent.test.tsx` (new) | 8-10 | 4-prereq + 4a + 4b | Baseline → 4 tabs → CI display |
| `InvocationDetailClient.test.tsx` (new) | 6-8 | 4-prereq + 4a | Baseline → collapsible bars |
| `evolutionVisualizationActions.test.ts` (extend) | 2-3 | 4b | buildEloLookupWithSigma |

### Manual Verification
- Run detail page: navigate to Metrics tab, verify metrics display for completed + running runs
- Invocation detail: verify Input Variant / Output Variants tabs render correctly, collapsible bars work, CI values shown on overview
- Strategy list: expand a strategy, verify P90 Elo / Max Elo columns in runs table
- Variants list: verify Rating column shows ±CI when elo_attribution exists
- Experiment creation: verify default budget is $0.05

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/visualization.md` — Add MetricsTab to pages table, update invocation detail description, add new component files, update action list with getRunMetricsAction
- `evolution/docs/evolution/reference.md` — Add getRunMetricsAction, update StrategyRunEntry fields
- `evolution/docs/evolution/experimental_framework.md` — Note default budget change from $0.50 to $0.05
- `evolution/docs/evolution/data_model.md` — No changes needed (no schema changes)
- `evolution/docs/evolution/arena.md` — No changes needed
- `evolution/docs/evolution/architecture.md` — No changes needed (reference only)
- `docs/docs_overall/design_style_guide.md` — No changes needed (reference only)
