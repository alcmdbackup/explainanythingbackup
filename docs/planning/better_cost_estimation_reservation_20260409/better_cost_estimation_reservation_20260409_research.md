# Better Cost Estimation Reservation Research

## Problem Statement
The evolution pipeline's cost estimation for generateFromSeedArticle is inaccurate, leading to budget waste when parallel agents exceed their budgets. The current 1-token-per-4-chars heuristic and fixed output token estimates (1000 for generation, 100 for ranking) don't reflect empirical article lengths. Additionally, parallelism in the generate iteration launches all N agents simultaneously without considering remaining budget, causing agents to fail mid-execution when budget runs out. This project aims to improve cost estimation accuracy using empirical data, establish a feedback loop for estimate validation, and modify the parallel launch strategy to be budget-aware — launching only as many agents as the remaining budget can support, then switching to sequential execution in subsequent iterations to minimize waste.

## Requirements (from GH Issue #945)
- Estimate the cost of generateFromSeedArticle as accurately as possible, based on model cost and empirical article lengths. This should account for both generation and ranking parts separately. Use Supabase dev to look at empirical article length, looking at debugging.md to see how to query
- Establish a feedback loop that allows us to evaluate the accuracy of our estimates
- Modify generateFromSeedArticle to handle parallelism more gracefully. To reduce waste, estimate how many you can launch in parallel, without going over the remaining budget. Do slightly less than this.
- In the iteration after this, set maximum parallel = 1 - i.e. go sequentially to reduce waste, until all budget is exhausted or all needed variants are generated.

## High Level Summary

Research across 5 rounds of 4 agents each revealed a **fundamental cost estimation flaw**: the system's fixed output token estimates (1000 for generation, 100 for ranking) underestimate actual costs by 3-9x, and the `recordSpend()` function only LOGS overruns without preventing them. Combined with launching all 9 agents in parallel, this causes runs with $0.05 budgets to spend $0.18-$0.44 actual (3.6-8.8x overruns). The architecture supports adding budget-aware parallelism and sequential fallback with straightforward modifications to `runIterationLoop.ts`.

## Key Findings

### 1. Massive Budget Overruns Confirmed Empirically

Staging DB shows runs with $0.05 budget spending $0.18-$0.44 actual:
- `gpt-5-mini` + `gpt-oss-20b` judge: $0.44 actual on $0.05 budget (8.8x)
- `gpt-5-nano` + `gpt-oss-20b` judge: $0.18-$0.31 actual on $0.05 budget (3.6-6.3x)

### 2. Root Cause: recordSpend() Does NOT Prevent Overruns

`trackBudget.ts:73-79`: After adding actual cost, it checks `totalSpent > budgetUsd` but only **logs a warning** — no error is thrown, no execution halted. The cost tracker is **strictly observational** for overruns. Only `reserve()` enforces limits, but it reserves against vastly underestimated amounts.

### 3. Fixed Output Token Estimates Are Wrong

| Phase | Estimated Output | Empirical Actual (chars) | Actual Tokens (~chars/4) | Error Factor |
|-------|-----------------|-------------------------|-------------------------|-------------|
| generation (grounding_enhance) | 1000 tokens | 11,799 chars | ~2,950 tokens | **2.95x** |
| generation (structural_transform) | 1000 tokens | 9,956 chars | ~2,489 tokens | **2.49x** |
| generation (lexical_simplify) | 1000 tokens | 5,836 chars | ~1,459 tokens | **1.46x** |
| ranking (comparison output) | 100 tokens | ~5 chars | ~2 tokens | 50x overestimate (harmless) |

### 4. Comparison Prompt Structure

- Fixed overhead: **698 characters** (evaluation criteria + instructions)
- Variable: **2 × article_text_length** (both texts included in prompt)
- Each comparison = **2 parallel LLM calls** (forward + reverse for bias mitigation)
- Output is tiny: "A", "B", or "TIE" (~2-3 characters)
- **Ranking cost is dominated by INPUT tokens**, not output

### 5. Empirical Cost Data (Staging, n=35 successful invocations)

| Strategy | Avg Gen Cost | Avg Rank Cost | Avg Total Cost | Avg Comparisons | Avg Output Chars |
|----------|-------------|--------------|----------------|-----------------|-----------------|
| grounding_enhance | $0.022536 | $0.016127 | $0.038664 | 10.5 | 11,799 |
| lexical_simplify | $0.004924 | $0.038438 | $0.043362 | 13.1 | 5,836 |
| structural_transform | $0.015383 | $0.018699 | $0.034083 | 3.1 | 9,956 |
| **Overall avg** | **$0.014753** | **$0.023948** | **$0.038701** | **9.0** | **~9,197** |

### 6. Comparison Count Distribution

| Comparisons | Count | Notes |
|-------------|-------|-------|
| 0-1 | 10 | First iteration with small pool (just baseline) |
| 2-5 | 14 | Typical early elimination or convergence |
| 6-7 | 4 | Moderate ranking depth |
| 16-59 | 7 | Deep ranking with large arena pool |

Median ~3, mean 9. Bimodal: first iteration has few comparisons (small pool), later iterations have many.

### 7. Pool Composition at Iteration 0

- **Prompt-based runs**: baseline + arena entries (from `evolution_variants` where `synced_to_arena = true`)
- **Explanation-based runs**: baseline only
- With small pool (1-5 entries), agents do ~1-3 comparisons
- With large arena (10+ entries), agents do ~8-15 comparisons
- The empirical avg of 9 is a cross-iteration average, NOT iteration-0 specific

### 8. Seed Article Cost Uses a Separate Tracking Path

Seed article generation (title + content LLM calls) goes through the main app's `callLLM()` function, which logs to the `llmCallTracking` table. The evolution iteration loop creates its own `CostTracker` (currently named `createV2LLMClient`, to be renamed `createEvolutionLLMClient`) with the full `budgetUsd`. Seed cost (~$0.001-0.005) doesn't deplete the evolution budget pool. The naming "V1/V2" is a codebase artifact — `callLLM()` is the original app-wide LLM path, while `createV2LLMClient` is the evolution-specific wrapper with reserve-before-spend budget tracking.

### 9. All Models Are in Pricing Table

`gpt-5-mini`, `gpt-5-nano`, and `gpt-oss-20b` all have exact pricing entries in `src/config/llmPricing.ts`. The overruns are NOT caused by missing model pricing — they're caused by underestimated output tokens.

### 10. Architecture Supports Multiple Generate Iterations

- Current `nextIteration()` returns `'generate'` only for `iteration === 0`, then always `'swiss'`
- Adding sequential generate iterations requires ~10 lines of new logic in `nextIteration()`
- Pool/ratings/matchCounts state persists across iterations — no restructuring needed
- MergeRatingsAgent already handles variable-count surfaced variants

### 11. Ranking Cost Analysis: generateFromSeedArticle vs SwissRanking

#### GFSA Binary Search Ranking

Each generateFromSeedArticle agent ranks its variant via binary search against a **local pool snapshot**. Key factors:

- **Comparison prompt**: 698 chars overhead + variant_text + opponent_text
- **Each comparison = 2 LLM calls** (forward + reverse bias mitigation, via `Promise.all`)
- **Output is tiny**: "A"/"B"/"TIE" (~2-3 chars). Ranking cost is dominated by INPUT tokens.
- **Comparisons per agent**: Depends on pool size at iteration start
  - Iteration 0 with small pool (baseline + 0-5 arena): **1-4 comparisons**
  - With large arena (10+ entries): **5-15 comparisons**
- **Cache impact**: Minimal in first iteration (all novel pairs). More helpful in later iterations.

Empirical from staging (all iteration 1, all novel comparisons):

| Strategy | Avg Comparisons | Typical Variant Length | Avg Rank Cost |
|----------|----------------|----------------------|--------------|
| grounding_enhance | 1.0 | 10,800 | $0.016127 |
| structural_transform | 2.3 | 9,500 | $0.018699 |
| lexical_simplify | 3.7 | 5,400 | $0.038438 |

Note: lexical_simplify does MORE comparisons despite smaller variants — its lower mu means it takes longer to converge/eliminate.

#### Swiss Ranking

SwissRankingAgent runs AFTER the first generate iteration and dispatches up to `MAX_PAIRS_PER_ROUND = 20` pairs per swiss iteration.

Empirical from staging (judge model: `gpt-oss-20b` at $0.03/$0.11 per 1M tokens):

| Iteration | Pairs Succeeded | Pairs Failed (Budget) | Cost | Cost/Pair |
|-----------|----------------|----------------------|------|-----------|
| 2 | 20 | 0 | $0.005444 | $0.000272 |
| 3 | 20 | 0 | $0.004752 | $0.000238 |
| 4 | 10 | 10 | $0.002822 | $0.000282 |

- **Cost per pair**: ~$0.000260 avg with `gpt-oss-20b`
- **Cache helps**: Iteration 3 cost/pair ($0.000238) < iteration 2 ($0.000272), likely due to cache hits
- **Budget often exhausted**: 4 of 5 runs had ALL 20 swiss pairs fail with budget exceeded (budget already consumed by GFSA)

#### Cost Distribution: GFSA vs Swiss

| Run | Budget | GFSA Cost (%) | Swiss Cost (%) |
|-----|--------|--------------|---------------|
| `9bd02...` | $0.05 | $0.441 (100%) | $0.000 (0%) |
| `0aa62...` | $0.05 | $0.439 (100%) | $0.000 (0%) |
| `c4057...` | $0.05 | $0.313 (100%) | $0.000 (0%) |
| `eb62d...` | $0.05 | $0.167 (93%) | $0.013 (7%) |
| `7e482...` | $0.01 | $0.027 (100%) | $0.000 (0%) |

**GFSA dominates cost: 93-100% of total run cost.** Swiss ranking is cheap (~$0.000260/pair) but rarely gets budget to run because GFSA already consumed everything.

### 12. Sigma Decay Analysis: How Many Comparisons to "Fully Rank"

Empirical sigma decay from the one variant that converged (pool size 444, 59 comparisons):

| Comparisons | Sigma | Drop/comparison |
|---|---|---|
| 0 (start) | 8.333 | — |
| 1 | 7.869 | -0.464 |
| 2 | 7.447 | -0.422 |
| 3 | 7.075 | -0.372 |
| 5 | 6.448 | -0.314/ea |
| 10 | 5.370 | -0.216/ea |
| 20 | 4.337 | -0.103/ea |
| 40 | 3.502 | -0.042/ea |
| **59** | **2.997** | converged (< 3.0) |

**Key insight**: Sigma decay is approximately logarithmic — fast at first, then diminishing returns. Rate is ~0.09/comparison averaged over the full convergence path.

**Stop reason distribution** (all 35 GFSA invocations in staging):

| Stop Reason | Count | Avg Comparisons | Notes |
|---|---|---|---|
| budget | 25 | 2.7 | Most common — budget exhausted before natural exit |
| eliminated | 8 | 6.9 | `mu + 2σ < top15Cutoff` — variant clearly non-competitive |
| converged | 1 | 59 | `sigma < 3.0` — only 1 of 35 ever converged |
| no_more_opponents | 0 | — | Never hit in staging data |

**Worst case by pool size** (comparisons to reach sigma < 3.0):

| Pool Size | Est. Comparisons to Converge | Notes |
|---|---|---|
| 2-5 | ~15-20 | Small pool, fewer opponents to discriminate |
| 10-20 | ~25-35 | Medium pool |
| 50-100 | ~40-50 | Large pool, more opponents to rank against |
| 400+ | ~59 | Empirically confirmed from staging data |

**For cost estimation**: Use pool_size to estimate worst-case comparisons. A conservative formula: `min(pool_size * 2, ceil(5.3 / 0.09))` ≈ `min(pool_size * 2, 59)`. But since most variants are eliminated (not converged), the practical expected comparisons is much lower — typically 5-7.

### 13. Output Token Estimate Breakdown

The current system estimates 1000 output tokens for generation (= 4000 chars), but empirical data shows actual output varies by strategy:

| Strategy | Estimated (chars) | Actual Avg (chars) | Actual Tokens | Error Factor | Impact |
|----------|-------------------|-------------------|--------------|-------------|--------|
| grounding_enhance | 4,000 | 11,799 | ~2,950 | **2.95x under** | Adds examples/details, longest output |
| structural_transform | 4,000 | 9,956 | ~2,489 | **2.49x under** | Restructures but maintains length |
| lexical_simplify | 4,000 | 5,836 | ~1,459 | **1.46x under** | Simplifies language, shortest output |
| ranking output | 400 | ~5 | ~2 | **50x over** | Harmless — input dominates cost |

The 1.3x reserve margin can absorb a 1.3x underestimate but NOT a 2.5-3x underestimate. This is the primary cause of budget overruns.

## Improved Cost Estimation Formulas

### Per-Agent Cost (generateFromSeedArticle)

```
TOTAL = GENERATION_COST + RANKING_COST

GENERATION_COST = calculateCost(
  inputChars = seedArticleLength + ~500 (strategy prompt overhead),
  outputChars = EMPIRICAL_OUTPUT[strategy],  // 5836-11799 chars
  pricing = getModelPricing(generationModel)
)

RANKING_COST = numComparisons * 2 * calculateCost(
  inputChars = 698 + variantLength + avgOpponentLength,
  outputChars = 20,  // ~5 tokens per response ("A"/"B"/"TIE")
  pricing = getModelPricing(judgeModel)
)
```

**Key insight for ranking**: The comparison prompt contains BOTH texts. For iteration 0 with small pool, `avgOpponentLength ≈ seedArticleLength` (comparing against baseline). The variant text length can be approximated using `EMPIRICAL_OUTPUT[strategy]` since it was just generated.

### Per-Iteration Cost (SwissRanking)

```
SWISS_COST = numPairs * 2 * calculateCost(
  inputChars = 698 + avgVariantLength * 2,  // both variants from pool
  outputChars = 20,
  pricing = getModelPricing(judgeModel)
)
```

Where:
- `numPairs`: up to `MAX_PAIRS_PER_ROUND = 20`, but typically fewer as pool converges
- `avgVariantLength`: average text length of variants in pool (~9197 chars)
- Cache hits reduce actual cost (especially in 2nd+ swiss iterations)

Empirical: ~$0.000260/pair with `gpt-oss-20b` ($0.03/$0.11 per 1M tokens)

### Empirical Constants

```typescript
const EMPIRICAL_OUTPUT_CHARS: Record<string, number> = {
  grounding_enhance: 11799,
  structural_transform: 9956,
  lexical_simplify: 5836,
  default: 9197,  // weighted average
};

// First iteration (small pool: baseline + 0-5 arena entries)
const EMPIRICAL_COMPARISONS_ITER0: Record<string, number> = {
  grounding_enhance: 1.0,
  structural_transform: 2.3,
  lexical_simplify: 3.7,
  default: 2.3,
};

// Later iterations or large arena pool
const EMPIRICAL_COMPARISONS_LATER: Record<string, number> = {
  grounding_enhance: 10.5,
  structural_transform: 3.1,
  lexical_simplify: 13.1,
  default: 9.0,
};

const COMPARISON_PROMPT_OVERHEAD = 698; // Fixed chars in buildComparisonPrompt
const MAX_PAIRS_PER_ROUND = 20; // Swiss pairing cap
```

### Budget-Aware Dispatch Formula

```
availableBudget = costTracker.getAvailableBudget()
estimatedPerAgent = estimateAgentCost(seedArticleLength, strategy, genModel, judgeModel, poolSize)
maxParallel = floor(availableBudget * 0.8 / estimatedPerAgent)  // 80% safety factor
dispatchCount = min(numVariants, max(1, maxParallel))

// For second generate iteration: dispatchCount = 1 (sequential)
```

### Total Run Cost Estimate

```
RUN_COST ≈ GFSA_COST + SWISS_COST
         ≈ (numAgents × avgAgentCost) + (numSwissIters × swissIterCost)

Where GFSA dominates: empirically 93-100% of total run cost.
Swiss is cheap but only runs if GFSA leaves budget remaining.
```

## Feedback Loop Design

### Approach: Extend execution_detail JSONB

Add to `GenerateFromSeedExecutionDetail`:
- `generation.estimatedCost` — pre-call estimate
- `generation.estimationErrorPct` — `(actual - estimated) / estimated * 100`
- `ranking.estimatedCost` — pre-call estimate  
- `ranking.estimationErrorPct` — same formula

No DB schema changes needed (JSONB is flexible). Analyze via SQL queries on `evolution_agent_invocations.execution_detail`.

### Where to Instrument

In `createLLMClient.ts`, the `estimated` value is already calculated at line 61 but discarded after reservation. We need to:
1. Return both `estimated` and `actual` from `llm.complete()` (or track in a side channel)
2. Record in the agent's execution detail

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- docs/docs_overall/debugging.md — query:staging/query:prod usage

### Relevant Docs
- evolution/docs/README.md
- evolution/docs/architecture.md — pipeline flow, budget tracking, iteration loop
- evolution/docs/cost_optimization.md — V2CostTracker, reserve-before-spend, budget tiers
- evolution/docs/data_model.md — evolution_agent_invocations, execution_detail JSONB
- evolution/docs/arena.md — arena loading into initial pool
- evolution/docs/rating_and_comparison.md — comparison prompt, binary search ranking
- evolution/docs/strategies_and_experiments.md — strategy config, experiments
- evolution/docs/reference.md
- evolution/docs/entities.md
- evolution/docs/metrics.md — metric registry, writeMetricMax, per-purpose costs
- evolution/docs/logging.md
- evolution/docs/visualization.md
- evolution/docs/curriculum.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/agents/overview.md — agent operations, format validation
- docs/docs_overall/llm_provider_limits.md
- docs/feature_deep_dives/evolution_metrics.md
- docs/docs_overall/testing_overview.md

## Code Files Read

### Cost Tracking
- `evolution/src/lib/pipeline/infra/trackBudget.ts` — V2CostTracker, reserve/recordSpend, budget overrun logging
- `evolution/src/lib/pipeline/infra/createLLMClient.ts` — LLM client wrapper, OUTPUT_TOKEN_ESTIMATES, calculateCost()
- `src/config/llmPricing.ts` — pricing table, getModelPricing(), calculateLLMCost()
- `src/lib/services/llmSpendingGate.ts` — global spending gate

### Pipeline Core
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — orchestrator, nextIteration(), parallel dispatch
- `evolution/src/lib/core/agents/generateFromSeedArticle.ts` — generate + rank per agent
- `evolution/src/lib/pipeline/loop/rankSingleVariant.ts` — binary search ranking algorithm
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — run context, arena loading
- `evolution/src/lib/pipeline/setup/generateSeedArticle.ts` — seed article generation (V1 cost path)
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — executePipeline entry point

### Comparison System
- `evolution/src/lib/shared/computeRatings.ts` — buildComparisonPrompt(), compareWithBiasMitigation()
- `evolution/src/lib/shared/reversalComparison.ts` — 2-pass A/B reversal framework
- `evolution/src/lib/shared/comparisonCache.ts` — order-invariant SHA-256 cache

### Error Handling
- `evolution/src/lib/types.ts` — BudgetExceededError, BudgetExceededWithPartialResults
- `evolution/src/lib/pipeline/errors.ts` — error classes
- `evolution/src/lib/core/Agent.ts` — Agent.run() budget error handling

### Metrics & Config
- `evolution/src/lib/metrics/registry.ts` — metric definitions
- `evolution/src/lib/metrics/writeMetrics.ts` — writeMetric, writeMetricMax
- `evolution/src/lib/metrics/types.ts` — MetricRow, entity types
- `evolution/src/lib/core/agentNames.ts` — AgentName type, COST_METRIC_BY_AGENT
- `evolution/src/lib/schemas.ts` — EvolutionConfig schema, execution detail schemas
- `evolution/src/lib/pipeline/infra/types.ts` — V2StrategyConfig, EvolutionConfig

### Tests
- `evolution/src/lib/pipeline/infra/trackBudget.test.ts` — unit tests for cost tracker
- `evolution/src/lib/pipeline/infra/trackBudget.property.test.ts` — property-based tests
- `evolution/src/lib/pipeline/infra/createLLMClient.test.ts` — LLM client tests
- `src/__tests__/integration/evolution-cost-attribution.integration.test.ts` — per-purpose cost attribution
- `src/__tests__/integration/evolution-cost-cascade.integration.test.ts` — cost cascade
- `src/config/llmPricing.test.ts` — pricing lookup tests

## Strategy Config: New Fields (`maxVariants`, `budgetBuffer`)

### Current V2StrategyConfig Schema

Defined in `evolution/src/lib/schemas.ts:321-328`:
```typescript
export const v2StrategyConfigSchema = z.object({
  generationModel: z.string(),
  judgeModel: z.string(),
  iterations: z.number().int().min(1),
  strategiesPerRound: z.number().int().min(1).optional(),
  budgetUsd: z.number().min(0).optional(),
  generationGuidance: generationGuidanceSchema.optional(),
});
```

### Config Hash (Dedup)

Only 3 fields are hashed: `generationModel`, `judgeModel`, `iterations` (in `findOrCreateStrategy.ts:25`). New fields should NOT be hashed — they're tuning parameters.

### Field Propagation Path

1. **Stored**: `evolution_strategies.config` JSONB column (no migration needed — untyped JSONB)
2. **Loaded**: `buildRunContext.ts:153-176` — reads strategy row, parses with `v2StrategyConfigSchema.safeParse()`
3. **Mapped to runtime**: Strategy fields → `EvolutionConfig` (run-level config, `schemas.ts:341-359`)
4. **Used**: `runIterationLoop.ts:174` reads `config.numVariants ?? 9`

### Proposed New Fields

#### `maxVariants` (replaces the implicit `numVariants` default of 9)

- **Purpose**: Maximum number of generateFromSeedArticle agents to spawn per run. Excludes seed article generation.
- **Schema**: `z.number().int().min(1).max(100)` — REQUIRED for new strategies, default 9 for legacy
- **NOT hashed** — tuning parameter
- **Lives in**: `V2StrategyConfig` (strategy-level), mapped to `EvolutionConfig.numVariants` at runtime
- **Legacy handling**: `buildRunContext.ts` maps `stratConfig.maxVariants ?? 9` → `config.numVariants`

#### `budgetBuffer` (fraction of budget to reserve for post-generation phases)

- **Purpose**: Reduce generation agent count so that X% of budget is estimated to remain for swiss ranking etc.
- **Schema**: `z.number().min(0).max(1).optional().default(0)` — 0 = no buffer (current behavior), 0.3 = reserve 30%
- **NOT hashed** — financial tuning parameter
- **Lives in**: `V2StrategyConfig`, mapped to `EvolutionConfig.budgetBuffer` at runtime

### Budget Buffer Implementation

**Formula** (in `runIterationLoop.ts`, before dispatch):
```
totalBudget = config.budgetUsd  // available from EvolutionConfig
maxBudgetForGeneration = totalBudget * (1 - config.budgetBuffer)
estimatedCostPerAgent = estimateAgentCost(originalText, strategy, genModel, judgeModel, poolSize)
maxAgents = floor(maxBudgetForGeneration / estimatedCostPerAgent)
dispatchCount = min(config.maxVariants, max(1, maxAgents))
```

**Key issue**: `V2CostTracker` only exposes `getAvailableBudget()` (remaining), not the total cap. Options:
- (A) Extend `V2CostTracker` interface with `getTotalBudget()` — simple, exposes closure var
- (B) Pass `budgetUsd` separately from config — already available as `config.budgetUsd`

**Recommendation**: Option (B) — `config.budgetUsd` is already in scope in `runIterationLoop.ts`. No need to modify the cost tracker.

### Files to Modify

| File | Change |
|------|--------|
| `evolution/src/lib/schemas.ts:321` | Add `maxVariants` and `budgetBuffer` to `v2StrategyConfigSchema` |
| `evolution/src/lib/schemas.ts:341` | Add `budgetBuffer` to `evolutionConfigSchema` |
| `evolution/src/lib/pipeline/setup/buildRunContext.ts:169` | Map `stratConfig.maxVariants` → `config.numVariants` |
| `evolution/src/lib/pipeline/loop/runIterationLoop.ts:174` | Read `config.budgetBuffer`, apply to dispatch count |
| `evolution/src/services/strategyRegistryActions.ts:32` | Add to `createStrategySchema` validation |
| `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts:47` | Optionally include in label |
| `src/app/admin/evolution/_components/StrategyConfigDisplay.tsx` | Add to display interface |
| `src/app/admin/evolution/_components/ExperimentForm.tsx` | Add form fields (if strategy creation UI exists inline) |

## Multi-Variant Ranking (Faster Convergence)

### Motivation

Current binary search ranking needs ~59 comparisons (118 LLM calls) to converge one variant in a large pool. Multi-variant ranking presents 3-4 variants to the judge in one prompt, extracting N-choose-2 pairwise outcomes per call.

### OpenSkill Multi-Team Support

OpenSkill `rate()` natively supports N-team rankings:
```typescript
const [[a2], [b2], [c2], [d2]] = rate([[a1], [b1], [c1], [d1]], {
  rank: [4, 1, 3, 2]  // b wins, d 2nd, a 3rd, c last
});
```
Returns updated ratings in same order as input.

### Multi-Team vs Decomposed Pairwise: Sigma Reduction (Verified from Source)

**Source**: `node_modules/openskill/dist/rate.js:72-121` (Plackett-Luce model)

The key formula:
```javascript
c = sqrt(Σ all teams (teamSigmaSq + BETASQ))   // line 74
iGamma = sqrt(iSigmaSq) / c                     // line 86, 113
iDelta = iGamma * deltaSum * (iSigmaSq / c²)    // line 115
sigma_new = sigma * sqrt(1 - (sigma²/iSigmaSq) * iDelta)  // line 118
```

For equal-rated players (sigma=8.333, beta=4.167, BETASQ=17.36):
- `c = sqrt(numTeams × 86.80)` → grows as sqrt(numTeams)
- `iDelta` has factors `1/c` (from iGamma) and `1/c²` (explicit), but `deltaSum` grows ~linearly with numTeams
- **Net scaling: `iDelta ∝ 1/sqrt(numTeams)`** (not 1/c² as previously claimed)

| Teams | c | Sigma reduction (relative to 2-team) |
|-------|---|--------------------------------------|
| 2 (pairwise) | 13.17 | 1.0x (baseline) |
| 3 | 16.14 | ~0.82x (18% less) |
| 4 | 18.63 | ~0.71x (29% less) |

**Previous analysis overstated the penalty.** Multi-team gives ~18-29% less sigma reduction per observation than pairwise, NOT 87.5% less. The earlier claim of "22x weaker" was incorrect — it didn't account for `deltaSum` growing with team count.

### Theoretical Soundness: Use Multi-Team rate(), Don't Decompose

**A single ranking observation is one probabilistic event.** When a judge ranks [A, B, C] as B > A > C, that's one holistic judgment. Decomposing it into 3 "independent" pairwise updates (B>A, B>C, A>C) **overcounts information** — those outcomes are correlated (they all derive from the same judgment). This produces artificially overconfident ratings (sigma drops too fast).

Plackett-Luce is the statistically correct model for a single ranking observation. It correctly accounts for the information content of one k-way ranking.

**The right approach:**
1. Each Latin square permutation IS an independent LLM judgment → apply via multi-team `rate()` 
2. K=N permutations → K calls to `rate()` → K genuine observations → honest sigma reduction
3. Do NOT decompose into pairwise — that treats K observations as K×(N choose 2) observations

**For N=3, K=3 (Latin square):**
- 3 calls to `rate([[A],[B],[C]], { rank: [rankings] })` 
- Each reduces sigma by ~82% as much as a pairwise call would
- 3 observations → sigma drops by roughly: `(1 - 0.82×δ_pairwise)³`
- Still much more efficient than 6 pairwise LLM calls for the same 3 pairs

### Prompt Design

```
You are an expert writing evaluator. Rank the following {N} texts from best to worst.

## Text 1
{text_1}

## Text 2
{text_2}

## Text 3
{text_3}

## Evaluation Criteria
- Clarity and readability
- Structure and flow
- Engagement and impact
- Grammar and style
- Overall effectiveness

Respond with ONLY a comma-separated list of text numbers (best first).
Example: "2, 1, 3"

Your ranking:
```

**Output parsing priority chain** (similar to existing `parseWinner()`):
1. Exact format: `"2, 1, 3"` → validate all numbers unique and in range
2. Number extraction: `"The ranking is: 2, 1, 3"` → extract via regex
3. Ordinal patterns: `"First: 2, Second: 1, Third: 3"` → extract via ordinal regex
4. `null` → unparseable, skip this permutation

### Position Bias Mitigation: Latin Square Permutations

**Use a Latin square** to guarantee each variant appears exactly once in each position across K permutations. This completely eliminates position bias by design — no variant is systematically advantaged or disadvantaged.

**For N variants, K = N permutations are required** for perfect balance. Generated via cyclic shifts:

```typescript
function generateLatinSquare(n: number): number[][] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i + j) % n)
  );
}
```

**N=3 (3 permutations — perfect balance):**
```
Perm 1: [A, B, C]  — each variant appears
Perm 2: [B, C, A]  — exactly once in
Perm 3: [C, A, B]  — each position ✓
```
3 LLM calls → 3 × 3 = 9 pairwise outcomes (each pair seen 3 times)

**N=4 (4 permutations — perfect balance):**
```
Perm 1: [A, B, C, D]
Perm 2: [B, C, D, A]
Perm 3: [C, D, A, B]
Perm 4: [D, A, B, C]
```
4 LLM calls → 4 × 6 = 24 pairwise outcomes (each pair seen 4 times)

**K < N is NOT acceptable for perfect balance** — each position would have unequal representation, reintroducing the very bias we're trying to eliminate.

**Recommended group size: N=3** (3 LLM calls for complete balance). N=4 gives more outcomes per call but requires 4 permutations and larger prompts. N=3 is the sweet spot: perfect balance with 3 calls, fits easily in any model's context window, and 3 articles is within the judge's reliable evaluation capacity.

Each permutation → decompose into pairwise outcomes:
- If X ranked above Y in permutation → X beats Y (one pairwise outcome)
- 3-variant ranking → 3 pairwise outcomes per permutation
- 3 permutations → 9 pairwise outcomes from 3 LLM calls (vs 6 calls for 3 pairwise comparisons with 2-pass reversal)

**Confidence scoring** from aggregation:
- X beats Y in K/K permutations → confidence 1.0
- X beats Y in (K-1)/K → confidence ~0.67 (for K=3)
- X beats Y in K/2 → confidence 0.5 (treat as draw)
- Parsing failure → skip permutation, reduce K denominator

**For 9 variants**: Split into 3 groups of 3. Each group gets its own Latin square (3 permutations). Balance is WITHIN each group. Cross-group comparison uses the existing Swiss pairing system.

### Context Window Analysis

| Variants | Avg Input (median 5166 chars/variant) | Tokens (~chars/4) | Fits in 8k? | Fits in 128k? |
|----------|--------------------------------------|-------------------|------------|--------------|
| 2 (current) | 698 + 2×5166 = 11,030 | ~2,758 | Yes | Yes |
| 3 | ~800 + 3×5166 = 16,298 | ~4,075 | Marginal | Yes |
| 4 | ~900 + 4×5166 = 21,564 | ~5,391 | No | Yes |
| 5 | ~1000 + 5×5166 = 26,830 | ~6,708 | No | Yes |

`gpt-oss-20b` (8k context) can only handle 2-3 median variants. All 128k models (gpt-4.1-mini, gpt-5-mini, deepseek-chat) easily handle 4-5.

### Cache Design

Multi-variant cache key: sort variant text hashes, concatenate, hash again. Permutation-order independent.
```
key = "multi:" + sha256(sorted_text_hashes.join("|")) + "|n=" + N
```

Same variant set in any permutation order → same cache key. Cache stores the aggregated pairwise outcomes across all K permutations.

### Efficiency Comparison

**For ranking 3 variants (all pairs):**

| Method | LLM Calls | Pairwise Outcomes | Outcomes/Call | Cost (relative) |
|--------|-----------|-------------------|---------------|-----------------|
| Pairwise 2-pass (current) | 6 | 3 | 0.5 | 1.0x |
| Multi-variant N=3, Latin square (K=3) | 3 | 9 | 3.0 | ~0.75x |

**For ranking 4 variants (all pairs):**

| Method | LLM Calls | Pairwise Outcomes | Outcomes/Call | Cost (relative) |
|--------|-----------|-------------------|---------------|-----------------|
| Pairwise 2-pass (current) | 12 | 6 | 0.5 | 1.0x |
| Multi-variant N=4, Latin square (K=4) | 4 | 24 | 6.0 | ~0.67x |

Input tokens per call are ~1.5x higher (3 articles vs 2) for N=3 or ~2x for N=4. But each call produces 3x or 6x more pairwise outcomes. Each pairwise outcome is applied via decomposed `updateRating()` for maximum sigma reduction.

### Empirical Sigma Reduction (computed with real openskill library)

**Single call, by team count** (all fresh ratings, decisive ranking):

| Teams | Per-variant sigma reduction | Total reduction (all variants) | Variants updated |
|-------|---------------------------|-------------------------------|-----------------|
| 2 (pairwise) | 0.2678 each | 0.5357 | 2 |
| 3 | 0.1285, 0.2755, 0.2755 | 0.6795 | 3 |
| 4 | 0.0702, 0.1541, 0.2496, 0.2496 | 0.7235 | 4 |
| 5 | 0.0428, 0.0932, 0.1533, 0.2215, 0.2215 | 0.7324 | 5 |

Note: In multi-team, the **winner gets the least sigma reduction** and the **loser gets the most**. This is because the loser's position is most informative (ranked last = strong evidence of low skill). Middle positions are somewhat ambiguous.

**Latin square (K=N permutations) vs pairwise 2-pass reversal:**

| N | Multi-team calls | Total σ reduction | σ/call | Pairwise calls | Total σ reduction | σ/call | **Efficiency ratio** |
|---|-----------------|-------------------|--------|---------------|-------------------|--------|---------------------|
| 2 | 2 | 1.023 | 0.511 | 2 | 0.536 | 0.268 | **1.91x** |
| 3 | 3 | 1.895 | 0.632 | 6 | 1.560 | 0.260 | **2.43x** |
| 4 | 4 | 2.653 | 0.663 | 12 | 3.026 | 0.252 | **2.63x** |
| 5 | 5 | 3.330 | 0.666 | 20 | 4.886 | 0.244 | **2.73x** |

**Key findings:**
- Multi-team Latin square is **2.4-2.7x more efficient per LLM call** than pairwise 2-pass
- Pairwise achieves more TOTAL sigma reduction (3.026 vs 2.653 for N=4) but uses 3x more LLM calls (12 vs 4)
- Efficiency advantage grows slightly with N but plateaus around 2.7x
- **N=3 is the sweet spot**: 2.43x efficiency, only 3 LLM calls, perfect Latin square balance, fits all models' context windows
- Input tokens per multi-team call are ~1.5x pairwise (3 articles vs 2), so true cost efficiency is ~2.43/1.5 ≈ **1.6x per dollar**

### Integration Approach

1. Add `buildRankingPrompt()`, `parseRanking()`, `runKPassPermutation()` alongside existing pairwise functions
2. Apply each permutation result via native multi-team `rate()` — this is the statistically correct model for a single ranking observation (do NOT decompose into pairwise, which overcounts information)
3. Aggregate confidence across K permutations per pair: unanimous agreement → confidence 1.0, disagreement → treat as draw
4. Keep pairwise `compareWithBiasMitigation()` as fallback for groups of 2
5. Pipeline agents opt-in via config flag (e.g., `rankingMode: 'pairwise' | 'multi_variant'`)

## Open Questions

1. **Should we query production DB** for more empirical data? Staging has only 45 GFSA invocations across 5 runs. Production may have more data with different model/strategy distributions.
2. ~~**Comparison count estimation**: Should we estimate differently for iteration 0 vs later?~~ **RESOLVED**: Yes — created separate `EMPIRICAL_COMPARISONS_ITER0` (1-4 range) vs `EMPIRICAL_COMPARISONS_LATER` (3-13 range) constants.
3. **Should the improved estimates be model-aware?** Different models produce different output lengths. Current empirical data is all from `gpt-5-mini`/`gpt-5-nano` — other models may differ.
4. ~~**Cache hit rate**: Should estimation account for cache hits?~~ **RESOLVED**: Cache impact is minimal in iteration 0 (all novel pairs). For swiss iterations, it reduces cost but swiss is already cheap (~7% of total). Not worth modeling for initial implementation.
5. ~~**Rename `createV2LLMClient` → `createEvolutionLLMClient`**: Should this be done in this project or separately?~~ **RESOLVED**: Added to plan as cleanup item, will do in this project.
6. ~~**Should we also estimate swiss iteration cost**?~~ **RESOLVED**: Swiss is 0-7% of cost and ~$0.000260/pair with cheap judge. Not worth modeling initially — focus on GFSA.
7. **`maxVariants` vs `numVariants`**: The existing `numVariants` field on `EvolutionConfig` serves the same purpose. Should `maxVariants` on `V2StrategyConfig` simply map to `numVariants` at runtime? Or should they be separate (strategy-level max vs run-level override)?
8. **Comparison count for estimation**: Should we use pool-size-dependent estimates (from sigma decay analysis) or strategy-based empirical averages? The empirical averages are mostly budget-limited exits, not natural convergence.
9. **Multi-variant ranking scope**: Should this be part of this project or a follow-up? It's a significant change to the comparison system (new prompt, parser, aggregation, cache) but offers ~2x cost efficiency. The core budget estimation/dispatch work is independent.
10. ~~**Decomposed pairwise vs native multi-team**~~ **RESOLVED**: Must use native multi-team `rate()`. Decomposing overcounts information (treats one observation as N-choose-2 independent observations), producing overconfident ratings. Multi-team gives ~18% less sigma reduction per observation for N=3 vs pairwise, but this correctly reflects the information content. Previous claim of "22x weaker" was wrong — didn't account for deltaSum scaling.
11. ~~**Can we guarantee equal position frequency?**~~ **RESOLVED**: Yes — Latin square with K=N permutations via cyclic shifts. For N=3: K=3 permutations, each variant appears exactly once in each position. K < N breaks perfect balance and is not acceptable.
12. **Judge accuracy with 3-4 variants**: Does the LLM produce reliable rankings with 3+ full articles? Needs empirical testing — accuracy may degrade vs pairwise. Should we start with N=3 (simpler, more reliable) before trying N=4?
