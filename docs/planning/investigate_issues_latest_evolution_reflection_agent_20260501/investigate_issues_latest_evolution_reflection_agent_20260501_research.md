# investigate_issues_latest_evolution_reflection_agent_20260501 Research

## Problem Statement
Cost estimates on the strategy preview wizard look "off" for strategy `d75c9dfc-f9d3-4d32-9bb2-964fa9a96977`. The preview reported only 2 agents dispatched in iteration 1 and 1 each in iterations 2-4, despite per-invocation cost being far below per-iteration budget.

## Requirements (from GH Issue #NNN)
- Cost estimates on strategy preview seem off for d75c9dfc-f9d3-4d32-9bb2-964fa9a96977
- Said could get 2 agents in iteration one (despite per invocation cost being far far lower than budget), and 1 each in iterations 2-4

## High Level Summary

The preview's dispatch count is **technically correct** but **misleadingly conservative**. Two compounding factors produce the small numbers, and the preview omits the runtime top-up phase that fills the rest of the budget.

**Root cause (UX-shaped, not a logic bug):** `projectDispatchPlan()` returns only the *initial parallel batch size*. It does NOT model the within-iteration top-up loop that runs after the parallel batch resolves (Phase 7b of multi_iteration_strategy_support_evolution_20260415). Actual runtime dispatch is much higher, but users see the low parallel-only number in the wizard and infer that's all they'll get.

**Concrete evidence — actual run `a0cdf104-d0e2-4e3c-8a68-5c07962b4f41` of this strategy:**

| Iter | Preview said | Actual dispatched | Avg cost/agent |
|------|--------------|-------------------|----------------|
| 1 (generate) | 2 | **6** | $0.002008 |
| 2 (reflect_and_generate) | 1 | **4** | $0.002480 |
| 3-4 | 1 each | not yet run | — |

So the preview understates dispatch by ~3× because top-up filled the gap.

**Compounding factor — `minBudgetAfterParallelAgentMultiple: 2` consumes half the iter budget:** Per iteration, budget = 25% × $0.05 = $0.0125. Preview reserves `2 × upperBound_per_agent` as the parallel floor before sizing the batch:
- Iter 1 (no reflection): upperBound ≈ $0.003 → floor = $0.006 → available = $0.0065 → `floor($0.0065 / $0.003)` = **2 agents**
- Iter 2-4 (with reflection +pool growth): upperBound ≈ $0.0034-0.004 → floor = $0.0068-$0.008 → available = $0.0045-$0.0057 → `floor(...)` = **1 agent**

The math is doing exactly what `projectDispatchPlan.ts` lines 290-301 + `budgetFloorResolvers.ts:36-39` say. The runtime then top-ups beyond the parallel batch using the much lower `actualAvgCostPerAgent`, which is why 6 actually ran in iter 1.

## Documents Read
- `evolution/docs/architecture.md` — config-driven iteration loop, Phase 7b top-up, `DISPATCH_SAFETY_CAP`
- `evolution/docs/cost_optimization.md` — per-iteration budget enforcement, RESERVE_MARGIN, two-layer budget tracker
- `evolution/docs/strategies_and_experiments.md` — IterationConfig schema, budget floor units (Fraction vs AgentMultiple)
- `evolution/docs/agents/overview.md` — `ReflectAndGenerateFromPreviousArticleAgent` cost stack (reflection + generation + ranking)
- `docs/feature_deep_dives/multi_iteration_strategies.md` — Phase 7b within-iteration top-up loop, EVOLUTION_TOPUP_ENABLED
- `docs/feature_deep_dives/evolution_metrics.md` — `projectDispatchPlan` is the SOT; `expected` vs `upperBound` heuristic ratios
- `docs/feature_deep_dives/variant_lineage.md` — sourceMode='pool' parent picking, `qualityCutoff`
- `docs/docs_overall/debugging.md` — `npm run query:staging` for read-only DB inspection

## Code Files Read
- `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts` — single SOT for dispatch prediction. Line 218 comment: "This function does NOT model top-up — it returns the initial parallel-batch size."
- `evolution/src/lib/pipeline/loop/budgetFloorResolvers.ts` — `resolveParallelFloor` returns `initialAgentCostEstimate * minBudgetAfterParallelAgentMultiple` (i.e. 2× upperBound). No top-up modeling.
- `evolution/src/lib/pipeline/infra/estimateCosts.ts` — `estimateAgentCost` and `estimateReflectionCost`; reflection adds ~$0.0004 per agent for gemini-flash-lite + topN=3.
- `evolution/src/services/strategyPreviewActions.ts` — `getStrategyDispatchPreviewAction` calls `projectDispatchPlan` with arena count + DEFAULT_SEED_CHARS. Returns `IterationPlanEntryClient[]` exposing `dispatchCount`, `maxAffordable.{atExpected, atUpperBound}`, `effectiveCap`, etc.
- `evolution/src/components/evolution/DispatchPlanView.tsx` — renderer. Displays only `entry.dispatchCount` (upperBound-derived), not `maxAffordable.atExpected`. Wizard footer disclaimer mentions "expected vs upper bound" but doesn't surface the realistic-count column. No mention of top-up.
- `src/app/admin/evolution/strategies/new/page.tsx` — wizard host, just passes plan into `DispatchPlanView`.

## Key Findings

1. **Preview shows parallel-batch size only; runtime top-up is invisible.** The user sees `dispatchCount = 2` and assumes "only 2 agents per iteration" — but the actual run dispatched 6 because top-up filled the budget after the parallel batch's `actualAvgCostPerAgent` came in lower than `upperBound`. Documented in `projectDispatchPlan.ts:218` but not reflected in the wizard UI.

2. **`maxAffordable.atExpected` is computed but not displayed.** The plan entry exposes both `atUpperBound` (reservation-safe — drives `dispatchCount`) and `atExpected` (realistic — what the runtime is likely to actually dispatch including top-up). The DispatchPlanView shows only `dispatchCount`. For this strategy iter 1: `atUpperBound = 2`, but `atExpected ≈ 5-6` would match observed reality.

3. **Floor reservation `minBudgetAfterParallelAgentMultiple: 2` consumes ~50% of the iter budget at upperBound prices.** This is by design (sequential top-up needs reserved budget) but compounds with the preview's blindness to top-up to make the displayed dispatchCount feel absurdly low.

4. **Reflection cost estimate is in the right ballpark.** `estimateReflectionCost` for gemini-flash-lite at topN=3 with seed_chars=8000: `(8000+4500)/4 * $0.10/1M + 600/4 * $0.40/1M ≈ $0.000372`. Actual run shows $0.00143 reflection_cost across 4 invocations = $0.000358 per call — within 4% of estimate. So the reflection-specific math is correct.

5. **`upperBound` vs `expected` ratios are heuristic, not calibrated.** `EXPECTED_GEN_RATIO = 0.7` and `EXPECTED_RANK_COMPARISONS_RATIO = 0.5` are "Phase 6a placeholders" per the file comment. With actual ratio observed (gen $0.0046 / 6 agents = $0.00076 vs upperBound ~$0.0011 → ratio ~0.7, ✓; ranking actual is harder to slice but within order). Not the cause of the user's complaint, but a potential follow-up.

6. **DispatchPlanWarnings already detects "tinyIter" (≤1 agent) — but this strategy hits 1 in iters 2-4, so the warning fires.** Per `DispatchPlanView.tsx:204-209`, this surfaces the message "budget is marginal for this iter. Increase budgetUsd or reduce maxComparisonsPerVariant." That advice is half-right — a more useful suggestion would also point to the top-up reality and to the floor multiple.

## Open Questions

1. **Preferred fix shape** — three options to discuss:
   - **A. Show `atExpected` alongside `dispatchCount`** in the wizard table as "likely with top-up" or similar. Smallest change; informational only.
   - **B. Model top-up in `projectDispatchPlan`** itself, returning a `expectedDispatchCount` that includes a heuristic top-up estimate. Larger change, but the runtime already has the math (`runIterationLoop.ts` Phase 7b loop). Risk: top-up depends on `actualAvgCostPerAgent` which is unknown pre-run.
   - **C. Update the warning text** to mention top-up + the floor multiplier when iter dispatches ≤ 1 at upperBound.
   - Probably want B + the warning copy from C; A as a stop-gap.

2. **Should `minBudgetAfterParallelAgentMultiple` default change?** A multiple of 2 is aggressive when reflection inflates the upperBound. Worth checking what other live strategies use and whether 1 or 1.5 would loosen the gate enough to match user expectations.

3. **Is the user's concern actually the preview, or the actual runtime?** Need to confirm with user whether they noticed:
   - Only the preview seemed off (UX issue → fix wizard display)
   - Actual runtime is also under-dispatching (architectural issue → debug top-up loop)
   The data above suggests runtime is fine; preview is the issue.
