# Scoring System Weighting V2: Similarity-Adjusted Feedback

## Problem Statement

We want to allow articles to inherit their scores from ancestors and other similar articles, to enable more rapid feedback and A/B testing. Having each article scored based on its own feedback will be too sparse.

## Instructions (for reference)
1. Create a new measure called similarity-adjusted-feedback which is similarity(c, a) * (feedback received)
2. We can weigh scoring across lineage based on similarity-adjusted feedback, including current article
3. We want to apply an exploration bonus based on total similarity-adjusted-feedback received across the lineage

Where:
- c = current article
- a = ancestor article (or current article itself)
- similarity(c, a) = similarity measure between current and ancestor (1.0 for current article)

---

## Core Formula

### Similarity-Adjusted-Feedback (SAF)
```
SAF(a, c) = similarity(c, a) * feedback_count(a)

Where similarity(c, c) = 1.0 for current article
```

### Unified Scoring
```
final_score = base_score + exploration_bonus

base_score = Σ(article_score_a * weight_a) / Σ(weight_a)
weight_a = SAF(a, c)
```

**Sum includes current article and all ancestors.**

---

## Worked Example

**Lineage**: A(score=80, sim=0.3, feedback=20) → B(score=70, sim=0.8, feedback=30) → C(score=90, sim=0.6, feedback=15) → N(score=75, sim=1.0, feedback=5)

### Calculate SAF Values
```
A: SAF = 0.3 * 20 = 6.0
B: SAF = 0.8 * 30 = 24.0
C: SAF = 0.6 * 15 = 9.0
N: SAF = 1.0 * 5 = 5.0
Total SAF = 44.0
```

### Calculate Weights & Final Score
```
weight_A = 6.0/44.0 = 0.136, weight_B = 24.0/44.0 = 0.545
weight_C = 9.0/44.0 = 0.205, weight_N = 5.0/44.0 = 0.114

base_score = 80*0.136 + 70*0.545 + 90*0.205 + 75*0.114 = 76.2
```

---

## Wilson-Based Exploration Bonus

### Concept
Use total SAF as effective sample size for Wilson confidence intervals:

```
estimated_quality = base_score / 100  // Convert 0-100 scale to 0-1 probability
effective_positive = total_saf * estimated_quality
effective_negative = total_saf * (1 - estimated_quality)

wilson_lcb = wilson_lower_bound(effective_positive, effective_negative)
wilson_ucb = wilson_upper_bound(effective_positive, effective_negative)

exploration_bonus = uncertainty_weight * (wilson_ucb - wilson_lcb)
```

**Properties**: High total SAF → low exploration bonus; Low total SAF → high exploration bonus

**Implementation Note**: This repurposes Wilson intervals for practical exploration bonuses rather than statistical soundness. Wilson interval width decreases with sample size, giving us the desired exploration vs exploitation trade-off regardless of statistical validity.

---

## Key Benefits

**Simplified**: Single SAF measure eliminates own vs lineage score blending
**Unified**: Current article included naturally with full similarity weight
**Principled**: Wilson intervals provide statistically sound exploration bonuses
**Tunable**: Single uncertainty_weight parameter (typically 0.2-0.4)

---

## Implementation

### Caching
- Cache SAF values per article-current pair
- Recompute when content or feedback changes

### Parameters
- `uncertainty_weight`: Exploration vs exploitation balance
- Wilson confidence: Standard 95% (z=1.96)

### Monitoring
- SAF distributions across lineages
- Weight concentration patterns
- Exploration bonus effectiveness

---

**Summary**: SAF approach unifies lineage scoring by weighting all articles (including current) by similarity-adjusted feedback. Wilson-based exploration bonuses provide fair evaluation for newer content without arbitrary thresholds.