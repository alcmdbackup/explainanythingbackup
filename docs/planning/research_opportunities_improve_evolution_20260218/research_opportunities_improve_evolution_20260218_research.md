# Research Opportunities Improve Evolution Research

## Problem Statement
Research opportunities to improve the evolution pipeline's Elo improvement efficiency per dollar spent. This project will audit the current pipeline's model selection, agent budget allocation, iteration count optimization, and algorithmic approaches to identify concrete improvements that maximize Elo gains relative to cost. The goal is to produce actionable, prioritized recommendations for both technical and algorithmic changes.

## Requirements (from GH Issue #473)

### Elo/$ Efficiency (Algorithmic)
- Research maximizing Elo improvement per dollar spent
- Analyze model selection trade-offs (generation model, judge model) and their impact on Elo/$
- Evaluate agent budget allocation effectiveness — which agents contribute most Elo per dollar
- Investigate optimal iteration counts and diminishing returns curves
- Assess comparison/rating system accuracy and its impact on selection pressure
- Identify algorithmic improvements to the evolutionary process (mutation strategies, crossover effectiveness, selection pressure)
- Review adaptive allocation system and recommend improvements

### Technical Improvements (Infrastructure)
- Evaluate parallelism opportunities — pipeline throughput, concurrent agent execution
- Assess caching effectiveness — comparison cache hit rates, opportunities for cross-run caching
- Review checkpoint/resume efficiency — serialization overhead, state size optimization
- Analyze error recovery paths — retry effectiveness, budget waste from failures
- Investigate pipeline throughput bottlenecks — LLM call latency, DB write patterns
- Review format validation — rejection rates, wasted LLM spend on rejected variants

### Deliverables
- Produce concrete, prioritized recommendations with estimated impact for both tracks
- Rank improvements by effort vs. expected Elo/$ gain

## High Level Summary

The evolution pipeline is a sophisticated 12-agent system that iteratively generates, competes, and refines text variants using LLM-driven agents and an OpenSkill Bayesian rating system. Research across 6 parallel investigations covering cost tracking, model routing, agent execution, comparison/rating, pipeline throughput, and strategy experiments reveals a system with strong foundations but several concrete optimization opportunities.

**Key findings:**

1. **Model cost asymmetry is the primary lever.** DeepSeek (`$0.14/$0.28 per 1M tokens`) is 3-11x cheaper than alternatives for generation, while `gpt-4.1-nano` (`$0.10/$0.40`) is already the cheapest judge option. The pipeline defaults to `deepseek-chat` for generation and `gpt-4.1-nano` for judging — already an efficient pairing. The question is whether `gpt-5-nano` (`$0.05/$0.40`) could replace `gpt-4.1-nano` as judge.

2. **Tournament is the single largest cost center.** Up to 80 LLM calls per iteration (40 comparisons × 2 bias-mitigation passes), using the judge model. CalibrationRanker adds another 10-30 calls per iteration for new entrants.

3. **Adaptive allocation is built but unwired.** The `adaptiveAllocation.ts` module implements ROI-based budget shifting but is explicitly marked `INTENTIONALLY UNUSED` pending sufficient historical data (10+ runs per agent).

4. **Strategy experiment framework is library-complete but CLI-missing.** The L8 orthogonal array and analysis engine (`factorial.ts`, `analysis.ts`) are fully implemented, but the orchestrating CLI script (`run-strategy-experiment.ts`) was never created.

5. **Sequential agent dispatch is the primary throughput bottleneck.** Agents execute one at a time within each iteration. Several agents (DebateAgent: 4 sequential LLM calls, IterativeEditingAgent: up to 12 sequential calls) are wall-clock-time heavy.

6. **Comparison cache is within-run only.** The SHA-256 order-invariant cache prevents duplicate comparisons within a single run but does not persist across runs. Cross-run caching could save significant judge costs when the same variants appear in multiple tournament rounds.

7. **Proximity embeddings are pseudo-embeddings.** The production code uses a character-based 16-element vector (first 16 chars → charCode/255) — documented as a placeholder. The diversity signal this produces may not accurately reflect semantic similarity.

---

## Detailed Findings

### 1. Cost Tracking & Budget Allocation

#### Current Cost Structure

The pipeline enforces budgets at two levels via `CostTrackerImpl`:
- **Per-agent caps** — configurable percentage of `budgetCapUsd` (default $5.00)
- **Global run cap** — hard limit at `budgetCapUsd`

Budget enforcement uses a **pre-call reservation system** with a FIFO queue and 30% safety margin. Before each LLM call, `reserveBudget(agentName, estimate * 1.3)` blocks if either cap would be exceeded. After the call, `recordSpend()` reconciles actual cost against the reservation.

#### Budget Cap Distribution

| Agent | Cap | Notes |
|-------|-----|-------|
| GenerationAgent | 20% | 3 parallel calls per iter |
| Tournament | 20% | Swiss-style, budget-adaptive depth |
| CalibrationRanker | 15% | Stratified opponent selection |
| Pairwise | 20% | Called BY tournament for LLM comparisons |
| EvolutionAgent | 10% | Mutation/crossover/creative |
| TreeSearch | 10% | Beam search (feature-flagged off) |
| OutlineGeneration | 10% | 6-call pipeline (feature-flagged off) |
| SectionDecomposition | 10% | Per-section parallel editing |
| Reflection | 5% | Critique top 3 variants |
| Debate | 5% | 4 sequential calls |
| IterativeEditing | 5% | Critique-edit-judge loops |
| FlowCritique | 5% | Flow dimension scoring |

Caps intentionally sum to 130% because not all agents run every iteration. Agents without explicit caps default to 20%.

#### Adaptive Allocation (Unwired)

`adaptiveAllocation.ts` implements `computeAdaptiveBudgetCaps()` which:
1. Queries `evolution_run_agent_metrics` for per-agent Elo/$ over the last 30 days
2. Computes proportional shares based on `avgEloPerDollar`
3. Clamps to floor 5% / ceiling 40% per agent
4. Normalizes to sum to 1.0

The module is marked `INTENTIONALLY UNUSED` and requires 10+ runs per agent for meaningful results. A separate `budgetPressureConfig()` exists here but is not used — `tournament.ts` has its own production version.

#### Budget Redistribution

When agents are disabled via `enabledAgents`, `computeEffectiveBudgetCaps()` scales remaining agents up proportionally to preserve the original total managed budget sum.

**Key files:**
- `evolution/src/lib/core/costTracker.ts` — FIFO reservation, reconciliation, checkpoint restore
- `evolution/src/lib/config.ts` — `DEFAULT_EVOLUTION_CONFIG`, `resolveConfig()`, auto-clamping
- `evolution/src/lib/core/adaptiveAllocation.ts` — ROI-based allocation (unwired)
- `evolution/src/lib/core/budgetRedistribution.ts` — Agent classification, cap scaling
- `evolution/src/lib/core/costEstimator.ts` — Pre-run predictions, baseline cache
- `evolution/src/lib/core/metricsWriter.ts` — Post-run per-agent metrics persistence

---

### 2. Model Routing & LLM Call Patterns

#### The LLM Call Path

```
Agent.execute(ctx)
  → llmClient.complete(prompt, agentName, { model? })
    → estimateTokenCost(prompt, model) via llmPricing.ts
    → costTracker.reserveBudget(agentName, estimate * 1.3)
    → callLLM(prompt, `evolution_${agentName}`, ...)
      → callLLMModelRaw()
        → semaphore.acquire() [if call_source starts with 'evolution_']
        → routeLLMCall() → callOpenAIModel() or callAnthropicModel()
        → semaphore.release()
      → onUsage callback → costTracker.recordSpend(agentName, actual)
```

#### Model Pricing (USD per 1M tokens)

| Model | Input | Output | Role in Pipeline |
|-------|-------|--------|-----------------|
| `deepseek-chat` | $0.14 | $0.28 | Default generation model (`EVOLUTION_DEFAULT_MODEL`) |
| `gpt-4.1-nano` | $0.10 | $0.40 | Default judge model |
| `gpt-4.1-mini` | $0.40 | $1.60 | Default `generationModel` in config (but overridden by `EVOLUTION_DEFAULT_MODEL`) |
| `gpt-4.1` | $2.00 | $8.00 | Quality preset generation |
| `gpt-5-nano` | $0.05 | $0.40 | Potential cheaper judge |
| `gpt-5-mini` | $0.25 | $2.00 | Strategy experiment "high" generation model |

**Important nuance:** The config default `generationModel: 'gpt-4.1-mini'` is NOT what most agents actually use. `GenerationAgent` and `EvolutionAgent` call `llmClient.complete(prompt, this.name)` without passing a model option, falling through to `EVOLUTION_DEFAULT_MODEL = 'deepseek-chat'`. Only `OutlineGenerationAgent` and `TreeSearchAgent` explicitly use `ctx.payload.config.generationModel`.

#### Per-Agent Model Usage

| Agent | Generation Model | Judge Model | LLM Calls | Parallelism |
|-------|-----------------|-------------|-----------|-------------|
| GenerationAgent | `deepseek-chat` (hardcoded default) | — | 3 | Parallel |
| EvolutionAgent | `deepseek-chat` (hardcoded default) | — | 3-6 | 3 parallel + sequential |
| CalibrationRanker | — | `judgeModel` (gpt-4.1-nano) | 2×N_opponents per entrant | Batched parallel |
| Tournament | — | `judgeModel` (gpt-4.1-nano) | 2×pairs per round | Per-round parallel |
| ReflectionAgent | `deepseek-chat` (default) | — | 3 | Parallel |
| DebateAgent | `deepseek-chat` (default) | — | 4 | Sequential |
| IterativeEditingAgent | `deepseek-chat` (edit), `judgeModel` (judge) | `judgeModel` | 3-12 | Sequential |
| OutlineGeneration | `generationModel` (gen), `judgeModel` (score) | `judgeModel` | 6 | Sequential |
| SectionDecomposition | `deepseek-chat` (edit), `judgeModel` (judge) | `judgeModel` | ~10 | Parallel per section |
| TreeSearchAgent | `generationModel` (gen), `judgeModel` (eval) | `judgeModel` | ~74 | Beam-width parallel |

#### LLM Semaphore

A module-level singleton counting semaphore caps concurrent `evolution_*` LLM calls at 20 (default). Non-evolution calls bypass the semaphore entirely. Configurable via `EVOLUTION_MAX_CONCURRENT_LLM` env var or `--max-concurrent-llm` CLI flag.

**Key files:**
- `evolution/src/lib/core/llmClient.ts` — Budget pre-check, callLLM invocation
- `src/lib/services/llms.ts` — `callLLMModelRaw`, semaphore gate, provider routing
- `src/config/llmPricing.ts` — Pricing table, `calculateLLMCost()`
- `src/lib/services/llmSemaphore.ts` — Counting semaphore

---

### 3. Agent Execution & Elo Contribution

#### Agent Execution Order

The supervisor dispatches agents in this canonical order per iteration:

```
generation → outlineGeneration → reflection → flowCritique →
iterativeEditing → treeSearch → sectionDecomposition →
debate → evolution → ranking → proximity → metaReview
```

**EXPANSION phase** restricts to: `generation`, `ranking` (as calibration), `proximity`.
**COMPETITION phase** runs all enabled agents.

#### Variant-Producing Agents

| Agent | Variants/Iter | Strategy | How It Contributes Elo |
|-------|---------------|----------|----------------------|
| GenerationAgent | 0-3 | structural_transform, lexical_simplify, grounding_enhance | Fresh diversity from orthogonal transformations |
| OutlineGeneration | 1 | outline_generation | Structurally different via plan-then-write |
| EvolutionAgent | 3-5 | mutate_clarity, mutate_structure, crossover, creative_exploration, mutate_outline | Selection pressure: top variants mutated/crossed |
| IterativeEditing | 0-3 | critique_edit_* | Targeted surgical edits gated by diff judge |
| TreeSearch | 1 | tree_search_* | Best leaf from beam search exploration |
| SectionDecomposition | 1 | section_decomposition_* | Weakest dimension edited per-section |
| DebateAgent | 1 | debate_synthesis | Multi-perspective synthesis of top 2 variants |

#### Rating Agents

- **CalibrationRanker** (EXPANSION): Establishes initial ratings for new entrants via stratified comparison. Adaptive early exit skips remaining opponents when first 2 are decisive (confidence >= 0.7, avg >= 0.8).
- **Tournament** (COMPETITION): Swiss-style with info-theoretic pairing. Budget-adaptive depth: 40 comparisons (low pressure), 25 (medium), 15 (high). Sigma-based convergence: stops when all eligible variants have sigma < 3.0 for 5 consecutive rounds.

#### Support Agents (Indirect Elo Contribution)

- **ReflectionAgent**: Dimensional critiques (clarity, engagement, precision, voice_fidelity, conciseness on 1-10 scale) consumed by editing agents to target weaknesses.
- **FlowCritique**: Flow-specific dimensions (local_cohesion, global_coherence, transition_quality, rhythm_variety, redundancy on 0-5 scale) used as additional edit targets.
- **MetaReviewAgent**: Zero LLM calls. Pure analysis producing `metaFeedback` (successful strategies, recurring weaknesses, patterns to avoid, priority improvements) injected into generation/evolution/debate prompts.
- **ProximityAgent**: Zero LLM calls. Maintains diversity score driving phase transition and creative exploration triggering.

**Key files:**
- `evolution/src/lib/agents/*.ts` — All 12 agent implementations
- `evolution/src/lib/core/supervisor.ts` — Phase detection, agent ordering, stop conditions
- `evolution/src/lib/core/pipeline.ts` — Main loop, `runAgent()`, dispatch

---

### 4. Comparison, Rating & Convergence

#### OpenSkill Bayesian Rating

- Initial rating: `{ mu: 25, sigma: 8.333 }`
- Ordinal (ranking metric): `mu - 3 * sigma` (fresh = 0, mapped to Elo 1200)
- Decisive match: `updateRating(winner, loser)` — winner mu up, loser mu down, both sigma decrease
- Low-confidence match (< 0.3): `updateDraw(a, b)` — both mu move toward each other
- Convergence: `sigma < 3.0` per variant

#### Bias-Mitigated Comparison

Every pairwise comparison runs twice with reversed presentation order:
1. Forward: A vs B
2. Reverse: B vs A (result flipped to original frame)

Agreement → confidence 1.0; disagreement → confidence 0.5 (treated as draw); one null → 0.3.

The `PairwiseRanker` runs both calls concurrently via `Promise.all`. The standalone `compareWithBiasMitigation()` (used by CalibrationRanker) runs them sequentially via `run2PassReversal()`.

#### Comparison Cache

- **Key**: SHA-256 of sorted `[textA, textB]` + structured flag + mode — order-invariant
- **Cached when**: `winnerId !== null || isDraw` (excludes errors/null results to allow retry)
- **Lifetime**: Within a single run only. Serialized to checkpoints for resume within a run but NOT shared across runs.

#### Diff-Based Comparison

Used by IterativeEditingAgent and SectionDecomposition. Presents CriticMarkup diffs (not full texts) to the judge. Uses **inverted truth table**: agreement between forward and reverse means the judge always says "yes" to changes (mixed signal → UNSURE, confidence 0.5); disagreement means the judge is genuinely evaluating direction (ACCEPT or REJECT, confidence 1.0).

#### Stopping Conditions (Priority Order)

1. **Quality threshold** (single-article only): All critique dimensions >= 8
2. **Quality plateau** (COMPETITION): Top ordinal improvement < 0.12 over last 3 iterations
3. **Degenerate state**: Plateau + diversity < 0.01
4. **Budget exhausted**: Available < $0.01
5. **Max iterations**: Default 15

**Key files:**
- `evolution/src/lib/core/rating.ts` — OpenSkill wrapper
- `evolution/src/lib/comparison.ts` — Bias-mitigated comparison
- `evolution/src/lib/core/comparisonCache.ts` — Order-invariant cache
- `evolution/src/lib/diffComparison.ts` — CriticMarkup diff comparison
- `evolution/src/lib/agents/tournament.ts` — Swiss pairing, convergence
- `evolution/src/lib/agents/calibrationRanker.ts` — Stratified calibration

---

### 5. Pipeline Throughput & Parallelism

#### Sequential Bottlenecks

1. **Agent dispatch is strictly sequential** — agents within an iteration execute one at a time. The pipeline cannot overlap generation with calibration.
2. **CalibrationRanker processes entrants sequentially** — if 3 new variants are generated, each is calibrated in turn (within each entrant, opponent batches are parallel).
3. **DebateAgent**: 4 sequential LLM calls (each depends on prior output).
4. **IterativeEditingAgent**: Up to 3 cycles of 3-4 sequential calls = 12 sequential calls max.
5. **FlowCritique**: Explicitly passes `parallel: false` to `runCritiqueBatch()`.
6. **Checkpoint after each agent**: DB upsert (with retry) blocks before next agent.

#### Parallelism Used

| Location | Pattern | Degree |
|----------|---------|--------|
| GenerationAgent | `Promise.allSettled()` | 3 concurrent |
| EvolutionAgent | `Promise.allSettled()` | 3 concurrent |
| PairwiseRanker (per comparison) | `Promise.all()` | 2 concurrent (forward + reverse) |
| Tournament (per round) | `Promise.allSettled()` | All pairs in round |
| CalibrationRanker (per batch) | `Promise.allSettled()` | `minOpponents` concurrent |
| ReflectionAgent | `Promise.allSettled()` via critiqueBatch | 3 concurrent |
| SectionDecomposition | `Promise.allSettled()` | All sections concurrent |
| Batch runner | `Promise.allSettled()` | `--parallel N` runs |

#### Format Validation

Variants failing format checks are silently discarded (the LLM cost is already spent). Rules: exactly 1 H1, at least 1 H2/H3, no bullets/numbered lists/tables, 75% of paragraphs must have 2+ sentences. `FORMAT_VALIDATION_MODE` env var controls behavior (`reject`/`warn`/`off`).

#### Checkpoint Serialization

Full pipeline state (pool with variant texts, ratings, match history, critiques, similarity matrix, comparison cache) is serialized after every agent. State size grows with pool size and match history — can reach several MB in full runs.

#### Proximity Embeddings

Production uses **character-based pseudo-embeddings** (first 16 chars → charCode/255) — a documented placeholder (`HIGH-4`). Not real semantic similarity. Cosine similarity over this 16-element vector drives the diversity score that gates phase transition and creative exploration.

**Key files:**
- `evolution/src/lib/core/pipeline.ts` — Main loop, checkpoint timing
- `evolution/src/lib/agents/formatValidator.ts` — Format rules
- `evolution/src/lib/core/state.ts` — Serialization/deserialization
- `evolution/src/lib/agents/proximityAgent.ts` — Pseudo-embeddings

---

### 6. Strategy Experiments & Optimization Infrastructure

#### Experiment Framework (Partially Built)

The **library layer is complete**:
- `factorial.ts`: L8 orthogonal array generation, factor-to-config mapping, full factorial for Round 2+
- `analysis.ts`: Main effects computation, interaction effects, factor ranking, recommendations

The **CLI orchestrator does not exist**: `run-strategy-experiment.ts` is documented but never created. The state file `experiments/strategy-experiment.json` also does not exist.

#### Round 1 Factors (Planned)

| Factor | Low | High | What It Tests |
|--------|-----|------|---------------|
| Generation model | deepseek-chat | gpt-5-mini | Cost vs quality of text generation |
| Judge model | gpt-4.1-nano | gpt-5-nano | Does better judgment improve selection pressure? |
| Iterations | 3 | 8 | More refinement cycles vs diminishing returns |
| Editor | iterativeEditing | treeSearch | Which editing approach produces better results? |
| Support agents | off | on | Is the full agent suite worth the cost? |

#### Preset Strategies

| Name | genModel | judgeModel | Iters | Pipeline | Enabled Agents |
|------|----------|------------|-------|----------|---------------|
| Economy | deepseek-chat | gpt-4.1-nano | 2 | minimal | none (required only) |
| Balanced | gpt-4.1-mini | gpt-4.1-nano | 3 | full | reflection, iterativeEditing, sectionDecomp, debate, evolution, metaReview |
| Quality | gpt-4.1 | gpt-4.1-mini | 5 | full | above + outlineGeneration |

#### Optimization Dashboard

The dashboard at `/admin/quality/optimization` has three tabs:
- **Strategy Analysis**: Leaderboard sorted by Elo, Elo/$, consistency; Pareto frontier scatter
- **Agent Analysis**: ROI leaderboard with per-agent Elo/$ rankings
- **Cost Analysis**: Summary cards (total runs, spend, best Elo/$)

All data sourced from pre-aggregated `strategy_configs` columns and `evolution_run_agent_metrics` table.

#### Cost Prediction Accuracy

Post-run, `computeCostPrediction()` compares pre-run estimates to actuals and stores `{ deltaPercent, perAgent }` in `content_evolution_runs.cost_prediction`. `refreshAgentCostBaselines()` updates baselines from `llmCallTracking` (requires 50+ samples for high confidence).

#### Known Implementation Gaps

1. **`run-strategy-experiment.ts` CLI** — documented but never created
2. **`adaptiveAllocation.ts`** — fully implemented but explicitly unwired from production
3. **`budgetPressureConfig()` in adaptiveAllocation.ts** — separate from tournament's own version, also unwired
4. **Supervisor strategy routing** — supervisor prepares per-strategy payloads for GenerationAgent but GenerationAgent ignores them (uses hardcoded `STRATEGIES` constant)
5. **Per-agent model overrides** — `agentModels` field exists in batch schema but not wired through pipeline
6. **`agentModels` excluded from strategy hash** — two configs differing only in per-agent model overrides share the same hash

**Key files:**
- `evolution/src/experiments/evolution/factorial.ts` — L8 design generation
- `evolution/src/experiments/evolution/analysis.ts` — Main effects, recommendations
- `evolution/src/lib/core/strategyConfig.ts` — Hash, label, diff
- `evolution/src/services/strategyRegistryActions.ts` — Strategy CRUD, presets
- `evolution/src/services/eloBudgetActions.ts` — Dashboard data queries
- `evolution/src/services/costAnalyticsActions.ts` — Estimation accuracy

---

---

## Phase 2: Improvement Opportunities — Technical & Algorithmic

### Research Date: 2026-02-19
### Git Commit: 7a67d4c4
### Branch: feat/research_opportunities_improve_evolution_20260218

---

## Prioritized Recommendations Matrix

| # | Improvement | Track | Effort | Expected Impact | Prerequisites |
|---|-------------|-------|--------|----------------|---------------|
| 1 | Fix pseudo-embeddings (MinHash/SimHash) | Algorithmic | Low | **HIGH** — unlocks all diversity logic | None |
| 2 | Staged parallel agent dispatch | Technical | Medium | **HIGH** — 3-4x wall-clock speedup | None |
| 3 | Reduce tournament convergence streak 5→2 | Technical | Trivial | **Medium** — 24-32 fewer LLM calls/tournament | None |
| 4 | Self-eval pre-filter before pool entry | Algorithmic | Low | **Medium** — 15-25% calibration savings | None |
| 5 | Pool culling at phase transition | Algorithmic | Low | **Medium** — 20-30% calibration savings | None |
| 6 | Single-pass for high-ordinal-gap pairs | Technical | Low | **Medium** — up to 40% tournament savings | Instrumentation (7) |
| 7 | Log per-comparison confidence levels | Technical | Trivial | **Enables** items 6, 10 | None |
| 8 | Add format auto-fix mode (bullets→prose, H1 fix) | Technical | Low | **Medium** — recovers wasted LLM spend | None |
| 9 | Diverse parent selection for crossover | Algorithmic | Low | **Medium** — 10-20% diversity improvement | Item 1 for best results |
| 10 | Adaptive single-pass bias mitigation | Technical | Medium | **High** at scale — 30-40% judge savings | Item 7 (data needed) |
| 11 | Quantitative strategy arm weights | Algorithmic | Medium | **Medium** — 10-15% better variant rate | MetaReview data |
| 12 | Fix CalibrationRanker sequential reversal | Technical | Trivial | **Low** — 50% calibration latency reduction | None |
| 13 | Reduce calibration opponents 5→3 | Technical | Trivial | **Medium** — 40% calibration cost reduction | Validation |
| 14 | Fix multi-turn tiebreaker threshold | Technical | Trivial | **Low** — halves tiebreaker invocations | None |
| 15 | Add flow comparison budget guard | Technical | Low | **Correctness** — prevents silent budget overrun | None |
| 16 | Multi-objective Pareto front | Algorithmic | Medium | **High** — prevents premature convergence | Item 1 |
| 17 | Wire adaptive allocation system | Technical | Medium | **Medium** at scale — auto-tunes budget | 10+ runs per agent |
| 18 | Build strategy experiment CLI | Technical | Medium | **Enables** empirical validation | None |
| 19 | Cross-run comparison cache (DB) | Technical | High | **Low** under current architecture | Variant seeding first |
| 20 | Cross-run quality predictor (ML) | Algorithmic | High | **High** at scale | Corpus of 50+ runs |

---

## Detailed Improvement Analysis

### TIER 1: High Impact, Low Effort (Do First)

#### 1. Fix Pseudo-Embeddings — Replace Character-Based with MinHash

**Problem:** `proximityAgent.ts:146-153` uses first 16 characters → charCode/255 as embeddings. Every article variant shares the same title, so ALL variants produce nearly identical pseudo-embeddings. This breaks:
- Phase transition (diversity never reaches 0.25 threshold → relies on iteration count fallback)
- Creative exploration trigger (diversityScore always ~0, triggering creative branch every iteration regardless of actual diversity)
- Degenerate state stop condition (diversityScore < 0.01 false-positives, causing premature stops)
- Supervisor diversity history (always shows COLLAPSED regardless of actual pool variety)

**Solution — MinHash on word trigrams (zero API cost):**
```typescript
_embed(text: string): number[] {
  const words = text.toLowerCase().split(/\s+/).slice(0, 200);
  const vec = new Array(64).fill(0);
  for (let i = 0; i < words.length - 2; i++) {
    const shingle = `${words[i]} ${words[i+1]} ${words[i+2]}`;
    let h = 0;
    for (let j = 0; j < shingle.length; j++) h = (Math.imul(31, h) + shingle.charCodeAt(j)) >>> 0;
    vec[h % 64]++;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v*v, 0)) || 1;
  return vec.map(v => v / norm);
}
```

**Alternatives considered:**
- TF-IDF cosine: also zero-cost, captures content overlap; slightly more complex
- OpenAI `text-embedding-3-small`: $0.00002/text, best quality but adds latency/cost
- Sentence-level Jaccard: cheap but loses ordering information

**Impact:** All diversity-dependent logic becomes meaningful. Phase transitions happen when actual diversity is ready. Creative exploration triggers when actually needed. Estimated **15-25% improvement in run quality** by preventing premature convergence and false degenerate stops.

**Files to change:** `evolution/src/lib/agents/proximityAgent.ts` (lines 136-153, `_embed()` method)

---

#### 2. Staged Parallel Agent Dispatch (3-4x Wall-Clock Speedup)

**Problem:** `pipeline.ts:388-414` dispatches agents in a sequential `for...of` loop. With all agents enabled, a COMPETITION iteration runs 12 agents serially — each waiting for the prior to complete.

**Dependency analysis reveals 6 stages:**

```
Stage 1: [generation ∥ outlineGeneration ∥ evolution*]     ← bottleneck: outlineGeneration (6 calls)
Stage 2: [reflection ∥ flowCritique]                        ← bottleneck: larger of 3 vs N calls
Stage 3: calibration                                        ← 5-10 calls per entrant
Stage 4: [iterativeEditing ∥ treeSearch ∥ sectionDecomp ∥ debate]  ← bottleneck: treeSearch
Stage 5: [tournament ∥ proximity]                           ← tournament dominates
Stage 6: metaReview                                         ← 0 LLM calls, ~1ms
```
*evolution runs in Stage 1 only when ratings exist (iteration > 1); otherwise Stage 4

**Why this is safe in JS:** All agents use append-only state mutations (`state.addToPool()` pushes to array, `state.allCritiques.push()`). JS cooperative concurrency means no interleaving within synchronous code blocks. `Promise.allSettled` is the correct pattern.

**One code fix needed:** `iterativeEditingAgent.ts:66` re-queries `getTopByRating(1)` mid-cycle. In parallel context, another agent could have added variants changing the top ranking. Fix: snapshot target variant once at agent start.

**Impact:** ~3-4x wall-clock speedup per iteration. The critical path drops from ~50-80 serial LLM calls to ~max(6, max(treeSearch), tournament) per stage.

**Files to change:**
- `evolution/src/lib/core/pipeline.ts` (replace sequential loop with staged dispatch)
- `evolution/src/lib/agents/iterativeEditingAgent.ts` (snapshot target variant)

---

#### 3. Reduce Tournament Convergence Streak from 5 to 2

**Problem:** `tournament.ts:42` requires sigma < 3.0 for ALL eligible variants for **5 consecutive rounds** before convergence exit. OpenSkill sigma decreases monotonically — once below 3.0, it never rises back. The 5-round streak is mathematically unnecessary.

**Cost:** Each extra confirmation round at pool size 8 = 4 comparisons × 2 LLM calls = 8 calls. With 5-round streak, that's ~24-32 unnecessary calls per tournament where convergence is reached.

**Fix:** Change `convergenceChecks: 5` → `convergenceChecks: 2` at `tournament.ts:42`.

**Risk:** Negligible — sigma is monotonically decreasing in this system.

---

#### 4. Self-Eval Pre-Filter Before Pool Entry

**Problem:** `generationAgent.ts` and `evolvePool.ts` add ALL generated variants to the pool without quality gating. Each new variant costs 5-10 calibration LLM calls to rate. Many generated variants (especially from `creative_exploration`) are below baseline quality.

**Solution:** Add a cheap self-eval using the judge model before `state.addToPool()`:
```typescript
const selfEvalPrompt = `Rate this article 1-10 for overall quality. JSON: {"score": N}`;
const eval = await llmClient.complete(selfEvalPrompt, agentName, { model: judgeModel });
if (parseJSON(eval).score < 5) { return null; } // skip
```

**Cost analysis:** gpt-4.1-nano at ~$0.0002 per eval. For 4 variants/iter = $0.0008. If it filters 30-40% of low-quality variants, saves 1.5-2 calibration matches ($0.014-0.018 each) = net positive.

**Impact:** 15-25% reduction in calibration costs. Particularly valuable for `creative_exploration` variants which have higher variance.

**Files to change:** `evolution/src/lib/agents/generationAgent.ts`, `evolution/src/lib/agents/evolvePool.ts`

---

#### 5. Pool Culling at Phase Transition

**Problem:** Pool grows unboundedly. After 8 expansion + 7 competition iterations, the pool can contain 50+ variants. Bottom-quartile variants consume calibration budget without contributing Elo improvement.

**Solution:** At EXPANSION→COMPETITION transition, cull bottom 25% of rated variants (keep minimum pool of 10, always preserve baseline):
```typescript
// In supervisor.ts at phase transition:
const rated = [...state.ratings.entries()].sort((a, b) => getOrdinal(a[1]) - getOrdinal(b[1]));
const cullCount = Math.floor(rated.length * 0.25);
state.pool = state.pool.filter(v => !toCull.includes(v.id) || v.strategy === BASELINE_STRATEGY);
```

**Impact:** 20-30% reduction in calibration cost per COMPETITION iteration by shrinking opponent pool.

**Files to change:** `evolution/src/lib/core/supervisor.ts`

---

### TIER 2: Medium Impact, Low-Medium Effort

#### 6. Single-Pass Comparison for High-Ordinal-Gap Pairs

**Problem:** Every comparison runs twice (forward + reverse) for bias mitigation. When the ordinal gap is large (e.g., `|ordA - ordB| > 20`), the better variant is clearly better — agreement rate is expected >90%.

**Solution:** In `swissPairing`, flag high-gap pairs for single-pass mode. Pass the flag through to `runComparison` in the tournament loop.

**Prerequisite:** Item 7 (confidence instrumentation) to validate the assumption.

**Impact:** Up to 40% tournament LLM call reduction if 40% of pairs have large gaps (common in late iterations when ranking diverges).

**Files to change:** `evolution/src/lib/agents/tournament.ts`, `evolution/src/lib/agents/pairwiseRanker.ts`

---

#### 7. Log Per-Comparison Confidence Levels (Instrumentation)

**Problem:** No data on actual agreement rates between forward/reverse passes. This blocks data-driven decisions about single-pass and adaptive bias mitigation.

**Solution:** Add confidence distribution to `metricsWriter.ts` output. Log `{ confidence_1_0: N, confidence_0_7: N, confidence_0_5: N, confidence_0_3: N }` per agent per iteration.

**Impact:** Enables items 6 and 10 with empirical data rather than assumptions.

**Files to change:** `evolution/src/lib/core/metricsWriter.ts`, `evolution/src/lib/agents/tournament.ts`

---

#### 8. Format Auto-Fix Mode

**Problem:** Format-rejected variants waste the full LLM generation cost. Rules 1 (H1) and 3a (bullets/lists) are mechanically fixable.

**Auto-fixable violations:**
- **Bullets/numbered lists → prose:** Join bullet items with connectors ("First, ... Additionally, ... Finally, ...")
- **H1 missing:** Promote first line to H1
- **Multiple H1s:** Demote extras to H2
- **Tables:** Convert to prose lists

**Not auto-fixable:** Rule 4 (short paragraphs) — needs semantic expansion via LLM.

**Solution:** Add `FORMAT_VALIDATION_MODE=fix` that attempts auto-fix before rejecting. Only fall back to rejection if the fixed version still fails validation.

**Impact:** Recovers ~30-50% of format-rejected variants (mostly Rule 3a bullet violations from `structural_transform` strategy).

**Files to change:** `evolution/src/lib/agents/formatValidator.ts`

---

#### 9. Diverse Parent Selection for Crossover

**Problem:** `pool.ts:108-112` always selects top-2 by rating for evolution parents. Crossover of the same two parents every iteration produces homogeneous children.

**Solution:** Keep first parent as elitist (top-1), select second parent from top-30% weighted by dissimilarity to first parent using similarity matrix:
```typescript
const candidatePool = eligible.slice(0, Math.max(2, Math.floor(eligible.length * 0.3)));
const second = candidatePool
  .filter(v => v.id !== firstParent.id)
  .sort((a, b) => similarity(firstParent, a) - similarity(firstParent, b))[0];
```

**Impact:** Crossover produces genuinely hybrid variants. Estimated 10-20% increase in effective diversity. Works best after Item 1 (real embeddings) provides meaningful similarity scores.

**Files to change:** `evolution/src/lib/core/pool.ts`

---

#### 10. Adaptive Single-Pass Bias Mitigation

**Problem:** 2-pass reversal doubles ALL judge costs. Academic research (Zheng et al. 2023) shows LLM judge agreement rates of 70-85% for clear quality differences.

**Solution:** After collecting confidence data (Item 7), implement adaptive single-pass:
- First K comparisons: always 2-pass (calibration)
- After K: if agreement rate > 85%, switch to single-pass with periodic 2-pass sampling (every 10th comparison) to detect drift
- If agreement rate drops below 80%, revert to 2-pass

**Impact:** At scale, 30-40% judge cost reduction. This is the single highest-impact cost optimization for the tournament (the biggest cost center).

**Prerequisite:** Item 7 (10+ runs of confidence data)

**Files to change:** `evolution/src/lib/agents/pairwiseRanker.ts`, `evolution/src/lib/comparison.ts`

---

### TIER 3: Medium-High Impact, Medium Effort

#### 11. Quantitative Strategy Arm Weights (Adaptive Mutation Rates)

**Problem:** All mutation strategies are tried with equal probability. MetaReview already computes strategy effectiveness scores (`_getStrategyScores()` in `metaReviewAgent.ts:95-105`) but this data is only used for text feedback, not adaptive scheduling.

**Solution:** In supervisor, use strategy scores to weight mutation probabilities:
- `successfulStrategies` → 2x weight
- `patternsToAvoid` → 0.1x weight
- Default → 1.0x weight

Feed weights through to `evolvePool.ts` strategy selection and `generationAgent.ts` strategy rotation.

**Impact:** Concentrates budget on proven strategies. Estimated 10-15% better variants-above-baseline rate.

**Files to change:** `evolution/src/lib/core/supervisor.ts`, `evolution/src/lib/agents/evolvePool.ts`, `evolution/src/lib/agents/generationAgent.ts`

---

#### 12-15. Quick Fixes (Trivial Effort)

**12. Fix CalibrationRanker sequential reversal** — `reversalComparison.ts:31-35` runs forward then reverse sequentially. Tournament uses `Promise.all`. Fix: parallelize in `run2PassReversal` or delegate to `PairwiseRanker`. Impact: 50% calibration latency reduction (same cost, just faster).

**13. Reduce calibration opponents 5→3** — `config.ts` default `calibration.opponents = 5`. Three opponents (1 top, 1 mid, 1 bottom/new) provides reasonable stratified placement. Impact: 40% calibration cost reduction.

**14. Fix multi-turn tiebreaker threshold** — `tournament.ts:184` fires tiebreaker at `confidence < 1.0`. Should be `<= 0.5` (only genuine disagreement). Confidence 0.7 (one TIE, one winner) is already directional. Impact: halves tiebreaker invocations.

**15. Add flow comparison budget guard** — `tournament.ts:337-371` runs flow comparisons inside tournament loop with no budget check and flow calls don't count toward `maxComparisons`. Impact: prevents silent budget overrun when flowCritique enabled.

---

### TIER 4: High Impact, High Effort (Longer Term)

#### 16. Multi-Objective Pareto Front

Maintain a Pareto front over (ordinal, novelty-vs-baseline). Variants on the front are never culled and are preferred crossover parents. Prevents premature convergence by preserving structurally diverse high-quality variants.

**Prerequisite:** Item 1 (real embeddings) for meaningful novelty scores.

#### 17. Wire Adaptive Allocation System

`adaptiveAllocation.ts` is fully implemented but marked `INTENTIONALLY UNUSED`. It needs 10+ runs per agent for meaningful data. Once data exists, wiring it into the budget system would auto-tune per-agent caps based on historical Elo/$ performance.

#### 18. Build Strategy Experiment CLI

The L8 orthogonal array framework (`factorial.ts`, `analysis.ts`) is complete but `run-strategy-experiment.ts` was never created. Building the CLI would enable systematic comparison of model/agent/iteration configurations.

#### 19. Cross-Run Comparison Cache

Cache key is already content-addressed and run-agnostic — architecturally ready for cross-run. However, under current architecture (no variant seeding from prior runs), cross-run hit rate would be ~0%. Should be implemented AFTER hall-of-fame variant seeding is added.

#### 20. Cross-Run Quality Predictor (ML Surrogate)

Train a model on (critique_scores, strategy, text_stats) → final_ordinal from accumulated run data. Use as cheap pre-filter: skip calibration for variants predicted below baseline. Needs 50+ runs for training data. Potentially 30-40% calibration cost reduction at scale.

---

## Academic & Industry Research Context

### LLM-as-Judge Efficiency
- **Listwise ranking** (having the LLM rank N variants at once) can replace O(N²) pairwise comparisons with O(N) calls. Chatbot Arena research shows this works for N≤7 with quality degradation for larger lists.
- **Pointwise scoring** (absolute 1-10 score per variant) is cheapest but has lower discrimination than pairwise comparison. Good as a pre-filter, not as a replacement.
- **Reference-anchored grading** uses the baseline text as an explicit reference point, improving judge consistency. The pipeline already does this implicitly through the baseline variant in the pool.

### Tournament Design for Small Populations
- For N=8-15 variants, Swiss-system with C(N,2)/4 rounds provides 95%+ ranking accuracy. The pipeline's approach is well-aligned.
- **Active sampling** (choosing the next comparison to maximize information gain, measured by expected sigma reduction) outperforms round-robin or random pairing. The pipeline's info-theoretic Swiss pairing partially implements this via ordinal-gap-based pairing but could be enhanced with explicit sigma-based pair selection.

### Evolutionary Text Optimization
- **Population sizes of 8-15 with elitism** match the pipeline's approach. Academic literature recommends 5-15 for expensive fitness functions.
- **Mutation rate adaptation** (reducing mutation strength as the population converges) is well-established but not implemented. The pipeline uses fixed mutation strategies throughout.
- **Surrogate-assisted evolution** (using a cheap model for most evaluations, expensive model for top candidates) maps directly to the self-eval pre-filter proposed in Item 4.

### Prompt Caching
- OpenAI and Anthropic both offer API-level prompt caching for identical prompt prefixes. The pipeline's format rules preamble (~200 tokens) is identical across all generation calls — structuring prompts with the FORMAT_RULES at the start would maximize cache prefix hits.
- Current prompt structure appends FORMAT_RULES at the end of the system message. Moving it to a dedicated system message prefix could save ~$0.0001 per cached call × ~50 calls/iteration = ~$0.005/iteration.

---

## Aggregate Impact Estimates

### Applying Tier 1 Improvements (Items 1-5):
- **Tournament+Calibration cost:** ~110 calls/iter → ~74 calls/iter (−33%)
- **Wall-clock time:** ~50-80 serial calls → ~max(6, treeSearch, tournament) per stage (−60-75%)
- **Quality:** Diversity logic works correctly → fewer wasted iterations on prematurely converged populations
- **Budget savings per run:** ~$1.60 on a $5.00 budget (~32%)

### Applying Tier 1 + Tier 2 (Items 1-10):
- **Tournament cost:** additional 30-40% reduction via adaptive single-pass
- **Format waste:** ~30-50% recovery of rejected variants
- **Wall-clock time:** same as Tier 1 (parallelism is the big win)
- **Estimated total Elo/$ improvement:** 50-80% more Elo per dollar spent

### Applying All Tiers (Items 1-20):
- **Full budget efficiency:** estimated 2-3x current Elo/$ with well-tuned strategy experiments
- **Requires:** 50+ runs of empirical data for ML surrogate and adaptive allocation

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered during initialization)
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/agents/generation.md
- evolution/docs/evolution/agents/tree_search.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/hall_of_fame.md

## Code Files Read

### Core Infrastructure
- `evolution/src/lib/core/costTracker.ts` — FIFO reservation, reconciliation, checkpoint restore
- `evolution/src/lib/core/costEstimator.ts` — Pre-run predictions, baseline cache, refresh
- `evolution/src/lib/core/adaptiveAllocation.ts` — ROI-based allocation (unwired)
- `evolution/src/lib/core/budgetRedistribution.ts` — Agent classification, cap scaling
- `evolution/src/lib/core/metricsWriter.ts` — Post-run per-agent metrics persistence
- `evolution/src/lib/core/llmClient.ts` — Budget pre-check, callLLM invocation
- `evolution/src/lib/core/pipeline.ts` — Main loop, agent dispatch, checkpoints
- `evolution/src/lib/core/supervisor.ts` — Phase detection, agent ordering, stop conditions
- `evolution/src/lib/core/state.ts` — PipelineStateImpl, serialize/deserialize
- `evolution/src/lib/core/persistence.ts` — Checkpoint upsert, variant persistence
- `evolution/src/lib/core/rating.ts` — OpenSkill wrapper
- `evolution/src/lib/core/comparisonCache.ts` — Order-invariant SHA-256 cache
- `evolution/src/lib/core/reversalComparison.ts` — Generic 2-pass reversal runner
- `evolution/src/lib/core/pool.ts` — Stratified opponent selection
- `evolution/src/lib/core/strategyConfig.ts` — Hash, label, extract, diff
- `evolution/src/lib/core/formatValidationRules.ts` — Shared format validation rules
- `evolution/src/lib/core/critiqueBatch.ts` — Shared parallel/sequential critique dispatch
- `evolution/src/lib/core/diversityTracker.ts` — Diversity analysis utility
- `evolution/src/lib/config.ts` — DEFAULT_EVOLUTION_CONFIG, resolveConfig()
- `evolution/src/lib/index.ts` — createDefaultAgents(), preparePipelineRun()
- `evolution/src/lib/types.ts` — All shared interfaces
- `evolution/src/lib/comparison.ts` — Bias-mitigated comparison
- `evolution/src/lib/diffComparison.ts` — CriticMarkup diff comparison

### Agents
- `evolution/src/lib/agents/base.ts` — Abstract AgentBase
- `evolution/src/lib/agents/generationAgent.ts` — 3-strategy parallel generation
- `evolution/src/lib/agents/outlineGenerationAgent.ts` — 6-call pipeline
- `evolution/src/lib/agents/reflectionAgent.ts` — Dimensional critique (top 3)
- `evolution/src/lib/agents/iterativeEditingAgent.ts` — Critique-edit-judge loops
- `evolution/src/lib/agents/treeSearchAgent.ts` — Beam search revisions
- `evolution/src/lib/agents/sectionDecompositionAgent.ts` — Per-section editing
- `evolution/src/lib/agents/debateAgent.ts` — 3-turn adversarial debate
- `evolution/src/lib/agents/evolvePool.ts` — Mutation/crossover/creative
- `evolution/src/lib/agents/calibrationRanker.ts` — Stratified calibration
- `evolution/src/lib/agents/tournament.ts` — Swiss-style tournament
- `evolution/src/lib/agents/proximityAgent.ts` — Pseudo-embeddings, diversity
- `evolution/src/lib/agents/metaReviewAgent.ts` — Pool-wide pattern analysis
- `evolution/src/lib/agents/formatValidator.ts` — Format rules, validation modes

### Strategy & Optimization
- `evolution/src/experiments/evolution/factorial.ts` — L8 design generation
- `evolution/src/experiments/evolution/analysis.ts` — Main effects analysis
- `evolution/src/services/strategyRegistryActions.ts` — Strategy CRUD, presets
- `evolution/src/services/eloBudgetActions.ts` — Dashboard data queries
- `evolution/src/services/costAnalyticsActions.ts` — Estimation accuracy
- `evolution/src/services/costAnalytics.ts` — LLM call cost tracking
- `evolution/src/config/promptBankConfig.ts` — 5 prompts, 6 methods

### Shared Infrastructure
- `src/lib/services/llms.ts` — callLLMModelRaw, provider routing
- `src/lib/services/llmSemaphore.ts` — Counting semaphore
- `src/config/llmPricing.ts` — Pricing table
- `src/lib/schemas/schemas.ts` — allowedLLMModelSchema
- `evolution/scripts/evolution-runner.ts` — Batch runner
