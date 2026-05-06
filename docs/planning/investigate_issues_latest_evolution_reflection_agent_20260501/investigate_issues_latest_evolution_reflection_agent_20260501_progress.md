# investigate_issues_latest_evolution_reflection_agent_20260501 Progress

## Phase 1: top-up simulation in `projectDispatchPlan`

### Work Done
- Added `DispatchPlanOptions` interface (`topUpEnabled?`, `reflectionEnabled?`) — flags threaded explicitly so the function stays pure and reproducible.
- Added `expectedTotalDispatch` and `expectedTopUpDispatch` fields to `IterationPlanEntry`.
- `weightedAgentCost` now gates reflection on `iterCfg.agentType === 'reflect_and_generate' && reflectionEnabled` so the EVOLUTION_REFLECTION_ENABLED kill-switch zeroes reflection cost in the projection.
- Top-up sim: `floor((iterBudget - sequentialFloor) / expected.total)` capped at `DISPATCH_SAFETY_CAP`, with `Math.max(dispatchCount, ...)` floor. Algebraically equivalent to the runtime's iterative gate `while (remaining - actualAvgCost >= sequentialFloor)`.
- `resolveSequentialFloor(config, iterBudgetUsd, upper.total, totalExpected)` — args mirror runtime call site (initial=upper, actual-proxy=expected).
- Pool growth between iterations now uses `expectedTotalDispatch` (matches runtime's post-top-up pool).
- Updated existing pool-growth test from `dispatchCount` → `expectedTotalDispatch`.
- Added 5 new test cases (d75c9dfc band, topUpEnabled=false, reflectionEnabled=false, swiss, saturation). All pass; 31 total in the file.

### Issues Encountered
None. Initial typecheck failed (existing fixtures missing `reflection`) but Phase 2/3 backfill resolved it cleanly.

## Phase 2: wizard preview UI

### Work Done
- `IterationPlanEntryClient` (server-action mirror): backfilled the pre-existing missing `reflection` field on `expected` and `upperBound`. Added `expectedTotalDispatch` and `expectedTopUpDispatch`.
- Added shape-parity test in `strategyPreviewActions.test.ts` comparing client mirror's `estPerAgent` keys against server's `EstPerAgentValue` via `Object.keys()` — prevents future drift.
- `getStrategyDispatchPreviewAction` reads `EVOLUTION_TOPUP_ENABLED` and `EVOLUTION_REFLECTION_ENABLED` env at the boundary (string-equality `!== 'false'`) and threads via `opts`. Inline comment notes the wizard-vs-runtime process divergence assumption.
- `DispatchPlanView`: new "Likely total (with top-up)" column between Dispatch and $/Agent. Cell shows `expectedTotalDispatch` with sub-line `N parallel + M top-up` when `expectedTopUpDispatch > 0`. Tooltip on header explains kill-switch behavior. tfoot updated with `dispatch-plan-total-likely` cell summing `expectedTotalDispatch`. Wizard footer disclaimer expanded.
- `DispatchPlanWarnings.tinyIter`: when `dispatchCount <= 1` AND `expectedTotalDispatch > dispatchCount`, surfaces "parallel batch is bound by floor — top-up will likely add ~N more agents at runtime"; otherwise keeps original "budget is marginal" copy. Also extended trigger to `reflect_and_generate` (was generate-only).
- E2E spec grep: `evolution-strategy-wizard-tactics.spec.ts` uses `data-testid="dispatch-plan-row-{idx}"` (column-shift safe). No `nth-child` on dispatch plan anywhere.

### Issues Encountered
None.

## Phase 3: tests + docs

### Work Done
- Updated `makeEntry()` fixture in `DispatchPlanView.test.tsx` with `expectedTotalDispatch: dispatchCount, expectedTopUpDispatch: 0` defaults (prevents 10-test compile cascade). Backfilled `reflection: 0` in 4 inline `estPerAgent` overrides.
- Added 8 new column tests: sub-line render, hidden when 0, swiss dash, header tooltip, footer sum, plus 3 warning-copy variants.
- Documentation:
  - `docs/feature_deep_dives/evolution_metrics.md` — added "Top-up projection" section under Dispatch Prediction.
  - `docs/feature_deep_dives/multi_iteration_strategies.md` — added "Wizard preview models top-up" paragraph under Within-Iteration Top-Up (Phase 7b).
  - `evolution/docs/reference.md` — expanded `EVOLUTION_TOPUP_ENABLED` and `EVOLUTION_REFLECTION_ENABLED` rows in the Kill-Switch table to describe wizard-preview behavior.
  - `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts` — file header comment now documents the top-up projection contract.

### Issues Encountered
None.

## Validation Results

- **typecheck (`npx tsc --noEmit`)**: clean across whole repo.
- **lint (touched files)**: 6 pre-existing errors in `strategyPreviewActions.test.ts` lines 15/168/184/195/211/222 (commit 7c133970, April 2026 — `Function` type usage in adminAction mock setup). Not introduced by this work; out of scope.
- **Targeted tests**: 208 passed across `projectDispatchPlan.test.ts` (31), `strategyPreviewActions.test.ts` (13), `DispatchPlanView.test.tsx` (19), and 15 other touched suites in `evolution/src/lib/pipeline/loop/`.
- **Full evolution suite**: 2,586 passed / 1 failed / 2 skipped. The single failure is `parseReflectionRanking.property.test.ts` (fast-check property-based reflection parser test) — confirmed pre-existing on the base commit `a63f992e`. Unrelated to dispatch projection; flagged for separate cleanup.

## Final Summary

The wizard preview now models the within-iteration top-up loop and surfaces the result as a "Likely total" column. For the reported strategy `d75c9dfc-f9d3-4d32-9bb2-964fa9a96977` (4×25% iterations, $0.05 budget, gemini-flash-lite, `minBudgetAfterParallelAgentMultiple: 2`), the preview now projects 5-7 / 3-5 / 3-5 / 3-5 agents (matching the actual run a0cdf104's observed 6 / 4 / pending / pending) instead of the old conservative 2 / 1 / 1 / 1.
