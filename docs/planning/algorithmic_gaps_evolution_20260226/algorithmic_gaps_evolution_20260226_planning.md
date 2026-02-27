# Algorithmic Gaps Evolution Plan

## Background
Research the analytics framework in place for experimenting, analyzing, and proposing improvements to the evolution pipeline for improving Elo of written content. Identify gaps and opportunities for improvement to make the system algorithmically robust.

## Requirements (from GH Issue #NNN)
- Research the analytics framework for experimenting, analyzing & proposing improvements to the evolution pipeline for improving elo of written content
- Look for gaps and opportunities in improvement
- System should be algorithmically robust

## Problem

The evolution pipeline is data-rich but algorithmically under-leveraging its own signals. Research across 80+ code files identified 42 concrete improvement proposals spanning 8 gap categories. The most critical issues are: (1) **75% of meta-review feedback is generated but never consumed** — only `priorityImprovements` is used while 3 other signal types are discarded; (2) **no confidence intervals anywhere** — experiment effects, strategy rankings, and Hall of Fame leaderboards are all point estimates with no uncertainty quantification; (3) **25+ hardcoded thresholds that never adapt** — including unexplained magic constants (×6, ÷10, ÷16) controlling critical stopping and pairing decisions; and (4) **dead code and disconnected signals** — `isRatingStagnant()` is never called, friction spots are never read, dimension scores don't influence ratings.

## Options Considered

### Option A: Quick Wins Only (P1-P9)
- **Scope:** 9 proposals, ~1-2 days total
- **Pros:** Immediate value, no architectural risk, each change independently testable
- **Cons:** Leaves statistical rigor, diversity measurement, and architectural rigidity untouched
- **Risk:** Low

### Option B: Quick Wins + Statistical Foundations (P1-P16)
- **Scope:** 16 proposals across Tiers 1-2, ~1-2 weeks
- **Pros:** Addresses the two highest-severity gaps (wasted signals + statistical rigor), provides principled replacements for magic constants
- **Cons:** Doesn't address diversity measurement or cross-run learning
- **Risk:** Medium (bootstrap CIs add computation; need to verify latency impact)

### Option C: Full Tier 1-3 Implementation (P1-P35) ← Recommended
- **Scope:** 35 proposals across 3 tiers, ~4-6 weeks in 6 phases
- **Pros:** Comprehensive robustness improvement — statistical rigor, signal utilization, diversity, quality measurement all addressed. Each phase is independently valuable.
- **Cons:** Significant total effort; later phases may need design iteration
- **Risk:** Medium-high (semantic embeddings and self-reflection loops need careful cost/benefit)

### Option D: Full Implementation Including Architectural (P1-P42)
- **Scope:** All 42 proposals, ~10-14 weeks
- **Pros:** Transformative — adaptive thresholds, cross-run learning, dynamic scheduling
- **Cons:** Architectural changes (multi-armed bandit, Bayesian experiment design) require extensive testing and may need fundamental pipeline restructuring
- **Risk:** High (scope creep, interaction effects between changes)

## Phased Execution Plan

### Phase 1: Quick Wins & Dead Code Activation (~1 day)

**Goal:** Immediate algorithmic improvements with minimal risk. Each change is 1-30 minutes.

#### P1: Use all 4 meta-feedback types in prompts
**Files modified:**
- `evolution/src/lib/agents/generationAgent.ts` (lines 69-71)
- `evolution/src/lib/agents/evolutionAgent.ts` (lines 196-199)

```typescript
// BEFORE (generationAgent.ts:69-71):
const feedbackContext = metaFeedback?.priorityImprovements?.join('\n') || '';

// AFTER:
const feedbackSections = [
  metaFeedback?.priorityImprovements?.length
    ? `Priority improvements:\n${metaFeedback.priorityImprovements.join('\n')}`
    : '',
  metaFeedback?.recurringWeaknesses?.length
    ? `Recurring weaknesses to address:\n${metaFeedback.recurringWeaknesses.join('\n')}`
    : '',
  metaFeedback?.successfulStrategies?.length
    ? `Successful strategies to continue:\n${metaFeedback.successfulStrategies.join('\n')}`
    : '',
  metaFeedback?.patternsToAvoid?.length
    ? `Patterns to avoid:\n${metaFeedback.patternsToAvoid.join('\n')}`
    : '',
].filter(Boolean).join('\n\n');
```

#### P2: Increase calibration minOpponents to 3
**Files modified:** `evolution/src/lib/core/config.ts` (line 17)
```typescript
// Change minOpponents default from 2 to 3
minOpponents: 3, // Reduces false-positive early exits from 4% → 0.1%
```

#### P3: Parametrize ×6 plateau multiplier
**Files modified:**
- `evolution/src/lib/core/config.ts` — add `plateauMultiplier: 6` to config
- `evolution/src/lib/core/supervisor.ts` (line 265) — replace hardcoded `6` with `this.cfg.plateauMultiplier`

#### P4: Check degenerate state independently
**Files modified:** `evolution/src/lib/core/supervisor.ts` — extract diversity < 0.01 check from `_isPlateaued()` into `shouldStop()` as independent condition

#### P5: Cap history arrays at 50 entries
**Files modified:** `evolution/src/lib/core/supervisor.ts` — add `MAX_HISTORY_LENGTH = 50` and slice in `recordIteration()`

#### P6: Wire isRatingStagnant() into creative exploration
**Files modified:** `evolution/src/lib/agents/evolvePool.ts` (lines 275-324) — call `isRatingStagnant()` alongside the existing `CREATIVE_RANDOM_CHANCE` and `CREATIVE_DIVERSITY_THRESHOLD` triggers

#### P7: Add sigma floor
**Files modified:** `evolution/src/lib/core/rating.ts`
```typescript
const MIN_SIGMA = 1.0;
// After each update:
rating.sigma = Math.max(rating.sigma, MIN_SIGMA);
```

#### P8: Normalize cross-scale thresholds
**Files modified:** `evolution/src/lib/agents/iterativeEditingAgent.ts` (line 252)
- Use `flowRubric.normalizeScore()` to convert flow 0-5 scale to match quality 1-10 scale before comparison

#### P9: Add CIs to Hall of Fame leaderboard
**Files modified:** `evolution/src/services/hallOfFameActions.ts` (lines 307-325)
- Add `ci_lower: mu - 1.96 * sigma` and `ci_upper: mu + 1.96 * sigma` to leaderboard query output
- Display in admin UI: `src/app/admin/quality/hall-of-fame/page.tsx`

**Tests for Phase 1:**
- `evolution/src/lib/agents/generationAgent.test.ts` — verify all 4 feedback types appear in prompt
- `evolution/src/lib/agents/evolutionAgent.test.ts` — verify all 4 feedback types appear in prompt
- `evolution/src/lib/core/supervisor.test.ts` — test degenerate check fires independently, history capping, parametrized multiplier
- `evolution/src/lib/agents/evolvePool.test.ts` — test stagnation-triggered creative exploration
- `evolution/src/lib/core/rating.test.ts` — test sigma floor enforcement
- `evolution/src/services/hallOfFameActions.test.ts` — test CI computation in leaderboard

---

### Phase 2: Statistical Foundations (~3-4 days)

**Goal:** Add confidence intervals and significance testing to experiment analysis engine.

#### P10: Bootstrap confidence intervals on experiment main effects
**Files modified:** `evolution/src/experiments/evolution/analysis.ts`

```typescript
function bootstrapCI(data: number[], nBootstrap = 1000, alpha = 0.05): { lower: number; upper: number } {
  const samples = Array.from({ length: nBootstrap }, () => {
    const resample = Array.from({ length: data.length }, () =>
      data[Math.floor(Math.random() * data.length)]
    );
    return mean(resample);
  });
  samples.sort((a, b) => a - b);
  return {
    lower: samples[Math.floor(alpha / 2 * nBootstrap)],
    upper: samples[Math.floor((1 - alpha / 2) * nBootstrap)],
  };
}
```
- Add `ci_lower`, `ci_upper` fields to `FactorEffect` interface
- Compute CIs per factor in `analyzeExperimentRound()`

#### P14: Convergence detection using CI lower bounds
**Files modified:** `src/app/api/cron/experiment-driver/route.ts` (lines 260-264)
```typescript
// BEFORE: topEffect < convergenceThreshold
// AFTER: topEffect.ci_upper < convergenceThreshold
// Only converge when we're confident the effect is small
```

#### P15: Effect size standardization (Cohen's d)
**Files modified:** `evolution/src/experiments/evolution/analysis.ts`
```typescript
// Add to factor ranking output:
cohensD: effect / pooledStdDev, // Standardized effect size
```

#### P26: Bonferroni correction for multiple comparisons
**Files modified:** `evolution/src/experiments/evolution/analysis.ts`
- Apply Bonferroni-adjusted significance level: `alpha_adjusted = 0.05 / numFactors`
- Flag non-significant effects in output

**Tests for Phase 2:**
- `evolution/src/experiments/evolution/analysis.test.ts` — bootstrap CI coverage test (simulate known effect, verify CI contains true value 95% of time); Cohen's d correctness; Bonferroni correction with known p-values
- Manual verification: run experiment analysis on existing data, compare before/after output

---

### Phase 3: Rating & Tournament Improvements (~3-4 days)

**Goal:** Replace ad-hoc scoring constants with principled formulas; fix rating system bugs.

#### P11: Replace ÷10 pairing score with OpenSkill logistic CDF
**Files modified:** `evolution/src/lib/agents/tournament.ts` (line 118)
```typescript
// BEFORE:
const outcomeUncertainty = 1 / (1 + ordGap / 10);

// AFTER: OpenSkill logistic CDF — probability that outcome is uncertain
const BETA = 4.166; // OpenSkill default: sigma_init / 2
const outcomeUncertainty = 1 / (1 + Math.exp(Math.abs(muA - muB) / BETA));
```

#### P12: Budget-aware calibration thresholds
**Files modified:** `evolution/src/lib/agents/calibrationRanker.ts` (lines 183-205)
```typescript
// Scale confidence thresholds by budget pressure
const budgetPressure = costTracker.budgetUsedRatio();
const minConfidence = budgetPressure > 0.8 ? 0.6 : 0.7; // Lenient when tight
const avgConfidence = budgetPressure > 0.8 ? 0.7 : 0.8;
```

#### P13: Multi-signal plateau detection
**Files modified:** `evolution/src/lib/core/supervisor.ts`
- Replace endpoint comparison with linear regression on `ordinalHistory`
- Add diversity trend (slope of `diversityHistory`) as second signal
- Add sigma trend (average pool sigma over window) as third signal
- Plateau = all 3 signals stagnant

#### P16: Convergence streak with 90% threshold
**Files modified:** `evolution/src/lib/agents/tournament.ts` (line 390)
```typescript
// BEFORE: all variants must be converged (100%)
// AFTER: 90% converged to handle outlier variants
const convergedRatio = convergedCount / totalVariants;
const isConverged = convergedRatio >= 0.9;
```

#### P21: Fix draw classification
**Files modified:**
- `evolution/src/lib/agents/tournament.ts` — use actual TIE verdict from comparison, not `confidence < 0.3`
- `evolution/src/services/hallOfFameActions.ts` — same fix for HoF comparisons

#### P22: Preserve ordinalHistory on phase transition
**Files modified:** `evolution/src/lib/core/supervisor.ts` (lines 159-160)
```typescript
// BEFORE: this.ordinalHistory = []; this.diversityHistory = [];
// AFTER: keep history, just mark the transition point
this.phaseTransitionIndex = this.ordinalHistory.length;
```

**Tests for Phase 3:**
- `evolution/src/lib/agents/tournament.test.ts` — verify logistic CDF pairing produces same ranking as ad-hoc for large gaps, better information gain for close matchups; convergence at 90%; draw classification using actual verdict
- `evolution/src/lib/agents/calibrationRanker.test.ts` — budget-aware threshold tests at 0.5, 0.8, 0.95 budget pressure
- `evolution/src/lib/core/supervisor.test.ts` — multi-signal plateau with mocked history (ordinal flat + diversity flat = plateau; ordinal flat + diversity improving ≠ plateau); history preservation across phase transition

---

### Phase 4: Signal Utilization (~1-2 weeks)

**Goal:** Connect unused data signals to decision-making; add graceful degradation.

#### P17: ROI-weighted budget redistribution
**Files modified:** `evolution/src/lib/core/budgetRedistribution.ts` (line 110)
```typescript
// BEFORE: proportional scaling
// AFTER: weight by Elo delta per dollar from recent iterations
const agentROI = recentIterations.map(iter => iter.eloDelta / iter.cost);
const roiWeight = mean(agentROI) || 1; // Fallback to equal weight
```

#### P18: Feed friction spots to editing agents
**Files modified:**
- `evolution/src/lib/agents/iterativeEditingAgent.ts` — accept frictionSpots in prompt context
- `evolution/src/lib/agents/treeSearchAgent.ts` — pass frictionSpots to revision actions
- `evolution/src/lib/agents/pairwiseRanker.ts` — expose frictionSpots in Match output (already stored)

#### P19: CI visualization on Elo history chart
**Files modified:**
- `src/app/admin/quality/evolution/run/[runId]/_components/EloTab.tsx` — add sigma bands (μ±1.96σ) as shaded areas
- `evolution/src/services/evolutionVisualizationActions.ts` — include sigma in rating history query

#### P20: Graceful budget degradation
**Files modified:**
- `evolution/src/lib/core/pipeline.ts` — catch `BudgetExceededError`, skip agent, continue with remaining agents
- `evolution/src/lib/core/costTracker.ts` — add `canAffordAgent(agentName): boolean` pre-check
- Order agents by cost (cheapest first) when budget is tight

#### P24: Track meta-feedback effectiveness
**Files modified:**
- `evolution/src/lib/agents/metaReviewAgent.ts` — store feedback hash + iteration number
- `evolution/src/lib/core/pipeline.ts` — after iteration, compute Elo delta and associate with feedback that was active
- New field in checkpoint: `feedbackEffectiveness: Map<string, number>`

#### P25: Track pairing informativeness
**Files modified:** `evolution/src/lib/agents/tournament.ts`
- After each match, record `expectedInfoGain` (pre) vs `actualInfoGain` (sigma reduction post-match)
- Log to metrics for analysis

**Tests for Phase 4:**
- `evolution/src/lib/core/budgetRedistribution.test.ts` — ROI-weighted allocation gives more to high-ROI agents; graceful fallback when no ROI data
- `evolution/src/lib/core/pipeline.test.ts` — budget exceeded skips agent, continues run; feedback effectiveness tracking persists across checkpoint
- `evolution/src/lib/agents/tournament.test.ts` — pairing informativeness tracked
- Manual verification: run evolution with CI visualization enabled, verify sigma bands render correctly

---

### Phase 5: Advanced Algorithms (~2-3 weeks)

**Goal:** Improved diversity measurement, smarter agent algorithms, better quality evaluation.

#### P23: Semantic diversity scoring via embeddings
**Files modified:**
- `evolution/src/lib/agents/proximityAgent.ts` — add semantic embedding path using existing Pinecone integration
- Fall back to trigram when embeddings unavailable
- Blend: `diversity = 0.7 * semantic + 0.3 * lexical`

#### P27: Pool-wide diversity (Shannon entropy)
**Files modified:** `evolution/src/lib/agents/proximityAgent.ts`
```typescript
// Replace top-10 pairwise with full pool Shannon entropy
function shannonDiversity(similarities: number[][]): number {
  // Cluster variants, compute entropy of cluster distribution
}
```

#### P28: Fitness-proportionate parent selection
**Files modified:** `evolution/src/lib/agents/evolvePool.ts` (lines 108-112)
```typescript
// BEFORE: always top-2 by ordinal
// AFTER: tournament selection — random K, pick best
function tournamentSelect(pool: Variant[], k = 3): Variant {
  const candidates = sampleWithoutReplacement(pool, k);
  return candidates.reduce((best, v) => v.ordinal > best.ordinal ? v : best);
}
```

#### P29: Adaptive tree search depth
**Files modified:** `evolution/src/lib/treeOfThought/beamSearch.ts` (line 42)
- Track beam improvement per depth level
- Early-stop when improvement < threshold for 2 consecutive depths

#### P30: Per-section weakness targeting
**Files modified:** `evolution/src/lib/agents/sectionDecompositionAgent.ts` (line 66)
- Critique each section individually instead of using global weakest dimension
- Each section targets its own worst dimension

#### P31: Post-edit self-reflection
**Files modified:**
- `evolution/src/lib/agents/iterativeEditingAgent.ts` — after edit, re-critique and verify target dimension improved
- `evolution/src/lib/agents/evolvePool.ts` — reject variants where target dimension regressed

#### P32: Cross-judge validation for Hall of Fame
**Files modified:**
- `evolution/src/services/hallOfFameActions.ts` — re-compare 10-20% of pairs with different judge model
- Compute inter-rater reliability (Cohen's kappa)

#### P33-P35: Visualization improvements
**Files modified:**
- New component for convergence trajectory per article
- `evolution/src/services/evolutionVisualizationActions.ts` — add dimension score trend query
- `evolution/src/services/costAnalyticsActions.ts` — add cost estimation feedback loop

**Tests for Phase 5:**
- `evolution/src/lib/agents/proximityAgent.test.ts` — semantic vs trigram diversity scores for known-similar/different texts; Shannon entropy for uniform vs skewed pools
- `evolution/src/lib/agents/evolvePool.test.ts` — tournament selection produces more diverse parents than top-2; stagnation detection triggers correctly
- `evolution/src/lib/treeOfThought/beamSearch.test.ts` — early stopping when improvement plateaus
- `evolution/src/lib/agents/sectionDecompositionAgent.test.ts` — per-section weakness targeting
- `evolution/src/services/hallOfFameActions.test.ts` — cross-judge validation and kappa computation
- Manual verification: run full evolution pipeline with new algorithms on staging, compare Elo outcomes before/after

---

### Phase 6: Architectural Improvements (~4-6 weeks, future)

**Goal:** Transformative changes requiring pipeline restructuring. Each is a standalone project.

#### P36: Multi-armed bandit for agent selection
- Thompson Sampling over agent selection using accumulated ROI data
- Replace fixed agent order with dynamic selection per iteration
- **Files:** `evolution/src/lib/core/supervisor.ts`, `evolution/src/lib/core/budgetRedistribution.ts`

#### P37: Cross-run learning
- Prompt difficulty priors from historical run outcomes
- Agent effectiveness priors per domain/difficulty
- Warm-start ratings from prior runs on similar prompts
- **Files:** New module `evolution/src/lib/core/crossRunLearning.ts`

#### P40: Reversible phase transition
- Allow COMPETITION → EXPANSION revert when diversity drops below crisis threshold
- Re-seed with fresh generation if revert triggers
- **Files:** `evolution/src/lib/core/supervisor.ts`

#### P41: Dynamic agent scheduling
- Skip agents with negative ROI in recent iterations
- Reorder agents to prioritize high-ROI when budget is tight
- **Files:** `evolution/src/lib/core/supervisor.ts`, `evolution/src/lib/core/pipeline.ts`

#### P38, P39, P42: Research-stage proposals
- P38: Bayesian experiment design (info gain optimization)
- P39: Adaptive threshold tuning from historical outcomes
- P42: Hierarchical Bayesian aggregation for Hall of Fame
- These require further design before implementation

**Tests for Phase 6:**
- Full integration tests with multi-run scenarios
- A/B testing framework to compare old vs new pipeline on same prompts
- Performance benchmarks (latency, cost) before/after

## Testing

### Unit Tests (per phase)
| Phase | New/Modified Tests | Coverage Target |
|-------|-------------------|-----------------|
| 1 | generationAgent.test.ts, evolutionAgent.test.ts, supervisor.test.ts, evolvePool.test.ts, rating.test.ts, hallOfFameActions.test.ts | All 9 proposals have at least 1 test |
| 2 | analysis.test.ts (bootstrap CI, Cohen's d, Bonferroni) | CI coverage validation, effect size correctness |
| 3 | tournament.test.ts, calibrationRanker.test.ts, supervisor.test.ts | Logistic CDF pairing, budget-aware thresholds, multi-signal plateau |
| 4 | budgetRedistribution.test.ts, pipeline.test.ts, tournament.test.ts | ROI allocation, graceful degradation, informativeness |
| 5 | proximityAgent.test.ts, evolvePool.test.ts, beamSearch.test.ts, sectionDecompositionAgent.test.ts, hallOfFameActions.test.ts | Semantic diversity, tournament selection, adaptive depth, cross-judge |
| 6 | Integration tests, A/B comparison tests | Full pipeline regression |

### Integration Tests
- Run full evolution pipeline on a test prompt after each phase
- Verify checkpoint/resume works with new fields
- Verify admin UI renders new data (CIs, dimension trends, etc.)

### Manual Verification on Staging
- Phase 1: Run evolution, verify all 4 feedback types appear in LLM prompts
- Phase 2: Run experiment, verify CIs appear in analysis output
- Phase 3: Run tournament, verify logistic CDF produces reasonable pairings
- Phase 4: Run evolution with tight budget, verify graceful degradation (agents skipped, not crashed)
- Phase 5: Run evolution, verify semantic diversity scores differ from trigram scores
- Phase 6: Run multi-prompt batch, verify cross-run learning improves starting configs

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/rating_and_comparison.md` - Rating algorithms and comparison methods
- `evolution/docs/evolution/architecture.md` - Pipeline architecture and phase transitions
- `evolution/docs/evolution/data_model.md` - Core primitives and dimensional queries
- `evolution/docs/evolution/agents/overview.md` - Agent framework and execution model
- `docs/feature_deep_dives/article_detail_view.md` - Elo attribution and article views
- `evolution/docs/evolution/hall_of_fame.md` - Cross-run comparison system
- `docs/docs_overall/white_paper.md` - Product philosophy
- `docs/feature_deep_dives/search_generation_pipeline.md` - Search and generation pipeline
