# Analyse Evolution Costs Research

## Problem Statement
Understand how LLM costs accumulate across agents, phases, and rounds in the evolution pipeline. Identify dominant cost drivers, quantify per-agent and per-phase cost contributions, and find optimization opportunities.

## High Level Summary

The evolution pipeline's cost structure is dominated by **comparison/judging calls** (Calibration + Tournament), which account for ~70-80% of total spend despite using the cheapest model (`gpt-4.1-nano`). This is because bias mitigation doubles every comparison (forward + reverse), and the Tournament agent can run up to 40 comparisons per iteration across multiple Swiss rounds. Generation-class agents (Generation, Evolution, Debate) collectively account for ~20-30% of cost, using `deepseek-chat` as the default model.

Two agents (ProximityAgent, MetaReviewAgent) make zero LLM calls and contribute $0 to cost.

A full 15-iteration run on a 2000-word article costs roughly **$0.24–$0.36** — well within the $5 default budget cap. The budget is rarely the binding constraint; plateau detection usually stops runs earlier.

### Key Finding: `generationModel` Config is Unused
The config defines `generationModel: 'gpt-4.1-mini'` ($0.40/$1.60 per 1M tokens) but **no agent actually uses it**. All generation agents call `llmClient.complete(prompt, this.name)` without passing a model option, defaulting to `EVOLUTION_DEFAULT_MODEL = 'deepseek-chat'` ($0.14/$0.28 per 1M tokens). This is either intentional cost savings or an oversight.

---

## Cost Tracking Architecture

### Flow
```
Agent calls llmClient.complete(prompt, agentName, options?)
  → estimateTokenCost(prompt, model) → costTracker.reserveBudget(agentName, estimate)
  → callLLM(prompt, `evolution_${agentName}`, ..., onUsage callback)
  → onUsage(usage) → costTracker.recordSpend(agentName, usage.estimatedCostUsd)
```

### Key Files
- `core/costTracker.ts` — `CostTrackerImpl`: per-agent + global budget tracking with pre-call reservation (30% safety margin) and optimistic locking for parallel calls
- `core/llmClient.ts` — `createEvolutionLLMClient`: wraps `callLLM` with budget enforcement; default model is `deepseek-chat`
- `config/llmPricing.ts` — Token pricing table for all supported models

### Budget Enforcement
- **Per-agent caps**: Configurable percentage of total budget (generation 25%, calibration 20%, tournament 25%, evolution 20%, reflection 5%, debate 5%)
- **Global cap**: Default $5.00 per run
- **Pre-call reservation**: Budget checked with 30% margin BEFORE every LLM call
- **Pause, not fail**: `BudgetExceededError` pauses the run (status='paused'), not marks it failed

---

## Per-Agent Cost Analysis

### Model Routing
| Agent | Model Used | Pricing (input/output per 1M tokens) |
|-------|-----------|--------------------------------------|
| GenerationAgent | `deepseek-chat` (default) | $0.14 / $0.28 |
| CalibrationRanker | `gpt-4.1-nano` (judgeModel) | $0.10 / $0.40 |
| Tournament (via PairwiseRanker) | `gpt-4.1-nano` (judgeModel) | $0.10 / $0.40 |
| EvolutionAgent | `deepseek-chat` (default) | $0.14 / $0.28 |
| ReflectionAgent | `deepseek-chat` (default) | $0.14 / $0.28 |
| DebateAgent | `deepseek-chat` (default) | $0.14 / $0.28 |
| ProximityAgent | **No LLM calls** | $0 |
| MetaReviewAgent | **No LLM calls** | $0 |

### LLM Calls Per Iteration

#### EXPANSION Phase (iterations 0–7)

| Agent | Calls per iteration | Parallelism | Notes |
|-------|-------------------|-------------|-------|
| GenerationAgent | 3 | All parallel (Promise.allSettled) | One per strategy |
| CalibrationRanker | 12–30 | Batched parallel (min 2 first, then rest) | 3 entrants × 3 opponents × 2 (bias mitigation); adaptive early exit saves ~40% |
| ProximityAgent | 0 | N/A | Character-based embeddings, no LLM |

**Total per EXPANSION iteration: 15–33 LLM calls**

#### COMPETITION Phase (iterations 8–14)

| Agent | Calls per iteration | Parallelism | Notes |
|-------|-------------------|-------------|-------|
| GenerationAgent | 1 | Single call | Rotating strategy |
| ReflectionAgent | 3 | All parallel | Critique top 3 variants |
| DebateAgent | 4 | **Sequential** (each depends on previous) | Advocate A → Advocate B → Judge → Synthesis |
| EvolutionAgent | 3–4 | 3 parallel + 30% chance of 1 more (creative) | mutate_clarity + mutate_structure + crossover + creative_exploration |
| Tournament | 30–80 | Parallel within each Swiss round | Up to 40 comparisons × 2 (bias mitigation); budget-adaptive |
| ProximityAgent | 0 | N/A | |
| MetaReviewAgent | 0 | N/A | Pure computation |

**Total per COMPETITION iteration: 41–92 LLM calls**

### Cost Estimate (2000-word article, ~8000 chars)

Assumptions: ~2000 input tokens per text, ~200-500 token prompt overhead.

| Agent | Phase | Cost per iteration | Iterations | Total est. |
|-------|-------|-------------------|------------|-----------|
| Generation | EXPANSION | ~$0.0026 (3 calls) | 8 | ~$0.021 |
| Generation | COMPETITION | ~$0.0009 (1 call) | 7 | ~$0.006 |
| Calibration | EXPANSION | ~$0.005–$0.008 | 8 | ~$0.040–$0.064 |
| Tournament | COMPETITION | ~$0.017–$0.034 | 7 | ~$0.119–$0.238 |
| Evolution | COMPETITION | ~$0.003 | 7 | ~$0.021 |
| Reflection | COMPETITION | ~$0.001 | 7 | ~$0.007 |
| Debate | COMPETITION | ~$0.003 | 7 | ~$0.021 |
| **Total** | | | | **~$0.24–$0.38** |

### Cost Distribution (approximate)

```
Tournament    ████████████████████████████████████  55–65%
Calibration   ██████████████                        15–20%
Generation    █████                                  7–10%
Evolution     ████                                   5–8%
Debate        ████                                   5–8%
Reflection    ██                                     2–3%
Proximity     ▏                                      0%
MetaReview    ▏                                      0%
```

---

## Phase-Level Cost Profiles

### EXPANSION (iterations 0–7)
- **Purpose**: Build a diverse pool of ≥15 variants
- **Active agents**: Generation (3 calls) + Calibration (12–30 calls) + Proximity (0 calls)
- **Cost profile**: Low per-iteration cost, dominated by calibration comparisons
- **Optimization**: Adaptive calibration early exit already saves ~40% of comparison costs
- **Typical total**: ~$0.06–$0.08 (20–25% of run cost)

### COMPETITION (iterations 8–14)
- **Purpose**: Refine the pool through tournament, reflection, debate, and evolution
- **Active agents**: All 7 agents (Generation, Reflection, Debate, Evolution, Tournament, Proximity, MetaReview)
- **Cost profile**: High per-iteration cost, dominated by tournament Swiss rounds
- **Typical total**: ~$0.18–$0.30 (75–80% of run cost)

### Phase Transition Trigger
Transitions to COMPETITION when: (pool ≥ 15 AND diversity ≥ 0.25) OR iteration ≥ 8

---

## Cost Amplifiers and Reducers

### Amplifiers
1. **Bias mitigation (2x)**: Every comparison runs twice with positions swapped — this is the single biggest cost multiplier
2. **Tournament multi-turn tiebreakers**: Top-quartile close matches get a 3rd comparison call (1.2x on ~20% of matches)
3. **Creative exploration (30% random)**: EvolutionAgent has 30% chance of a 4th LLM call per iteration
4. **Pool growth**: Larger pools in COMPETITION = more Swiss-round pairs per tournament

### Reducers
1. **ComparisonCache**: SHA-256 order-invariant cache avoids re-comparing previously seen text pairs across iterations
2. **Adaptive calibration early exit**: Skips remaining opponents after 2 decisive matches (~40% savings)
3. **Budget pressure tiers**: Tournament adapts maxComparisons: 40 (low pressure), 25 (medium), 15 (high)
4. **Swiss pairing convergence**: Stops when max Elo change < 10 for 5 consecutive rounds
5. **Model tiering**: Cheap `gpt-4.1-nano` for judging ($0.10/$0.40) vs `deepseek-chat` for generation ($0.14/$0.28)

---

## Gaps and Observations

1. **`generationModel` config is unused**: `config.generationModel = 'gpt-4.1-mini'` is defined but no agent passes it to llmClient. All generation uses the hardcoded default `deepseek-chat`. Either the config should be plumbed through, or the field should be removed.

2. **No per-iteration cost tracking**: CostTracker only tracks per-agent cumulative totals. There's no breakdown by iteration, phase, or round — the admin UI's BudgetTab relies on aggregate agent costs, not temporal cost curves.

3. **Cost attribution gap in Tournament**: The Tournament agent calls PairwiseRanker methods, but the LLM calls are attributed to agent name `"pairwise"` (the PairwiseRanker's name), not `"tournament"`. This means `costTracker.getAgentCost('tournament')` may undercount while `"pairwise"` gets the attribution.

4. **DebateAgent reports `costUsd: 0`**: The DebateAgent returns `{ costUsd: 0 }` in all its return statements rather than `ctx.costTracker.getAgentCost(this.name)`. The actual cost IS tracked via the onUsage callback, but the AgentResult doesn't reflect it.

5. **Reservation leak potential**: When an agent errors mid-execution (e.g., after 2 of 3 parallel calls), reservations for calls that never completed aren't fully released because `recordSpend` is only called on actual completions.

6. **ProximityAgent uses character-based embeddings**: The comment says "Real OpenAI embedding integration deferred to post-MVP production path." If real embeddings are added later, ProximityAgent will become a cost contributor.

---

## Recommended Cost Reduction: Pairwise OpenSkill (Weng-Lin Bayesian Rating)

### What is OpenSkill?

OpenSkill (`openskill` npm package, MIT license) is a Bayesian rating system based on the Weng-Lin algorithm. Each player gets two numbers:

- **mu** — estimated skill (analogous to Elo rating). Starts at 25 by default.
- **sigma** — uncertainty in that estimate. Starts high (~8.33), shrinks with each match.

After every match, both values update via Bayesian inference:
- **mu** shifts toward the observed outcome (winner's mu goes up, loser's goes down)
- **sigma** shrinks for both players (we learned something about them)

The key property: **sigma encodes how confident we are in the ranking**. A variant with `{mu: 30, sigma: 2}` is reliably strong. One with `{mu: 30, sigma: 7}` might be strong or might be lucky — we need more matches to tell.

### How It Replaces Elo

OpenSkill is a drop-in replacement for Elo in pairwise mode. No prompt changes, no group ranking, no new LLM calls:

```typescript
import { rating, rate, ordinal } from 'openskill';

// Initialize (replaces Elo 1200)
const v1 = rating();  // { mu: 25, sigma: 8.333 }
const v2 = rating();

// After a match where v1 wins (replaces updateEloWithConfidence)
const [[newV1], [newV2]] = rate([[v1], [v2]], { rank: [1, 2] });

// Draw (replaces updateEloDraw)
const [[newV1], [newV2]] = rate([[v1], [v2]], { rank: [1, 1] });

// Sort by ordinal (mu - 3*sigma) for conservative ranking
variants.sort((a, b) => ordinal(b.rating) - ordinal(a.rating));
```

### What It Replaces in the Codebase

| Current (Elo) | OpenSkill Equivalent |
|---|---|
| `state.eloRatings: Map<string, number>` | `state.ratings: Map<string, Rating>` where `Rating = {mu, sigma}` |
| `ELO_CONSTANTS.INITIAL_RATING = 1200` | `rating()` → `{mu: 25, sigma: 8.333}` |
| `updateEloWithConfidence(state, winnerId, loserId, confidence, kFactor)` | `rate([[winner], [loser]], {rank: [1, 2]})` |
| `updateEloDraw(state, idA, idB, kFactor)` | `rate([[a], [b]], {rank: [1, 1]})` |
| `getAdaptiveK(matchCount)` → 48/32/16 tiers | Automatic — sigma naturally controls update magnitude |
| `sigma()` proxy at `tournament.ts:54` → `1/sqrt(matchCount+1)` | Real sigma from Bayesian updates |
| Convergence: "max Elo change < 10 for 5 rounds" | Convergence: "all sigmas below threshold" |

### Why This Saves Cost

The savings come from **smarter stopping**, not fewer calls per comparison:

1. **Sigma-based tournament termination**: Currently the tournament checks convergence via a heuristic: "max Elo change < 10 for 5 consecutive rounds" (`tournament.ts:298-306`). This is conservative — it often runs extra rounds after rankings have stabilized because Elo changes are still > 10 for low-match-count variants. OpenSkill's sigma directly answers "are we confident enough?" without needing to observe delta trends over multiple rounds.

2. **Sigma-guided Swiss pairing**: The current `sigma()` proxy (`tournament.ts:54-56`) estimates uncertainty as `1/sqrt(matchCount+1)`. This ignores match *outcomes* — a variant with 4 decisive wins has the same proxy sigma as one with 2 wins and 2 losses. Real sigma distinguishes these, leading to better pair selection and fewer wasted comparisons on already-resolved rankings.

3. **Confidence-aware calibration early exit**: CalibrationRanker's adaptive early exit (`calibrationRanker.ts:150-156`) currently checks `confidence >= 0.7`. With OpenSkill, it can also check if the entrant's sigma has dropped below a threshold after the first batch — if yes, skip remaining opponents entirely.

**Estimated savings:** ~15-25% reduction in tournament comparisons → **~8-15% of total run cost** (tournament is 55-65% of total spend).

### Why Not Group Ranking

OpenSkill supports group ranking (`rate([[v1], [v2], [v3], [v4]], {rank: [2,1,4,3]})`), but we should **not** use it because:

1. **Prompt length doubles**: 4 texts × 2000 tokens = 8000 tokens vs 4000 for pairwise. On `gpt-4.1-nano`, longer contexts degrade ranking accuracy.
2. **Position bias gets worse**: Pairwise has 1 dimension of bias (A vs B). Group ranking adds primacy, recency, and middle-neglect effects. The current 2-pass reversal can't scale to 4! = 24 permutations.
3. **Parsing reliability drops**: `parseWinner()` handles simple A/B/TIE. Parsing a ranked ordering from `gpt-4.1-nano` is less reliable.
4. **Marginal dollar savings**: At $0.10/1M input tokens, each comparison costs ~$0.0004. Going from 80 to 10 calls saves ~$0.03/tournament — real but modest.

Keep pairwise comparisons. Use OpenSkill for the *rating math*, not the *comparison structure*.

---

## Experiment: Selective Bias Mitigation

### Hypothesis
If two variants have a large Elo gap, position bias is unlikely to change the outcome — the stronger variant should win regardless of presentation order. Skipping the reverse comparison for well-separated variants could save up to 50% of comparison LLM calls.

### Test Design
Built a simulation framework (`selectiveBiasMitigation.test.ts`) with:
- **Simulated LLM judge**: Models ground-truth quality, 30% position bias rate, and noise for close variants
- **Seedable PRNG** (xorshift32) for deterministic reproducibility across 20 trials per configuration
- **Two modes**: Full mitigation (always 2 calls) vs Selective (skip reverse when `eloGap >= threshold`)
- **Metrics**: Spearman rank correlation (vs full, vs ground truth), top-3 agreement, LLM call savings
- **Pool**: 16 variants, 40 max comparisons, 20 Swiss rounds per tournament

### Results

#### Threshold Sweep (20 trials each, pool=16, maxComparisons=40)

| Threshold | LLM Savings | Correlation vs Full | Correlation vs Ground Truth |
|-----------|------------|--------------------|-----------------------------|
| 25        | 2.7%       | 0.903              | 0.793                       |
| 50        | 0.5%       | 0.982              | 0.792                       |
| 75        | 0.1%       | 1.000              | 0.809                       |
| 100       | 0.0%       | 1.000              | 0.808                       |
| 150       | 0.0%       | 1.000              | 0.808                       |
| 200       | 0.0%       | 1.000              | 0.808                       |
| 300       | 0.0%       | 1.000              | 0.808                       |

#### Ground Truth Accuracy (threshold=100)
- Full vs GT: Spearman = 0.804
- Selective vs GT: Spearman = 0.804
- Accuracy delta: 0.00pp
- Top-3 agreement: 68.3%
- LLM call savings: 0.0%

#### High Position Bias (50% bias rate, threshold=100)
- Selective vs GT correlation: 0.708 (degrades gracefully)

#### Edge Case: threshold=1 (skip after any gap forms)
- Savings: 30% (full=40 calls, selective=28 calls)
- Demonstrates savings ARE possible when gaps exist

### Key Finding: Negligible Savings Within Single Tournament

**Selective bias mitigation provides only 0-2.7% savings within a single tournament iteration.** This is because:

1. **Cold start problem**: All variants start at Elo 1200 (no gap). The first round of comparisons always runs full mitigation since `eloGap = 0`.
2. **Slow gap formation**: Elo K-factor of 48 (first match) produces gaps of ~24 points per decisive match. With threshold=50, a variant needs 2+ matches before gaps cross the threshold.
3. **Swiss pairing exhaustion**: With 16 variants and adjacent pairing, all unique pairs are exhausted within ~8 rounds. By the time gaps form, few pairs remain.

### Implication

Selective bias mitigation is **not worth implementing within the Tournament agent** as currently architected. The promising directions are elaborated below.

---

## Complementary Optimizations (Post-OpenSkill)

These optimizations can be done alongside or after OpenSkill migration:

### Cross-Iteration Selective Bias Mitigation in CalibrationRanker

New entrants (default mu) face established pool members with low sigma. When sigma of both players is low and mu gap is large, the outcome is near-certain — the reverse comparison can be skipped.

- `calibrationRanker.ts:115-118` selects opponents; `calibrationRanker.ts:132-136` runs comparisons in batches
- With OpenSkill: check `Math.abs(entrantMu - opponentMu) > 3 * max(entrantSigma, opponentSigma)` before running reverse
- **Estimated savings**: 3-5% of total cost (COMPETITION iterations only)
- **Complexity**: Low — ratings already available in the calibration loop

### Swiss Pairing with Real Sigma

The existing `swissPairing()` (`tournament.ts:64-119`) computes `outcomeUncertainty` and a proxy sigma. With OpenSkill, both improve:
- `outcomeUncertainty` becomes `ordinal`-based (mu - 3*sigma) rather than raw rating
- Sigma proxy replaced by real sigma → better pair selection → fewer wasted comparisons
- Pairs where `outcomeUncertainty < 0.3` can skip reverse comparison (pass as flag to `runComparison()`)
- **Estimated savings**: 5-10% of tournament calls
- **Complexity**: Low — values already computed, just use real sigma

---

## Summary: Recommended Implementation

### Primary: Pairwise OpenSkill Migration

Replace Elo with OpenSkill in pairwise mode. No prompt changes, no group ranking.

**What changes:**
- `elo.ts` → replaced by OpenSkill `rate()` calls
- `state.eloRatings: Map<string, number>` → `state.ratings: Map<string, Rating>`
- `getAdaptiveK()` → removed (OpenSkill handles this via sigma)
- Tournament convergence → sigma-based instead of "Elo delta < 10 for 5 rounds"
- Swiss pairing `sigma()` proxy → real sigma from ratings

**What stays the same:**
- All LLM comparison logic (prompts, parsing, bias mitigation)
- PairwiseRanker, CalibrationRanker comparison flow
- Budget tracking, cost attribution
- ComparisonCache

**Estimated total savings:** ~15-25% of tournament comparisons → **~8-15% of total run cost**

### Secondary: Selective bias mitigation in CalibrationRanker + Swiss pairing improvements

**Additional savings:** ~5-10% of total cost on top of OpenSkill migration

### Files Created
- `src/lib/evolution/core/selectiveBiasMitigation.test.ts` — Full experiment with 10 test cases (all passing)

---

## Visualization Impact: mu + sigma in Admin UI

The visualization plan (`docs/planning/visualization_tool_for_evolution_pipeline_20260131/`) defines 7 display points that currently show single Elo numbers. With OpenSkill, each gains sigma (uncertainty) as a second dimension.

### Per-Component Changes

| Component | Current | With OpenSkill |
|---|---|---|
| **EloSparkline** (Phase 1) | Single line, `{iteration, elo}[]` | Line (mu) + shaded confidence band (±2σ). Band starts wide, narrows as matches accumulate. |
| **EloTab** (Phase 5) | LineChart, one line per variant, Y: 800-1800 | Line (mu) with confidence ribbon (±2σ) per variant. Early iterations = wide ribbons. Visually shows when rankings are "settled". |
| **VariantsTab** (Phase 6) | Table sorted by Elo descending | Sort by `ordinal` (mu - 3σ). Columns: Rank, ID, Rating (ordinal), mu, σ, Matches, Strategy. Uncertain variants rank lower despite high mu. |
| **VariantCard** (Phase 1) | Shows single Elo number | Shows `28.3 ± 4.1` (mu ± sigma) |
| **LineageGraph** (Phase 5) | Node size = Elo | Node size = ordinal. Node opacity or border style = sigma (low sigma = solid/opaque, high sigma = dashed/transparent). |
| **Compare page** (Phase 6) | Stat card: "Elo delta" | Stat cards: "mu delta" + "winner sigma" (confidence in winner). |
| **`getEvolutionRunEloHistoryAction`** (Phase 2) | `ratings: Record<string, number>` | `ratings: Record<string, {mu: number, sigma: number}>` |

### Key Visualization Insight

The biggest win from sigma is **showing uncertainty visually**. The confidence ribbon on the Rating chart lets admins see at a glance:
- Which variants are confidently ranked (narrow ribbon)
- Whether the tournament ran enough rounds (if ribbons are still wide at final iteration, it stopped too early)
- When sigma-based convergence triggered (ribbons narrow → tournament stops)

This replaces the current convergence heuristic ("Elo delta < 10 for 5 rounds") with a visual that directly shows *why* the tournament stopped.

### Data Layer Change

Checkpoint `state_snapshot` stores `{mu, sigma}` per variant instead of single Elo number. JSONB extraction query changes from `state_snapshot->'eloRatings'` to `state_snapshot->'ratings'`. The `getEvolutionRunEloHistoryAction` return type changes accordingly.

---

## Documents Read
- docs/feature_deep_dives/evolution_pipeline.md
- docs/feature_deep_dives/evolution_pipeline_visualization.md
- docs/docs_overall/architecture.md
- docs/docs_overall/getting_started.md
- docs/docs_overall/project_workflow.md

## Code Files Read
- src/lib/evolution/core/costTracker.ts — Budget enforcement with per-agent attribution
- src/lib/evolution/core/llmClient.ts — LLM client wrapper with budget reservation
- src/lib/evolution/core/pipeline.ts — Pipeline orchestrator (minimal + full modes)
- src/lib/evolution/core/supervisor.ts — EXPANSION→COMPETITION phase transitions
- src/lib/evolution/config.ts — Default config and Elo constants
- src/lib/evolution/comparison.ts — Standalone bias-mitigated comparison
- src/lib/evolution/agents/generationAgent.ts — 3-strategy text generation
- src/lib/evolution/agents/calibrationRanker.ts — Pairwise calibration with adaptive early exit
- src/lib/evolution/agents/tournament.ts — Swiss-style tournament with budget-adaptive depth
- src/lib/evolution/agents/evolvePool.ts — Mutation, crossover, creative exploration
- src/lib/evolution/agents/reflectionAgent.ts — 5-dimension critique of top variants
- src/lib/evolution/agents/debateAgent.ts — 3-turn structured debate + synthesis
- src/lib/evolution/agents/proximityAgent.ts — Diversity tracking (no LLM)
- src/lib/evolution/agents/metaReviewAgent.ts — Strategy analysis (no LLM)
- src/lib/evolution/agents/pairwiseRanker.ts — Bias-mitigated comparison with cache
- src/config/llmPricing.ts — Token pricing table for all models
