# investigate_issues_latest_evolution_reflection_agent_20260501 Plan

## Background
The strategy creation wizard's dispatch preview shows the *initial parallel-batch size* only. It does not model the within-iteration top-up loop (Phase 7b in `runIterationLoop.ts`) that fills the remaining iter budget after the parallel batch's `actualAvgCostPerAgent` comes in below `upperBound`. This makes the displayed dispatch counts look absurdly low — e.g. strategy `d75c9dfc-f9d3-4d32-9bb2-964fa9a96977` showed 2/1/1/1 in the wizard but the actual run dispatched 6/4/(pending)/(pending). Users reading the preview don't realize top-up will fill the budget.

## Requirements (from GH Issue #NNN)
- Cost estimates on strategy preview seem off for d75c9dfc-f9d3-4d32-9bb2-964fa9a96977
- Said could get 2 agents in iteration one (despite per invocation cost being far far lower than budget), and 1 each in iterations 2-4

## Problem
`projectDispatchPlan.ts:218` self-documents: "This function does NOT model top-up — it returns the initial parallel-batch size, same as today's runtime." The wizard renders only `entry.dispatchCount`, which uses `upperBound` per-agent cost and is gated by `parallelFloorUsd = 2 × upperBound` for this strategy. The runtime then top-ups using actual per-agent cost (much lower than upperBound), tripling dispatch in practice. Users can't see this and infer the strategy is mis-budgeted.

## Options Considered
- [x] **Option A: Show `maxAffordable.atExpected` as a second column** — already computed, tiny patch. But still conservative because `parallelFloorUsd` is locked to `upperBound`, so iter 1 of the example shows 3 (vs observed 6). **Rejected** — doesn't actually answer the complaint.
- [x] **Option B: Simulate top-up in `projectDispatchPlan` and surface a "Likely total" column** *(chosen)* — keep existing `dispatchCount` (parallel batch, reservation-safe) and add `expectedTotalDispatch` that adds top-up estimate using `expected.total` per-agent cost. Math matches observed reality.
- [x] **Option C: Update warning copy only** — minimal effort but doesn't fix the misleading number. **Rejected** — the number is the user's primary signal.

## Phased Execution Plan

### Phase 1: Add top-up simulation to `projectDispatchPlan`

- [ ] **Thread env flags via options, not `process.env` reads.** `projectDispatchPlan.ts` is the SOT consumed by runtime + wizard + cost-sensitivity counterfactuals; env-driven branching breaks reproducibility. Add an optional 3rd argument:
  ```typescript
  export interface DispatchPlanOptions {
    /** When false, top-up simulation is skipped (expectedTotalDispatch = dispatchCount).
     *  Mirrors EVOLUTION_TOPUP_ENABLED kill-switch. Default true. */
    topUpEnabled?: boolean;
    /** When false, reflection cost is zeroed out for `reflect_and_generate` iterations
     *  (mirrors EVOLUTION_REFLECTION_ENABLED kill-switch which falls those iters back to
     *  vanilla GFPA dispatch in runIterationLoop). Default true. */
    reflectionEnabled?: boolean;
  }
  export function projectDispatchPlan(
    config: EvolutionConfig,
    ctx: DispatchPlanContext,
    opts: DispatchPlanOptions = {},
  ): IterationPlanEntry[]
  ```
  Callers (`getStrategyDispatchPreviewAction`, `costEstimationActions`, runtime) resolve env at their own boundary and pass explicit booleans, mirroring how `runIterationLoop.ts` reads `EVOLUTION_TOPUP_ENABLED` once at iteration entry.
- [ ] Extend `IterationPlanEntry` in `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts` with two new fields:
  ```typescript
  /** Top-up-aware projection: parallel batch + estimated top-up agents using expected
   *  per-agent cost. Capped at DISPATCH_SAFETY_CAP. Always >= dispatchCount. When opts.topUpEnabled=false, equals dispatchCount. */
  expectedTotalDispatch: number;
  /** Top-up agents projected beyond the parallel batch. expectedTotalDispatch - dispatchCount. */
  expectedTopUpDispatch: number;
  ```
- [ ] **Honor `reflectionEnabled` in cost computation.** Inside the iteration loop:
  ```typescript
  const useReflection = iterCfg.agentType === 'reflect_and_generate' && (opts.reflectionEnabled ?? true);
  ```
  When ops flips `EVOLUTION_REFLECTION_ENABLED=false`, `reflect_and_generate` iters fall back to vanilla GFPA at runtime (`reflectionDispatch.ts`), so the projection must zero out reflection cost — otherwise the wizard inflates per-agent cost in the very scenario the user complained about.
- [ ] In the iteration loop body, after computing `dispatchCount`, simulate top-up:
  ```typescript
  // Simulate Phase 7b top-up loop. Runtime gate: `while (remaining - actualAvgCost >= sequentialFloor)`.
  // Algebraically equivalent to `K_total <= (iterBudget - sequentialFloor) / actualAvgCost`
  // where K_total = parallel + topUp (parallel spend cancels out in the substitution).
  // We use `totalExpected` as the proxy for `actualAvgCost` and pass `upper.total` as
  // `initialAgentCostEstimate` to mirror runIterationLoop.ts's call: it passes
  // (cfg, iterBudget, estPerAgent /* upper */, actualAvgCost). For the preview,
  // actualAvgCost is unknown pre-run, so we substitute totalExpected (calibrated proxy).
  if (opts.topUpEnabled === false) {
    expectedTotalDispatch = dispatchCount;
    expectedTopUpDispatch = 0;
  } else {
    const sequentialFloorUsd = resolveSequentialFloor(config, iterBudgetUsd, upper.total, totalExpected);
    const expectedTotalAffordable = totalExpected > 0
      ? Math.max(dispatchCount, Math.floor((iterBudgetUsd - sequentialFloorUsd) / totalExpected))
      : dispatchCount;
    expectedTotalDispatch = Math.min(DISPATCH_SAFETY_CAP, expectedTotalAffordable);
    expectedTopUpDispatch = expectedTotalDispatch - dispatchCount;
  }
  ```
  Inline comment in the implementation should explain why `parallel * actualAvgCost` doesn't appear explicitly in the formula (it cancels in `K_total = parallel + floor((iterBudget - parallelSpend - floor)/cost) = floor((iterBudget - floor)/cost)`) — prevents future "fix" attempts.
- [ ] Update pool growth to use `expectedTotalDispatch` for the next iteration's `poolSize`, since rank cost depends on the variants present going into the next iter (matches what the runtime sees post-top-up).
- [ ] **Update existing pool-growth test** at `evolution/src/lib/pipeline/loop/projectDispatchPlan.test.ts:82-96` (currently asserts `plan[1].poolSizeAtStart === 10 + plan[0].dispatchCount`) → change to `=== 10 + plan[0].expectedTotalDispatch`. Without this, CI goes red on the first commit.
- [ ] Add new unit tests in the same file:
  - Case 1: d75c9dfc strategy config inlined (4-iter, 25% each, gemini-flash-lite + qwen, $0.05 budget, `minBudgetAfterParallelAgentMultiple: 2`). Assert `plan[0].expectedTotalDispatch >= 5 && <= 7` and `plan[1].expectedTotalDispatch >= 3 && <= 5`. Use a band rather than exact value because `EXPECTED_GEN_RATIO` and `EXPECTED_RANK_COMPARISONS_RATIO` are placeholder heuristics that may be recalibrated.
  - Case 2: `opts.topUpEnabled = false` — assert `expectedTotalDispatch === dispatchCount` and `expectedTopUpDispatch === 0`. No `process.env` mutation needed since flags are passed via params.
  - Case 3: `opts.reflectionEnabled = false` on a strategy with `reflect_and_generate` iterations — assert per-agent cost matches plain `generate` (no reflection added), and `expectedTotalDispatch` is correspondingly higher.
  - Case 4: swiss iteration — assert `expectedTotalDispatch === 0` (matches `dispatchCount === 0`).
  - Case 5: tiny iter budget where parallel batch already saturates expected — assert `expectedTopUpDispatch === 0`, `expectedTotalDispatch === dispatchCount`.

### Phase 2: Surface in wizard preview UI

- [ ] **Backfill pre-existing drift**: extend `IterationPlanEntryClient` in `evolution/src/services/strategyPreviewActions.ts:198-215` to also include the existing-but-omitted `reflection: number` field on both `expected` and `upperBound` (the server's `EstPerAgentValue` carries it; the client mirror does not — pre-existing bug). Add a brief unit test that compares object shape via `Object.keys()` between server `EstPerAgent` and client mirror to prevent future drift.
- [ ] Extend `IterationPlanEntryClient` to include the two new fields from Phase 1 (`expectedTotalDispatch`, `expectedTopUpDispatch`). Mark them as required (matching the server type).
- [ ] **Resolve env at the server-action boundary**: in `getStrategyDispatchPreviewAction`, read `process.env.EVOLUTION_TOPUP_ENABLED` and `process.env.EVOLUTION_REFLECTION_ENABLED` (string-equality `!== 'false'` per existing convention) and pass them to `projectDispatchPlan(parsed.config, ctx, { topUpEnabled, reflectionEnabled })`. Document at the call site that the wizard process's env may differ from the evolution backend process's env (Next.js server vs evolution worker) — when they diverge, the preview projects what the WIZARD process believes is enabled, which may not match runtime. This is acceptable because in practice both processes share the same deployment env file; flag in inline comment.
- [ ] Add a "Likely total" column to `evolution/src/components/evolution/DispatchPlanView.tsx`:
  - Header: `Likely total (with top-up)`
  - Cell content: `{entry.expectedTotalDispatch}` with a sub-line `parallel {dispatchCount} + top-up {expectedTopUpDispatch}` when `expectedTopUpDispatch > 0`. Hide sub-line when 0 (they match).
  - Place the column between `Dispatch` and `$/Agent` so the eye reads "parallel batch → realistic total → cost".
  - Add a `title` tooltip explaining: "Parallel batch is reservation-safe (sized at upper-bound cost). Top-up runs after the parallel batch using actual cost feedback. EVOLUTION_TOPUP_ENABLED=false disables top-up."
- [ ] **Update tfoot for the new column.** Currently line 150 uses `colSpan={3}` (Iter+Type+Iter Budget) and line 153-154 has a single cell summing `totalPlannedDispatch`. Add a new `<td>` between line 153 and 154 that sums `expectedTotalDispatch` across iterations (computed alongside existing `totalPlannedDispatch`). Update both the totals row AND any conditional `showActual` columns so cell counts match the header. Keep the spacing consistent.
- [ ] Update the wizard footer disclaimer (lines 175-183) to mention top-up: "...The runtime top-ups beyond the parallel batch using actual cost feedback; the 'Likely total' column projects this. When `EVOLUTION_TOPUP_ENABLED=false`, the projection collapses to the parallel batch." Keep the calibration provenance text.
- [ ] Update the "tinyIter" warning text in `DispatchPlanWarnings`: when `dispatchCount <= 1` AND `expectedTotalDispatch > dispatchCount`, change copy from "budget is marginal" to "parallel batch is bound by floor — top-up will likely add ~N more agents at runtime." When `expectedTotalDispatch <= 1` too, keep the original "increase budget" message.
- [ ] **Verify no E2E selector breakage**: grep `src/__tests__/e2e/specs/` for selectors that target the `dispatch-plan-*` table by column index or `nth-child`. Adding a column shifts subsequent column indices. If any fragile selectors exist, prefer fixing them up-front rather than waiting for E2E failure. Specs to check: `evolution-strategy-wizard-tactics.spec.ts` and similar.

### Phase 3: Tests + manual verification

- [ ] **Update shared test fixture** in `evolution/src/components/evolution/DispatchPlanView.test.tsx` (the `makeEntry()` helper around line 9-28) to include sensible defaults for the new required fields: `expectedTotalDispatch: dispatchCount` (matching, so existing tests' assertions about totals still hold) and `expectedTopUpDispatch: 0`. Without this, all 10 existing test cases will fail TypeScript compilation when `IterationPlanEntryClient` extends.
- [ ] Update `evolution/src/components/evolution/DispatchPlanView.test.tsx` to cover the new column:
  - Renders sub-line when `expectedTopUpDispatch > 0`.
  - Hides sub-line when top-up is 0.
  - Tooltip text present.
  - Footer's new "Likely total" cell sums `expectedTotalDispatch` correctly across multiple iters.
- [ ] Update warning test cases in same file for new copy:
  - When `dispatchCount=1, expectedTotalDispatch=5` → new "parallel batch is bound by floor — top-up will likely add ~4 more" copy.
  - When `dispatchCount=1, expectedTotalDispatch=1` → keep original "increase budget" copy.
- [ ] Update CostEstimatesTab tests if they exercise dispatch plan rendering (likely none, since CostEstimatesTab uses different rendering — verify before implementing).

## Testing

### Unit Tests
- [ ] `evolution/src/lib/pipeline/loop/projectDispatchPlan.test.ts` — 4 new cases per Phase 1
- [ ] `evolution/src/components/evolution/DispatchPlanView.test.tsx` — column rendering + tooltip + warning copy

### Integration Tests
- [ ] None — `projectDispatchPlan` is pure; no DB or runtime integration changes.

### E2E Tests
- [ ] None — wizard UI is covered by existing strategy-create specs; the column addition is non-blocking. (Skip unless we discover a regression.)

### Manual Verification
- [ ] Open `/admin/evolution/strategies/new`, paste the d75c9dfc config, and confirm the preview shows iter 1 "Likely total: ~6", iter 2 "~4" (allow ±1 due to heuristic ratios). Compare against actual run a0cdf104 (and any new run launched).
- [ ] Toggle `EVOLUTION_TOPUP_ENABLED=false` env var, **restart tmux dev server** (the env var is read by the Node server-action process, not the browser — without restart the change won't take effect), reload preview, confirm "Likely total" collapses back to `dispatchCount`.
- [ ] Toggle `EVOLUTION_REFLECTION_ENABLED=false` similarly, restart server, reload preview for the d75c9dfc config — confirm reflection cost is zeroed and `expectedTotalDispatch` for iters 2-4 is correspondingly higher (since GFPA-only is cheaper than reflect+GFPA).
- [ ] Test with a strategy where parallel batch already saturates (e.g. high budget per iter with cheap model) — confirm "Likely total" doesn't show a misleading sub-line of "+0".

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Manual UI check via the wizard at `/admin/evolution/strategies/new` — described in Manual Verification above.

### B) Automated Tests
- [ ] `cd evolution && npx vitest run src/lib/pipeline/loop/projectDispatchPlan.test.ts`
- [ ] `cd evolution && npx vitest run src/components/evolution/DispatchPlanView.test.tsx`
- [ ] Full evolution suite green: `cd evolution && npx vitest run`

## Documentation Updates
- [ ] `docs/feature_deep_dives/evolution_metrics.md` — under "Dispatch Prediction", add a paragraph explaining the new top-up-aware projection field and that the wizard surfaces it.
- [ ] `docs/feature_deep_dives/multi_iteration_strategies.md` — under "Within-Iteration Top-Up (Phase 7b)", note that the wizard now projects top-up via `expectedTotalDispatch`.
- [ ] `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts` — update the file header comment (currently says "does NOT model top-up") to reflect that it now does (approximate, via `expected.total` proxy), and that the projection is gated by the new `opts.topUpEnabled` and `opts.reflectionEnabled` parameters.
- [ ] `evolution/docs/reference.md` — update the `EVOLUTION_TOPUP_ENABLED` row in the Kill-Switch table (line ~401): expand "Effect when 'false'" to: "Skips the within-iteration top-up loop AND collapses the wizard preview's `expectedTotalDispatch` to `dispatchCount`. Both runtime and preview consult the flag so they remain consistent."
- [ ] `evolution/docs/reference.md` — add a new row for `EVOLUTION_REFLECTION_ENABLED` if not already present (it is — verify the description mentions both runtime fallback AND wizard preview cost zeroing).

## Review & Discussion

### /plan-review consensus (2 iterations to 5/5)

**Iteration 1 scores:** Security 2/5 · Architecture 3/5 · Testing 3/5

**Iteration 1 critical gaps (all addressed in plan above):**
1. *Security*: `resolveSequentialFloor` arg mismatch — fixed to `(config, iterBudget, upper.total, totalExpected)` mirroring runtime's `(cfg, iterBudget, estPerAgent /* upper */, actualAvgCost)` call site.
2. *Security*: claimed off-by-one — orchestrator re-derived: runtime gate `while (remaining - x >= floor)` algebraically yields `K_total <= floor((iterBudget - floor)/x)` (parallel*x term cancels). Plan formula matches; no fix needed.
3. *Security*: `EVOLUTION_REFLECTION_ENABLED` ignored — fixed by threading `reflectionEnabled` through `DispatchPlanOptions`; `useReflection` now conjoins this flag, mirroring `reflectionDispatch.ts`.
4. *Architecture*: pre-existing drift on `IterationPlanEntryClient.reflection` field — Phase 2 backfills it and adds an `Object.keys()` shape-parity test.
5. *Architecture/Testing*: existing pool-growth test at `projectDispatchPlan.test.ts:82-96` would break — Phase 1 explicitly lists updating it from `dispatchCount` to `expectedTotalDispatch`.
6. *Architecture*: `DispatchPlanView` tfoot colSpan/totals — Phase 2 adds a dedicated bullet specifying the new `<td>` summing `expectedTotalDispatch` and `showActual` cell-count consistency.
7. *Architecture*: `process.env` cross-process divergence — eliminated by threading flags through `opts: DispatchPlanOptions`; env resolved at the server-action boundary; inline comment notes wizard-vs-backend env parity assumption.
8. *Testing*: `DispatchPlanView.test.tsx` `makeEntry()` fixture — Phase 3 specifies defaults (`expectedTotalDispatch: dispatchCount, expectedTopUpDispatch: 0`) preventing 10-test compile cascade.
9. *Testing*: env setup/teardown for new test — eliminated; flags now passed via `opts` parameter, no `process.env` mutation needed.

**Iteration 2 scores:** Security 5/5 · Architecture 5/5 · Testing 5/5 — **consensus reached**.

**Iteration 2 minor issues (non-blocking, deferred):**
- Wizard process env may diverge from evolution worker env in unusual deployments (acceptable in practice; documented inline).
- Top-up sim is closed-form vs runtime's iterative loop (algebraically equivalent under the substitution; should be flagged in implementation comment).
- Phase 3 fixture default of `expectedTotalDispatch: dispatchCount` means existing tests don't exercise the new sub-line render path (covered by new dedicated cases).
- Cosmetic: unit-test count summary says "4 new cases" but list shows 5; tighten when implementing.
- Shape-equality test from Phase 2 should specify its file location (suggest `strategyPreviewActions.test.ts` or co-locate with `projectDispatchPlan.test.ts`).

### Ready for execution.
