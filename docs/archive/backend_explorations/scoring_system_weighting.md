# Lineage-Based Scoring with Dual Weighting

## Overview

This document explores an advanced scoring approach that weights ancestor contributions based on both content similarity and feedback reliability. Each ancestor's score contribution is weighted by how similar it is to the current article AND how much feedback it has received relative to the lineage.

---

## Core Formula

```
lineage_score_N = Σ(ancestor_score_i * final_weight_i)

where:
final_weight_i = normalized(similarity_weight_i * feedback_weight_i)
similarity_weight_i = similarity(a_i, N) / Σ_j(similarity(a_j, N))
feedback_weight_i = feedback_count_i / Σ_j(feedback_count_j)
```

**Critical**: The combined weights must be re-normalized to sum to 1.0 to avoid score deflation.

---

## Step-by-Step Calculation

### Step 1: Calculate Raw Similarities
For each ancestor, compute content similarity to current article using:
- Shingle overlap: `shared_tokens / total_tokens`
- Sentence embeddings: cosine similarity
- Hybrid approach: semantic + lexical similarity

### Step 2: Normalize Similarity Weights
```
similarity_weight_i = similarity(a_i, N) / Σ_all_ancestors(similarity(a_j, N))
```

### Step 3: Normalize Feedback Weights
```
feedback_weight_i = feedback_count_i / Σ_all_ancestors(feedback_count_j)
```

### Step 4: Combine and Re-normalize
```
combined_weight_i = similarity_weight_i * feedback_weight_i
final_weight_i = combined_weight_i / Σ_all_ancestors(combined_weight_j)
```

### Step 5: Calculate Weighted Score
```
lineage_score = Σ(ancestor_score_i * final_weight_i)
```

---

## Worked Example

**Lineage**: A(score=80, sim=0.3, feedback=10) → B(score=70, sim=0.8, feedback=30) → C(score=90, sim=0.6, feedback=20) → N

### Calculations:

**Similarity Weights**:
- Total similarity = 0.3 + 0.8 + 0.6 = 1.7
- A: 0.3/1.7 = 0.176
- B: 0.8/1.7 = 0.471
- C: 0.6/1.7 = 0.353

**Feedback Weights**:
- Total feedback = 10 + 30 + 20 = 60
- A: 10/60 = 0.167
- B: 30/60 = 0.500
- C: 20/60 = 0.333

**Combined Weights**:
- A: 0.176 × 0.167 = 0.029
- B: 0.471 × 0.500 = 0.236
- C: 0.353 × 0.333 = 0.118

**Re-normalized Final Weights**:
- Total combined = 0.029 + 0.236 + 0.118 = 0.383
- A: 0.029/0.383 = 0.076 (7.6%)
- B: 0.236/0.383 = 0.616 (61.6%)
- C: 0.118/0.383 = 0.308 (30.8%)

**Final Score**:
```
lineage_score_N = 80×0.076 + 70×0.616 + 90×0.308 = 76.9
```

---

## Key Properties

### Advantages

**Content Relevance**: Similar ancestors contribute more than distant ones
**Data Reliability**: Well-evaluated ancestors get higher weight
**Anti-Gaming**: Can't manipulate score through irrelevant or unvalidated ancestors
**Mathematical Cleanliness**: Weights sum to 1.0, preserving score ranges

### Potential Issues

**Double Penalty**: Articles that are both dissimilar AND low-feedback get very low weights
**Feedback Concentration**: Single high-feedback ancestor can dominate even with moderate similarity
**Computational Cost**: Requires similarity calculation for all ancestor pairs

---

## Design Variations

### Alternative 1: Separate Normalization
```
final_weight_i = α * similarity_weight_i + (1-α) * feedback_weight_i
```
Linearly combines normalized factors instead of multiplying.

### Alternative 2: Minimum Thresholds
```
adjusted_feedback_i = max(feedback_count_i, min_threshold)
adjusted_similarity_i = max(similarity_i, min_threshold)
```
Prevents zero weights for sparse data.

### Alternative 3: Feedback Weight Capping
```
capped_feedback_weight_i = min(raw_feedback_weight_i, max_weight)
```
Prevents single ancestors from dominating through excessive feedback.

---

## Integration with Base Scoring

### Hybrid Approach
```
final_score = own_score_weight * own_score + lineage_weight * lineage_score

where:
own_score_weight = confidence_factor(own_feedback_count)
lineage_weight = 1 - own_score_weight
```

### Confidence-Based Blending
Articles with sparse feedback rely more heavily on lineage scoring, while well-evaluated articles use primarily their own scores.

---

## Implementation Considerations

### Caching Strategy
- Similarity calculations: Cache by content hash pairs
- Lineage scores: Recompute when ancestor scores change
- Weight normalization: Can be precomputed per lineage

### Performance Optimization
- Limit lineage depth (e.g., 5-10 ancestors maximum)
- Use approximate similarity for initial filtering
- Batch similarity calculations for efficiency

### Monitoring
- Track weight distribution across lineages
- Monitor for feedback concentration patterns
- Alert on unusual similarity patterns (potential gaming)

---

## Uncertainty-Based Exploration Bonuses

To ensure newer content receives fair evaluation opportunities, we can extend the lineage scoring approach with **statistically-principled exploration bonuses** based on confidence interval uncertainty.

### Core Concept

Rather than arbitrary time-based or vote-count bonuses, this approach uses genuine statistical uncertainty from Wilson confidence intervals:

```
uncertainty_bonus = uncertainty_weight * (wilson_ucb - wilson_lcb)
enhanced_score = base_lineage_score + uncertainty_bonus
```

**Where**:
- `wilson_lcb` = Wilson Lower Confidence Bound (conservative estimate)
- `wilson_ucb` = Wilson Upper Confidence Bound (optimistic estimate)
- `uncertainty_weight` = exploration parameter (0.0 to 1.0)

### Lineage-Level Uncertainty Calculation

Aggregate feedback across the entire lineage chain using similarity weighting to get robust uncertainty estimates:

```
// Step 1: Aggregate lineage feedback with similarity weighting
total_positive = Σ(positive_votes_i * similarity_factor_i)
total_negative = Σ(negative_votes_i * similarity_factor_i)

// Step 2: Compute lineage-level Wilson bounds
lineage_wilson_lcb = wilson_lcb(total_positive, total_negative)
lineage_wilson_ucb = wilson_ucb(total_positive, total_negative)

// Step 3: Calculate uncertainty and bonus
lineage_uncertainty = lineage_wilson_ucb - lineage_wilson_lcb
exploration_bonus = uncertainty_weight * lineage_uncertainty
```

### Integration with Dual Weighting

The uncertainty bonus can be combined with the dual weighting approach:

```
base_lineage_score = Σ(ancestor_score_i * final_weight_i)  // From dual weighting
enhanced_lineage_score = base_lineage_score + exploration_bonus

final_article_score = blend(own_score, enhanced_lineage_score, confidence_factor)
```

### Worked Example

**Lineage**: A(score=80, sim=0.3, feedback=16pos/4neg) → B(score=70, sim=0.8, feedback=21pos/9neg) → C(score=90, sim=0.6, feedback=17pos/3neg) → N(2pos/0neg)

**Step 1: Aggregate Similarity-Weighted Votes**
```
A contribution: 16 pos, 4 neg * 0.3 similarity = 4.8 pos, 1.2 neg
B contribution: 21 pos, 9 neg * 0.8 similarity = 16.8 pos, 7.2 neg
C contribution: 17 pos, 3 neg * 0.6 similarity = 10.2 pos, 1.8 neg
N contribution: 2 pos, 0 neg * 1.0 similarity = 2 pos, 0 neg

Total aggregated: 33.8 positive, 10.2 negative votes
```

**Step 2: Calculate Wilson Bounds**
```
Lineage Wilson LCB ≈ 0.65
Lineage Wilson UCB ≈ 0.84
Uncertainty = 0.84 - 0.65 = 0.19
```

**Step 3: Apply Exploration Bonus**
```
With uncertainty_weight = 0.3:
exploration_bonus = 0.3 * 0.19 = 0.057

If base_lineage_score = 76.9 (from dual weighting):
enhanced_score = 76.9 + 0.057 = 76.957
```

### Key Properties

**Statistically Principled**: Based on genuine confidence interval mathematics, not arbitrary rules

**Self-Regulating**: Uncertainty naturally decreases as evidence accumulates

**Anti-Gaming**: Cannot manipulate uncertainty without changing actual vote patterns

**Lineage Synergy**: New articles benefit from aggregated ancestor feedback for more robust uncertainty estimates

**Compatibility**: Works seamlessly with existing dual weighting approach

### Parameter Tuning

| uncertainty_weight | Behavior | Use Case |
|-------------------|----------|----------|
| 0.0 | Pure exploitation | Established systems with abundant feedback |
| 0.2-0.4 | Balanced exploration | Most practical applications |
| 0.5+ | High exploration | New systems needing content discovery |

### Implementation Integration

**Enhanced Weighting Pipeline**:
1. Compute similarity and feedback weights (existing dual weighting)
2. Calculate base lineage score using weighted ancestors
3. Aggregate similarity-weighted votes for uncertainty calculation
4. Apply Wilson bounds to get exploration bonus
5. Combine base score with exploration bonus

**Caching Strategy**:
- Cache aggregated vote totals per lineage
- Recompute Wilson bounds when any ancestor receives new votes
- Pre-compute uncertainty bonuses for common confidence levels

### Benefits for New Content Evaluation

**Fair Bootstrapping**: Articles get evaluation incentives proportional to genuine statistical uncertainty

**No Arbitrary Cutoffs**: Purely driven by confidence interval width

**Robust Estimates**: Leverages entire lineage history for uncertainty calculation

**Exploration-Exploitation Balance**: Single parameter controls system behavior

**Maintains Quality Standards**: Conservative base scoring (Wilson LCB) with principled exploration bonuses

This approach elegantly solves the new content evaluation problem while maintaining the mathematical rigor and anti-gaming properties of the dual weighting system.