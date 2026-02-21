# Optimize Elo Over Fixed Budget Research

## Problem Statement
Given a fixed dollar budget, determine the optimal allocation of LLM API calls across generation, comparison, and evolution to maximize overall Elo ratings. Currently the pipeline uses hardcoded budget splits and a fixed model set. We need: (1) smarter budget allocation, (2) expanded model pool including latest GPT-5.x models, (3) upfront cost estimation, (4) JSON-configurable batch runs with model/iteration combinatorics, and (5) predicted vs realized cost comparison.

## High Level Summary

The evolution pipeline has mature budget enforcement (3-tier: pre-call reservation, per-agent caps, supervisor stopping) but lacks: upfront cost prediction, JSON-driven batch configuration, predicted-vs-actual tracking, and the latest models. The infrastructure is well-positioned for extension — `resolveConfig()` already supports deep-merge overrides, `CostTracker` tracks per-agent spend, and the `llmCallTracking` table logs every call with real token counts.

**Critical insight for optimization strategy:** The system already tracks `elo_per_dollar` in `article_bank_elo` and `strategyEffectiveness` in `run_summary`, but **lacks the integration layer** connecting these to guide budget allocation. The data exists to answer "which agents/models/configs produce the best Elo/dollar" — we just need to compute and act on it.

## Requirements
1. **Maximize Elo given budget** — Allocate budget across agents (generation, calibration, tournament, evolution, reflection, debate, iterativeEditing) to maximize Elo improvement per dollar
2. **Expand model pool** — Add latest GPT models (gpt-5, gpt-5-mini, gpt-5-nano, etc.) and other providers to both generation and judge roles
3. **Upfront budget estimation** — Before running, calculate expected cost based on config (iterations, model pricing, agent allocation) and show predicted total
4. **JSON batch config** — Define a JSON config that specifies multiple runs: combinations of models (generation + judge), iteration counts, budget caps, and agent allocations, subject to a total budget constraint
5. **Predicted vs realized cost** — After each run, compare the upfront estimate to actual spend and surface the delta

## Documents Read
- `docs/feature_deep_dives/evolution_pipeline.md` — Full pipeline architecture, agents, Elo system, budget enforcement, config
- `docs/feature_deep_dives/evolution_pipeline_visualization.md` — Dashboard, run detail tabs, comparison page
- `docs/feature_deep_dives/comparison_infrastructure.md` — Article bank, Swiss-style comparison, Elo rating, multi-provider LLM support, prompt bank

## Code Files Read (Round 1)
- `src/lib/evolution/core/costTracker.ts` — CostTrackerImpl with pre-call reservation (30% margin), per-agent caps, optimistic reconciliation
- `src/lib/evolution/config.ts` — DEFAULT_EVOLUTION_CONFIG ($5 budget, 7 agent caps summing to 100%), ELO_CONSTANTS, K_SCHEDULE, resolveConfig()
- `src/lib/evolution/core/elo.ts` — Standard Elo with 400-point divisor, floor=800, adaptive K (48/32/16), confidence-weighted updates
- `src/lib/evolution/core/supervisor.ts` — EXPANSION→COMPETITION transitions, 4 stopping conditions (plateau, budget, max iterations, degenerate)
- `src/lib/evolution/core/llmClient.ts` — Evolution LLM wrapper, EVOLUTION_DEFAULT_MODEL=deepseek-chat, estimateTokenCost (4 chars/token heuristic)
- `src/lib/services/llms.ts` — callLLM, callLLMModelRaw router (claude-*→Anthropic, deepseek-*→DeepSeek, gpt-*/o3-*→OpenAI), DEFAULT_MODEL=gpt-4.1-mini
- `src/lib/schemas/schemas.ts` — allowedLLMModelSchema Zod enum (11 models)
- `src/config/llmPricing.ts` — 40+ model pricing entries, calculateLLMCost(), prefix-based matching, fallback pricing
- `scripts/lib/oneshotGenerator.ts` — Multi-provider generation with onUsage cost accumulation
- `src/config/promptBankConfig.ts` — Static TypeScript: 5 prompts × 4 methods (3 oneshot + 1 evolution with checkpoints [3,5,10])
- `scripts/run-prompt-bank.ts` — Batch orchestrator: coverage matrix from DB, sequential generation, child process for evolution, --max-cost cap
- `scripts/run-prompt-bank-comparisons.ts` — Batch comparison: all-pairs × rounds, Swiss pairing, Elo updates, aggregate summary
- `scripts/run-evolution-local.ts` — Local CLI: --prompt/--file, --bank, --bank-checkpoints, --budget, mock mode
- `scripts/evolution-runner.ts` — Production batch: claim pending runs, executeFullPipeline, heartbeat, graceful shutdown
- `src/lib/evolution/agents/base.ts` — AgentBase abstract: execute(), estimateCost(), canExecute()
- `src/lib/evolution/agents/generationAgent.ts` — 3 strategies, heuristic cost estimate (hardcoded $0.0004/$0.0016 rates)
- `src/lib/evolution/agents/calibrationRanker.ts` — Stratified opponents, adaptive early exit, bias mitigation doubles calls
- `src/lib/evolution/agents/tournament.ts` — Swiss pairing, budgetPressureConfig (adapts comparisons to remaining budget)
- `src/lib/evolution/agents/evolvePool.ts` — Mutation/crossover/creative (30% wild card), 3 parallel calls
- `src/lib/evolution/agents/iterativeEditingAgent.ts` — Critique→edit→judge cycles, maxCycles=3, diff-based judging
- `src/lib/evolution/core/pipeline.ts` — executeFullPipeline/executeMinimalPipeline orchestration
- `src/lib/evolution/types.ts` — EvolutionRunConfig, PipelineState, AgentResult (no estimatedCostUsd field)

## Code Files Read (Round 2 — Elo/Dollar Optimization Focus)
- `article_bank_elo` table — `elo_per_dollar = (elo_rating - 1200) / total_cost_usd`, updated after each comparison
- `article_bank_comparisons` table — Match history with confidence scores, judge model, dimension scores
- `src/lib/services/articleBankActions.ts` — 14 actions including `getBankLeaderboardAction`, `getCrossTopicSummaryAction`, `getPromptBankMethodSummaryAction`
- `evolution_runs.run_summary` — JSONB with `strategyEffectiveness`, `eloHistory`, `baselineRank`, `metaFeedback`
- `evolution_variants` table — Per-variant Elo but **no cost field** (cost attribution gap)
- `llmCallTracking` table — Full token counts, `call_source` like `evolution_generation`, `estimated_cost_usd`
- `src/lib/services/costAnalytics.ts` — `getCostSummaryAction`, `getCostByModelAction`, `getCostByUserAction`, `getDailyCostsAction`
- `daily_llm_costs` view — Pre-aggregated daily costs by model/user
- `src/lib/evolution/agents/metaReviewAgent.ts` — `_analyzeStrategies()`, `_findWeaknesses()`, `_findFailures()`, `_prioritize()` (zero-cost analysis)

## Key Findings

### Current Budget System
- **Total budget default:** $5.00 per run
- **Per-agent caps:** generation 25%, calibration 15%, tournament 25%, evolution 15%, reflection 5%, debate 5%, iterativeEditing 10%
- **Enforcement:** Pre-call reservation with 30% safety margin, atomic per-agent + global checks
- **Stopping:** Budget < $0.01, quality plateau (< 2 Elo points over 3 iterations), max 15 iterations, degenerate diversity < 0.01

### Current Model Support (11 models)
- **OpenAI:** gpt-4.1 ($2/$8), gpt-4.1-mini ($0.40/$1.60), gpt-4.1-nano ($0.10/$0.40), gpt-5-mini ($0.25/$2), gpt-5-nano ($0.05/$0.40), o3-mini ($1.10/$4.40)
- **DeepSeek:** deepseek-chat ($0.14/$0.28) — evolution default
- **Anthropic:** claude-sonnet-4 ($3/$15)
- **Missing:** gpt-5, gpt-5.1, gpt-5.1-mini, newer Anthropic models

### Cost Estimation Gaps
- Agent `estimateCost()` methods use **hardcoded rates** (e.g., $0.0004/$0.0016) instead of actual `llmPricing.ts` data
- **No `estimatedCostUsd` field** on `AgentResult` — only actual spend tracked
- **No predicted-vs-actual comparison** exists anywhere in the system
- Heuristic: 4 chars/token, output ≈ input tokens — likely 30-50% off for generation vs comparison tasks

### Batch System Gaps
- Prompt bank config is **static TypeScript**, not JSON-loadable
- Batch orchestrator tracks oneshot costs but **not evolution child process costs** at orchestrator level
- No **batch ID** linking related runs together
- Evolution child process timeout hardcoded (600s/1200s)
- All generation sequential — no parallel child processes
- No combinatorial expansion (model × iterations × budget permutations)

### Adaptive Tournament (Existing Strength)
The tournament agent already adapts to budget pressure:
- Low pressure (<50% spent): 40 comparisons, 3 multi-turn tiebreakers
- Medium pressure (50-80%): 25 comparisons, 1 tiebreaker
- High pressure (>80%): 15 comparisons, no tiebreakers
This pattern could be extended to other agents.

### Cost Per Phase (Empirical Estimates)
- **EXPANSION iteration:** $0.30-0.80 (generation + calibration + proximity)
- **COMPETITION iteration:** $0.70-1.90 (all agents, highly variable)
- **Typical full run (15 iterations):** $3-8 depending on article length and agent suite

---

## Elo/Dollar Optimization: Data Available vs Missing

### Data Available Today ✓
| Data | Location | Granularity |
|------|----------|-------------|
| Elo per dollar | `article_bank_elo.elo_per_dollar` | Per article entry |
| Strategy effectiveness | `run_summary.strategyEffectiveness` | Per strategy per run |
| Per-agent cost | `costTracker` (memory) | Per agent per run (not persisted) |
| LLM call history | `llmCallTracking` | Per call with `call_source` |
| Cross-topic method summary | `getCrossTopicSummaryAction` | Avg Elo, cost, win rate per method |
| Prompt bank coverage | `getPromptBankCoverageAction` | Prompts × methods matrix |

### Critical Gaps ✗
| Gap | Impact | Solution |
|-----|--------|----------|
| **No per-variant cost** | Can't compute cost-per-Elo-gain for individual variants | Add `cost_usd` column to `evolution_variants` |
| **No per-agent cost persistence** | Can't analyze which agents have best ROI across runs | Add `evolution_run_agent_metrics` table |
| **No config-level tracking** | Can't compare "5 iterations vs 10" or "gpt-4.1 vs deepseek" | Store config params + computed metrics in `run_summary` |
| **No historical baselines** | Can't predict cost for new (model, agent) combos | Build `agent_cost_baseline` table from `llmCallTracking` |

### Historical Data for Cost Calibration
From `llmCallTracking`, we can compute per-agent token baselines:
```sql
SELECT call_source, model,
       AVG(prompt_tokens) as avg_prompt,
       AVG(completion_tokens) as avg_completion,
       AVG(estimated_cost_usd) as avg_cost
FROM llmCallTracking
WHERE call_source LIKE 'evolution_%'
GROUP BY call_source, model;
```
This enables accurate cost prediction for future runs.

---

## Strategy for Testing & Optimizing Elo Over Fixed Budget

### Phase 1: Establish Baselines (Measure Current State)
**Goal:** Understand current Elo/dollar performance before making changes.

1. Run the existing prompt bank (`run-prompt-bank.ts`) to generate baseline articles
2. Run comparisons (`run-prompt-bank-comparisons.ts`) to establish Elo rankings
3. Query `getCrossTopicSummaryAction` to get per-method avg Elo, cost, elo_per_dollar
4. Export baseline data: `{ method, avgElo, avgCost, avgEloPerDollar, winRate }`

**Expected output:**
```
oneshot_gpt-4.1-mini:     Elo=1245, Cost=$0.12, Elo/$=375
oneshot_deepseek-chat:    Elo=1230, Cost=$0.04, Elo/$=750
evolution_deepseek_5iter: Elo=1285, Cost=$2.50, Elo/$=34
evolution_deepseek_10iter: Elo=1310, Cost=$4.80, Elo/$=23
```

### Phase 2: Instrument Cost Attribution
**Goal:** Enable per-variant and per-agent cost tracking.

1. Add `cost_usd` to `TextVariation` type and `evolution_variants` table
2. Modify agents to tag variants with creation cost at `addToPool()` time
3. Add `evolution_run_agent_metrics` table: `(run_id, agent_name, cost_usd, variants_generated, avg_elo)`
4. Persist per-agent costs from `costTracker` at run completion

### Phase 3: Build Cost Estimation from Historical Data
**Goal:** Replace hardcoded estimates with data-driven predictions.

1. Query `llmCallTracking` to compute per-agent, per-model baselines
2. Create `agent_cost_baseline` table with: `agent, model, avg_tokens, avg_cost, sample_size`
3. Update each agent's `estimateCost()` to lookup baseline and scale by text length
4. Add `estimatedCostUsd` to `AgentResult` and compare to actual at run end

### Phase 4: JSON Batch Config with Combinatorial Expansion
**Goal:** Enable systematic exploration of model × iteration × budget space.

**Batch config schema:**
```typescript
interface BatchConfig {
  name: string;
  totalBudgetUsd: number;
  matrix: {
    prompts: string[];
    generationModels: string[];
    judgeModels: string[];
    iterations: number[];
    budgetAllocations?: Record<string, number>[]; // optional per-agent cap variations
  };
  comparison: { judgeModel: string; rounds: number };
}
```

**Expansion algorithm:**
1. Compute Cartesian product: `prompts × genModels × judgeModels × iterations`
2. For each combo, estimate cost using calibrated baselines
3. Sort by estimated Elo/dollar (heuristic: cheaper + higher historical Elo → higher priority)
4. Greedily select runs until `sum(estimatedCost) > totalBudget`
5. Execute selected runs, track actual cost
6. Run comparisons across all generated articles
7. Output: predicted vs actual cost, Elo leaderboard, Elo/dollar rankings

### Phase 5: Adaptive Budget Allocation
**Goal:** Shift budget toward agents with proven Elo/dollar ROI.

**Algorithm:**
```typescript
function computeAdaptiveBudgets(leaderboard: AgentMetrics[], totalBudget: number) {
  // Rank agents by avgEloPerDollar from historical runs
  const ranked = leaderboard.sort((a, b) => b.avgEloPerDollar - a.avgEloPerDollar);

  // Allocate proportional to performance, with min 5% floor
  const totalEpd = ranked.reduce((s, a) => s + a.avgEloPerDollar, 0);
  return Object.fromEntries(
    ranked.map(a => [a.agent, Math.max(0.05, a.avgEloPerDollar / totalEpd)])
  );
}
```

Apply to `config.budgetCaps` before each run, based on last N runs' data.

### Phase 6: Comparative Analysis & Reporting
**Goal:** Answer "what's the best way to spend $X?"

**Key queries:**
1. **Model comparison:** Given prompt difficulty, which model maximizes Elo/dollar?
2. **Iteration sweet spot:** At what iteration count does marginal Elo gain drop below cost?
3. **Agent ROI:** Which agents contribute most Elo per dollar?
4. **Config optimization:** What (model, iterations, budgetCaps) combo is Pareto-optimal?

**Dashboard additions:**
- Elo vs Cost scatter plot with Pareto frontier
- Agent effectiveness leaderboard (Elo/dollar ranking)
- Predicted vs actual cost tracking over time
- Budget allocation recommendations based on historical data

---

## Recommended Execution Order

1. **Phase 1** (Baselines) — Can run immediately with existing infrastructure
2. **Phase 2** (Cost attribution) — DB migration + agent modifications
3. **Phase 3** (Data-driven estimation) — Depends on Phase 2 for calibration data
4. **Phase 4** (Batch config) — Independent, can parallelize with Phase 2-3
5. **Phase 5** (Adaptive allocation) — Depends on Phase 2-3 for ROI data
6. **Phase 6** (Reporting) — Depends on all prior phases for comprehensive data

---

## Detailed Technical Findings (Round 2 Agents)

### Agent Cost Tracking Infrastructure

**10 distinct evolution agents tracked via `call_source`:**
| Agent | `call_source` Value | Primary Cost Driver |
|-------|---------------------|---------------------|
| Generation | `evolution_generation` | High token count (full article) |
| Calibration | `evolution_calibration` | Model choice × opponents |
| Tournament | `evolution_tournament` | Number of Swiss pairings |
| Evolution | `evolution_evolution` | Mutation/crossover calls |
| Reflection | `evolution_reflection` | Rubric critique tokens |
| Debate | `evolution_debate` | 4 calls per comparison |
| IterativeEditing | `evolution_iterativeEditing` | Feedback loop cycles |
| MetaReview | `evolution_meta_review` | Zero cost (computation only) |
| Proximity | `evolution_proximity` | Embedding comparisons |
| Pairwise | `evolution_pairwise` | Simple A/B judgments |

**Cost calculation formula** (from `llmPricing.ts`):
```
cost = (promptTokens / 1M) × inputPricePer1M
     + (completionTokens / 1M) × outputPricePer1M
     + (reasoningTokens / 1M) × reasoningPricePer1M  // o1/o3 only
```

### MetaReviewAgent Analysis Capabilities

The `MetaReviewAgent` already performs zero-cost effectiveness analysis:

1. **`_analyzeStrategies()`** — Groups variants by strategy, computes avg Elo, returns above-average strategies
2. **`_findWeaknesses()`** — Identifies bottom-quartile failure patterns
3. **`_findFailures()`** — Finds strategies with negative parent→child Elo delta (threshold: -50)
4. **`_prioritize()`** — Flags diversity issues, stale top performers, strategy coverage gaps

**Output stored in:** `state.metaFeedback` → `run_summary.metaFeedback`

This is the foundation for adaptive allocation — we just need to connect it to budget decisions.

### Batch Orchestration Patterns

**Current `run-prompt-bank.ts` architecture:**
1. **Coverage matrix:** Builds `prompts × methods` grid, queries DB for existing entries
2. **Method expansion:** Evolution checkpoints `[3, 5, 10]` → 3 labels (`evolution_deepseek_3iter`, etc.)
3. **Missing detection:** Collects cells where `exists = false`
4. **Sequential execution:** Oneshot via `generateOneshotArticle()`, evolution via child process `execFileSync`
5. **Budget tracking:** Only oneshot costs tracked; evolution costs in child process

**Gaps for combinatorial expansion:**
- No Cartesian product (model × iterations)
- No cross-batch budget enforcement
- No priority sorting by Elo/dollar
- No parallel execution
- No resume from checkpoint

### Database Schema for Elo/Dollar Analysis

**Existing tables with relevant data:**
```sql
-- Article bank Elo tracking
article_bank_elo (
  topic_id, entry_id,
  elo_rating NUMERIC(8,2) DEFAULT 1200,
  elo_per_dollar NUMERIC(12,2),  -- KEY METRIC: (elo - 1200) / cost
  match_count INT
)

-- LLM call history
llmCallTracking (
  call_source VARCHAR(255),  -- e.g., 'evolution_generation'
  model VARCHAR(100),
  prompt_tokens INT,
  completion_tokens INT,
  estimated_cost_usd NUMERIC(10,6),
  created_at TIMESTAMP
)

-- Run summary with effectiveness data
evolution_runs (
  run_summary JSONB  -- Contains strategyEffectiveness, eloHistory, metaFeedback
)
```

**Proposed new tables:**
```sql
-- Per-agent metrics per run
evolution_run_agent_metrics (
  run_id UUID,
  agent_name TEXT,
  cost_usd NUMERIC(10,6),
  variants_generated INT,
  avg_elo NUMERIC(8,2)
)

-- Historical cost baselines for prediction
evolution_agent_cost_baselines (
  agent_name TEXT,
  model TEXT,
  avg_prompt_tokens INT,
  avg_completion_tokens INT,
  avg_cost_usd NUMERIC(10,6),
  sample_size INT
)
```

### Key SQL Queries for Optimization

**Agent ROI leaderboard:**
```sql
SELECT agent_name,
       COUNT(*) as runs,
       AVG(cost_usd) as avg_cost,
       AVG(avg_elo - 1200) as avg_elo_gain,
       AVG((avg_elo - 1200) / NULLIF(cost_usd, 0)) as elo_per_dollar
FROM evolution_run_agent_metrics
GROUP BY agent_name
ORDER BY elo_per_dollar DESC;
```

**Model comparison:**
```sql
SELECT generation_method, model,
       AVG(elo_rating) as avg_elo,
       AVG(total_cost_usd) as avg_cost,
       AVG(elo_per_dollar) as avg_epd
FROM article_bank_entries e
JOIN article_bank_elo elo ON e.id = elo.entry_id
GROUP BY generation_method, model
ORDER BY avg_epd DESC;
```

**Historical baselines for cost prediction:**
```sql
INSERT INTO evolution_agent_cost_baselines
SELECT REPLACE(call_source, 'evolution_', ''),
       model,
       AVG(prompt_tokens)::INT,
       AVG(completion_tokens)::INT,
       AVG(estimated_cost_usd),
       COUNT(*)
FROM llmCallTracking
WHERE call_source LIKE 'evolution_%'
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY call_source, model;
```

---

## Experiment Design Questions

### Question 1: How to Define "Best Elo Per Batch"?

**Context:** When running a batch of experiments with a fixed budget, we need a success metric. Current system uses `elo_per_dollar` per article, but batch-level optimization requires aggregate metrics.

**Options Considered:**

| Metric | Formula | Pros | Cons |
|--------|---------|------|------|
| **Max Elo** | `MAX(elo)` | Shows ceiling potential; answers "how good can we get?" | Ignores variance; may reward lucky runs |
| **Average Elo** | `AVG(elo)` | Stable, consistent measure | Penalized by failed runs; doesn't capture upside |
| **Median Elo** | `MEDIAN(elo)` | Robust to outliers | Loses information about distribution shape |
| **Top-K Average** | `AVG(top K elo)` | Balances ceiling vs consistency | Arbitrary K selection |
| **Elo per Dollar** | `(elo - 1200) / cost` | Efficiency metric | Doesn't account for diminishing returns |
| **Marginal Elo/Dollar** | `Δelo / Δcost` | Captures diminishing returns | Requires sequential budget increments |
| **Reliability-Adjusted** | `AVG(elo) - λ * STDDEV(elo)` | Rewards consistency | Arbitrary λ penalty |

**Analysis:**

The right metric depends on the **use case**:
- **"What's the best we can achieve?"** → Max Elo
- **"What's the most efficient allocation?"** → Elo per Dollar
- **"What's reproducible?"** → Median or Top-K Average
- **"What's the safe bet?"** → Reliability-adjusted (mean - stddev)

**Proposed Multi-Metric Approach:**
1. **Primary:** `best_elo_per_batch = MAX(elo)` — Answers "how high can we go?"
2. **Efficiency:** `elo_per_dollar = (MAX(elo) - 1200) / total_batch_cost` — Efficiency of the best result
3. **Reliability:** `top3_avg_elo = AVG(top 3 elos)` — Reproducibility measure
4. **Diminishing Returns:** Plot `marginal_elo_gain` vs `cumulative_cost` to find the "knee"

**Open Questions:**
- Should we use the **single best article** or **Pareto frontier** (set of non-dominated configs)?
- How do we weight efficiency vs absolute quality for different use cases?
- Should the baseline be 1200 (starting Elo) or the initial generation's Elo?

---

### Question 2: What Factors Should We Vary? Over What Range?

**Context:** We need to design the experimental matrix — which parameters to sweep and what values to test.

**Factor Categories:**

#### A. Model Selection (Discrete)
| Factor | Values to Test | Rationale |
|--------|----------------|-----------|
| Generation Model | `deepseek-chat`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-5-nano`, `gpt-5-mini` | Range from cheap/fast to expensive/capable |
| Judge Model | `gpt-4.1-nano`, `gpt-5-nano`, `deepseek-chat` | Judge quality vs cost tradeoff |
| Model Pairing | Separate gen/judge vs same model | Does asymmetric pairing help? |

#### B. Iteration Count (Integer)
| Factor | Values to Test | Rationale |
|--------|----------------|-----------|
| Max Iterations | `3, 5, 10, 15, 20, 30` | Find diminishing returns point |
| Expansion Iterations | `3, 5, 8` | How long to stay in EXPANSION phase |

#### C. Budget Parameters (Continuous)
| Factor | Values to Test | Rationale |
|--------|----------------|-----------|
| Total Budget | `$1, $2, $5, $10, $20` | Log scale exploration |
| Per-Agent Caps | `uniform`, `gen-heavy (40/10/30)`, `tournament-heavy (20/10/40)`, `adaptive` | Test allocation strategies |

#### D. Pipeline Configuration (Discrete)
| Factor | Values to Test | Rationale |
|--------|----------------|-----------|
| Mode | `minimal`, `full` | Cost vs quality tradeoff |
| Active Agents | All vs subset (no debate, no iterativeEditing) | Agent ablation study |
| Pool Size | `5, 10, 15` initial variants | Exploration vs exploitation |

#### E. Quality Thresholds (Continuous)
| Factor | Values to Test | Rationale |
|--------|----------------|-----------|
| Plateau Threshold | `1, 2, 5, 10` Elo points | Early stopping sensitivity |
| K-Factor Schedule | `aggressive (64/32/16)`, `conservative (32/24/16)` | Elo volatility tradeoff |

**Proposed Experimental Design:**

**Tier 1: Core Sweep (Must Test)**
- Generation Model × Iterations × Total Budget
- 5 models × 5 iteration counts × 4 budgets = **100 configs**
- Estimated cost: ~$500-800 at avg $5-8 per run

**Tier 2: Agent Ablation (If Budget Allows)**
- Full pipeline vs `{no debate}` vs `{no iterativeEditing}` vs `{minimal}`
- 4 configs × 3 prompts × 2 models = **24 configs**
- Estimated cost: ~$120-200

**Tier 3: Budget Allocation Sweep**
- 4 allocation strategies × 3 iteration counts × 2 models = **24 configs**
- Estimated cost: ~$100-150

**Recommended Starting Point:**
```json
{
  "name": "elo_optimization_v1",
  "totalBudgetUsd": 200,
  "matrix": {
    "prompts": ["Explain photosynthesis", "Explain blockchain", "Explain WWI causes"],
    "generationModels": ["deepseek-chat", "gpt-4.1-nano", "gpt-5-nano"],
    "judgeModels": ["gpt-4.1-nano"],
    "iterations": [5, 10, 15]
  }
}
```
This gives 3 × 3 × 1 × 3 = **27 runs** as a tractable starting experiment.

**Open Questions:**
- Should we include **prompt difficulty** as an explicit factor (easy/medium/hard)?
- Should we test **parallel vs sequential** child process execution?
- Do we need a **hold-out test set** of prompts for validation?
- Should we run **multiple replicates** per config to measure variance?

---

## Answers and Decisions

### Decision 1: Elo Metric Definition

**Chosen approach:** Reliably high Elo in article bank comparison

**Rationale:** We're not optimizing within a single run. We want the configuration that, when used repeatedly, produces articles that rank highly when compared against the **entire article bank population**.

**Evaluation flow:**
```
Config A → Run → Top-K articles → Add to bank with labels → Compare vs bank → Elo ratings
Config B → Run → Top-K articles → Add to bank with labels → Compare vs bank → Elo ratings
...
Aggregate by config → Which config has highest mean Elo? Lowest variance?
```

**Success metric:** `config_score = AVG(elo_of_top_k_articles) - λ * STDDEV(elo)` where λ penalizes inconsistency.

Or simpler: **Mean Elo of top-K articles per config**, ranked across configs.

### Decision 2: Experimental Design — Bank-Based Comparison

**Core Idea:** Use the article bank as a stable reference population. Each experimental config produces articles that compete against this population.

#### Labeling Schema for Traceability

Each article added to the bank gets metadata tracking its origin:

```typescript
interface ExperimentArticleMetadata {
  experiment_id: string;           // "elo_opt_v1"
  config_hash: string;             // Deterministic hash of config params
  generation_model: string;        // "gpt-5-nano"
  judge_model: string;             // "gpt-4.1-nano"
  iterations: number;              // 10
  total_budget_usd: number;        // 5.00
  actual_cost_usd: number;         // 4.23
  run_id: string;                  // UUID of evolution run
  rank_in_run: number;             // 1, 2, 3 (top-K selection)
  prompt_id: string;               // Which prompt was used
}
```

Store in `article_bank_entries.metadata` JSONB column (already exists).

#### Top-K Selection Strategy

From each evolution run, select the **top K articles** by final Elo to add to the bank:

| K Value | Pros | Cons |
|---------|------|------|
| K=1 | Measures ceiling only | High variance, ignores depth |
| K=3 | Balances ceiling + depth | Good default |
| K=5 | More robust signal | May include mediocre articles |

**Recommendation:** K=3 (top 3 articles per run).

#### Comparison Protocol

After all experiment runs complete:

1. **Isolation:** Each config's articles compete against the **existing bank** (not each other initially)
2. **Swiss-style rounds:** Run 5 rounds of comparisons per new article
3. **Cross-config comparison:** After Elo stabilization, articles from different configs compete
4. **Aggregation:** Group by `config_hash`, compute `AVG(elo)`, `STDDEV(elo)`, `MIN(elo)`

#### SQL for Config Leaderboard

```sql
-- After running comparisons, aggregate by config
SELECT
  metadata->>'generation_model' as gen_model,
  metadata->>'judge_model' as judge_model,
  (metadata->>'iterations')::int as iterations,
  (metadata->>'total_budget_usd')::numeric as budget,
  COUNT(*) as articles,
  AVG(elo.elo_rating) as avg_elo,
  STDDEV(elo.elo_rating) as stddev_elo,
  MIN(elo.elo_rating) as min_elo,
  MAX(elo.elo_rating) as max_elo,
  AVG(elo.elo_rating) - 0.5 * STDDEV(elo.elo_rating) as reliability_score
FROM article_bank_entries e
JOIN article_bank_elo elo ON e.id = elo.entry_id
WHERE metadata->>'experiment_id' = 'elo_opt_v1'
GROUP BY
  metadata->>'generation_model',
  metadata->>'judge_model',
  metadata->>'iterations',
  metadata->>'total_budget_usd'
ORDER BY reliability_score DESC;
```

### Decision 3: Experimental Factors and Ranges

**Budget constraint:** $10 maximum for first experiment

**Chosen factors (Tier 1):**

| Factor | Values | Rationale |
|--------|--------|-----------|
| Generation Model | `deepseek-chat`, `gpt-5-nano` | Cheap vs mid-tier comparison |
| Iterations | `5, 10` | Explore diminishing returns |
| Prompts | 2 from existing prompt bank | Minimal topic variance control |

**Fixed:**
- Judge model: `gpt-4.1-nano`
- Budget per run: `$1`
- Mode: `full`
- Top-K: 3

**Matrix size:** 2 models × 2 iterations × 2 prompts = **8 runs**
**Articles produced:** 8 runs × 3 top articles = **24 articles** added to bank
**Generation cost:** ~$8 (8 runs × $1 budget)
**Comparison cost:** ~$1.50 (24 articles × 3 rounds × $0.02/comparison)

**Total experiment cost:** ~$10

### Experimental Protocol

**Experiment config (`experiments/elo_opt_v1.json`):**
```json
{
  "name": "elo_opt_v1",
  "description": "First budget optimization experiment - $10 cap",
  "totalBudgetUsd": 10.00,
  "perRunBudgetUsd": 1.00,
  "topK": 3,
  "matrix": {
    "prompts": ["prompt_bank_1", "prompt_bank_2"],
    "generationModels": ["deepseek-chat", "gpt-5-nano"],
    "judgeModels": ["gpt-4.1-nano"],
    "iterations": [5, 10]
  },
  "comparison": {
    "rounds": 3,
    "judgeModel": "gpt-4.1-nano",
    "includeFullBank": true
  }
}
```

**Phase 1: Generate (8 runs)**
```bash
npx tsx scripts/run-elo-experiment.ts \
  --config experiments/elo_opt_v1.json
```

**Phase 2: Compare (24 articles vs bank)**
```bash
npx tsx scripts/run-prompt-bank-comparisons.ts \
  --filter "metadata->>'experiment_id' = 'elo_opt_v1'" \
  --rounds 3 \
  --include-bank
```

**Phase 3: Analyze**
```bash
npx tsx scripts/analyze-elo-experiment.ts \
  --experiment-id elo_opt_v1
```

### Expected Output

**Config Leaderboard (8 configs):**
```
Rank | Gen Model      | Iters | Avg Elo | StdDev | Articles
-----|----------------|-------|---------|--------|----------
1    | gpt-5-nano     | 10    | 1325    | 32     | 6
2    | gpt-5-nano     | 5     | 1298    | 28     | 6
3    | deepseek-chat  | 10    | 1285    | 45     | 6
4    | deepseek-chat  | 5     | 1260    | 38     | 6
```

**Pareto Frontier (Elo vs Cost):**
- Identify configs that are not dominated (no other config has both higher Elo AND lower cost)

**Diminishing Returns Curve:**
- Plot Elo vs Iterations for each model
- Find the "knee" where additional iterations stop helping
