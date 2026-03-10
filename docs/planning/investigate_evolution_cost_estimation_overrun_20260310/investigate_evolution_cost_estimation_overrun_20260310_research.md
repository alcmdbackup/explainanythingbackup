# Investigate Evolution Cost Estimation Overrun Research

## Problem Statement
Run 223bc062 exceeded costs in production. The goal is to investigate whether better cost estimation could have prevented this overrun, understand how the estimation system worked for this run, and identify root causes in the cost estimation and budget tracking systems.

## Requirements (from GH Issue #686)
- Use supabase prod query tool to investigate how estimation worked for run 223bc062
- Use budget tracking table (evolution_budget_events) to see what happened during the run
- Write an evolution_budget deep dive document to cover how the estimation system works, if one doesn't already exist

## High Level Summary

The investigation revealed **7 systemic issues** far beyond the original run 223bc062 overrun:

1. **Estimation system completely dead in production** — 66 of 67 completed runs have null estimates; `llmCallTracking` table is empty; `evolution_agent_cost_baselines` table is empty; the entire estimation feedback loop is non-functional
2. **Tournament + gpt-5-nano underestimated 3.7x** — hardcoded 150 output tokens for comparisons vs ~2000 actual
3. **Generation + gpt-5.2 underestimated 3.6x** — 50% output ratio heuristic wrong for high-output models
4. **Tournament invocation cost tracking broken** — `evolution_agent_invocations.cost_usd` = $0 while budget events show $0.053
5. **Text length scaling mismatch** — estimator uses original text (72 chars seed article) but costs scale with generated variant length (2000-8000 chars)
6. **treeSearch overestimated 10x** — reserved $0.105 but only spent $0.010, wasting budget headroom
7. **No `recordSpend()` overflow check** — budget can go arbitrarily negative after reservation is granted

---

## Production-Wide Estimation Health (67 completed runs)

### Estimation System Status
| Metric | Value |
|--------|-------|
| Total completed runs | 67 |
| Runs with pre-run estimate | **1** (1.5%) |
| Runs with cost prediction | **1** |
| `llmCallTracking` rows | **0** (empty table) |
| `evolution_agent_cost_baselines` rows | **0** (empty table) |

The entire estimation feedback loop is dead: no LLM calls tracked → no baselines populated → estimator always uses heuristic fallback → no queue-time budget validation (null estimates skip the check).

### Systematic Reserve vs Spend Ratios by Agent+Model

**UNDER-estimated (actual >> reserved) — budget overrun risk:**

| Agent | Model | Spend/Reserve Ratio | Calls | Issue |
|-------|-------|---------------------|-------|-------|
| **tournament** | **gpt-5-nano** | **3.67x** | 125 | 150-token comparison heuristic catastrophically wrong |
| **generation** | **gpt-5.2** | **3.59x** | 9 | Output much longer than 50% heuristic |
| **calibration** | **gpt-5-nano** | **2.04x** | 42 | Same 150-token comparison issue |
| **generation** | **deepseek-chat** | **1.61x** | 33 | Moderate underestimate |

**OVER-estimated (actual << reserved) — wastes budget headroom:**

| Agent | Model | Spend/Reserve Ratio | Calls | Issue |
|-------|-------|---------------------|-------|-------|
| iterativeEditing | deepseek-chat | 0.80x | 74 | Slight overestimate |
| reflection | deepseek-chat | 0.71x | 18 | ~30% overestimate |
| tournament | deepseek-chat | 0.67x | 177 | ~33% overestimate |
| evolution | deepseek-chat | 0.64x | 13 | Overestimate |
| calibration | deepseek-chat | 0.52x | 80 | ~2x overestimate |
| outlineGeneration | deepseek-chat | 0.49x | 24 | ~2x overestimate |
| debate | deepseek-chat | 0.48x | 13 | ~2x overestimate |
| flowCritique | deepseek-chat | 0.43x | 33 | ~2.3x overestimate |
| sectionDecomposition | deepseek-chat | 0.30x | 43 | ~3x overestimate |
| **treeSearch** | **deepseek-chat** | **0.10x** | 40 | **10x overestimate** |

**Pattern:** deepseek-chat is consistently over-estimated (wasting budget); gpt-5-nano and gpt-5.2 are consistently under-estimated (causing overruns).

### Runs That Exceeded Budget Cap

| Run | Budget | Actual | % of Budget | Judge | Gen |
|-----|--------|--------|-------------|-------|-----|
| c091a23e | $0.05 | $0.072 | 144% | gpt-5-nano | deepseek-chat |
| 223bc062 | $0.05 | $0.069 | 138% | gpt-5-nano | deepseek-chat |
| 27fea0a3 | $0.10 | $0.126 | 126% | deepseek-chat | gpt-5.2 |

All 3 overruns involve gpt-5-nano judge or gpt-5.2 generation — the two most underestimated model combinations.

### Article Text Length Problem

All recent production runs use seed articles of **62-72 characters** (just the prompt title, e.g., "Explain quantum computing"). The cost estimator:
- Passes `textLength` (72 chars) to `estimateRunCostWithAgentModels()`
- Default fallback is 5000 chars in `queueEvolutionRunAction` (line 201)
- But comparison prompts include the full **generated variant texts** (2000-8000 chars), not the original
- Variants grow through iterations, making later comparisons more expensive than early ones
- This is a fundamental mismatch: estimation scales on original text, but costs scale on generated variants

### Tournament Invocation Cost Tracking Bug

For run 223bc062:
| Source | Tournament Cost |
|--------|----------------|
| `evolution_agent_invocations.cost_usd` | **$0.000** |
| `evolution_budget_events` spend total | **$0.053** |

The invocation table doesn't capture tournament costs. This means `persistCostPrediction()` (which reads from invocations) would compute wrong actuals even if estimates existed. The `updateAgentInvocation()` call for tournament likely happens before the tournament's LLM calls complete, or the scoped cost tracking isn't wired correctly.

---

## Run 223bc062 — Detailed Production Data

### Run Configuration
| Field | Value |
|-------|-------|
| Budget cap | $0.05 |
| Total cost | $0.0689 (38% over budget) |
| Estimated cost | NULL (no pre-run estimate) |
| Status | completed (budget_exhausted) |
| Iterations completed | 2 of 5 |
| Generation model | deepseek-chat |
| Judge model | gpt-5-nano |
| Enabled agents | iterativeEditing, reflection |
| Continuation count | 0 |
| Runner | runner-658206c0 (minicomputer batch) |
| Source | experiment:bdfd6253 |

### Per-Agent Cost Breakdown
| Agent | Reserved | Spent | Ratio (Spent/Reserved) | Calls |
|-------|----------|-------|----------------------|-------|
| tournament | $0.0143 | $0.0531 | **3.72x** | 61 |
| calibration | $0.0038 | $0.0079 | 2.09x | 18 |
| iterativeEditing | $0.0032 | $0.0056 | 1.76x | 10 |
| generation | $0.0007 | $0.0012 | 1.74x | 6 |
| reflection | $0.0016 | $0.0011 | 0.71x | 3 |
| proximity | - | $0.0000 | - | 1 |

### Budget Event Timeline
- **Budget went negative** at 20:15:12 ($0.045 spent, available = -$0.0005)
- Tournament started at 20:14:26, reserved ~$0.000234/call avg
- Tournament actual spend was ~$0.000870/call avg
- **24 more tournament spend events** after budget went negative
- Final state: $0.069 spent, available = -$0.019

### Tournament Cost Math (gpt-5-nano)
```
Prompt: ~6000 chars (template + two variant texts) → ~1500 input tokens
Estimated output: 150 tokens (hardcoded for comparison taskType)
Actual output: ~2000 tokens (5 criteria reasoning + winner + confidence)

gpt-5-nano pricing: input=$0.05/1M, output=$0.40/1M (8x ratio)

Estimated: (1500/1M × $0.05) + (150/1M × $0.40)  = $0.000135
Actual:    (1500/1M × $0.05) + (2000/1M × $0.40) = $0.000875
Ratio: 6.5x on output cost, 3.7x total
```

The 8x output/input price ratio on gpt-5-nano amplifies the output token underestimate catastrophically.

---

## Root Cause Analysis

### 1. Token Cost Underestimation for Comparison Calls

`estimateTokenCost()` in `llmClient.ts:59` hardcodes 150 output tokens for `taskType === 'comparison'`. The empirical output ratio cache (`getOutputRatio`) is only used for `taskType: 'generation'` — comparisons always use the 150 hardcode.

Real comparison outputs are 500-2000 tokens depending on the model and whether structured scoring is used. The 150 estimate dates from when comparisons returned just "A", "B", or "TIE".

### 2. Estimation Feedback Loop Broken on Minicomputer

All production runs execute on the minicomputer batch runner. `saveLlmCallTracking()` in `llms.ts:114-123` catches and logs errors non-fatally. The `llmCallTracking` table is empty, meaning inserts silently fail. Without tracking data:
- `refreshAgentCostBaselines()` has nothing to aggregate
- `preloadOutputRatios()` returns null for all agents
- The system is permanently stuck on heuristic fallbacks

### 3. No Post-Reservation Overflow Check

`recordSpend()` in `costTracker.ts` adds actualCost to totalSpent unconditionally. There's no check for `totalSpent > budgetCapUsd`. Once parallel reservations are granted (all individually small enough to pass), actual costs can push the budget deeply negative.

### 4. Text Length Scaling Mismatch

Cost estimation scales by `originalText` length, but the dominant cost (tournament/calibration comparisons) scales with **generated variant length**, which grows through iterations and is much longer than the original.

### 5. Model-Specific Pricing Asymmetry

Models with high output/input price ratios (gpt-5-nano: 8x, gpt-5.2: 8x) amplify output token underestimates. Models with low ratios (deepseek-chat: 2x) are more forgiving, which is why deepseek-chat runs work fine.

---

## Open Questions (Answered)

| Original Question | Answer |
|-------------------|--------|
| Why was cost_estimate_detail null? | 66/67 runs have null estimates — the estimation system is unused/broken in production |
| Is gpt-5-nano pricing correct? | Yes, $0.05/$0.40 in llmPricing.ts matches. The issue is output token count, not pricing |
| Are baselines populated? | No — `evolution_agent_cost_baselines` table is completely empty |
| Should recordSpend enforce a cap? | Yes — current code allows unlimited negative budget |
| Should tournament check budget between rounds? | Yes — currently fires all comparisons in parallel without mid-round checks |
| How many runs have overruns? | 3 of 67 (4.5%), all involving gpt-5-nano judge or gpt-5.2 generation |

## Remaining Open Questions

1. Why does `saveLlmCallTracking()` silently fail on the minicomputer? Schema validation? Supabase connection issue? Missing env var?
2. Why does `evolution_agent_invocations.cost_usd` = $0 for tournament? Is `createScopedLLMClient` not wiring the invocationId correctly for tournament calls?
3. Should we abandon the text-length scaling approach and use per-model empirical baselines exclusively?

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/experimental_framework.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/agents/generation.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/agents/support.md
- evolution/docs/evolution/visualization.md

## Code Files Read
- evolution/src/lib/core/costTracker.ts — Budget enforcement, reservation FIFO queues, recordSpend with no overflow check
- evolution/src/lib/core/costEstimator.ts — Pre-run estimation, baselines (50 sample min), computeCostPrediction (union-key)
- evolution/src/lib/core/llmClient.ts — estimateTokenCost (150 tokens for comparison, prompt.length/4), budgetedCallLLM
- evolution/src/lib/core/metricsWriter.ts — persistCostPrediction, persistAgentMetrics, refreshAgentCostBaselines
- evolution/src/lib/core/config.ts — MAX_RUN_BUDGET_USD=$1.00, resolveConfig budget clamping
- evolution/src/lib/core/budgetRedistribution.ts — Agent classification, no per-agent caps anymore
- evolution/src/lib/core/pipeline.ts — Agent dispatch, BudgetExceededError handling, shouldStop checks
- evolution/src/lib/core/supervisor.ts — shouldStop budget check ($0.01 threshold)
- evolution/src/lib/core/persistence.ts — Checkpoint save/load with costTrackerTotalSpent
- evolution/src/lib/index.ts — preparePipelineRun, wireBudgetEventLogger
- evolution/src/services/evolutionActions.ts — queueEvolutionRunAction, budget validation at queue time
- evolution/src/services/costAnalyticsActions.ts — Cost accuracy analytics
- evolution/src/services/eloBudgetActions.ts — Budget optimization queries
- evolution/src/services/evolutionRunnerCore.ts — Runner flow, continuation support
- supabase/migrations/20260306000001_evolution_budget_events.sql — Budget events table schema
- scripts/query-prod.ts — Production readonly query tool
- src/config/llmPricing.ts — Model pricing table (gpt-5-nano: $0.05/$0.40)
- src/lib/services/llms.ts — callLLMModelRaw, saveLlmCallTracking (non-fatal catch), routeLLMCall
- evolution/src/lib/comparison.ts — buildComparisonPrompt template (~300 chars + two variant texts)
- evolution/src/lib/agents/pairwiseRanker.ts — Sets taskType: 'comparison' for judge calls
- evolution/src/lib/agents/tournament.ts — Parallel comparison dispatch via Promise.allSettled
