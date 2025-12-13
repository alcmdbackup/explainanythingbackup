# Attribution Problem: Estimating Paragraph Quality from Article Scores

This is a fascinating latent factor estimation problem. Here are the most effective approaches:

## 1. Regularized Linear Regression
Treat article scores as targets and paragraph presence as binary features. Use Ridge/Lasso regression where coefficients represent paragraph quality. The regularization handles noise and prevents overfitting when paragraphs appear infrequently.

## 2. Bayesian Hierarchical Model
Model paragraph qualities as latent variables with prior distributions (e.g., Normal). Article scores are noisy observations of paragraph aggregations (sum/mean). Use variational inference or MCMC to get posterior distributions of paragraph quality, naturally handling uncertainty.

## 3. Iterative Weighted Least Squares
- Initialize paragraph scores randomly
- For each iteration:
  - Predict article scores from current paragraph estimates
  - Update paragraph scores to minimize prediction error
  - Weight updates by confidence (inverse of prediction variance)
- Converges to optimal solution under mild assumptions

## 4. Matrix Factorization with Constraints

### Problem Setup

**Given:**
- Article-paragraph indicator matrix M: M[i,j] = 1 if article i contains paragraph j
- Article scores vector s: observed quality scores for each article
- Want: Individual paragraph quality estimates

**Unknown:**
- Contribution matrix C: C[i,j] = contribution of paragraph j to article i's score

### Constraints & Formulation

**Hard Constraints:**
1. **Sparsity**: C[i,j] = 0 if M[i,j] = 0 (no contribution if paragraph not in article)
2. **Row sums**: Σⱼ C[i,j] = s[i] (contributions sum to observed article score)

**Optimization Problem:**
```
minimize λ||C||* + μ||C||₁
subject to:
- C ⊙ (1 - M) = 0  (element-wise, zeros where no connection)
- C × 1 = s       (row sums equal article scores)
```

Where ||C||* is nuclear norm (sum of singular values) encouraging low-rank structure.

### Why This Works

**Low-rank assumption**: If paragraphs have intrinsic qualities and articles aggregate them, C should be expressible as UV^T where:
- U captures "article style" factors (how articles weight different paragraph types)
- V captures "paragraph quality" factors

**Nuclear norm regularization**: Automatically finds the right rank and handles noise by shrinking singular values.

### Solution Methods

**1. Proximal Gradient:**
- Project onto constraint set (row sums + sparsity)
- Apply nuclear norm proximal operator (soft-thresholding of singular values)

**2. ADMM (Alternating Direction Method of Multipliers):**
```
minimize λ||Z||* + μ||C||₁
subject to: Z = C, row/sparsity constraints on C
```

**3. Practical Algorithm:**
- Initialize C satisfying constraints
- Repeat:
  - SVD of C = USV^T
  - Soft-threshold singular values: S' = soft_threshold(S, λ)
  - Update C = US'V^T
  - Project back onto constraint set

### Paragraph Quality Extraction

From final C matrix:
- **Simple**: q[j] = mean(C[i,j]) over articles containing paragraph j
- **Weighted**: q[j] = weighted mean using article confidence scores
- **Factor-based**: Use columns of V from final factorization C ≈ UV^T

### Advantages Over Regression

1. **Handles article heterogeneity**: Different articles can weight paragraph types differently
2. **Automatic feature discovery**: Latent factors capture paragraph "types"
3. **Better with sparse data**: Nuclear norm helps when paragraphs appear in few articles
4. **Uncertainty quantification**: Smaller singular values indicate higher uncertainty

## Scalability Considerations

**Short Answer: Probably not for truly large corpora with standard matrix factorization. But there are scalable alternatives.**

### Computational Bottlenecks

**Standard Approach Issues:**
- **SVD complexity**: O(min(N²P, NP²)) per iteration for N articles, P paragraphs
- **Memory**: N×P matrix storage (could be GB/TB for large corpora)
- **Dense updates**: Even if input is sparse, C becomes dense during optimization

**Scale Reality Check:**
- 100K articles × 50K paragraphs = 5B entries (20GB+ in memory)
- SVD of this scale: hours to days per iteration

### Fast Scalable Alternatives

**1. Randomized Low-Rank Approximation**
```
Instead of: SVD(C) = USV^T (expensive)
Use: Randomized SVD with rank k << min(N,P)
Complexity: O(k²(N+P)) vs O(NP²)
```

**2. Block Coordinate Descent**
- Partition paragraphs into blocks
- Optimize each block independently
- Parallelize across blocks
- Linear scaling with corpus size

**3. Streaming/Online Matrix Factorization**
```
Process articles incrementally:
- Initialize paragraph factors
- For each new article:
  - Update only paragraphs in that article
  - Use stochastic gradient descent
```

**4. Sparse Subproblem Decomposition**
Key insight: Most paragraph-article pairs are zero.

```
For each connected component in bipartite graph:
- Solve much smaller factorization problem
- Components are often 100s of articles/paragraphs vs millions
```

### Most Practical Scalable Approach

**Hierarchical Regularized Regression** (abandoning matrix factorization):

```python
# Pseudo-algorithm
1. Group similar articles (clustering/LSH)
2. For each group:
   - Fit Ridge regression: paragraph_indicators → article_scores
   - Extract paragraph coefficients
3. Aggregate coefficients across groups (weighted by confidence)
```

**Complexity**: O(P² × avg_articles_per_group) vs O(N²P²)

**Why it scales:**
- Embarrassingly parallel across groups
- Each subproblem is small
- Can handle streaming updates
- No expensive SVDs

### Hybrid Approach for Best of Both

```
1. Use regression for initial paragraph quality estimates (fast)
2. Apply low-rank matrix completion only on high-variance paragraphs
3. Use warm-start from regression solution
```

## Conclusion

**Most Efficient**: The regularized regression approach. It's computationally simple, handles noise naturally through regularization, and gives you both point estimates and confidence intervals. Use cross-validation to tune regularization strength.

For corpora with >10K articles and >10K paragraphs, stick with regularized regression or hierarchical methods. Matrix factorization is theoretically elegant but computationally prohibitive at scale without major algorithmic modifications.

The key insight is that this is essentially a "rating prediction from partial observations" problem where paragraphs are latent factors and articles are composite ratings.