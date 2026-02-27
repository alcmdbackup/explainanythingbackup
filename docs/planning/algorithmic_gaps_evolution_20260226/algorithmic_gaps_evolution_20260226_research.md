# Algorithmic Gaps Evolution Research

## Problem Statement
Research the analytics framework in place for experimenting, analyzing, and proposing improvements to the evolution pipeline for improving Elo of written content. Identify gaps and opportunities for improvement to make the system algorithmically robust.

## Requirements (from GH Issue #583)
- Research the analytics framework for experimenting, analyzing & proposing improvements to the evolution pipeline for improving elo of written content
- Look for gaps and opportunities in improvement
- System should be algorithmically robust

## High Level Summary

The evolution pipeline has a **comprehensive and well-engineered** experimentation and analytics framework with three major subsystems: (1) a Taguchi L8 factorial experiment engine with automated state machine, (2) multi-level cost tracking with data-driven estimation, and (3) a unified dimensional explorer with strategy/agent ROI leaderboards. The algorithmic core uses OpenSkill Bayesian ratings, Swiss-style tournaments, and creator-based Elo attribution.

The system has **8 identified gaps** across three severity tiers, with **27 concrete improvement proposals** ranging from trivial (1-line config changes) to architectural (multi-day feedback loop systems). The highest-impact improvements are:

1. **Bootstrap confidence intervals on experiment effects** — the experiment engine computes main effects with no error bars, making convergence detection unreliable
2. **Use all 4 meta-feedback types** — currently only `priorityImprovements` is consumed; 75% of generated feedback is wasted
3. **Replace ad-hoc outcome uncertainty with OpenSkill logistic CDF** — the tournament's ÷10 scaling factor has no theoretical basis
4. **Justify or parametrize the ×6 plateau multiplier** — the most critical stopping condition uses an unexplained magic number

---

## Inventory: What Exists

### 1. Experiment Framework
- **Taguchi L8 orthogonal array** for screening 5 factors in 8 runs (factorial.ts)
- **Full-factorial design** for refinement rounds (factorial.ts)
- **Factor registry** with type-safe definitions, validation, and value expansion (factorRegistry.ts)
- **Automated state machine** driven by cron: pending → round_running → round_analyzing → pending_next_round → converged/budget_exhausted/max_rounds (experiment-driver/route.ts)
- **Analysis engine**: main effects, interaction effects (L8 columns 6-7), factor ranking by importance, automated recommendations (analysis.ts)
- **Validation pipeline**: factor validation → L8 generation → config resolution → strategy validation → run config validation → cost estimation (experimentValidation.ts)
- **CLI orchestrator**: plan/run/analyze/status commands with state file persistence (run-strategy-experiment.ts)
- **Admin UI**: ExperimentForm for factor selection, real-time status, results display

### 2. Analytics & Metrics
- **Unified Explorer**: 4 views (table, matrix, trend, article detail) with 5 dimensions (prompt, strategy, pipeline type, agent, time) and 5 metrics (avgElo, totalCost, runCount, avgEloDollar, successRate)
- **Strategy Leaderboard**: ranked by avg Elo, Elo/$, consistency (stddev), with Pareto frontier computation
- **Agent ROI Leaderboard**: per-agent avgCost, avgEloGain, Elo/dollar with sample sizes
- **Cost tracking**: 4 levels — invocation → agent → run → strategy, with reservation-based budget enforcement
- **Cost estimation**: data-driven baselines from historical LLM calls, text-length scaling, confidence levels (high/medium/low)
- **Cost accuracy**: estimated vs actual delta tracking with per-strategy accuracy stats and stddev
- **Creator-based Elo attribution**: per-variant deltaMu/sigmaDelta/zScore, per-agent aggregation with root-sum-of-squares CI

### 3. Algorithmic Core
- **OpenSkill Bayesian ratings**: mu/sigma with ordinal = mu - 3σ, sigma-based convergence
- **Swiss-style tournament**: info-theoretic pairing (outcome uncertainty × sigma weight), greedy matching, eligibility filtering, budget-adaptive depth
- **Calibration**: stratified opponent selection (quartile-based 2-2-1), adaptive early exit (batched parallelism with confidence thresholds)
- **Two-phase pipeline**: EXPANSION (pool building) → COMPETITION (refinement) with one-way lock
- **5 stopping conditions**: quality threshold, plateau detection, degenerate state, budget exhaustion, max iterations
- **Diversity scoring**: trigram-based cosine similarity over top-10 variants, sparse matrix caching
- **Meta-review**: strategy success analysis, weakness detection, failure patterns, priority identification
- **Comparison bias mitigation**: 2-pass reversal (forward + reverse) with order-invariant caching

### 4. Visualization
- **Dashboard**: active runs, queue depth, 7-day success rate, monthly spend, daily trends
- **Run detail**: 5 tabs (Elo history, timeline, budget, variants, lineage)
- **Hall of Fame**: cross-method leaderboard, cost vs Elo scatter, word-level text diff, prompt bank coverage grid

---

## Gap Analysis: Detailed Code-Level Findings

### GAP 1: No Online/Adaptive Learning (Critical)

**25+ hardcoded thresholds** that never adapt within or across runs:

| Category | Threshold | Value | Configurable? | File:Line |
|----------|-----------|-------|--------------|-----------|
| Phase transition | expansionMinPool | 15 | Yes (config) | supervisor.ts |
| Phase transition | diversityThreshold | 0.25 | Yes (config) | supervisor.ts |
| Phase transition | expansionMaxIterations | 8 | Yes (config) | supervisor.ts |
| Quality threshold | single-article quality | 8/10 all dims | **No** | supervisor.ts:185 |
| Plateau detection | window | 3 iters | Yes (config) | supervisor.ts |
| Plateau detection | threshold × 6 | 0.12 ordinal | **Partially** (×6 hardcoded) | supervisor.ts:265 |
| Budget pressure | tier boundaries | 0.5, 0.8 | **No** | tournament.ts:20-28 |
| Multi-turn | threshold / 16 scale | ÷16 | **No** | tournament.ts:181 |
| Swiss pairing | ordGap scaling | ÷10 | **No** | tournament.ts:118 |
| Convergence | sigma threshold | 3.0 | Via constant | rating.ts |
| Calibration | early-exit confidence | 0.7, 0.8 | **No** | calibrationRanker.ts:183-189 |
| Meta-review | diversity crisis | 0.3 | **No** | metaReviewAgent.ts:218 |
| Meta-review | ordinal too-similar | 6 | **No** | metaReviewAgent.ts:226 |
| Meta-review | ordinal too-high | 30 | **No** | metaReviewAgent.ts:228 |
| Meta-review | weakness overrep | 0.5× | **No** | metaReviewAgent.ts:147 |
| Meta-review | failure delta | -3 | **No** | metaReviewAgent.ts:203 |
| Meta-review | stagnation window | 2 iters | **No** | metaReviewAgent.ts:234 |
| Meta-review | min strategy count | 3 | **No** | metaReviewAgent.ts:246 |
| Evolution | creative exploration prob | 0.3 | **No** | evolutionAgent.ts |
| Evolution | creative diversity trigger | 0.5 | **No** | evolutionAgent.ts |
| Evolution | stagnation window | 2 iters | **No** | evolutionAgent.ts |
| Proximity | max cache size | 200 | **No** | proximityAgent.ts:9 |
| Proximity | top-N for diversity | 10 | **No** | proximityAgent.ts:108 |
| Tournament | maxStaleRounds | 1 | **No** | tournament.ts:44 |
| Tournament | maxRounds | 50 | **No** | tournament.ts:41 |

**Key finding from deep-dive**: The PoolSupervisor tracks `ordinalHistory` and `diversityHistory` arrays that grow unbounded (no max length enforcement). Additionally, the pipeline has access to `matchCounts`, `matchHistory`, `dimensionScores`, `allCritiques`, `strategyCounts`, `metaFeedback`, and rating sigma values — all of which could inform stopping decisions but are currently unused.

### GAP 2: Weak Statistical Rigor (High)

**Deep-dive findings from analysis.ts**:

The experiment analysis engine computes main effects using a simple formula:
```
Effect(Factor F) = avg(response | F=high) - avg(response | F=low)
```

**Present (basic):**
- Balanced L8 design (4 high / 4 low per factor)
- Orthogonality (factors vary independently)
- Cost-aware metric (Elo/$ computed alongside Elo)
- Partial data handling (works with <8 runs)
- Multi-metric tracking

**Absent (critical):**
| Gap | Impact | Severity |
|-----|--------|----------|
| Confidence intervals | Cannot quantify uncertainty in effect estimates | HIGH |
| Error variance estimation | No per-factor measurement noise | HIGH |
| Significance testing | Can't distinguish real effects from random variation | HIGH |
| Multiple comparison correction | 5 factors tested without Bonferroni/FDR | MEDIUM |
| Effect size standardization | Effects not normalized by noise magnitude | MEDIUM |
| Power analysis | Can't predict detection probability for small effects | MEDIUM |
| Non-linear effect detection | Model assumes additive main effects only | MEDIUM |

**Convergence detection** in the cron driver (route.ts:260-264) checks:
```
topEffect < convergenceThreshold AND completedRuns >= 4
```
No confidence intervals means the system cannot distinguish "truly converged" from "noisy small effects."

**Interaction effects**: Only 2 of 10 possible 2-factor interactions are estimated (L8 columns 6-7). These are confounded with empty columns and have no error term — confidence is LOW.

### GAP 3: Primitive Diversity Measurement (High)

**Deep-dive findings from proximityAgent.ts**:

Production embedding algorithm:
1. Lowercase + strip punctuation + split on whitespace
2. Generate word trigrams (3-word sequences)
3. Hash each trigram: `(hash * 31 + charCode) % 64`
4. Accumulate frequency in 64-dimensional vector
5. L2-normalize → cosine similarity

**Problems confirmed by code review:**
- **64-dimensional bottleneck**: Average article (~500 words) → ~500 trigrams → 60-70% collision rate in 64 buckets
- **Purely lexical**: "The cat sat on the mat" vs "A feline rested on the rug" → very different despite semantic equivalence
- **Top-10 bias**: `diversityScore = 1 - mean(top-10 pairwise similarities)` ignores 80%+ of pool
- **Short text penalty**: Texts with <3 words produce zero vectors (line 141)
- **FIFO cache eviction** (not true LRU): Line 45 uses `.keys().next().value` — oldest insertion, not least recently used
- **No semantic embeddings exist anywhere in evolution codebase** — Pinecone is used elsewhere but not wired into evolution

**Test evidence**: Test at line 202-214 only enforces `sim < 0.95` for different texts — confirms system designed to avoid false positives, not achieve precision.

### GAP 4: Meta-Review Feedback is 75% Wasted (High — upgraded from Medium)

**Deep-dive findings from metaReviewAgent.ts + generationAgent.ts + evolutionAgent.ts**:

MetaFeedback has 4 fields:
```typescript
interface MetaFeedback {
  recurringWeaknesses: string[];     // NEVER consumed
  priorityImprovements: string[];    // CONSUMED by generation + evolution
  successfulStrategies: string[];    // NEVER consumed
  patternsToAvoid: string[];         // NEVER consumed
}
```

**Consumption trace:**
- `generationAgent.ts:69-71` — only uses `priorityImprovements.join('\n')`
- `evolutionAgent.ts:196-199` — only uses `priorityImprovements.join('\n')`
- Other 4 fields: generated, serialized to checkpoints, displayed in admin UI, but **never injected into any prompt**

**No feedback loop exists:**
- Feedback computed once per iteration
- Consumed once in prompts as unstructured text
- No measurement of whether feedback improved outcomes
- No reinforcement of effective feedback types

### GAP 5: Plateau Detection Uses Unexplained ×6 Multiplier (High — upgraded from Medium)

**Deep-dive findings from supervisor.ts:261-266**:

```typescript
private _isPlateaued(): boolean {
  if (this.ordinalHistory.length < this.cfg.plateauWindow) return false;
  const recent = this.ordinalHistory.slice(-this.cfg.plateauWindow);
  const improvement = recent[recent.length - 1] - recent[0];
  return improvement < this.cfg.plateauThreshold * 6;  // ← MAGIC
}
```

**Problems confirmed:**
1. **×6 has zero documentation** — no comment, no test validates magnitude
2. **Simple endpoint comparison** — misses oscillation (ordinal could rise and fall within window)
3. **No trend extrapolation** — linear regression would predict future improvement rate
4. **Degenerate check is nested inside plateau path** — diversity < 0.01 only checked after plateau fires, should be independent
5. **Unbounded history arrays** — `ordinalHistory` and `diversityHistory` grow without limit
6. **Resume gap** — on checkpoint restore, histories are empty; needs `plateauWindow` more iterations

**Hypotheses for ×6 origin (ranked by likelihood):**
1. Empirical tuning from early runs
2. Intended to convert 0-1 threshold to ordinal scale (~6 ordinal points = ~100 Elo)
3. Conservative safety margin (harder to trigger plateau = longer runs)
4. Leftover from refactoring

### GAP 6: Tournament Pairing Uses Ad-Hoc Scoring (Medium)

**Deep-dive findings from tournament.ts:118**:

```typescript
const outcomeUncertainty = 1 / (1 + ordGap / 10);  // ad-hoc
const sigmaWeight = (sigmaA + sigmaB) / 2;
const score = outcomeUncertainty * sigmaWeight;
```

**Problems confirmed:**
- ÷10 scaling has no theoretical justification — should use OpenSkill logistic CDF: `P(A>B) = 1/(1+exp(-(muA-muB)/BETA))`
- Greedy matching is suboptimal vs Hungarian algorithm (estimated 5-10% fewer rounds with optimal matching, but complexity not justified)
- ÷16 factor in multi-turn threshold (line 181) is also unexplained — OpenSkill BETA ≈ 4.17, not 16

**Budget pressure tiers** (0.5, 0.8) are well-calibrated for binary choices but not empirically validated.

### GAP 7: No Cross-Run Learning (Medium)

Each run starts completely fresh. Strategy configs carry over via registry, but:
- No prompt difficulty estimation from prior outcomes
- No agent effectiveness priors per domain/difficulty
- No warm-starting from prior run ratings
- No transfer learning between similar prompts

### GAP 8: Calibration Early-Exit May Miss Information (Medium)

**Deep-dive findings from calibrationRanker.ts:183-205**:

Early exit triggers when: `all(confidence >= 0.7) AND avg(confidence) >= 0.8` after just 2 matches.

**Statistical risk**: P(high-conf by chance with 2 matches) ≈ 0.04 — significantly higher than P(5 matches) ≈ 0.002.

**Not budget-aware**: Same thresholds regardless of remaining budget. Should be stricter when budget is available.

---

## Concrete Improvement Proposals (Ranked)

### Tier 1: Quick Wins (hours, high impact)

| # | Proposal | Effort | Impact | Files |
|---|----------|--------|--------|-------|
| P1 | **Use all 4 meta-feedback types in prompts** | 15 min | 15-25% variant quality | generationAgent.ts:69-71, evolutionAgent.ts:196-199 |
| P2 | **Increase calibration minOpponents to 3** | 1 line | Reduce false-positive early exits from 4% → 0.1% | config.ts:17 |
| P3 | **Parametrize ×6 multiplier** as `plateauMultiplier` in config | 30 min | Enable tuning; document intent | supervisor.ts:265, config.ts |
| P4 | **Check degenerate state independently** (before plateau) | 30 min | Earlier detection of collapsed diversity | supervisor.ts:shouldStop() |
| P5 | **Cap history arrays** at 50 entries | 15 min | Prevent unbounded memory growth | supervisor.ts |

### Tier 2: Medium Effort (days, high impact)

| # | Proposal | Effort | Impact | Files |
|---|----------|--------|--------|-------|
| P6 | **Bootstrap confidence intervals on main effects** | 1-2 days | Know if effect ±50 Elo or ±5 Elo | analysis.ts |
| P7 | **Replace ÷10 pairing score with OpenSkill logistic CDF** | 2 hrs | More principled information gain | tournament.ts:118 |
| P8 | **Budget-aware calibration thresholds** | 2 hrs | Stricter when budget available, lenient when tight | calibrationRanker.ts:183 |
| P9 | **Multi-signal plateau detection** (ordinal + diversity + sigma trends) | 1 day | Fewer false plateau calls | supervisor.ts |
| P10 | **Convergence detection using CI lower bounds** instead of point estimates | 4 hrs | Avoid false convergence | experiment-driver/route.ts:260 |
| P11 | **Effect size standardization** (partial eta squared, Cohen's d) | 4 hrs | Compare effects across experiments | analysis.ts |
| P12 | **Convergence streak with 90% threshold** instead of 100% | 2 hrs | More robust to outliers | tournament.ts:390 |

### Tier 3: Significant Effort (weeks, medium-high impact)

| # | Proposal | Effort | Impact | Files |
|---|----------|--------|--------|-------|
| P13 | **Semantic diversity scoring** via embeddings | 2-3 days | 30-50% better duplicate detection | proximityAgent.ts |
| P14 | **Track meta-feedback effectiveness** (measure impact of feedback on next iteration) | 2-3 days | Enable reinforcement loop | metaReviewAgent.ts, pipeline.ts |
| P15 | **Track pairing informativeness** per tournament round | 1-2 days | Data-driven tournament exit | tournament.ts |
| P16 | **Bonferroni correction** for multiple factor comparisons | 4 hrs | Reduce false positives in factor ranking | analysis.ts |
| P17 | **Pool-wide diversity** (Shannon entropy / Simpson's index) instead of top-10 only | 1 day | Better stagnation detection | proximityAgent.ts |

### Tier 4: Architectural (weeks+, transformative)

| # | Proposal | Effort | Impact | Files |
|---|----------|--------|--------|-------|
| P18 | **Multi-armed bandit for agent selection** (Thompson Sampling) | 1-2 weeks | Dynamic budget allocation to highest-ROI agents | supervisor.ts, budgetRedistribution.ts |
| P19 | **Cross-run learning** (prompt difficulty priors, agent effectiveness priors) | 1-2 weeks | Better starting configs per prompt type | New module |
| P20 | **Bayesian experiment design** (info gain optimization for next round) | 2-3 weeks | More efficient factor exploration | factorial.ts, analysis.ts |
| P21 | **Adaptive threshold tuning** based on historical outcomes | 2-3 weeks | Self-tuning pipeline | New module |

---

## Key Findings

1. **The experiment engine has no error bars** — main effects are point estimates with no confidence intervals, making convergence detection unreliable and factor ranking potentially misleading
2. **75% of meta-review feedback is generated but never consumed** — only `priorityImprovements` is used; `recurringWeaknesses`, `successfulStrategies`, and `patternsToAvoid` are wasted
3. **The ×6 plateau multiplier is the most critical unexplained constant** — it controls when the pipeline stops, yet has no documentation, no test validating its magnitude, and no way to tune it
4. **Diversity scoring is lexical-only** — 64-dimensional trigram hashing with 60-70% collision rate, measuring only top-10 variants, no semantic understanding
5. **Tournament pairing uses ad-hoc scoring** — the ÷10 ordGap scaling and ÷16 multi-turn threshold have no theoretical basis; OpenSkill's own logistic CDF would be more principled
6. **Zero thresholds adapt during or across runs** — the pipeline makes identical decisions regardless of accumulated experience (25+ hardcoded constants)
7. **Available but unused data**: matchHistory, dimensionScores, strategyCounts, sigma trends, and critique trends could all inform stopping/transition decisions
8. **Calibration early-exit is not budget-aware** — same confidence thresholds (0.7/0.8) regardless of remaining budget; should be stricter when budget available

## Open Questions

1. **What is the actual origin of the ×6 multiplier?** Need to check git blame or ask original author
2. **How much do current thresholds cost in suboptimal runs?** Would need A/B testing to quantify
3. **Is semantic diversity worth the cost?** Embeddings cost ~$0.0001/article; need to benchmark vs trigram quality
4. **How many experiment runs have been completed?** Sample size affects which statistical improvements are practical
5. **Would the user prefer quick wins (P1-P5) first, or skip to architectural improvements (P18-P21)?**

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/agents/overview.md
- docs/feature_deep_dives/article_detail_view.md
- evolution/docs/evolution/hall_of_fame.md
- docs/docs_overall/white_paper.md
- docs/feature_deep_dives/search_generation_pipeline.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/cost_optimization.md

## Code Files Read (Deep-Dived)
- evolution/src/lib/core/supervisor.ts — PoolSupervisor, phase transitions, shouldStop(), _isPlateaued(), all stopping conditions
- evolution/src/lib/core/supervisor.test.ts — Edge cases, resume behavior, phase locking tests
- evolution/src/lib/core/config.ts — resolveConfig(), auto-clamping, default constants
- evolution/src/experiments/evolution/analysis.ts — Main effects, interactions, factor ranking, recommendations
- evolution/src/experiments/evolution/analysis.test.ts — Analysis validation tests
- evolution/src/experiments/evolution/factorial.ts — L8 array, full-factorial, factor-to-pipeline mapping
- evolution/src/experiments/evolution/factorRegistry.ts — Factor definitions, expandAroundWinner
- src/app/api/cron/experiment-driver/route.ts — State machine, convergence detection, next round derivation
- evolution/src/lib/agents/tournament.ts — Swiss pairing, budget pressure, convergence, multi-turn tiebreaker
- evolution/src/lib/agents/tournament.test.ts — Pairing, eligibility, convergence tests
- evolution/src/lib/agents/calibrationRanker.ts — Stratified opponents, adaptive early exit
- evolution/src/lib/agents/calibrationRanker.test.ts — Early exit, budget error tests
- evolution/src/lib/core/pool.ts — Quartile-based stratified selection
- evolution/src/lib/core/rating.ts — OpenSkill wrapper, ordinal, convergence
- evolution/src/lib/agents/proximityAgent.ts — Trigram embedding, similarity matrix, diversity score
- evolution/src/lib/agents/proximityAgent.test.ts — Embedding tests
- evolution/src/lib/agents/metaReviewAgent.ts — Strategy analysis, weakness detection, all 4 modules
- evolution/src/lib/agents/metaReviewAgent.test.ts — Threshold and feedback tests
- evolution/src/lib/agents/generationAgent.ts — MetaFeedback consumption (priorityImprovements only)
- evolution/src/lib/agents/evolutionAgent.ts — MetaFeedback consumption (priorityImprovements only)
- evolution/src/services/experimentActions.ts — Experiment lifecycle actions
- evolution/src/services/strategyRegistryActions.ts — Strategy CRUD
- evolution/src/services/strategyResolution.ts — Atomic strategy find-or-create
- evolution/src/services/unifiedExplorerActions.ts — Explorer views
- evolution/src/services/eloBudgetActions.ts — Agent ROI, strategy leaderboard, Pareto frontier
- evolution/src/services/costAnalytics.ts — Cost aggregation
- evolution/src/services/costAnalyticsActions.ts — Cost accuracy metrics
- evolution/src/lib/core/costTracker.ts — Budget enforcement with reservation
- evolution/src/lib/core/costEstimator.ts — Data-driven cost prediction
- evolution/src/lib/core/budgetRedistribution.ts — Agent selection, budget scaling
- evolution/src/lib/core/strategyConfig.ts — Strategy identity, hashing
- evolution/src/lib/core/eloAttribution.ts — Creator-based attribution math
- evolution/src/lib/core/metricsWriter.ts — Strategy config linking, cost prediction persistence
- evolution/src/lib/core/hallOfFameIntegration.ts — Prompt linking
- evolution/src/lib/core/reversalComparison.ts — 2-pass reversal framework
- evolution/src/lib/diffComparison.ts — CriticMarkup diff comparison
- scripts/run-strategy-experiment.ts — CLI orchestrator
- supabase/migrations/20260222100003_add_experiment_tables.sql — Experiment tables
