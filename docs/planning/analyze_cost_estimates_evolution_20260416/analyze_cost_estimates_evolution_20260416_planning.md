# Analyze Cost Estimates Evolution Plan

## Background
The Cost Estimates tab for evolution run 9a49176c shows +136% estimation error, but investigation reveals the actual estimation accuracy is ~2.9%. The error reporting is broken due to sibling cost bleed in `execution_detail` — the same Bug B class that was fixed for `inv_cost` via `AgentCostScope.getOwnSpent()` but not for the per-phase cost breakdown inside execution_detail.

## Requirements
- Fix sibling cost bleed in GFSA execution_detail so `generation.cost` and `ranking.cost` reflect only this agent's spend
- Fix `estimationErrorPct` to use corrected actuals
- Update EMPIRICAL_OUTPUT_CHARS to match observed outputs for better pre-dispatch estimation
- Ensure Cost Estimates tab, strategy-level aggregates, and run-level metrics all reflect accurate data

## Problem
`generateFromSeedArticle.ts` and `rankNewVariant.ts` compute per-phase costs using `ctx.costTracker.getTotalSpent()` deltas. But `getTotalSpent()` on an `AgentCostScope` delegates to the **shared** tracker — under parallel dispatch of 9 agents, each agent's generation/ranking cost captures sibling agents' concurrent LLM spend (2-7x inflation). The resulting `estimationErrorPct` in execution_detail is wildly inaccurate, and this propagates to the `cost_estimation_error_pct` run metric and up to strategy/experiment aggregates.

## Options Considered
- [x] **Option A: getOwnSpent() deltas in GFSA + rankNewVariant**: Snapshot `getOwnSpent()` before/after each phase. Requires widening `AgentContext.costTracker` type to `AgentCostScope` (or adding `getOwnSpent()` to `V2CostTracker` with a default impl). Minimal blast radius — only changes cost attribution in execution_detail, not budget gating.
- [ ] **Option B: Per-phase counters on AgentCostScope**: Add `getOwnPhaseCosts(): Record<AgentName, number>` to the scope, intercept by phase label. More complex, couples scope to phase semantics.

**Decision: Option A** — simplest, directly mirrors the existing `scope.getOwnSpent()` pattern used for `inv_cost`.

## Phased Execution Plan

### Phase 1: Fix sibling cost bleed in execution_detail
- [ ] Add `getOwnSpent(): number` to `V2CostTracker` interface (default: returns `getTotalSpent()`) so agents can call it without knowing whether they have a scope. In `trackBudget.ts`.
- [ ] In `generateFromSeedArticle.ts`: replace `ctx.costTracker.getTotalSpent()` deltas (lines 164, 195, 209) with `ctx.costTracker.getOwnSpent()` deltas for `generationCost`.
- [ ] In `rankNewVariant.ts`: replace `costTracker.getTotalSpent()` deltas (lines 64, 79) with `costTracker.getOwnSpent()` deltas for `rankingCost`.
- [ ] Verify `estimationErrorPct` computation (line 262 of GFSA) now uses the corrected `actualTotalCost`.

### Phase 2: Update EMPIRICAL_OUTPUT_CHARS
- [ ] In `estimateCosts.ts`: update `EMPIRICAL_OUTPUT_CHARS` to match observed reality from staging DB:
  - `grounding_enhance`: 11799 → ~5200 (observed 44% of current)
  - `structural_transform`: 9956 → ~5900 (observed 56-61% of current)
  - `lexical_simplify`: 5836 → ~4400 (observed 74-76% of current)
  - `DEFAULT_OUTPUT_CHARS`: 9197 → ~5200
- [ ] Query staging DB for actual output lengths per strategy across recent runs (not just this one run) to get robust averages before updating.

### Phase 3: Backfill (optional)
- [ ] Consider extending `backfillInvocationCostFromTokens.ts` to recalculate `execution_detail.generation.cost`, `ranking.cost`, and `estimationErrorPct` for historical GFSA invocations. Low priority — historical data will naturally become a small fraction as new runs use the fixed code.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/core/agents/generateFromSeedArticle.test.ts` — verify `generation.cost` in execution_detail matches scope's own spend, not shared total. Mock two parallel agents dispatching simultaneously and assert no cross-contamination.
- [ ] `evolution/src/lib/pipeline/loop/rankNewVariant.test.ts` — verify `rankingCost` return uses own spend.
- [ ] `evolution/src/lib/pipeline/infra/trackBudget.test.ts` — test `getOwnSpent()` on base `V2CostTracker` returns `getTotalSpent()` (backward compat).

### Integration Tests
- [ ] Existing integration tests should pass unchanged (the fix narrows per-invocation attribution, doesn't affect run-level totals).

### E2E Tests
- [ ] `admin-evolution-run-pipeline.spec.ts` — run a full pipeline and verify the Cost Estimates tab shows reasonable error % (should be <50%, not +100-300%).

### Manual Verification
- [ ] Run a new evolution experiment with the fix deployed, verify Cost Estimates tab shows single-digit error %.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Navigate to a completed run's Cost Estimates tab, verify error % values are reasonable and no NaN/Infinity renders.

### B) Automated Tests
- [ ] `npm run test:unit` — all pass
- [ ] `npm run lint && npx tsc --noEmit` — clean
- [ ] `npm run build` — succeeds

## Documentation Updates
- [ ] Update `evolution/docs/cost_optimization.md` — Estimation Feedback Loop section: note that execution_detail per-phase costs now use scope-isolated attribution (getOwnSpent delta), and that the Bug B fix now covers execution_detail in addition to inv_cost.
- [ ] Update `docs/docs_overall/debugging.md` — Bug B section: note the fix was extended to cover execution_detail.

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions]
