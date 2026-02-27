# Algorithmic Gaps Evolution Plan

## Background
Research the analytics framework in place for experimenting, analyzing, and proposing improvements to the evolution pipeline for improving Elo of written content. Identify gaps and opportunities for improvement to make the system algorithmically robust.

## Requirements (from GH Issue #583)
- Research the analytics framework for experimenting, analyzing & proposing improvements to the evolution pipeline for improving elo of written content
- Look for gaps and opportunities in improvement
- System should be algorithmically robust

## Problem

The evolution pipeline is data-rich but algorithmically under-leveraging its own signals. Research across 80+ code files identified 42 concrete improvement proposals spanning 8 gap categories. The most critical issues are: (1) **75% of meta-review feedback is generated but never consumed** — only `priorityImprovements` is used while 3 other signal types are discarded; (2) **no confidence intervals anywhere** — experiment effects, strategy rankings, and Hall of Fame leaderboards are all point estimates with no uncertainty quantification; (3) **25+ hardcoded thresholds that never adapt** — including unexplained magic constants (×6, ÷10, ÷16) controlling critical stopping and pairing decisions; and (4) **dead code and disconnected signals** — `isRatingStagnant()` is never called, friction spots are never read, dimension scores don't influence ratings.

## Scope

**5 highest-impact improvements**, selected from 42 research proposals:

1. **Use all 4 meta-feedback types in prompts** — 75% of generated feedback is wasted
2. **Add confidence intervals to all rankings** — experiment effects, HoF leaderboard, Elo history are all point estimates
3. **Replace ad-hoc ÷10 pairing with OpenSkill logistic CDF** — principled information gain per match
4. **Feed friction spots to editing agents** — comparison generates passage-level quality data that nothing reads
5. **Semantic diversity scoring via embeddings** — current trigram hashing has ~65% collision rate

All other proposals are documented in the Appendix for future work.

## Phased Execution Plan

### Phase 1: Wire All Meta-Feedback Into Prompts

**Problem:** MetaFeedback has 4 fields but only `priorityImprovements` is consumed. `recurringWeaknesses`, `successfulStrategies`, and `patternsToAvoid` are generated, serialized to checkpoints, displayed in admin UI, but **never injected into any prompt**.

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

Same pattern applied to `evolutionAgent.ts`.

**Tests:**
- `evolution/src/lib/agents/generationAgent.test.ts` — verify all 4 feedback types appear in prompt when present; verify graceful handling when fields are empty/undefined
- `evolution/src/lib/agents/evolutionAgent.test.ts` — same coverage

---

### Phase 2: Confidence Intervals Everywhere

**Problem:** No confidence intervals anywhere in the system. Experiment effects, strategy leaderboard, Hall of Fame rankings, and Elo history are all point estimates. Rankings appear more decisive than the data supports.

#### 2a: Bootstrap CIs on experiment main effects
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

#### 2b: Convergence detection using CI upper bounds
**Files modified:** `src/app/api/cron/experiment-driver/route.ts` (lines 260-264)
```typescript
// BEFORE: topEffect < convergenceThreshold
// AFTER: topEffect.ci_upper < convergenceThreshold
// Only converge when we're confident the effect is small
```

#### 2c: CIs on Hall of Fame leaderboard
**Files modified:**
- `evolution/src/services/hallOfFameActions.ts` (lines 307-325) — add `ci_lower: mu - 1.96 * sigma` and `ci_upper: mu + 1.96 * sigma` to leaderboard output
- `src/app/admin/quality/hall-of-fame/page.tsx` — display CI range next to each ranking

#### 2d: CI visualization on Elo history chart
**Files modified:**
- `src/app/admin/quality/evolution/run/[runId]/_components/EloTab.tsx` — add sigma bands (μ±1.96σ) as shaded areas on rating trajectories
- `evolution/src/services/evolutionVisualizationActions.ts` — include sigma in rating history query

**Tests:**
- `evolution/src/experiments/evolution/analysis.test.ts` — bootstrap CI coverage (simulate known effect, verify CI contains true value ~95% of time); verify CIs narrow with more data
- `evolution/src/services/hallOfFameActions.test.ts` — test CI computation; verify entries with overlapping CIs are flagged as statistically tied
- Manual: run experiment analysis on existing data, confirm CIs appear; check HoF leaderboard shows ranges; check Elo chart shows sigma bands

---

### Phase 3: Replace Ad-Hoc Pairing With OpenSkill Logistic CDF

**Problem:** Tournament pairing uses `1/(1 + ordGap/10)` — an ad-hoc formula where the ÷10 has no theoretical basis. OpenSkill's logistic CDF provides the mathematically correct probability of outcome uncertainty.

**Files modified:** `evolution/src/lib/agents/tournament.ts` (line 118)

```typescript
// BEFORE:
const outcomeUncertainty = 1 / (1 + ordGap / 10);
const sigmaWeight = (sigmaA + sigmaB) / 2;
const score = outcomeUncertainty * sigmaWeight;

// AFTER: OpenSkill logistic CDF — probability that outcome is uncertain
const BETA = 4.166; // OpenSkill default: sigma_init / 2
const winProbability = 1 / (1 + Math.exp(-(muA - muB) / BETA));
const outcomeUncertainty = 1 - Math.abs(2 * winProbability - 1); // Peaks at 1.0 when equal
const sigmaWeight = (sigmaA + sigmaB) / 2;
const score = outcomeUncertainty * sigmaWeight;
```

**Tests:**
- `evolution/src/lib/agents/tournament.test.ts`:
  - Identical ratings → `outcomeUncertainty ≈ 1.0`
  - Large gap (|μA-μB| >> BETA) → `outcomeUncertainty ≈ 0.0`
  - Symmetric: swapping A/B produces same score
  - Verify pairing order matches old behavior for extreme gaps, better information gain for close matchups

---

### Phase 4: Feed Friction Spots to Editing Agents

**Problem:** Pairwise comparison generates `frictionSpots` — specific passages where text quality drops (e.g., "paragraph 3 loses reader engagement due to abrupt topic shift"). These are stored in `Match.frictionSpots` but nothing downstream ever reads them. Editing agents currently guess which passages need work instead of targeting known problems.

**Files modified:**
- `evolution/src/lib/agents/pairwiseRanker.ts` — ensure frictionSpots are included in Match output (already stored, may need explicit exposure)
- `evolution/src/lib/agents/iterativeEditingAgent.ts` — accept frictionSpots in context, inject into editing prompt
- `evolution/src/lib/agents/treeSearchAgent.ts` — pass frictionSpots to revision action selection
- `evolution/src/lib/treeOfThought/revisionActions.ts` — use frictionSpots to prioritize which passages to revise

```typescript
// iterativeEditingAgent.ts — inject friction spots into editing prompt
const frictionContext = recentFrictionSpots?.length
  ? `Known problematic passages:\n${recentFrictionSpots.map(f => `- ${f.location}: ${f.issue}`).join('\n')}`
  : '';

// Add to editing prompt alongside dimension target and critique
const editPrompt = `${dimensionTarget}\n\n${critiqueContext}\n\n${frictionContext}\n\n${editInstructions}`;
```

**Key decisions:**
- Source friction spots from the most recent comparison round (not all history — freshest is most relevant)
- Friction spots supplement, not replace, dimension-targeted editing — agent still targets weakest dimension but with passage-level specificity
- Tree search uses friction spots to bias action selection toward passages with known issues

**Tests:**
- `evolution/src/lib/agents/iterativeEditingAgent.test.ts` — verify friction spots appear in edit prompt when present; verify graceful handling when no friction spots exist
- `evolution/src/lib/agents/treeSearchAgent.test.ts` — verify friction spots passed through to revision actions
- `evolution/src/lib/treeOfThought/revisionActions.test.ts` — verify friction-spot-aware action selection prioritizes problematic passages

---

### Phase 5: Semantic Diversity Scoring

**Problem:** Current diversity uses 64-dim trigram hashing with ~65% collision rate. "A feline rested on the rug" vs "The cat sat on the mat" score as very different despite semantic equivalence. Pinecone embeddings are already in the codebase but not wired to evolution.

**Files modified:**
- `evolution/src/lib/agents/proximityAgent.ts` — add semantic embedding path
- New utility: `evolution/src/lib/semanticEmbedding.ts` — embedding generation via existing Pinecone/OpenAI integration

```typescript
// proximityAgent.ts — updated similarity computation
async function computeSimilarity(textA: string, textB: string): Promise<number> {
  if (embeddingService.isAvailable()) {
    const [embA, embB] = await Promise.all([
      embeddingService.embed(textA),
      embeddingService.embed(textB),
    ]);
    const semantic = cosineSimilarity(embA, embB);
    const lexical = trigramSimilarity(textA, textB);
    return 0.7 * semantic + 0.3 * lexical; // Blend for robustness
  }
  return trigramSimilarity(textA, textB); // Fallback
}
```

**Key decisions:**
- Blend 70/30 semantic/lexical — lexical catches formatting/structural similarity that embeddings miss
- Fallback to trigram-only when embeddings unavailable (offline, API error)
- Cache embeddings per variant (text is immutable once created)

**Tests:**
- `evolution/src/lib/agents/proximityAgent.test.ts`:
  - Semantic synonyms ("cat"/"feline") score high similarity (>0.8) — unlike trigram which scores low
  - Identical text → similarity ≈ 1.0
  - Completely unrelated text → similarity < 0.3
  - Fallback to trigram when embedding service unavailable
  - Cache hit: second call for same text doesn't re-embed
- `evolution/src/lib/semanticEmbedding.test.ts` — embedding dimension consistency, L2 normalization

## Testing

### Unit Tests
| Phase | Test Files | Key Assertions |
|-------|-----------|----------------|
| 1 | generationAgent.test.ts, evolutionAgent.test.ts | All 4 feedback fields in prompt; empty field handling |
| 2 | analysis.test.ts, hallOfFameActions.test.ts | CI coverage ~95%; CIs narrow with more data; overlapping CIs flagged |
| 3 | tournament.test.ts | Logistic CDF symmetry; equal ratings → max uncertainty; large gap → min uncertainty |
| 4 | iterativeEditingAgent.test.ts, treeSearchAgent.test.ts, revisionActions.test.ts | Friction spots in prompt; graceful when empty; passage prioritization |
| 5 | proximityAgent.test.ts, semanticEmbedding.test.ts | Synonym detection; fallback behavior; cache correctness |

### Integration Tests
- Run full evolution pipeline on a test prompt after each phase
- Verify checkpoint/resume works with any new fields
- Verify admin UI renders new data (CIs, sigma bands)

### Manual Verification on Staging
- Phase 1: Run evolution, verify all 4 feedback types appear in LLM prompts (check logs)
- Phase 2: Run experiment analysis, confirm CIs in output; check HoF shows ranges; check Elo chart sigma bands
- Phase 3: Run tournament, verify pairings are reasonable (close matchups preferred over mismatches)
- Phase 4: Run evolution, verify friction spots appear in editing agent prompts (check logs for "Known problematic passages")
- Phase 5: Run evolution, compare semantic vs trigram diversity scores for known-similar content

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/rating_and_comparison.md` - Phase 3 changes pairing formula
- `evolution/docs/evolution/architecture.md` - Phase 5 adds embedding dependency
- `evolution/docs/evolution/data_model.md` - Phase 2 adds CI fields
- `evolution/docs/evolution/agents/overview.md` - Phase 1 changes feedback consumption
- `evolution/docs/evolution/hall_of_fame.md` - Phase 2 adds CIs to leaderboard
- `docs/feature_deep_dives/article_detail_view.md` - Phase 2 adds sigma bands to Elo chart

---

## Appendix: Deferred Proposals

All 42 proposals from research, organized by tier. **Items in scope above are marked with ✅.**

### Tier 1: Quick Wins
| # | Proposal | Source |
|---|----------|--------|
| P1 | ✅ Use all 4 meta-feedback types in prompts | GAP 4 |
| P2 | Increase calibration minOpponents to 3 | GAP 8 |
| P3 | Parametrize ×6 plateau multiplier | GAP 5 |
| P4 | Check degenerate state independently | GAP 5 |
| P5 | Cap history arrays at 50 entries | GAP 5 |
| P6 | Wire isRatingStagnant() into creative exploration | R2-1 |
| P7 | Add sigma floor (MIN_SIGMA=1.0) | R2-5 |
| P8 | Normalize cross-scale thresholds | R2-4 |
| P9 | ✅ Add CIs to Hall of Fame leaderboard | R3-3 |

### Tier 2: Medium Effort
| # | Proposal | Source |
|---|----------|--------|
| P10 | ✅ Bootstrap CIs on experiment main effects | GAP 2 |
| P11 | ✅ Replace ÷10 pairing with OpenSkill logistic CDF | GAP 6 |
| P12 | Budget-aware calibration thresholds | GAP 8 |
| P13 | Multi-signal plateau detection | GAP 5 |
| P14 | ✅ Convergence detection using CI lower bounds | GAP 2 |
| P15 | Effect size standardization (Cohen's d) | GAP 2 |
| P16 | Convergence streak with 90% threshold | R2-5 |
| P17 | ROI-weighted budget redistribution | E3 |
| P18 | ✅ Feed friction spots to editing agents | R2-4 |
| P19 | ✅ CI visualization on Elo history chart | R3-2 |
| P20 | Graceful budget degradation | R3-4 |
| P21 | Fix draw classification (actual TIE not confidence) | R2-5 |
| P22 | Preserve ordinalHistory on phase transition | R3-4 |

### Tier 3: Significant Effort
| # | Proposal | Source |
|---|----------|--------|
| P23 | ✅ Semantic diversity scoring via embeddings | GAP 3 |
| P24 | Track meta-feedback effectiveness | GAP 4 |
| P25 | Track pairing informativeness | GAP 6 |
| P26 | Bonferroni correction for multiple comparisons | GAP 2 |
| P27 | Pool-wide diversity (Shannon entropy) | GAP 3 |
| P28 | Fitness-proportionate parent selection | R2-1 |
| P29 | Adaptive tree search depth | R2-2 |
| P30 | Per-section weakness targeting | R2-3 |
| P31 | Post-edit self-reflection | R2-4 |
| P32 | Cross-judge validation for Hall of Fame | R3-3 |
| P33 | Convergence trajectory visualization | R3-2 |
| P34 | Cost estimation feedback loop | E3 |
| P35 | Dimension score trend visualization | R3-2 |

### Tier 4: Architectural
| # | Proposal | Source |
|---|----------|--------|
| P36 | Multi-armed bandit for agent selection | GAP 1 |
| P37 | Cross-run learning (difficulty priors) | GAP 7 |
| P38 | Bayesian experiment design | GAP 2 |
| P39 | Adaptive threshold tuning | GAP 1 |
| P40 | Reversible phase transition | R3-4 |
| P41 | Dynamic agent scheduling by ROI | R3-4 |
| P42 | Hierarchical Bayesian aggregation for HoF | R3-3 |
