# Analyze Cost Estimates Evolution Research

## Problem Statement
Assess why cost estimates for evolution run 9a49176c-28a8-42ab-8396-fcff83946c95 are over (i.e., estimated costs exceed actual costs or vice versa), and propose how to fix the estimation accuracy.

## Requirements
- Investigate why cost estimates for run 9a49176c-28a8-42ab-8396-fcff83946c95 are inaccurate
- Propose how to fix the estimation issues

## High Level Summary

The Cost Estimates tab for this run shows +136.2% estimation error, with generation error at +243.8%. Investigation reveals the root cause is **sibling cost bleed in execution_detail** — the same class of bug that was fixed for `inv_cost` via `AgentCostScope.getOwnSpent()` (Bug B in debugging.md), but was NOT fixed for the per-phase cost breakdown inside `execution_detail`.

The `generation.cost` and `ranking.cost` fields in execution_detail are computed using `ctx.costTracker.getTotalSpent()` deltas, but `getTotalSpent()` on an `AgentCostScope` delegates to the **shared** tracker. Under parallel dispatch (9 GFSA agents in iteration 1), each agent's `generationCost` delta captures other agents' concurrent LLM spend, inflating the "actual" by 2-7x.

Meanwhile, the correct per-invocation cost (`inv_cost` = `scope.getOwnSpent()`) shows the estimates are actually quite accurate: projected $0.001623/agent vs actual $0.001578/agent = only 2.9% error. The Budget Floor Sensitivity module already shows this correct comparison.

## Run Details

| Field | Value |
|-------|-------|
| Run ID | 9a49176c-28a8-42ab-8396-fcff83946c95 |
| Status | completed (converged, 3 iterations) |
| Budget | $0.05 |
| Actual cost | $0.0188 |
| Strategy | "Cheap judge, aggressive budget floor" |
| Gen model | deepseek-chat ($0.28/$0.42 per 1M tokens) |
| Judge model | qwen-2.5-7b-instruct ($0.04/$0.10 per 1M tokens) |
| Variants | 10 (9 parallel GFSA + 1 sequential) |

## Key Findings

### 1. Sibling cost bleed in execution_detail (ROOT CAUSE)

In `generateFromSeedArticle.ts:164,209`:
```typescript
const costBeforeGen = ctx.costTracker.getTotalSpent(); // shared tracker total
// ... generation LLM call ...
const generationCost = ctx.costTracker.getTotalSpent() - costBeforeGen; // includes siblings
```

`ctx.costTracker` is an `AgentCostScope`, but `getTotalSpent()` delegates to the shared tracker (trackBudget.ts:44). Under parallel dispatch, this delta captures all 9 agents' concurrent spend.

Evidence — invocation `84d2d289`:
- `inv_cost` (scope.getOwnSpent): **$0.001285** ← correct
- `gen_cost` (shared delta): **$0.004797** ← inflated ~3.7x
- `rank_cost` (shared delta): **$0.002905** ← inflated
- `gen_cost + rank_cost` = $0.007702 = 6x the real cost

### 2. estimationErrorPct computed from inflated actuals

The `estimationErrorPct` formula: `((actualTotalCost - estTotalCost) / estTotalCost) * 100`

Where `actualTotalCost = generationCost + rankingCost` (both using shared tracker deltas). This makes the error look 2-7x worse than reality. The inflated per-invocation errors average to +136.2%, which propagates to the run-level `cost_estimation_error_pct` metric and up to strategy/experiment aggregates.

### 3. Actual estimation accuracy is good

The Budget Floor Sensitivity module (which uses `scope.getOwnSpent()` indirectly via `agent_cost_actual`) shows:
- Agent cost estimated: $0.001623
- Agent cost actual: $0.001578  
- Error: only **2.9%**

### 4. Actual output lengths vs EMPIRICAL_OUTPUT_CHARS

| Strategy | EMPIRICAL_OUTPUT_CHARS | Actual variant lengths | Ratio |
|----------|----------------------|------------------------|-------|
| structural_transform | 9956 | 5566-6080 | 56-61% |
| grounding_enhance | 11799 | 5163-5217 | 44% |
| lexical_simplify | 5836 | 4310-4415 | 74-76% |

The empirical constants overestimate output length by 24-56%. However, this has a MINOR effect on estimation accuracy since the per-call generation estimate ($0.001-0.002) is close to the real per-call cost ($0.001-0.001). The dominant error is the sibling bleed in the execution_detail.

### 5. Ranking cost estimation is reasonable

`ranking_estimation_error_pct` = +27.4% — much lower than generation. The ranking estimate uses `min(poolSize-1, maxComparisonsPerVariant)` which is deterministic. The remaining error comes from the bleed being smaller for ranking (shorter wall-clock LLM calls → less concurrent sibling overlap).

## Documents Read
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- docs/docs_overall/debugging.md
- All 18 evolution docs
- docs/feature_deep_dives/evolution_metrics.md

## Code Files Read
- evolution/src/lib/pipeline/infra/estimateCosts.ts — pre-dispatch estimation using EMPIRICAL_OUTPUT_CHARS
- evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts — per-call reserve/recordSpend with real token costs
- evolution/src/lib/pipeline/infra/trackBudget.ts — V2CostTracker + AgentCostScope (getTotalSpent delegates to shared)
- evolution/src/lib/core/agents/generateFromSeedArticle.ts — generationCost/rankingCost computed via shared getTotalSpent() delta
- evolution/src/services/costEstimationActions.ts — Cost Estimates tab server action
- src/config/llmPricing.ts — pricing table
- src/config/modelRegistry.ts — deepseek-chat pricing: $0.28/$0.42

## Open Questions
1. Should the fix use `scope.getOwnSpent()` with phase-level attribution, or a fresh approach (e.g., per-phase ownSpent counters on the scope)?
2. Are there other consumers of `generation.cost` / `ranking.cost` in execution_detail that would be affected by changing to scope-based attribution?
3. Should we also update the EMPIRICAL_OUTPUT_CHARS constants to match observed reality, or rely on the cost calibration table (currently disabled)?
