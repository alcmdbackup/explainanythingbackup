# Shingle-Based Article Scoring with Approximate Nearest Neighbors

## Problem Definition

**Input:**
- Target article broken into X shingles
- Y reference articles with known quality scores
- Overlapping shingles between target and reference articles

**Goal:** Predict the quality score of the target article using shingle overlap patterns

## Core Approaches

### 1. Similarity-Weighted Prediction (Recommended)

**Algorithm:**
```python
def predict_article_rating(target_shingles, reference_articles):
    predictions = []

    for ref_article in reference_articles:
        # Calculate Jaccard similarity
        overlap = len(target_shingles.intersection(ref_article.shingles))
        similarity = overlap / len(target_shingles.union(ref_article.shingles))

        # Weight reference score by similarity
        weighted_score = similarity * ref_article.score
        predictions.append((weighted_score, similarity))

    # Weighted average prediction
    total_weight = sum(sim for _, sim in predictions)
    prediction = sum(score for score, _ in predictions) / total_weight
    return prediction
```

**Why it works:**
- Articles with more shingle overlap likely have similar quality
- Natural confidence weighting (higher overlap = higher confidence)
- Handles sparse overlap gracefully

### 2. Shingle Quality Attribution

**Two-step process:**
1. Estimate individual shingle qualities from reference articles using ridge regression
2. Predict target article score as sum of its shingle qualities

**Best for:** When you need to understand which specific shingles contribute to quality

### 3. Local Regression

**Algorithm:**
- Filter reference articles to only those sharing shingles with target
- Fit regression model on this relevant subset
- Apply model to predict target score

**Best for:** When global patterns don't apply locally

## Scalability Challenge: Approximate Nearest Neighbors

### The Problem
- With 100K+ reference articles: exact similarity computation takes 10+ seconds
- Need ~10ms response time for real-time scoring
- **Solution:** Approximate nearest neighbors (ANN) for 1000x speedup

### ANN Techniques

#### 1. MinHash LSH (Locality Sensitive Hashing) ⭐ RECOMMENDED

**Perfect for Jaccard similarity on shingle sets:**

```python
from datasketch import MinHashLSH, MinHash

class ShingleANN:
    def __init__(self, threshold=0.5, num_perm=128):
        self.lsh = MinHashLSH(threshold=threshold, num_perm=num_perm)
        self.minhashes = {}

    def build_index(self, reference_articles):
        for article_id, article in enumerate(reference_articles):
            m = MinHash(num_perm=self.num_perm)
            for shingle in article.shingles:
                m.update(shingle.encode('utf8'))

            self.minhashes[article_id] = m
            self.lsh.insert(article_id, m)

    def query(self, target_shingles, k=100):
        target_minhash = MinHash(num_perm=self.num_perm)
        for shingle in target_shingles:
            target_minhash.update(shingle.encode('utf8'))

        candidates = list(self.lsh.query(target_minhash))

        # Compute exact similarities for candidates
        similarities = []
        for candidate_id in candidates:
            exact_jaccard = target_minhash.jaccard(self.minhashes[candidate_id])
            similarities.append((exact_jaccard, candidate_id))

        return sorted(similarities, reverse=True)[:k]
```

**Performance:**
- **Query time:** O(log Y) vs O(Y × S) for exact
- **Memory:** O(Y × 128) ≈ 10MB for 100K articles
- **Accuracy:** 95%+ recall at similarity threshold

#### 2. Random Projection

**For dense vector embeddings of shingles:**
- Project high-dimensional vectors to lower dimension
- Use ball-tree or similar for fast NN search
- Good when you have rich shingle embeddings

#### 3. Hierarchical Clustering

**Cluster-based search:**
- Pre-cluster reference articles by shingle similarity
- At query time, search only relevant clusters
- More interpretable but slower than LSH

### Performance Comparison

| Method | Build Time | Query Time | Memory | Accuracy | Best For |
|--------|------------|------------|---------|----------|----------|
| MinHash LSH | O(Y×S) | O(log Y) | O(Y×128) | 95%+ | Jaccard similarity |
| Random Projection | O(Y×D²) | O(k log Y) | O(Y×k) | 90%+ | Dense embeddings |
| Clustering | O(Y×S×k) | O(C+k×S) | O(Y+C×S) | 85%+ | Interpretable |
| Exact (baseline) | O(1) | O(Y×S) | O(Y×S) | 100% | Small scale |

## Production Implementation

### Recommended Architecture

```python
class OptimalShingleScorer:
    def __init__(self, reference_articles):
        # Primary: MinHash LSH for fast Jaccard similarity
        self.lsh = MinHashLSH(threshold=0.3, num_perm=128)
        self.article_scores = {}
        self.global_stats = self._compute_stats(reference_articles)

        self._build_index(reference_articles)

    def predict_article_score(self, target_shingles, k=50):
        # Step 1: Get approximate neighbors
        neighbors = self.lsh.query(target_shingles, k=k*2)

        if len(neighbors) < 5:
            return self.global_stats['mean_score'], 0.1  # Low confidence fallback

        # Step 2: Compute weighted prediction
        total_weight = 0
        weighted_sum = 0

        for similarity, article_id in neighbors[:k]:
            if similarity > 0.1:  # Minimum threshold
                weight = similarity ** 1.5  # Emphasize high similarity
                weighted_sum += weight * self.article_scores[article_id]
                total_weight += weight

        prediction = weighted_sum / total_weight
        confidence = min(1.0, total_weight / k)

        return prediction, confidence
```

### Advanced Optimizations

#### 1. Multi-Level Indexing
- **Level 1:** Fast coarse filter (LSH with loose threshold)
- **Level 2:** Exact similarity computation on candidates
- Balances speed and accuracy

#### 2. Dynamic Indexing
- **Static index:** For historical articles (rebuilt periodically)
- **Buffer:** For recent articles (merged periodically)
- Handles streaming updates efficiently

#### 3. Parallel Querying
- Shard articles across multiple indices
- Query shards in parallel
- Merge results for final prediction

## When to Use Each Approach

### Scale-Based Recommendations

**Small Scale (Y < 1,000):**
- Use exact similarity computation
- Simple similarity-weighted prediction
- Fast enough without ANN

**Medium Scale (Y = 1,000-10,000):**
- Use MinHash LSH with exact refinement
- Consider local regression for better accuracy
- Good balance of speed and precision

**Large Scale (Y > 10,000):**
- **Must use** MinHash LSH with multi-level indexing
- Parallel querying for sub-10ms response times
- Focus on similarity-weighted prediction (simplest, most robust)

### Quality vs Speed Trade-offs

**Highest Accuracy:** Local regression on exact neighbors
**Best Balance:** MinHash LSH + similarity weighting
**Fastest:** Clustering + approximate similarity
**Most Interpretable:** Shingle quality attribution

## Key Implementation Insights

1. **Jaccard similarity** is ideal for shingle overlap problems
2. **MinHash LSH** is almost always the right ANN choice for shingles
3. **Similarity weighting** often outperforms complex attribution methods
4. **Confidence estimation** is crucial for production systems
5. **Fallback strategies** handle edge cases (low overlap, new content types)

## Performance Targets

**Real-time scoring (production):**
- **Query time:** <10ms
- **Accuracy:** >90% correlation with exact similarity
- **Memory:** <100MB index for 100K articles
- **Throughput:** >1000 predictions/second

**Batch scoring:**
- **Processing rate:** >10K articles/minute
- **Resource usage:** <4GB memory
- **Scalability:** Linear with dataset size

This approach enables real-time, accurate article quality prediction at massive scale using shingle overlap patterns as the primary signal.