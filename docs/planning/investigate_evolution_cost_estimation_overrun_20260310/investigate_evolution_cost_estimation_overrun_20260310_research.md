# Investigate Evolution Cost Estimation Overrun Research

## Problem Statement
Run 223bc062 exceeded costs in production. The goal is to investigate whether better cost estimation could have prevented this overrun, understand how the estimation system worked for this run, and identify root causes in the cost estimation and budget tracking systems.

## Requirements (from GH Issue #686)
- Use supabase prod query tool to investigate how estimation worked for run 223bc062
- Use budget tracking table (evolution_budget_events) to see what happened during the run
- Write an evolution_budget deep dive document to cover how the estimation system works, if one doesn't already exist

## High Level Summary

The investigation revealed **20 systemic issues** far beyond the original run 223bc062 overrun:

**Budget Enforcement:**
1. **No `recordSpend()` overflow check** — budget can go arbitrarily negative after reservation is granted
2. **Estimation system completely dead in production** — 66 of 67 completed runs have null estimates; `llmCallTracking` table is empty; the entire feedback loop is non-functional

**Token Estimation:**
3. **Tournament + gpt-5-nano underestimated 3.7x** — hardcoded 150 output tokens for comparisons vs ~2000 actual
4. **Generation + gpt-5.2 underestimated 3.6x** — 50% output ratio heuristic wrong for high-output models
5. **Comparison output 150-token estimate wrong in both directions** — simple A/B need 1-5 tokens (30x overestimate), flow need 80-150 (correct), structured need 20-40 (6x overestimate)
6. **Incomplete judge cost in 2 agents** — `iterativeEditingAgent.ts:181` and `sectionDecompositionAgent.ts:216` only include input cost ($0.10), omitting output cost ($0.40) — **80% underestimate**

**Pricing & Model Lists:**
7. **Agent estimateCost() methods use hardcoded rates up to 350x wrong** — dead code for most agents, but treeSearch and sectionDecomposition use them for internal budget reservation
8. **Two parallel estimation paths** — central estimator uses correct llmPricing.ts; agent methods use stale hardcoded rates
9. **8 models have 8x output/input price ratio** — all GPT-5 series amplify output token errors catastrophically; Claude models at 5x also at risk
10. **4 UI model selectors hardcoded independently** — `strategies/page.tsx` missing 6 models, `arena/page.tsx` missing 3, none reference `allowedLLMModelSchema`
11. **run-evolution-local.ts dual-path bug** — reserves budget using hardcoded deepseek-chat rates, records actual spend using canonical pricing; **uses DeepSeek rates for Claude models**

**Text Length Scaling:**
12. **Text length scaling mismatch** — estimator uses original text (72 chars seed article) but costs scale with generated variant length (2000-8000 chars)
13. **Variant text grows 3-8% per iteration** — compounding to 50-100% by iteration 15, but all iterations use same base textLength
14. **queueEvolutionRunAction hardcodes 5000 chars** regardless of actual article length

**Call Count Mismatches (estimator vs reality):**
15. **Calibration: estimator hardcodes 3 opponents, config default is 5** — expansion: 18 estimated vs up to 30 actual; competition: 30 estimated vs up to 50 actual
16. **TreeSearch: estimator assumes 33 gen + 33 judge = 66 total** — actual with defaults (K=3,B=3,D=3): 27 gen + 6 re-critique + **90 eval = 123 calls** (nearly 2x)
17. **Tournament: estimator assumes 50 calls** — actual ranges 30-80+ depending on budget pressure, convergence, multi-turn tiebreakers

**Other:**
18. **Tournament invocation cost tracking broken** — `evolution_agent_invocations.cost_usd` = $0 while budget events show $0.053
19. **30% safety margin masks moderate errors** — deepseek-chat (2x ratio) errors absorbed; gpt-5-nano (8x ratio) errors exceed margin
20. **flowCritique model mismatch** — estimator uses judgeModel but actual code uses generationModel

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

1. Why does `saveLlmCallTracking()` silently fail on the minicomputer? Double error suppression confirmed in code — most likely missing env vars or connection issues. Needs minicomputer-specific debugging.
2. Why does `evolution_agent_invocations.cost_usd` = $0 for tournament? Code paths look correct (`createScopedLLMClient` wires invocationId, pipeline reads `getInvocationCost`). Likely a timing issue with `Promise.allSettled` — costs may not be fully accumulated before retrieval.
3. Should we abandon the text-length scaling approach and use per-model empirical baselines exclusively?

---

## Round 2-3 Deep Investigation Findings

### Two Parallel Estimation Paths

The codebase has **two completely separate cost estimation systems** that don't talk to each other:

**Path 1: Central Estimator (Production — used for pre-run estimates)**
- `costEstimator.ts:estimateRunCostWithAgentModels()` → called at queue time
- Uses `calculateLLMCost()` which reads from `llmPricing.ts` — **correct model-specific pricing**
- Estimates all 11 cost-bearing agents with hardcoded call multipliers per iteration
- Falls back to heuristic `tokens = textLength/4` when no baselines exist

**Path 2: Agent estimateCost() Methods (Mostly dead code)**
- Each agent implements `estimateCost()` with its own **hardcoded pricing rates**
- Only used by treeSearch and sectionDecomposition for internal budget reservation
- Rates are wildly wrong — some 300x too low, others 5-6x too high

### Agent estimateCost() Pricing Errors

| Agent | Hardcoded Input | Hardcoded Output | Actual Model | Actual Input | Actual Output | Error |
|-------|----------------|-----------------|-------------|-------------|--------------|-------|
| generationAgent | $0.0004/M | $0.0016/M | deepseek-chat | $0.14/M | $0.28/M | **350x under** |
| reflectionAgent | $0.80/M | $4.0/M | deepseek-chat | $0.14/M | $0.28/M | **5-14x over** |
| iterativeEditingAgent | $0.80/M | $4.0/M | deepseek-chat | $0.14/M | $0.28/M | **5-14x over** |
| treeSearchAgent (gen) | $0.40/M | $1.60/M | gpt-4.1-mini | $0.40/M | $1.60/M | **Correct** |
| treeSearchAgent (eval) | $0.10/M | $0.40/M | gpt-4.1-nano | $0.10/M | $0.40/M | **Correct** |
| outlineGenerationAgent | $0.0004/M | $0.0016/M | deepseek-chat | $0.14/M | $0.28/M | **350x under** |
| sectionDecompositionAgent | $0.80/M | $4.0/M | deepseek-chat | $0.14/M | $0.28/M | **5-14x over** |
| debateAgent | $0.0008/M | $0.004/M | deepseek-chat | $0.14/M | $0.28/M | **70-175x under** |
| tournament | $0.0008/M | $0.004/M | deepseek-chat | $0.14/M | $0.28/M | **70-175x under** |
| calibrationRanker | $0.0004/M | $0.0016/M | deepseek-chat | $0.14/M | $0.28/M | **350x under** |

**Key insight:** These methods are mostly dead code — the central estimator uses correct pricing. Only treeSearch and sectionDecomposition call their own `estimateCost()` during execution.

### Model Risk Assessment (Output/Input Price Ratios)

Models with high output/input ratios amplify any output token estimation error:

| Risk Level | Models | Ratio | Underestimate Factor | Status |
|-----------|--------|-------|---------------------|--------|
| **CRITICAL (8x)** | gpt-5-nano, gpt-5-mini, gpt-5.2, gpt-5.2-pro | 8.0x | 3.7x | gpt-5-nano/mini allowed |
| **HIGH (5x)** | All Claude models (claude-sonnet-4) | 5.0x | 1.71x | claude-sonnet-4 allowed |
| **MODERATE (4x)** | All GPT-4.1 series, GPT-4o series, o1, o3-mini | 4.0x | 1.67x | Default judge models |
| **ACCEPTABLE (2x)** | deepseek-chat | 2.0x | ~1.5x | Default generation model |

### Comparison Output Token Analysis (150-token hardcode)

Three distinct comparison types with very different actual output sizes:

| Type | Where Used | Actual Output Tokens | vs 150 Hardcode |
|------|-----------|---------------------|-----------------|
| **Simple A/B/TIE** | calibration, tournament | 1-5 tokens | **30x overestimate** |
| **Structured 5-dim** | pairwiseRanker quality | 20-40 tokens | **4-7x overestimate** |
| **Flow + friction spots** | pairwiseRanker flow, flowCritique | 80-150 tokens | **~correct** |

The 150 hardcode is only accurate for flow comparisons. For simple comparisons, it massively overestimates output. The 3.7x underestimate for gpt-5-nano is driven by the **output pricing ratio** (8x), not by output tokens being higher than 150.

### Text Length Scaling Deep Dive

**Entry points and defaults:**
- `estimateRunCostAction()`: accepts optional textLength, defaults to **5000 chars**
- `queueEvolutionRunAction()`: **hardcodes 5000** at line 201 (no parameter)
- Short seed articles (62-72 chars) get textLength=5000 default regardless

**Variant growth through iterations (NOT accounted for):**
- Iteration 1: variants typically 5-15% larger than seed
- Iteration 5: variants 20-40% larger (cumulative edits, expansions)
- Iteration 15: variants 50-100% larger (outline expansion cycles)
- All iterations use the same base textLength — no growth factor applied

**Impact on short articles:**
- 62-char seed article → estimator uses 5000-char default
- If baselines calibrated on 5000-char articles, short articles get correct scaling by accident
- But actual variant length at iteration 5 may be 2000 chars, not 5000 — still underestimated

### Feedback Loop Root Cause Analysis

`saveLlmCallTracking()` has **double error suppression**:
1. Inner function catches Supabase errors, throws `ServiceError`
2. Outer `saveTrackingAndNotify()` catches ALL errors, only logs `'LLM call tracking save failed (non-fatal)'`
3. LLM response still returned successfully — no signal that tracking failed

Most likely root causes for minicomputer failure:
- Missing `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` env vars
- Supabase connection timeout or rate limiting from minicomputer network
- Schema mismatch between insert payload and table columns

### Tournament Invocation Cost Tracking

Code paths appear correct:
1. Pipeline creates invocation row before `tournament.execute()`
2. `createScopedLLMClient()` wraps llmClient with tournament's invocationId
3. Each LLM call passes invocationId through options → `recordSpend(agentName, cost, invocationId)`
4. Pipeline reads `getInvocationCost(invocationId)` after execute returns
5. `updateAgentInvocation()` writes correct cost

If still showing $0, likely timing issue: `Promise.allSettled()` in tournament fires parallel comparisons, but cost accumulation may not complete before `getInvocationCost()` is called.

### Budget Redistribution Status

Per-agent budget redistribution has been **removed** — only global budget enforcement remains. Agents compete for a single shared pool. Over-estimated agents don't release budget to under-estimated ones; the 30% safety margin is the only buffer.

### flowCritique Model Mismatch

Central estimator uses `getModel('flowCritique', true)` → **judgeModel**, but actual pipeline code uses generationModel for flowCritique calls. This causes overestimation if judgeModel is more expensive.

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
- evolution/src/lib/agents/pairwiseRanker.ts — Sets taskType: 'comparison' for judge calls; estimateCost uses $0.0008/$0.004 hardcoded
- evolution/src/lib/agents/tournament.ts — Parallel comparison dispatch via Promise.allSettled; estimateCost uses $0.0008/$0.004 hardcoded
- evolution/src/lib/agents/generationAgent.ts — estimateCost uses $0.0004/$0.0016 (350x under actual deepseek-chat)
- evolution/src/lib/agents/reflectionAgent.ts — estimateCost uses $0.80/$4.0 (5-14x over actual)
- evolution/src/lib/agents/iterativeEditingAgent.ts — estimateCost uses $0.80/$4.0 (5-14x over actual)
- evolution/src/lib/agents/treeSearchAgent.ts — estimateCost uses correct gpt-4.1-mini/nano rates; 1.3x safety margin
- evolution/src/lib/agents/outlineGenerationAgent.ts — estimateCost uses $0.0004/$0.0016 (350x under)
- evolution/src/lib/agents/sectionDecompositionAgent.ts — estimateCost uses $0.80/$4.0 (over); actually called during execution
- evolution/src/lib/agents/debateAgent.ts — estimateCost uses $0.0008/$0.004 (70-175x under)
- evolution/src/lib/agents/calibrationRanker.ts — estimateCost uses $0.0004/$0.0016 (350x under)
- evolution/src/lib/agents/evolvePool.ts — evolutionAgent estimateCost
- evolution/src/lib/agents/proximityAgent.ts — Zero LLM cost (local computation only)
- evolution/src/lib/agents/metaReviewAgent.ts — Zero LLM cost (ordinal analysis only)
- evolution/src/lib/flowRubric.ts — Flow comparison prompt with 5 dimensions + friction spots
- evolution/src/services/costAnalyticsActions.ts — Post-hoc cost accuracy analytics, outlier detection
- src/lib/schemas/schemas.ts — allowedLLMModelSchema (enabled model whitelist)
- src/app/admin/evolution/analysis/_components/runFormUtils.ts — MODEL_OPTIONS (missing 2 models vs schema)
- src/app/admin/evolution/strategies/page.tsx — MODEL_OPTIONS (missing 6 models vs schema)
- src/app/admin/evolution/arena/page.tsx — hardcoded HTML <option> tags (missing 3 models)
- src/app/admin/evolution/arena/[topicId]/page.tsx — hardcoded HTML <option> tags (missing 1 model)
- evolution/scripts/run-evolution-local.ts — duplicate estimateTokenCost with hardcoded deepseek-chat rates
- scripts/generate-article.ts — 3x output ratio heuristic; uses canonical getModelPricing correctly
- evolution/src/lib/treeOfThought/types.ts — DEFAULT_BEAM_SEARCH_CONFIG (K=3, B=3, D=3)
- evolution/src/services/strategyRegistryActions.ts — getStrategyPresets with mixed hardcoded/config model names

---

## Pre-Implementation Audit Findings

### Hardcoded Token Lengths

| Location | Value | What | Assessment |
|----------|-------|------|-----------|
| `llmClient.ts:56` | `prompt.length / 4` | Char-to-token ratio | Fine — standard heuristic |
| `llmClient.ts:60` | `150` | Comparison output tokens | **WRONG** — needs subtype split (10/50/150) |
| `llmClient.ts:65` | `0.5` | Default output/input ratio | Fine — has empirical override |
| 8 agent files | `200` | Prompt overhead tokens | Fine — reasonable constant |
| `reflectionAgent.ts:129`, `debateAgent.ts:358` | `500` | Higher prompt overhead | Fine — justified for multi-turn |
| `llms.ts:440,456` | `8192` | max_tokens for Claude | Fine — intentionally high |
| comparison scripts | `64` | max_tokens for comparisons | Fine — short decisions |
| `generate-article.ts:75` | `3x input` | Output ratio for article gen | Aggressive but intentional |
| `run-evolution-local.ts:198` | `0.5x input` | Output ratio | Fine for estimation |

### Incomplete Judge Cost Bug

**iterativeEditingAgent.ts:181** and **sectionDecompositionAgent.ts:216**:
```typescript
const judgeCost = ((diffLen + 300) / 4 / 1_000_000) * 0.10;  // MISSING: + * 0.40 for output
```
- Only includes gpt-4.1-nano input cost ($0.10/1M), completely omits output ($0.40/1M)
- **Judge cost underestimated by 80%** (5x cheaper than reality)
- Correct reference: treeSearchAgent.ts:143 includes both `* 0.10 + ... * 0.40`

### UI Model Selector Desync

Schema (`allowedLLMModelSchema`) has 13 models. UI files are independently hardcoded:

| File | Models | Missing |
|------|--------|---------|
| `runFormUtils.ts` | 11 | `gpt-4o-mini`, `LOCAL_qwen2.5:14b` |
| `strategies/page.tsx` | 7 | `gpt-4o-mini`, all GPT-5 series, `LOCAL_qwen2.5:14b` |
| `arena/page.tsx` | 10 | `gpt-4o-mini`, `gpt-4.1-nano`, `LOCAL_qwen2.5:14b` |
| `arena/[topicId]/page.tsx` | 12 | `LOCAL_qwen2.5:14b` |

No shared utility exists. Fix: create shared export from schema, import in all UI files.

### Script Dual-Path Bug

`run-evolution-local.ts` has a local `estimateTokenCost()` (lines 196-205) that hardcodes deepseek-chat rates ($0.14/$0.28). Despite importing `calculateLLMCost` from canonical pricing, it uses the local function for budget reservation — meaning **Claude calls are reserved at DeepSeek rates**.

### Call Count Mismatches (Estimator vs Reality)

| Agent | Estimator Assumes | Config Default | Actual Calls | Mismatch |
|-------|-------------------|---------------|--------------|----------|
| **calibration** | 3 opponents, 18-30 calls | opponents: 5 | Up to 50 calls | **1.7x under** |
| **treeSearch** | 33 gen + 33 judge = 66 | K=3,B=3,D=3 | 27 gen + 6 re-crit + 90 eval = 123 | **1.9x under** |
| **tournament** | 25 matches × 2 = 50 | adaptive | 30-80+ depending on pressure | **Variable** |
| generation | 3 per iter | strategies: 3 | 3 per iter | Correct |

### Budget Constants Inventory

| Location | Value | What |
|----------|-------|------|
| `config.ts:81` | `$1.00` | MAX_RUN_BUDGET_USD |
| `config.ts:84` | `$10.00` | MAX_EXPERIMENT_BUDGET_USD |
| `costTracker.ts:41` | `1.3x` | Safety margin on reservations |
| `supervisor.ts:46` | `$0.01` | Min budget to continue |
| `costEstimator.ts:107` | `50` | Min samples for baseline |
| `tournament.ts:21-27` | `0.5/0.8` | Budget pressure tier thresholds |
| `evolutionActions.ts:96-99` | `100-100000` | Text length bounds |
| `evolutionActions.ts:98` | `5000` | Default text length |
| `treeOfThought/types.ts:62-66` | `K=3,B=3,D=3` | Default beam search config |
