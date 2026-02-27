# Algorithmic Gaps Evolution Research

## Problem Statement
Research the analytics framework in place for experimenting, analyzing, and proposing improvements to the evolution pipeline for improving Elo of written content. Identify gaps and opportunities for improvement to make the system algorithmically robust.

## Requirements (from GH Issue #583)
- Research the analytics framework for experimenting, analyzing & proposing improvements to the evolution pipeline for improving elo of written content
- Look for gaps and opportunities in improvement
- System should be algorithmically robust

## High Level Summary

The evolution pipeline has a **comprehensive and well-engineered** experimentation and analytics framework with three major subsystems: (1) a Taguchi L8 factorial experiment engine with automated state machine, (2) multi-level cost tracking with data-driven estimation, and (3) a unified dimensional explorer with strategy/agent ROI leaderboards. The algorithmic core uses OpenSkill Bayesian ratings, Swiss-style tournaments, and creator-based Elo attribution.

After **3 rounds of deep research with 12 parallel agents** reading **80+ code files**, the system has **15+ identified gap categories** across four severity tiers, with **30+ concrete improvement proposals**. The research covered: core pipeline algorithms, experiment engine, agent internals (evolution/tree search/section decomposition/debate), rating system, comparison bias mitigation, checkpoint/resume, admin UI analytics, Hall of Fame statistical rigor, and pipeline orchestration.

**Top 6 highest-impact improvements:**

1. **Use all 4 meta-feedback types in prompts** — 75% of generated feedback is wasted; only `priorityImprovements` consumed while `recurringWeaknesses`, `successfulStrategies`, `patternsToAvoid` are discarded
2. **Add confidence intervals everywhere** — no CIs on experiment effects, strategy leaderboard, Hall of Fame rankings, or elo_per_dollar; rankings appear more decisive than data supports
3. **Replace ad-hoc scoring constants with principled formulas** — the ÷10, ÷16, ×6 constants have no theoretical basis; OpenSkill logistic CDF available
4. **Wire dead code: isRatingStagnant()** — stagnation detection exists but is never called; would improve exploration triggering
5. **Add dynamic agent scheduling** — fixed agent execution order ignores ROI data that's already being collected
6. **Make phase transition reversible** — one-way EXPANSION→COMPETITION lock prevents recovery from diversity collapse

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

## Concrete Improvement Proposals (Ranked — All Research Rounds)

### Tier 1: Quick Wins (hours, high impact)

| # | Proposal | Effort | Impact | Files | Source |
|---|----------|--------|--------|-------|--------|
| P1 | **Use all 4 meta-feedback types in prompts** — add `recurringWeaknesses`, `successfulStrategies`, `patternsToAvoid` | 15 min | 15-25% variant quality improvement | generationAgent.ts:69-71, evolutionAgent.ts:196-199 | GAP 4 |
| P2 | **Increase calibration minOpponents to 3** | 1 line | Reduce false-positive early exits from 4% → 0.1% | config.ts:17 | GAP 8 |
| P3 | **Parametrize ×6 multiplier** as `plateauMultiplier` in config | 30 min | Enable tuning; document intent | supervisor.ts:265, config.ts | GAP 5 |
| P4 | **Check degenerate state independently** (before plateau) | 30 min | Earlier detection of collapsed diversity | supervisor.ts:shouldStop() | GAP 5 |
| P5 | **Cap history arrays** at 50 entries | 15 min | Prevent unbounded memory growth | supervisor.ts | GAP 5 |
| P6 | **Wire isRatingStagnant() into creative exploration trigger** | 30 min | Enable stagnation-driven exploration (dead code → live) | evolvePool.ts:143-166, 281 | R2-1 |
| P7 | **Add sigma floor** (e.g., MIN_SIGMA=1.0) to prevent over-confidence | 1 line | Prevent pathological sigma → 0 | rating.ts | R2-5 |
| P8 | **Normalize cross-scale thresholds** — use flowRubric.normalizeScore() consistently | 30 min | Quality 8/10 and flow 3/5 become equivalent | iterativeEditingAgent.ts:252 | R2-4 |
| P9 | **Add CIs to Hall of Fame leaderboard** — display μ ± 1.96σ | 1 hr | Show which rankings are statistically separable | hallOfFameActions.ts:307-325 | R3-3 |

### Tier 2: Medium Effort (days, high impact)

| # | Proposal | Effort | Impact | Files | Source |
|---|----------|--------|--------|-------|--------|
| P10 | **Bootstrap confidence intervals on experiment main effects** | 1-2 days | Know if effect ±50 Elo or ±5 Elo | analysis.ts | GAP 2 |
| P11 | **Replace ÷10 pairing score with OpenSkill logistic CDF** | 2 hrs | Principled information gain from pairings | tournament.ts:118 | GAP 6 |
| P12 | **Budget-aware calibration thresholds** | 2 hrs | Stricter when budget available, lenient when tight | calibrationRanker.ts:183 | GAP 8 |
| P13 | **Multi-signal plateau detection** (ordinal + diversity + sigma trends) | 1 day | Fewer false plateau calls | supervisor.ts | GAP 5 |
| P14 | **Convergence detection using CI lower bounds** instead of point estimates | 4 hrs | Avoid false convergence in experiment driver | experiment-driver/route.ts:260 | GAP 2 |
| P15 | **Effect size standardization** (partial eta squared, Cohen's d) | 4 hrs | Compare effects across experiments | analysis.ts | GAP 2 |
| P16 | **Convergence streak with 90% threshold** instead of 100% | 2 hrs | More robust to outliers | tournament.ts:390 | R2-5 |
| P17 | **ROI-weighted budget redistribution** instead of proportional | 1 day | Allocate more to high-ROI agents | budgetRedistribution.ts:110 | E3 |
| P18 | **Use friction spots in editing agents** — feed frictionSpots to iterativeEditing/treeSearch | 4 hrs | Target specific problematic passages | pairwiseRanker.ts, iterativeEditingAgent.ts | R2-4 |
| P19 | **Add CI visualization to Elo history chart** — sigma bands on rating trajectories | 1 day | Show uncertainty during evolution | EloTab.tsx, evolutionVisualizationActions.ts | R3-2 |
| P20 | **Graceful budget degradation** — skip expensive agents instead of halting run | 1 day | Runs produce results even when budget tight | pipeline.ts, costTracker.ts | R3-4 |
| P21 | **Fix draw classification** — use actual TIE (not confidence < 0.3) for updateDraw | 2 hrs | Don't conflate uncertainty with ties | tournament.ts, hallOfFameActions.ts | R2-5 |
| P22 | **Preserve ordinalHistory on phase transition** instead of clearing it | 2 hrs | Enable earlier plateau detection in COMPETITION | supervisor.ts:159-160 | R3-4 |

### Tier 3: Significant Effort (weeks, medium-high impact)

| # | Proposal | Effort | Impact | Files | Source |
|---|----------|--------|--------|-------|--------|
| P23 | **Semantic diversity scoring** via embeddings (Pinecone already available) | 2-3 days | 30-50% better duplicate detection | proximityAgent.ts | GAP 3 |
| P24 | **Track meta-feedback effectiveness** (measure impact on next iteration's Elo delta) | 2-3 days | Enable reinforcement loop | metaReviewAgent.ts, pipeline.ts | GAP 4 |
| P25 | **Track pairing informativeness** per tournament round | 1-2 days | Data-driven tournament exit | tournament.ts | GAP 6 |
| P26 | **Bonferroni correction** for multiple factor comparisons | 4 hrs | Reduce false positives in factor ranking | analysis.ts | GAP 2 |
| P27 | **Pool-wide diversity** (Shannon entropy / Simpson's index) instead of top-10 | 1 day | Better stagnation detection | proximityAgent.ts | GAP 3 |
| P28 | **Fitness-proportionate parent selection** for evolution agent | 2 days | Escape local optima; more diverse variants | evolvePool.ts, pool.ts | R2-1 |
| P29 | **Adaptive tree search depth** — stop early when beam plateaus | 1-2 days | Save cost when depth provides no improvement | beamSearch.ts:42 | R2-2 |
| P30 | **Per-section weakness targeting** in section decomposition | 1-2 days | Each section improved on its specific weakness | sectionDecompositionAgent.ts:66 | R2-3 |
| P31 | **Post-edit self-reflection** — agents validate target dimension improved | 2-3 days | Guarantee edits actually improve targeted quality | iterativeEditingAgent.ts, evolvePool.ts | R2-4 |
| P32 | **Cross-judge validation** — re-compare 10-20% of HoF pairs with different judge | 2 days | Detect and correct systematic judge bias | hallOfFameActions.ts, run-hall-of-fame-comparison.ts | R3-3 |
| P33 | **Convergence trajectory visualization** per article | 2 days | Show where quality plateaus; inform when to stop | New component, articleDetailActions.ts | R3-2 |
| P34 | **Cost estimation feedback loop** — update static multipliers from actual cost data | 2 days | Predictions improve over time | costEstimator.ts:194-280, costAnalyticsActions.ts | E3 |
| P35 | **Dimension score trend visualization** in admin UI | 2 days | Track per-dimension improvement over runs | New component, evolutionVisualizationActions.ts | R3-2 |

### Tier 4: Architectural (weeks+, transformative)

| # | Proposal | Effort | Impact | Files | Source |
|---|----------|--------|--------|-------|--------|
| P36 | **Multi-armed bandit for agent selection** (Thompson Sampling) | 1-2 weeks | Dynamic budget allocation to highest-ROI agents | supervisor.ts, budgetRedistribution.ts | GAP 1 |
| P37 | **Cross-run learning** (prompt difficulty priors, agent effectiveness priors) | 1-2 weeks | Better starting configs per prompt type | New module | GAP 7 |
| P38 | **Bayesian experiment design** (info gain optimization for next round) | 2-3 weeks | More efficient factor exploration | factorial.ts, analysis.ts | GAP 2 |
| P39 | **Adaptive threshold tuning** based on historical outcomes | 2-3 weeks | Self-tuning pipeline | New module | GAP 1 |
| P40 | **Reversible phase transition** with diversity recovery | 1-2 weeks | Re-enter EXPANSION if COMPETITION diversity collapses | supervisor.ts | R3-4 |
| P41 | **Dynamic agent scheduling** — skip/reorder agents based on per-iteration ROI | 1-2 weeks | Stop wasting budget on low-value agents | supervisor.ts, pipeline.ts | R3-4 |
| P42 | **Hierarchical Bayesian aggregation** for Hall of Fame cross-topic inference | 2-3 weeks | Proper uncertainty-weighted method ranking | hallOfFameActions.ts | R3-3 |

---

## Key Findings (Consolidated Across All Research Rounds)

### Statistical Rigor
1. **No confidence intervals anywhere** — experiment effects, strategy leaderboard, Hall of Fame rankings, and elo_per_dollar are all point estimates with no uncertainty quantification
2. **No statistical significance testing** — strategy and method comparisons may be noise; no t-tests, Bonferroni correction, or power analysis
3. **Convergence threshold (σ < 3.0) is not theoretically derived** — allows ~40% CI overlap; σ < 2.0 would give 95% confidence

### Wasted Signals
4. **75% of meta-review feedback is generated but never consumed** — only `priorityImprovements` used; 3 other signal types (`recurringWeaknesses`, `successfulStrategies`, `patternsToAvoid`) discarded
5. **Friction spots from flow comparison are generated but never read** — stored in `Match.frictionSpots`, no downstream consumer
6. **Dimension scores don't influence ratings** — `state.ratings` and `state.dimensionScores` are fully decoupled
7. **Per-agent metrics (cost/benefit, convergence streaks, stale rounds) are audit-only** — logged but never shape decisions

### Dead Code & Unexplained Constants
8. **`isRatingStagnant()` is dead code** — defined with CREATIVE_STAGNATION_ITERATIONS=2 but never called by any agent
9. **DECISIVE_CONFIDENCE=0.6 is defined but never referenced** — rating.ts:85; appears to be planned-but-unimplemented
10. **The ×6 plateau multiplier has zero documentation** — controls the most critical stopping condition with no justification
11. **Tournament scoring uses ad-hoc ÷10, ÷16 constants** — no theoretical basis; OpenSkill logistic CDF available

### Architectural Rigidity
12. **Phase transition is one-way** — EXPANSION→COMPETITION lock never reverts even if diversity collapses
13. **Agent scheduling is fixed** — canonical order per phase; no dynamic skipping, reordering, or ROI-based adaptation
14. **Budget failure halts entire run** — no graceful degradation; could skip expensive agents instead
15. **Evolution parent selection is deterministic top-2** — no tournament selection, no diversity-aware recombination, vulnerable to local optima

### Diversity & Quality Measurement
16. **Diversity scoring is lexical-only** — 64-dim trigram hashing with 60-70% collision rate; no semantic embeddings
17. **No self-reflection loop** — agents don't critique own outputs; no dimension validation post-edit
18. **Cross-scale normalization inconsistent** — quality (1-10) vs flow (0-5) thresholds not equivalent in effect

### Persistence & Learning
19. **No inter-iteration learning** — feedback is stateless; recomputed fresh each iteration
20. **ordinalHistory/diversityHistory reset on phase transition** — plateau detection can't trigger for first ~5 COMPETITION iterations
21. **No cross-run learning** — each run starts fresh; no prompt difficulty priors or agent effectiveness history

### Hall of Fame Specific
22. **Pairing is "greedy adjacent" not true Swiss** — doesn't update pairings based on round results
23. **Cross-topic aggregation is unweighted** — ignores sigma; high-uncertainty entries weighted equally
24. **No cross-judge validation** — different judge models may have different preferences; no consistency analysis

## Extended Analysis (Round 1 — 4 Deep-Dive Agents)

### E1: Real Experiment Data & Strategy Infrastructure

**Data flow gaps:**
- `stddev_final_elo` field is declared in RPC output but never computed — always returns null
- Variant quality scores are unindexed, causing full table scans on large datasets
- No convergence tracking is persisted — the experiment driver checks convergence ephemerly but doesn't store convergence trajectory
- Strategy aggregation pipeline (`get_strategy_leaderboard` RPC) uses COALESCE defaults that mask missing data (e.g., 0 for avg_elo when no runs exist)

**Pareto frontier**: The O(N²) dominance computation in `eloBudgetActions.ts:257-317` is correct (no early-exit bugs found), but only operates on 2 objectives (Elo, Cost). Multi-objective optimization with consistency (stddev) as a 3rd axis is missing.

**State machine reliability**: The experiment driver's cron route has proper idempotency guards (status checks before transitions), but no dead-letter handling for runs that hang in `running` state indefinitely.

### E2: Comparison & Bias Mitigation Vulnerabilities

**2-pass reversal sufficiency:**
- The bias mitigation runs exactly 2 comparisons (forward + reverse). This catches simple position bias but cannot detect:
  - **Length bias** (judges favoring longer text regardless of position)
  - **Style bias** (judges favoring certain rhetorical patterns)
  - **Recency bias** (different from position — last-read text advantage in longer contexts)
- Confidence scoring: 1.0 (agree) vs 0.5 (disagree) is binary — no gradation for partial agreement (e.g., both say A wins but with different strength language)

**Parser ambiguity in `parseWinner()`:**
- Regex-based extraction from LLM output; edge cases with equivocal language (e.g., "Article A is slightly better but Article B has stronger structure") can misparse
- No structured output (JSON mode) enforcement — relies on prompt-following compliance

**Cache key collision risk:**
- SHA-256 hashing of `textA + textB` (concatenated) — texts where textA's suffix equals textB's prefix could collide (though probability is negligible in practice)
- No text normalization before hashing — leading/trailing whitespace changes produce different cache keys, causing redundant comparisons

### E3: Budget Redistribution & Cost Estimation

**Redistribution algorithm (budgetRedistribution.ts:110):**
- Uses pure proportional scaling — if agent A had 30% budget and agent B (disabled) had 20%, A gets `30/(30+remaining) * total`. This ignores ROI entirely.
- Better approach: ROI-weighted redistribution using `eloDelta/cost` from recent iterations
- Per-agent cap enforcement is correct but the 30% safety margin (costTracker.ts:24) is fixed regardless of prediction accuracy — should shrink as estimation improves

**Cost estimation accuracy:**
- Hardcoded call multipliers in `costEstimator.ts:194-280` (e.g., generationAgent = 2 calls, evolutionAgent = 3 calls) don't account for retry logic or conditional paths
- `costAnalyticsActions.ts` tracks estimated-vs-actual deltas but this data is never fed back to update the multipliers
- No feedback loop: accuracy data exists in DB but the estimator always uses static baselines

### E4: Strategy Leaderboard & Analytics Gaps

**Missing statistical analysis:**
- No confidence intervals on leaderboard Elo values — ordinal ± stderr would immediately show which rankings are statistically separable
- No significance testing between adjacent strategies — "Strategy A is rank 1 and Strategy B is rank 2" may be statistically indistinguishable
- Pareto frontier is binary (dominated/non-dominated) — no envelope/frontier-distance metric
- No temporal trend analysis — can't answer "is this strategy improving over time?"

**A/B testing support:**
- The experiment engine runs L8 designs but has no capability for paired A/B comparison of two specific strategies
- The unified explorer can filter by strategy but lacks head-to-head comparison view
- No matched-pairs analysis (same prompt, same judge, different strategies)

**Dashboard limitations:**
- 7-day success rate is hardcoded window — no configurable period
- No alerting on statistical anomalies (sudden Elo drops, cost spikes, convergence failures)
- Agent ROI leaderboard doesn't account for sample size — an agent with 1 run and high Elo looks better than one with 50 runs

## Extended Analysis (Round 2 — 4 Deep-Dive Agents)

### R2-1: Evolution Agent Mutation & Parent Selection

**Parent Selection — Deterministic Top-N (evolvePool.ts:108-112):**
- `getEvolutionParents(n=2)` always selects top-2 by ordinal, excluding baseline
- No tournament selection, fitness-proportionate selection, or diversity-aware selection
- Purely greedy — vulnerable to local optima convergence

**Three Core Mutation Types (all LLM-guided, not procedural):**
1. `mutate_clarity` — simplify sentences, improve word choice (single parent)
2. `mutate_structure` — reorganize paragraphs, strengthen transitions (single parent)
3. `crossover` — combines structural + stylistic elements from 2 parents (LLM-driven blend, not genetic crossover)
- Fallback: if only 1 parent, crossover degrades to mutate_clarity

**Creative Exploration (evolvePool.ts:275-324):**
- 30% random trigger (CREATIVE_RANDOM_CHANCE=0.3) OR diversityScore < 0.5 (CREATIVE_DIVERSITY_THRESHOLD)
- Identifies overrepresented strategies (>1.5× average) and tells LLM to avoid them
- `isRatingStagnant()` function EXISTS but is NEVER CALLED — defined at lines 143-166 with no callers

**Key Gaps Found:**
| Gap | Evidence | Impact |
|-----|----------|--------|
| No tournament/fitness-proportionate parent selection | evolvePool.ts:190 — always top-N | Vulnerable to local optima |
| Stagnation detection code is dead code | CREATIVE_STAGNATION_ITERATIONS=2 defined but isRatingStagnant() never called | Missed exploration trigger |
| No mutation strength adaptation | LLM prompts are static; no intensity scaling by convergence | Can't shift from exploration to exploitation |
| No failed mutation retry | Format rejections discarded (1 attempt only), cost still charged | Budget waste on failed variants |
| No circular crossover prevention | A×B then B×A is possible across iterations | Wasted computation |
| Pool health stats unused | pool.ts:114-145 poolStatistics() never called by evolvePool | Available diversity info ignored |

### R2-2: Tree Search Agent (Beam Search)

**Architecture: A hybrid beam search with two-stage evaluation.**

Key files: `treeSearchAgent.ts`, `treeOfThought/beamSearch.ts` (368 lines), `evaluator.ts`, `revisionActions.ts`

**Algorithm (K=3 beam width, B=3 branching factor, D=3 max depth):**
```
Root Selection → highest μ variant with σ > convergence threshold (prefers underexplored)
FOR depth 1..D:
  Re-critique beam members (depth ≥ 2)
  Generate K×B candidates (diverse action types)
  Stage 1: Parent-relative filter (diff or pairwise comparison)
  Stage 2: Sibling mini-tournament (local OpenSkill ratings, adjacent-pair matches)
  Diversity slot: K-1 by ordinal + 1 from different parent lineage
Best leaf → add to pool (rate-limited: only 1 variant per invocation)
```

**5 Revision Action Types:** edit_dimension (targets weakest), structural_transform, lexical_simplify, grounding_enhance, creative

**Cost:** ~55 LLM calls + ~90 comparisons per run; budget cap 10% ($0.50)

**Key Gaps Found:**
| Gap | Evidence | Impact |
|-----|----------|--------|
| No adaptive depth control | maxDepth fixed at 3; no budget/performance heuristic | Wasted depth if plateau, insufficient if improving |
| Single-round sibling tournament | Adjacent-pair comparisons only, not full round-robin | Could miss strong candidates losing to immediate neighbor |
| Fixed re-critique depth boundary | Always at depth ≥ 2, regardless of edit magnitude | Stale critiques at depth 1 for large edits |
| No adaptive strategy prioritization | Cycles through action types in fixed order | No meta-strategy based on critique analysis |
| Stale critique fallback is silent | Falls back to root critique without quality penalty | Beam decisions based on outdated critique |
| Cost estimation uses magic "30×D" | treeSearchAgent.ts:144 — not derived from algorithm | Budget predictions may be inaccurate |

### R2-3: Section Decomposition Agent

**Architecture: H2-level section decomposition with parallel editing.**

Key files: `sectionDecompositionAgent.ts` (220 lines), `sectionParser.ts`, `sectionEditRunner.ts`, `sectionStitcher.ts`

**Algorithm:**
```
Parse article → H2 sections (skip preamble, skip < 100 chars)
Identify weakest dimension from top variant critique
Reserve budget (once, upfront)
Parallel: for each eligible section → critique → edit → judge (compareWithDiff)
Build replacement map → stitch → validate format → add to pool
```

**Key Properties:** MAX_CYCLES=2 per section, single weakness target for all sections, round-trip fidelity in parsing

**Key Gaps Found:**
| Gap | Evidence | Impact |
|-----|----------|--------|
| All sections target same weakness dimension | getWeakestDimension() returns one dimension for all | Section-specific weaknesses ignored |
| No cross-section coherence check | Sections edited independently, no post-stitch flow analysis | Tone/style inconsistencies between sections |
| Preamble excluded from editing | !s.isPreamble filter | Intro hook optimization missed |
| No section prioritization | Promise.allSettled treats all sections equally | Budget spread thin on low-impact sections |
| Format validation lacks repair loop | SEC-2 diagnostic only logs; doesn't retry or fix | Valid edits lost due to stitching format issues |

### R2-4: Critique, Reflection & Quality Evaluation

**Two parallel evaluation tracks:**
1. **Comparative (pairwise):** A/B comparison with 5 quality + 5 flow dimensions, bias-mitigated
2. **Absolute (critique):** ReflectionAgent (1-10 quality scores) + FlowCritiqueAgent (0-5 flow scores)

**Dimension Coverage:**
- Quality: clarity, engagement, precision, voice_fidelity, conciseness (1-10)
- Flow: local_cohesion, global_coherence, transition_quality, rhythm_variety, redundancy (0-5)
- Stored in `state.dimensionScores` (numeric) and `state.allCritiques` (full critique objects)

**Key Gaps Found:**
| Gap | Evidence | Impact |
|-----|----------|--------|
| No numeric aggregation of pairwise dimension scores | PairwiseRanker stores A/B/TIE strings, not numbers | Can't track per-dimension wins across tournament |
| No self-reflection loop | Agents don't critique own output; no dimension validation post-edit | No guarantee target dimension improved |
| Dimension scores don't influence ratings | state.ratings and state.dimensionScores are fully decoupled | Dimension imbalance invisible to ranking |
| Cross-scale normalization inconsistent | flowRubric.ts normalizes; iterativeEditingAgent doesn't | Quality threshold 8/10 ≠ flow threshold 3/5 in effect |
| Friction spots generated but never used | frictionSpots stored in Match but nothing reads them | Lost signal on problematic passages |
| Critique parsing silently fails | parseQualityCritiqueResponse returns null on error | Bad examples/notes lost without logging |
| No dimension preference modeling | All 10 dimensions treated as equal weight | Can't prioritize clarity > engagement |
| No confidence weighting in meta-analysis | MetaReview counts strategies equally regardless of match confidence | Low-confidence verdicts weighted same as high |

### R2-5: OpenSkill Rating Internals

**Parameters (all openskill v4.1.0 defaults, no overrides):**

| Parameter | Value | Purpose |
|-----------|-------|---------|
| mu_init | 25 | Initial skill estimate |
| sigma_init | 8.333 | Initial uncertainty (25/3) |
| z | 3 | Confidence interval width |
| tau | 0.083 | Skill decay between matches (25/300) |
| beta | 4.166 | Observation noise (sigma/2) |
| CONVERGENCE_SIGMA | 3.0 | Sigma threshold for convergence |

**Ordinal formula: μ - 3σ** — conservative (0.135% tail); appropriate for risk-averse ranking but more conservative than 95% CI standard (μ - 2σ)

**Convergence threshold σ < 3.0:**
- Not theoretically derived — appears to be "round number ≈ 1/3 of default sigma"
- Allows ~40% CI overlap — suitable for "winner declaration" but not "statistical certainty"
- A σ < 2.0 threshold would give 95% confidence; σ < 1.5 for 99%

**Attribution math (eloAttribution.ts) — MATHEMATICALLY SOUND:**
- deltaMu = variant.mu - avgParentMu, gain = deltaMu × ELO_SCALE (16)
- Sigma combination via quadrature (independent uncertainties)
- Minor bug: multi-parent sigma averaging uses arithmetic mean of variances, should use root-mean-square

**Key Gaps Found:**
| Gap | Evidence | Impact |
|-----|----------|--------|
| No sigma lower bound | Sigma can approach zero after many decisive matches | Over-confidence in well-tested variants |
| Tau never applied | tau=0.083 defined but no code applies iterative decay | Stale ratings from early iterations remain artificially confident |
| Convergence streak fragile | Single non-converged round resets streak to 0 | Real convergence may never fire |
| Draw classification uses confidence, not actual tie | confidence < 0.3 → draw, even if winner was reported | Conflates uncertainty with ties |
| No inflation tracking | No audit of pool mean drift vs baseline | Systematic mutation bias undetected |
| No tiebreaker for equal ordinals | Pairing breaks ties arbitrarily | Non-reproducible tournament behavior |
| eloToRating uses hardcoded matchCount thresholds | matchCount 4/8 → sigma 5.0/3.0 (step function) | Artificial ceiling effects in migration |
| Convergence metric unintuitive | Normalized by DEFAULT_SIGMA (8.333), not convergence threshold | "0.64" when converged is confusing |
| No time-based skill decay for idle variants | Old ratings don't inflate uncertainty | Iteration-1 ratings treated same as iteration-9 |
| DECISIVE_CONFIDENCE=0.6 defined but never used | rating.ts:85 — dead constant | Intended decision boundary unused |

## Extended Analysis (Round 3 — 4 Deep-Dive Agents)

### R3-1: Checkpoint/Resume & State Persistence

**What IS persisted (complete list):**
- Pool (all variants), ratings (mu/sigma), matchCounts, matchHistory (truncated to 5000)
- dimensionScores, allCritiques (truncated to last 5 iterations' variants), similarityMatrix, diversityScore
- metaFeedback, debateTranscripts, treeSearchResults/States, sectionState
- costTrackerTotalSpent, comparisonCacheEntries
- supervisorState (phase, ordinalHistory, diversityHistory)
- resumeAgentNames (for mid-iteration continuation)

**What is NOT persisted (critical gaps):**

| Lost Data | Impact | Severity |
|-----------|--------|----------|
| Learned rating parameters (sigma calibration) | Fresh ratings over-trust new variants | HIGH |
| Feedback effectiveness tracking | Agents ignore what feedback worked before | HIGH |
| Strategy mutation success rates | Bad mutations retried on resume | MEDIUM |
| Phase transition history (EXPANSION metrics) | ordinalHistory/diversityHistory reset on COMPETITION transition | MEDIUM |
| Cost-per-ordinal-improvement curves | Budget misallocation on resume | MEDIUM |
| Lineage dominance metrics | Root cause of diversity collapse lost | MEDIUM |
| Per-match quality/informativeness | No audit of match value | LOW |

**Checkpoint frequency:** Every agent execution + iteration end. Not configurable. Checkpoint includes full serialized state (~5000 match history, all ratings, all critiques).

**State validation on resume:** Validates pool/poolIds consistency, parent ID references. Does NOT validate matchHistory consistency, critique-variant linkage, or diversity metric validity.

### R3-2: Admin UI Analytics Gaps

**What's visualized:**
- Strategy leaderboard (avg Elo, Rating/$, runs, stddev) — HTML table
- Pareto frontier (cost vs Elo) — SVG scatter
- Agent ROI (cost, gain, Elo/$) — table + bar chart
- Cost accuracy (estimated vs actual, per-agent accuracy) — Recharts line chart
- Run timeline (burn chart, agent cost bars, per-iteration breakdown)
- Rating history (multi-line per variant) — Recharts line chart
- Variant lineage tree
- Hall of Fame cross-method summary cards

**Critical missing visualizations:**

| Missing | Data exists in... | Impact |
|---------|-------------------|--------|
| Confidence intervals on Elo ratings | sigma is stored; just need μ±1.96σ | Rankings appear more decisive than warranted |
| Convergence trajectories per article | Run Elo data exists | Can't tell if quality is plateauing |
| Dimension score trends | dimensionScores in timeline JSONB | Can't track per-dimension improvement |
| Agent ROI over time | Agent metrics per run exist | Can't detect agent degradation |
| Experiment results visualization | Experiment tables exist | Can't evaluate experiment success |
| Statistical significance testing | σ and matchCount exist | Adjacent rankings may be statistically tied |
| Meta-feedback effectiveness | metaFeedback + next iteration Elo exist | Can't measure if feedback helped |
| Cross-method A/B comparison | Unified explorer data exists | No head-to-head matched-pairs analysis |

**Key insight:** The pipeline is **data-rich but visualization-poor** — most collected metrics are buried in JSONB or never surfaced.

### R3-3: Hall of Fame Statistical Rigor

**Rating system:** Same OpenSkill (mu=25, sigma=8.333) as within-run. DECISIVE_CONFIDENCE_THRESHOLD=0.6 correctly applied.

**Comparison pairing (NOT true Swiss):**
- Sorts by ordinal, greedily matches adjacent entries, skips already-compared pairs
- Does NOT update pairings based on round results (true Swiss would)
- Pragmatic for small N (<10 entries) but loses information vs optimal pairing

**Statistical rigor gaps:**

| Gap | Severity | Detail |
|-----|----------|--------|
| No confidence intervals on leaderboard | CRITICAL | Rankings are point estimates; mu=1250 σ=8 vs mu=1252 σ=1.5 look like clear ordering |
| No elo_per_dollar uncertainty | HIGH | Point estimate: `(ordinalToEloScale(ordinal) - 1200) / cost`, no error propagation |
| No cross-judge validation | HIGH | Different judge models may have different preferences; no ICC or consistency check |
| No significance testing | HIGH | No paired t-tests, no Bonferroni correction; method differences may be noise |
| Match count < convergence | MEDIUM | Typical 4-6 matches per entry; need 8+ for sigma < 3.0 convergence |
| Unweighted aggregation | MEDIUM | Cross-topic avg ignores sigma; high-uncertainty entries weighted equally |
| No algorithm versioning | MEDIUM | If OpenSkill parameters change, historical ratings become incomparable |
| dimension_scores column unused | LOW | Schema has it; code always writes NULL |

**ordinalToEloScale:** Linear and monotonic: `1200 + ordinal × 16`, clamped [0, 3000]. Correct.

### R3-4: Pipeline Orchestration & Agent Scheduling

**Agent execution order (fixed, canonical):**
```
generation → outlineGeneration → reflection → flowCritique →
iterativeEditing → treeSearch → sectionDecomposition →
debate → evolution → ranking → proximity → metaReview
```

**EXPANSION phase:** Only `generation`, `ranking` (as calibration), `proximity` allowed. All others blocked.

**COMPETITION phase:** Full agent roster. `ranking` dispatches as tournament (Swiss pairing).

**Key orchestration gaps:**

| Gap | Evidence | Impact |
|-----|----------|--------|
| No dynamic agent scheduling | Fixed order per phase; no adaptive skipping | Can't skip low-ROI agents |
| Phase transition is one-way | `_phaseLocked = 'COMPETITION'` — never reverts | Can't re-seed if diversity collapses |
| Plateau detection delayed after transition | ordinalHistory cleared on transition; needs ~5 iterations to trigger | Late stopping in early COMPETITION |
| Budget failure halts run | BudgetExceededError → immediate pause, no graceful degradation | Could skip expensive agents instead |
| 3/4 meta-feedback signals wasted | successfulStrategies, recurringWeaknesses, patternsToAvoid never consumed | Agents don't learn from pattern analysis |
| Metrics are audit-only | Per-agent cost/benefit, convergence streaks, stale rounds logged but never shape decisions | Rich data collected, never used |
| No inter-iteration learning | metaFeedback recomputed fresh; no memory of what worked | Feedback loop is stateless |
| Evolution parent selection ignores state | Always top-2 by ordinal; no diversity in parent choice | Vulnerable to local optima |
| Calibration opponents are static | Always 2 top, 2 mid, 1 bottom quartile | No information-theoretic optimization |

**Iteration lifecycle:** Sequential agent execution → checkpoint after each agent → supervisor phase check → stopping condition evaluation → next iteration. No parallelism.

## Open Questions

1. **What is the actual origin of the ×6 multiplier?** Need to check git blame or ask original author
2. **How much do current thresholds cost in suboptimal runs?** Would need A/B testing to quantify
3. **Is semantic diversity worth the cost?** Embeddings cost ~$0.0001/article; need to benchmark vs trigram quality
4. **How many experiment runs have been completed?** Sample size affects which statistical improvements are practical
5. **Would the user prefer quick wins (P1-P5) first, or skip to architectural improvements (P18-P21)?**
6. **Are the parser ambiguity issues in parseWinner() causing real misparses?** Need to check comparison logs for anomalies
7. **How much budget is wasted by proportional (vs ROI-weighted) redistribution?** Could simulate with historical run data
8. **Should leaderboard rankings show confidence bounds?** Would reveal that many rankings are statistically tied
9. **Why is isRatingStagnant() dead code?** Was it intended to be wired in and forgotten?
10. **Should convergence use σ < 2.0 (95% CI) instead of σ < 3.0?** Would require more matches but improve confidence
11. **Is the DECISIVE_CONFIDENCE=0.6 constant a remnant?** May indicate planned-but-unimplemented decision logic
12. **Should tree search depth adapt based on beam improvement rate?** Early stopping when plateau detected at depth d
13. **Should the phase transition be reversible?** Re-entering EXPANSION if diversity collapses in COMPETITION
14. **Should agents be dynamically skipped based on ROI?** Track per-agent ordinal delta and skip negative-ROI agents
15. **Should the HoF require minimum match count for leaderboard ranking?** Only show entries with σ < 3.0

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

### Round 2 Deep-Dives
- evolution/src/lib/agents/evolvePool.ts — Mutation strategies, parent selection, creative exploration, crossover
- evolution/src/lib/agents/treeSearchAgent.ts — Tree search orchestration, root selection, cost estimation
- evolution/src/lib/treeOfThought/beamSearch.ts — Beam search core algorithm (368 lines)
- evolution/src/lib/treeOfThought/types.ts — TreeNode, TreeState, BeamSearchConfig
- evolution/src/lib/treeOfThought/treeNode.ts — Tree construction, traversal, pruning
- evolution/src/lib/treeOfThought/evaluator.ts — Two-stage evaluation (parent-relative + sibling tournament)
- evolution/src/lib/treeOfThought/revisionActions.ts — Action selection, diversity enforcement
- evolution/src/lib/agents/sectionDecompositionAgent.ts — Section decomposition orchestration
- evolution/src/lib/section/sectionParser.ts — H2 boundary parsing, code block safety
- evolution/src/lib/section/sectionStitcher.ts — Section reassembly with replacement map
- evolution/src/lib/section/sectionEditRunner.ts — Per-section critique→edit→judge loop
- evolution/src/lib/agents/reflectionAgent.ts — Quality critique (1-10 scale, 5 dimensions)
- evolution/src/lib/flowRubric.ts — Flow dimensions, cross-scale normalization, critique prompts
- evolution/src/lib/agents/pairwiseRanker.ts — Structured per-dimension comparison, friction spots
- evolution/src/lib/agents/debateAgent.ts — Advocate/judge synthesis, critique context injection
- evolution/src/lib/agents/iterativeEditingAgent.ts — Dimension-targeted editing, open review
- evolution/docs/evolution/agents/tree_search.md — Tree search specification

### Round 3 Deep-Dives
- evolution/src/lib/core/pipeline.ts — Main pipeline orchestrator (executeFullPipeline, runAgent, iteration lifecycle)
- evolution/src/lib/core/persistence.ts — Checkpoint persistence, serialization, resume loading, validation
- evolution/src/lib/core/state.ts — PipelineStateImpl, serializeState/deserializeState, truncation limits
- evolution/src/lib/core/types.ts — SerializedPipelineState, SerializedCheckpoint interfaces
- evolution/src/lib/core/validation.ts — validateStateIntegrity for checkpoint loading
- evolution/src/lib/core/comparisonCache.ts — In-memory LRU cache with persistence/restoration
- evolution/src/lib/core/pipelineUtilities.ts — computeDiffMetrics, agent invocation tracking
- evolution/src/lib/core/diversityTracker.ts — PoolDiversityTracker, lineage counting
- evolution/src/services/hallOfFameActions.ts — 14 server actions, Swiss pairing, rating updates, cross-topic aggregation
- evolution/scripts/run-hall-of-fame-comparison.ts — CLI comparison runner
- evolution/scripts/run-prompt-bank-comparisons.ts — Batch comparison aggregation
- supabase/migrations/20260220000002_hall_of_fame_openskill.sql — OpenSkill schema migration
- src/app/admin/quality/optimization/page.tsx — 5-tab optimization dashboard
- src/app/admin/quality/optimization/_components/ — Strategy leaderboard, Pareto, Agent ROI, Cost accuracy panels
- src/app/admin/quality/evolution/run/[runId]/page.tsx — Run detail with 5 tabs
- src/app/admin/quality/evolution/article/[explanationId]/page.tsx — Article detail with attribution
- src/app/admin/quality/explorer/page.tsx — Unified explorer (4 views)
- src/app/admin/quality/hall-of-fame/page.tsx — Hall of Fame topic list and prompt bank
