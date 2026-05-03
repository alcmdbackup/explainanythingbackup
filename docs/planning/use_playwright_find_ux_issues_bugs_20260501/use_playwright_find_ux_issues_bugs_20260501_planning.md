# use_playwright_find_ux_issues_bugs_20260501 Plan

## Background
Playwright sweep of evolution admin pages produced 52 raw findings; pass-2 source-code audit dropped 17 false positives, leaving 35 actionable findings (3 confirmed Bug-Major + ~32 Bug-Minor / UX-Minor / UX-Major). The single highest-impact item is the run-detail Metrics tab rendering ELO-attribution metrics through the cost formatter (visible negative dollar values like `$-1.951`); root cause is one default branch in `EntityMetricsTab.tsx`. Three independent reflection-wrapper observability gaps cluster around the same cause: tactic-field misread (`d.strategy` vs `d.tactic`), `reflect_and_generate` agent type missing from badge resolvers, and `reflection_cost` listView flag off. The remainder are accessibility (aria-live, per-row labels), polish (browser tab titles, page-size selector), and inconsistent visual language (status rendering across pages).

## Requirements (from GH Issue #NNN)
Use the `.claude/skills/maintenance/bugs-ux/` skill to use playwright to look for ux issues and bugs in the evolution admin dashboard. Findings (post-audit) below.

## Problem
Three concrete data-display bugs and ~30 UX/a11y polish items make the admin surface harder to use than it should be — especially for any reflect-and-generate run. The negative-dollar regression is fresh (post-Phase 5 attribution rollout) and silently visible to every admin viewing any run. Reflection observability is partly broken (column hidden, tactic field misread, badge type unsupported), so admins can't trace what reflection chose without inspecting raw DB rows.

## Options Considered
- [x] **Option A: Phased by severity** (Bug-Major fixes first, then accessibility cluster, then polish). Each phase commits independently and runs tests-per-phase. Mirrors the prior `user_testing_for_bugs_ux_issues_20260326` project structure.
- [x] **Option B: Phased by surface area** (fix all run-detail bugs, then experiments, then arena). Defers Bug-Major fixes behind unrelated UX cleanup.
- [x] **Option C: One PR, all fixes** (single big bang). Hard to review; if any one fix regresses CI the whole thing rolls back.

Selected: **Option A**. Severity-driven phases let us land the data-correctness fixes first, ship accessibility wins fast, and defer the longer polish queue without blocking.

## Pre-flight (do BEFORE Phase 1)

- [x] **Branch-conflict check** — `git fetch origin && git log origin/feat/look_for_bugs_evolution_20260501 --since="2026-04-25" -- evolution/src/components/evolution/tabs/EntityMetricsTab.tsx evolution/src/services/costEstimationActions.ts evolution/src/lib/core/metricCatalog.ts evolution/src/components/evolution/tabs/TimelineTab.tsx evolution/src/components/evolution/tabs/CostEstimatesTab.tsx evolution/src/components/evolution/tables/RunsTable.tsx`. If commits exist that touch any of these files, document them in `_progress.md` and resolve overlap (rebase early, cherry-pick, or coordinate with that branch owner) BEFORE starting Phase 1. Without this, the "git revert per phase" rollback claim is unsafe.
- [x] **Test-data factory extension** — Add to `src/__tests__/e2e/helpers/evolution-test-data-factory.ts` (and `evolution/src/testing/evolution-test-helpers.ts` for unit tests):
  - `createTestReflectAndGenerateRun({...})` — produces a run with strategy `agentType: 'reflect_and_generate'`, at least one invocation row with `agent_name='reflect_and_generate_from_previous_article'` and `execution_detail.tactic='lexical_simplify'`, plus seeded `eloAttrDelta:reflect_and_generate_from_previous_article:lexical_simplify` metric with a SIGNED INTEGER value (e.g. `-15`).
  - Reuse the `eloAttrDelta:*` metric-row factory pattern from `evolution/src/components/evolution/charts/StrategyEffectivenessChart.test.ts:13-90` (extract to `evolution/src/testing/eloAttrFixtures.ts` if not already shared).
  - Cleanup helper extends existing `cleanupAllTrackedEvolutionData()` (per Rule 16 / `require-test-cleanup` ESLint rule).

## Rollback dependency graph (read before reverting)

Phases are NOT independently revertable. Reverse-order revert is required:

```
Phase 1 (data correctness) → mutates renderer + reads `getMetricValue`
   ↓ depended on by
Phase 4 (Fix #1: changes `getMetricValue` to return null for missing rows)
   ↓ depended on by
Phase 5 (Fix #42: handles `cost === 0` at the column level)
```

**Revert order**: P5 → P4 → P3 → P2 → P1. Reverting P1 alone after P4 ships will leave `RunsTable.tsx` Spent fallback referring to a `getMetricValue` contract that returns `null` (post-P4) instead of `0` (pre-P4), producing different-but-still-broken output. Document this graph in `_progress.md` and the eventual PR description.

## Phased Execution Plan

### Phase 1 — Data correctness (Bug-Major, 7 fixes)

**Goal**: stop the run-detail Metrics tab from showing negative dollars; reconcile run-list cost columns; restore reflection observability.

- [x] **Fix #29-31 (negative dollars on Metrics tab)** — `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx`. Refactor BOTH `resolveFormatter()` (line 36-41), `resolveCategory()` (line 29-34), AND `resolveLabel()` (line 43-53) to consume a shared prefix-dispatch table so the prefix list lives in ONE place.

  Step 1 — extend `evolution/src/lib/metrics/types.ts` to export a typed registry alongside `DYNAMIC_METRIC_PREFIXES`:
  ```typescript
  export const DYNAMIC_METRIC_REGISTRY: Record<string, {
    formatter: MetricFormatter;
    category: 'cost' | 'rating' | 'count' | 'match';
    labelSuffix: string; // appended to the prettified suffix; '' for none
  }> = {
    'agentCost:':         { formatter: 'costDetailed', category: 'cost',   labelSuffix: ' Cost' },
    'eloAttrDelta:':      { formatter: 'elo',          category: 'rating', labelSuffix: ' Δ Elo' },
    'eloAttrDeltaHist:':  { formatter: 'percent',      category: 'rating', labelSuffix: ' (bucket)' },
  };
  // Keep DYNAMIC_METRIC_PREFIXES = Object.keys(DYNAMIC_METRIC_REGISTRY) for backward compat.
  ```

  Step 2 — `EntityMetricsTab.tsx` consumes the registry at all three resolver sites:
  ```typescript
  function dynamicMatch(name: string) {
    return Object.entries(DYNAMIC_METRIC_REGISTRY).find(([p]) => name.startsWith(p));
  }
  function resolveFormatter(name: string, entityType: EntityType) {
    const def = getEntityMetricDef(entityType, name);
    if (def) return METRIC_FORMATTERS[def.formatter as MetricFormatter];
    const dyn = dynamicMatch(name);
    return dyn ? METRIC_FORMATTERS[dyn[1].formatter] : METRIC_FORMATTERS.integer;
  }
  function resolveCategory(name: string, entityType: EntityType): Category {
    const def = getEntityMetricDef(entityType, name);
    if (def) return def.category;
    const dyn = dynamicMatch(name);
    return dyn ? dyn[1].category as Category : 'count';
  }
  function resolveLabel(name: string, entityType: EntityType): string {
    const def = getEntityMetricDef(entityType, name);
    if (def) return def.label;
    const dyn = dynamicMatch(name);
    if (!dyn) return name;
    const [prefix, cfg] = dyn;
    const suffix = name.slice(prefix.length); // e.g. "reflect_and_generate_from_previous_article:lexical_simplify"
    const pretty = suffix.split(':').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' / ');
    return pretty + cfg.labelSuffix;
  }
  ```
  This eliminates the dual hard-coded prefix list AND fixes the cosmetic regression where `eloAttrDelta:*` rows would otherwise be labelled "... Cost".

- [x] **Fix #11 (cost columns don't sum)** — three call-sites:
  - `evolution/src/lib/core/metricCatalog.ts:28` flip `reflection_cost.listView` to `true`. Add column entry to `createRunsMetricColumns()` between Ranking Cost and Seed Cost.
  - `evolution/src/components/evolution/tables/RunsTable.tsx:128-133` Spent fallback include `reflection_cost`.
  - `evolution/src/lib/cost/getRunCostWithFallback.ts` (`getRunCostsWithFallback`) — apply the same fallback inclusion so the dashboard `Total Cost` reconciles too. (The runs table comment at line 127 explicitly mirrors this helper.)
- [x] **Fix #38 (Tactic column blank) — TWO call sites**: `evolution/src/services/costEstimationActions.ts:282` (`buildInvocationRows`) AND line 561 (strategy slice breakdown loop). Both read `d.strategy` and both need the same fix:
  ```typescript
  const tactic = (typeof d.tactic === 'string' && d.tactic)
              || (typeof d.strategy === 'string' && d.strategy)
              || null;
  ```
  The truthy-check on `d.tactic` is intentional — the wrapper writes `tactic: ''` (empty string) on early-failure rows (`reflectAndGenerateFromPreviousArticle.ts:309,344`), and the empty string should fall through to the legacy `d.strategy` path.
- [x] **Fix #22 + #40 (reflect_and_generate badge type missing) — three call sites in TWO files**:

  **File A**: `evolution/src/components/evolution/tabs/TimelineTab.tsx`
  - Line 29-42: extend `agentKind()`:
    ```typescript
    function agentKind(name: string): 'generate' | 'swiss' | 'merge' | 'reflect_generate' | 'other' {
      if (name === 'reflect_and_generate_from_previous_article') return 'reflect_generate';
      if (name.includes('merge')) return 'merge';
      if (name.includes('swiss')) return 'swiss';
      if (name.includes('generate')) return 'generate';
      return 'other';
    }
    ```
    Note `reflect_generate` is checked FIRST (the agent's name contains "generate" so the fallthrough order matters).
  - Line 37 `KIND_CONFIG`: add `reflect_generate: { label: 'REFLECT+GEN', color: '#f59e0b' }` (matches the amber `REFLECTION_COLOR` already used by `InvocationTimelineTab.tsx`).
  - Line 304 LEGEND list: append `'reflect_generate'` so the new badge has a key.
  - Line 329-331 `iterAgentType` derivation: extend the ternary to recognize reflect_generate:
    ```typescript
    const isReflectGen = invs.some((i) => agentKind(i.agent_name) === 'reflect_generate');
    const iterAgentType = isReflectGen ? 'reflect_generate'
                        : isGenerate    ? 'generate'
                        : isSwiss       ? 'swiss'
                        : 'other';
    ```

  **File B**: `evolution/src/components/evolution/tabs/CostEstimatesTab.tsx:419,447-449` `PerIterationSummarySection`. Apply the same kind-inference fix.

  Audit pass (in scope): grep for `agentKind\b`, `agentType === 'generate'`, and `agent_name === 'reflect_and_generate'` across `evolution/src/components/evolution/` to find any other switch/ternary that must be widened. (`DispatchPlanView.tsx:118,194,205` is OUT OF SCOPE unless the audit shows visible breakage; flag in `_progress.md` for follow-up.)
- [x] **Fix #35 (Reflection cost summary card missing)** — pre-flight verification confirms reflection labeling is already wired (`createEvolutionLLMClient` has `'reflection'` in `COST_METRIC_BY_AGENT`, mapping to `reflection_cost`; the wrapper calls `llm.complete(prompt, 'reflection', ...)` at `reflectAndGenerateFromPreviousArticle.ts:299`). The visible gap is purely UI-side — the EntityMetricsTab cost section has no `Reflection Cost` summary card alongside `Cost / Generation Cost / Ranking Cost / Seed Cost`. Add it via the existing static-metric path (extend `metricCatalog` to surface `reflection_cost` as a top-level Cost-section metric on run entities). Do NOT modify the wrapper or LLM client.

**Tests** (each Phase-1 fix has at least one assertion — addresses Phase-6 audit gate):

- [x] `evolution/src/components/evolution/tabs/EntityMetricsTab.test.tsx` — three assertions:
  - `resolveFormatter('eloAttrDelta:gfpa:lexical_simplify')` returns `formatElo` (renders `-15` as `-15`, not `$-15.000`).
  - `resolveCategory('eloAttrDelta:...')` returns `'rating'` (groups under "Rating", not "Cost").
  - `resolveLabel('eloAttrDelta:gfpa:lexical_simplify')` ends with `' Δ Elo'` (NOT `' Cost'`).
- [x] `evolution/src/services/costEstimationActions.test.ts` — TWO assertions:
  - `buildInvocationRows` (line 282 site): mock `execution_detail.tactic='curiosity_hook'` row surfaces as `tactic: 'curiosity_hook'`.
  - Strategy slice breakdown (line 561 site): mock invocation with `execution_detail.tactic='lexical_simplify'` populates the `tactic` slice key as `'lexical_simplify'` (not `'unknown'`).
- [x] `evolution/src/components/evolution/tabs/TimelineTab.test.tsx` — TWO assertions:
  - Iteration with agent_name `'reflect_and_generate_from_previous_article'` renders the `REFLECT+GEN` badge.
  - Legend list includes the new badge entry (queryAllByText('REFLECT+GEN')).
- [x] `evolution/src/components/evolution/tabs/CostEstimatesTab.test.tsx` — `PerIterationSummarySection` mock with reflect_and_generate iteration renders `REFLECT+GEN` badge (covers the second site of the #22/#40 fix).
- [x] `evolution/src/components/evolution/tables/RunsTable.test.tsx` — Spent fallback sums all FOUR cost components (`generation_cost + ranking_cost + seed_cost + reflection_cost`) when rollup `cost` is missing.
- [x] `evolution/src/lib/cost/getRunCostWithFallback.test.ts` — same four-component sum assertion at the helper level.
- [x] `evolution/src/components/evolution/tabs/EntityMetricsTab.test.tsx` (continued) — assertion for **Fix #35**: with `reflection_cost=$0.012` in the metrics map, the Cost section renders a summary card labelled "Reflection Cost" with value `$0.0120`.

**E2E** (extend existing `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts`, which already has `afterAll` cleanup per Rule 16):

- [x] **POSITIVE assertions only** (avoids the false-pass when the tab fails to render). Use the test-data factory `createTestReflectAndGenerateRun()` from pre-flight to seed:
  - Wait for hydration: `await page.getByTestId('entity-metrics-grid').waitFor({ state: 'visible' });` (Rule 18).
  - Assert at least one Elo-attribution metric value matches `/^-?\d+$/` (Elo formatter, NOT `/^\$/`).
  - Negative assertion: `await expect(page.getByTestId('entity-metrics-grid')).not.toContainText('$-')` (only valid AFTER positive grid-visibility check above).
  - Cost Estimates tab: assert Tactic column row visible for the seeded reflect+generate invocation; cell text equals the seeded tactic name (use `getByRole('cell', { name: 'lexical_simplify' })` per Rule 3, NOT nth-child).
  - Timeline tab: `await expect(page.getByText('REFLECT+GEN')).toBeVisible()` for the seeded iteration AND the legend.
- [x] Tag the new assertions `{ tag: ['@evolution', '@critical'] }` so the negative-dollar regression is caught on every PR to main (matches `admin-evolution-navigation.spec.ts:16` precedent).

### Phase 2 — Accessibility cluster (5 fixes)

**Goal**: ship the small a11y wins together so the regression test can be one spec.

- [x] **Fix #4/#8 (refresh status not aria-live)** — `evolution/src/components/evolution/AutoRefreshProvider.tsx:117-150`. Add `aria-live="polite"` and `aria-atomic="true"` to the `<span data-testid="refresh-ago">`.
- [x] **Fix #18 (per-row Delete buttons unlabelled) — TWO patches**:
  - **Patch A (inline buttons)**: `src/app/admin/evolution/runs/page.tsx:198` and `src/app/admin/evolution/experiments/page.tsx:236-239` render bare `<button>Delete</button>`. Wrap with `aria-label="Delete run ${row.id.slice(0,8)}"` (or `Delete experiment ${row.name}` for experiments).
  - **Patch B (`EntityListPage.RowAction` infrastructure)**: `evolution/src/components/evolution/EntityListPage.tsx:194-205` renders generic `RowAction` buttons across `prompts/page.tsx` and `strategies/page.tsx`. Extend `RowAction<T>` type to optionally accept `getAriaLabel?: (row: T) => string`; when provided, set `aria-label` on the rendered button. Update the two consumers to pass it.
  - **Skip pages without Delete buttons**: variants, tactics, invocations, arena topic list, arena topic detail — verified by Pass-2 audit to have no per-row Delete buttons. Documented here so reviewers don't expect changes there.
- [x] **Fix #45 (stale tooltip missing)** — `evolution/src/components/evolution/primitives/StatusBadge.tsx`. Add `title="Run/experiment marked stale: claimed/running for >10min without heartbeat"` to the stale badge variant.
- [x] **Fix #32 (asterisk legend missing)** — `evolution/src/components/evolution/primitives/MetricGrid.tsx`. Add an inline footnote `* indicates n=2 (low sample)` when any rendered metric has the asterisk.
- [x] **Fix #52 (arena dim legend invisible)** — `src/app/admin/evolution/arena/[topicId]/page.tsx:264-267`. Promote the existing cutoff line to a callout box with a small icon, AND attach `title="Below top 15% Elo cutoff — dimmed"` to each dimmed row.

**Tests**:
- [x] Unit: `AutoRefreshProvider.test.tsx` — assert `aria-live="polite"`.
- [x] Unit: `StatusBadge.test.tsx` — assert `title` attribute on stale variant.
- [x] Unit: `MetricGrid.test.tsx` — assert footnote renders when any metric has `n < 3`.
- [x] E2E: extend `admin-evolution-accessibility.spec.ts` (already exists per `testing_setup.md`): assert per-row Delete buttons have unique aria-labels.

### Phase 3 — Browser tab titles + sidebar header (3 fixes)

> **Both run-detail (`runs/[runId]/page.tsx`) and arena-topic-detail (`arena/[topicId]/page.tsx`) are `'use client'` components — `generateMetadata` is server-only and Next.js will reject it. Use the `useEffect(() => { document.title = ... })` pattern, which is already used by `runs/page.tsx:83`, `arena/page.tsx:58`, `experiments/page.tsx:130`. Accept the SSR title gap (acceptable for an admin-only page).**

- [x] **Fix #21 (run detail tab title)** — `src/app/admin/evolution/runs/[runId]/page.tsx`. Add inside the existing component:
  ```typescript
  useEffect(() => {
    if (runId) document.title = `Run ${runId.slice(0,8)} | Evolution`;
  }, [runId]);
  ```
- [x] **Fix #50 (arena topic detail tab title)** — `src/app/admin/evolution/arena/[topicId]/page.tsx`. Same pattern, using the topic name once loaded:
  ```typescript
  useEffect(() => {
    if (topic?.name) document.title = `${topic.name} | Arena | Evolution`;
  }, [topic?.name]);
  ```
- [x] **Fix #2/#19 (sidebar header static)** — `evolution/src/components/evolution/EvolutionSidebar.tsx:48`. Replace hardcoded "Evolution Dashboard" with the current section name derived from pathname (e.g., "Evolution / Runs"). Cleaner: just say "Evolution" and let the breadcrumb carry section context.

**Tests**:
- [x] Unit: `EvolutionSidebar.test.tsx` — assert title text comes from pathname-derived label.
- [x] E2E: add to `admin-evolution-navigation.spec.ts` — `expect(page).toHaveTitle(/Run [a-f0-9]{8}/)` after navigating to a run detail.

### Phase 4 — List/table polish (8 fixes)

- [x] **Fix #1 (cost=0 vs unknown)** — `evolution/src/lib/utils/formatters.ts` (`formatCost`). Treat `value === 0` from a metric row that lacks the rollup the same as `null` — render `'—'` or `$0 *` with footnote. Audit: the runs list `Spent` cell currently calls `formatCost(getMetricValue(run.metrics, 'cost'))` and `getMetricValue` returns 0 when missing — change to return `null` when the metric row is absent.
- [x] **Fix #14 (Estimation Error % column unclear)** — `evolution/src/lib/core/metricCatalog.ts:213`. Update `description` to `'Mean per-invocation estimation error %. Negative = actual was less than estimated (over-estimate).'`.
- [x] **Fix #15 (no page-size selector)** — `evolution/src/components/evolution/EntityListPage.tsx`. Add a `PageSize: 20 ▼` dropdown next to pagination with options `10, 20, 50, 100`. Default 20 (preserve current). Wire to existing `pageSize` query param.
- [x] **Fix #20 (count below heading)** — `EntityListPage.tsx:228-235`. Render heading as `{title} <span class="muted">({count})</span>`.
- [x] **Fix #25 (chip prefixes redundant)** — `EntityDetailHeader.tsx:154-161`. Remove the `{prefix}:` prefix; rely on chip ordering + section context. Keep the prefix only on the first chip if absolutely needed for screen readers (use `<span class="sr-only">`).
- [x] **Fix #41 (abs error formula confusing)** — `CostEstimatesTab.tsx`. Add `<HelpTooltip>` next to the ABS ERROR card explaining "Mean of per-invocation \|actual − estimated\|, NOT \|sum_actual − sum_estimated\|. Use ERROR % for run-level total error."
- [x] **Fix #43 (SE > mean threshold)** — `CostEstimatesTab.tsx:156`. If `SE > 1.5 * |mean|`, render the SE in muted color and add a `title="High variance — interpret with care"` attribute.
- [x] **Fix #44 (experiments list cell density)** — `src/app/admin/evolution/experiments/page.tsx`. Combine the Best Winner Elo value and CI into one cell using `formatEloCIRange()` (already exported per `formatters.ts`).

**Tests**:
- [x] Unit: `formatters.test.ts` — `formatCost(null) === '—'`, `formatCost(0) === '$0.00'`, `getMetricValue` returns null for missing metric.
- [x] Unit: `EntityListPage.test.tsx` — page-size dropdown changes effective page size.
- [x] Unit: `metricCatalog.test.ts` — `Estimation Error %` description includes "over-estimate".
- [x] E2E: extend `admin-evolution-runs.spec.ts` — assert pagination dropdown is visible and clicking 50 increases visible row count.

### Phase 5 — Arena consistency + remaining polish (8 fixes)

- [x] **Fix #9 (refresh button glyph)** — `AutoRefreshProvider.tsx:146`. Replace `↻ Refresh` with `<RefreshIcon aria-hidden /> Refresh` (using existing icon library).
- [x] **Fix #27 (no completion timestamp on run header)** — `EntityDetailHeader.tsx`. Add optional `subtitle` prop rendered below the heading. Pass `Completed ${formatRelative(completed_at)} (${formatAbsolute(completed_at)})` from run detail page.
- [x] **Fix #37 (cost estimates loading skeleton too small)** — `CostEstimatesTab.tsx:655-663`. Replace `<LoadingSkeleton h-24 />` with a multi-row skeleton matching the actual layout (5 summary cards + table skeleton).
- [x] **Fix #39 (GFSA histogram degenerate buckets)** — `costEstimationConstants.ts:5-11`. Compute buckets dynamically from data range when all values fall within a single fixed bucket (fall back to fixed buckets when range > 50%).
- [x] **Fix #46 (Cancel/Delete column ambiguity)** — `experiments/page.tsx`. Replace conditional Cancel-or-Delete with a small `⋯` menu button per row → "Cancel" or "Delete" options as appropriate. Reduces vertical column ambiguity.
- [x] **Fix #47 (search placeholder visible empty)** — `experiments/page.tsx:49` already sets `placeholder: 'Search...'`. Investigate why Playwright snapshot showed empty — likely a CSS specificity issue. Fix at `EntityListPage.tsx:305` if the placeholder is being overridden.
- [x] **Fix #49 (arena count "X of Y")** — `evolution/src/components/evolution/EntityListPage.tsx:232-235`. When list is filtered, change "{N} items" to "{visible} of {total} items".
- [x] **Fix #51 (arena column-visibility picker)** — extract a shared primitive instead of copy-pasting:
  - **Step 1**: extract `ColumnPicker` from `runs/page.tsx:46` into `evolution/src/components/evolution/primitives/ColumnPicker.tsx`. Re-export via `evolution/src/components/evolution/index.ts` barrel. Update runs page to import the new primitive (no behavior change).
  - **Step 2**: extract the SSR-safe persistence dance from `runs/page.tsx:91-116` (`useState(() => new Set())` + load-in-`useEffect` + `hiddenColsLoaded` gate) into a reusable hook `evolution/src/components/evolution/hooks/usePersistedHiddenColumns.ts`. Both runs and arena pages consume it.
  - **Step 3**: use `<ColumnPicker>` + `usePersistedHiddenColumns('evolution-arena-leaderboard-hidden-columns')` on `src/app/admin/evolution/arena/[topicId]/page.tsx`.
  - This prevents a third copy when experiments list eventually gets one.
- [x] **Fix #53 (arena status plain text)** — `arena/page.tsx:48`. Change `render: (t) => t.status` to `render: (t) => <EvolutionStatusBadge status={t.status} variant="run-status" />`.
- [x] **Fix #42 (extreme outliers display)** — experiments list `Avg Estimation Error %` column. The plan does NOT introduce a new `formatErrorPct` function (none exists in `formatters.ts` — only `formatPercentValue`). Instead, handle the `cost === 0` case at the column-render level in `evolution/src/lib/metrics/metricColumns.tsx` (or wherever the column accessor lives — verify in Phase 5 by `grep -rn "estimation_error_pct\|Avg Estimation Error"`):
  ```typescript
  // In column.render(row):
  const totalCost = row.metrics.find(m => m.metric_name === 'total_cost')?.value ?? 0;
  if (totalCost === 0) return <span title="No cost recorded — error % undefined">—</span>;
  return formatPercentValue(value);
  ```

**Tests**:
- [x] Unit: `EntityListPage.test.tsx` — count displays "X of Y" when filter is active.
- [x] Unit: `metricColumns.test.tsx` — Avg Estimation Error % column with `total_cost=0` row renders `'—'` (NOT `-100%`); with `total_cost>0` renders the percent value via `formatPercentValue`.
- [x] E2E: `admin-arena.spec.ts` — assert column-visibility picker is visible on arena leaderboard; assert status badge renders (not plain text). Call the existing `resetFilters()` POM helper after `gotoArena*()` per testing_overview Rule 1.

### Phase 6 — Final regression suite

- [x] Run full test matrix: `npm run lint && npm run typecheck && npm run build && npm test`.
- [x] Run `npm run test:e2e:critical` (~18 tests, target <3min).
- [x] Run `npm run test:e2e:evolution` (~45 tests).
- [x] Audit test coverage: every Phase-1 Bug-Major fix must have at least one assertion (unit OR E2E).
- [x] Commit phase 6 (final regression run).

### Out of scope (explicitly deferred)

These findings are dropped or deferred:

| # | Reason |
|---|---|
| #3, #5, #6, #7, #10, #13, #16, #17, #23, #24, #26, #28, #33, #34, #36, #48 | False positives per pass-2 audit. |
| #6/#48 (test-content patterns) | Filter is working as designed; expanding `evolution_is_test_name` patterns or renaming legacy strategies is a separate project. |
| #12 (default 14 columns) | Already mitigated by per-user `localStorage` persistence — first-paint flash is acceptable for an admin tool. |

### Rollback Strategy

- Each phase is its own commit. **Revert in REVERSE order from the latest phase shipped** (P5 → P4 → P3 → P2 → P1) — see "Rollback dependency graph" near the top of this plan. Phase 4 mutates the `getMetricValue` contract (returns null for missing rows instead of 0), which Phase 1's `RunsTable` Spent fallback consumes; reverting P1 alone after P4 ships will leave the fallback running against the post-P4 contract.
- Pre-flight branch-conflict check (above) is the load-bearing prerequisite: if `feat/look_for_bugs_evolution_20260501` already touched any of the same files, this plan cannot ship until the overlap is resolved (rebase, cherry-pick, or coordinate).
- Phase 1 is the only data-correctness phase; if a regression hits production after the full set of phases is shipped, the safest recovery is to revert P5→P1 in order and re-evaluate.

### CI Gate Per Phase

To match `/finalize` expectations without burning CI:

- **Phases 1–5 (each)**: `npm run lint && npm run typecheck && npm test && npm run test:e2e:critical` (~5min total, no build, no full E2E).
- **Phase 1 ONLY (extra)**: `npm run test:e2e:evolution` after lint+tsc+unit (catches the new metrics tab + cost estimates assertions).
- **Phase 6 (final)**: full matrix — `npm run lint && npm run typecheck && npm run build && npm test && npm run test:e2e` (mirrors `/finalize`).
- Rationale: build is expensive (~3 min) and only matters for production-shape compilation, which is asserted at Phase 6. Per-phase build adds ~15 min total with no incremental safety benefit since all phases land in one PR.

## Testing

Tests are written per-phase alongside fixes (not deferred to a single test phase).

### Unit Tests
- [x] Phase 1: 4 unit tests (EntityMetricsTab formatter, costEstimationActions tactic, TimelineTab badge, RunsTable fallback).
- [x] Phase 2: 3 unit tests (AutoRefreshProvider aria-live, StatusBadge stale title, MetricGrid asterisk footnote).
- [x] Phase 3: 1 unit test (EvolutionSidebar pathname-derived title).
- [x] Phase 4: 3 unit tests (formatters, EntityListPage page-size dropdown, metricCatalog description).
- [x] Phase 5: 2 unit tests (filtered count display, errorPct null when cost=0).

### Integration Tests
- [x] None new — existing `evolution-cost-attribution.integration.test.ts` already covers metric persistence; verify it still passes after Phase 1 changes.

### E2E Tests

- [x] Extend `admin-evolution-run-pipeline.spec.ts`: assert no `$-` text on Metrics tab; assert Tactic non-empty on Cost Estimates; assert reflect+generate badge.
- [x] Extend `admin-evolution-accessibility.spec.ts`: assert per-row Delete buttons have unique aria-labels; assert refresh status has aria-live.
- [x] Extend `admin-evolution-navigation.spec.ts`: assert browser tab title matches `/Run [a-f0-9]{8}/`.
- [x] Extend `admin-evolution-runs.spec.ts`: assert page-size dropdown.
- [x] Extend `admin-arena.spec.ts`: assert column-picker visible; status badge renders.

### Manual Verification

- [x] Open a reflect+generate run's Metrics tab in browser; verify no negative dollar values, all metric labels readable.
- [x] Open run-list in browser at 1280px viewport; verify default columns fit (after Phase 4 page-size change is independent — column count is still 14, but per-user localStorage persists choice).
- [x] Navigate to arena topic detail; verify column picker is visible.
- [x] Test keyboard-only nav across run-detail page tabs; verify per-row Delete buttons announce unique labels via screen reader.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Run `npm run test:e2e:critical` after each phase commit.
- [x] Run `npm run test:e2e:evolution` after Phase 1 (most evolution-touching).
- [x] Final `npm run test:e2e` in Phase 6.

### B) Automated Tests (per-phase)

Per "CI Gate Per Phase" above:
- [x] Phases 1-5: `npm run lint && npm run typecheck && npm test && npm run test:e2e:critical` after each.
- [x] Phase 1 only: also run `npm run test:e2e:evolution`.
- [x] Phase 6: full matrix including `npm run build` and `npm run test:e2e`.

## Documentation Updates
- [x] `evolution/docs/visualization.md` — note the new `REFLECT+GEN` badge in Timeline + Cost Estimates sections; note new `ColumnPicker` primitive + `usePersistedHiddenColumns` hook now used by runs and arena pages.
- [x] `evolution/docs/metrics.md` — document the new `DYNAMIC_METRIC_REGISTRY` typed registry in `lib/metrics/types.ts` so future contributors who add a dynamic prefix know to declare its formatter + category + label suffix in one place.
- [x] `evolution/docs/cost_optimization.md` — note that the runs list `Spent` fallback and `getRunCostsWithFallback` helper now include `reflection_cost`.
- [x] `docs/feature_deep_dives/admin_panel.md` — update the Spent column description to reflect `Reflection Cost` as a sibling column; update arena page section to mention the new column-visibility picker.

## Review & Discussion

### Iteration 1 (Scores: Security 3/5, Architecture 3/5, Testing 3/5)

**Critical gaps fixed**:

1. **[Security] `d.strategy → d.tactic` patch incomplete** — Fixed: Phase 1 #38 now patches BOTH line 282 (`buildInvocationRows`) AND line 561 (strategy slice breakdown).
2. **[Security] `resolveLabel` cosmetic regression** — Fixed: Phase 1 #29-31 now refactors all THREE resolvers (`resolveFormatter`, `resolveCategory`, `resolveLabel`) to share a typed `DYNAMIC_METRIC_REGISTRY` so labels render `' Δ Elo'` not `' Cost'` for attribution metrics.
3. **[Security] In-flight branch overlap risk** — Fixed: Added Pre-flight section requiring branch-conflict check against `feat/look_for_bugs_evolution_20260501` before starting Phase 1.
4. **[Architecture] `generateMetadata` on `'use client'` page** — Fixed: Phase 3 #21 + #50 both now use `useEffect(() => { document.title = ... })` pattern matching existing pages (`runs/page.tsx:83`, `arena/page.tsx:58`).
5. **[Architecture] `agentKind` widening missed legend + iterAgentType** — Fixed: Phase 1 #22/#40 now lists FOUR call sites (line 29-42 `agentKind`, line 37 `KIND_CONFIG`, line 304 legend list, line 329-331 `iterAgentType` derivation) plus the second site in CostEstimatesTab.
6. **[Architecture] #18 Per-row Delete fix conflated patterns** — Fixed: Phase 2 #18 now splits into Patch A (inline buttons in runs/experiments) and Patch B (`RowAction` infrastructure for prompts/strategies via `getAriaLabel?` prop). Skipped pages without Delete buttons are explicitly listed.
7. **[Testing] `formatErrorPct` references non-existent function** — Fixed: Phase 5 #42 now handles `cost === 0` at the column-render level using existing `formatPercentValue`. Phase 5 test entry updated to assert at `metricColumns.test.tsx`.
8. **[Testing] Cross-phase coupling breaks rollback claim** — Fixed: Added "Rollback dependency graph" section explicitly listing P5 → P4 → P3 → P2 → P1 reverse-revert order; Rollback Strategy section updated to point to it.
9. **[Testing] `no $- prefix` E2E false-pass risk** — Fixed: Phase 1 E2E now requires positive grid-visibility check (`getByTestId('entity-metrics-grid').waitFor({ state: 'visible' })` per Rule 18) AND positive value-format assertion (`/^-?\d+$/`) BEFORE the negative `not.toContainText('$-')` assertion. Tagged `['@evolution', '@critical']`.
10. **[Testing] Fix #35 had no unit test** — Fixed: Phase 1 Tests block now includes EntityMetricsTab assertion that `reflection_cost=$0.012` renders as a "Reflection Cost" summary card.
11. **[Testing] Fix #22/#40 only tested TimelineTab** — Fixed: Phase 1 Tests block now includes `CostEstimatesTab.test.tsx` covering `PerIterationSummarySection` reflect_and_generate badge.
12. **[Testing] Test-data factory extension missing** — Fixed: Pre-flight now adds `createTestReflectAndGenerateRun(...)` to both `evolution-test-data-factory.ts` (E2E) and `evolution-test-helpers.ts` (unit), reusing existing `eloAttrDelta:*` factory pattern.

**Minor issues addressed**:

- Phase 1 #11 now also patches `evolution/src/lib/cost/getRunCostWithFallback.ts` so the dashboard `Total Cost` reconciles too (not just runs-list Spent).
- Phase 5 #51 now extracts `ColumnPicker` primitive + `usePersistedHiddenColumns` hook so arena leaderboard reuses runs-list code (not a third copy).
- CI gate per phase reduced to lint+tsc+unit+e2e:critical (not full build/E2E) to avoid burning ~15min per phase; Phase 6 retains full matrix to mirror `/finalize`.
- Documentation Updates expanded to include `docs/feature_deep_dives/admin_panel.md`.

### Iteration 2 — CONSENSUS REACHED (Security 5/5, Architecture 5/5, Testing 5/5)

All three reviewers voted 5/5 with zero critical gaps. Plan is ready for execution.

**Remaining minor notes for the implementer (non-blocking polish)**:

- Phase 4: extend `getMetricValue → null` audit with `grep -rn 'getMetricValue(' evolution/src src/app` to enumerate all call sites that may rely on the implicit-0 contract.
- Phase 1: drop the backward-compat `DYNAMIC_METRIC_PREFIXES = Object.keys(DYNAMIC_METRIC_REGISTRY)` aliasing in a follow-up; make the registry the single source of truth.
- Phase 5 #51: ColumnPicker extraction must preserve the existing per-column visibility callback signature (document the prop API explicitly in the implementation PR).
- Phase 5 #51: specify the on-disk JSON shape for `evolution-arena-leaderboard-hidden-columns` and add a defensive parse fallback for stale data.
- Pre-flight grep: also include `evolution/src/lib/metrics/types.ts` and `evolution/src/lib/cost/getRunCostWithFallback.ts` in the branch-conflict scan.
- Phase 5 manual-verification list: add bullets for the Phase-5 visual deltas (#37 multi-row skeleton, #46 ⋯ menu, #53 status badge).
- Phase 1 unit tests: extract a shared `eloAttrFixtures.ts` helper so TimelineTab and CostEstimatesTab tests don't drift on fixture shape.
- Documentation note in `metrics.md`: explicitly require documenting the invariant `Object.keys(DYNAMIC_METRIC_REGISTRY) === DYNAMIC_METRIC_PREFIXES` so future contributors don't add a prefix-only entry.
