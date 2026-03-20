# Rating & Comparison

OpenSkill Bayesian rating system, Swiss-style tournament, bias mitigation, calibration, and comparison methods used within the evolution pipeline to rank text variants.

**Note:** The pipeline uses a single unified OpenSkill rating system. Arena entries are loaded into the pool at run start with their pre-existing ratings, so in-run ranking and cross-run Arena ranking share one continuous rating space. See [Arena](./arena.md) for Arena-specific details.

## OpenSkill Bayesian Rating System

Variants are rated using an OpenSkill (Weng-Lin Bayesian) rating system (`core/rating.ts`) where each variant has a `{mu, sigma}` pair: `mu` is the estimated skill and `sigma` is the uncertainty. New variants start at `mu=25, sigma=8.333`. After each pairwise comparison, the winner's `mu` increases and the loser's decreases, while both sigmas shrink (uncertainty decreases). Ranking and sorting use `r.mu` directly — sigma communicates uncertainty via bootstrap confidence intervals rather than being baked into a point estimate. The system converges when all sigmas fall below a threshold (default: 3.0). For the `elo_score` DB column (0-3000 range), mu values are mapped via `toEloScale(mu)`: `1200 + (mu - 25) * 16` (equivalently `800 + mu * 16`), clamped to [0, 3000]. A fresh variant (mu=25) maps to Elo 1200. The eligibility gate (replacing the old `ordinal >= 0` check) is `r.mu >= 3 * r.sigma`.

### Rating Updates

Rating updates use the OpenSkill pairwise functions (`core/rating.ts`):

- **`updateRating(winner, loser)`**: Updates both ratings after a decisive match. Winner's mu increases, loser's decreases, both sigmas shrink.
- **`updateDraw(a, b)`**: Updates both ratings toward each other (used when the result is a draw).
- **Draw detection**: A result is a draw when `confidence < 0.3` (low-confidence result) or `winnerId === loserId` (degenerate match). Note: the `confidence >= 0.7` threshold used in triage adaptive early-exit (see RankingAgent above) is for calibration decisions only and is unrelated to draw detection.
- **Sigma-based convergence**: Unlike Elo's fixed K-factor, OpenSkill automatically adjusts update magnitude via sigma decay. High-sigma (uncertain) variants see larger updates; low-sigma (well-tested) variants see smaller updates.

## rankPool() (Unified Triage + Fine-Ranking)

The `rankPool()` function (`v2/rank.ts`) implements a two-step ranking process:

1. **Triage** — sequential calibration of new entrants (sigma >= 5.0) against stratified opponents with adaptive early exit (confidence >= 0.7 skips remaining opponents).
2. **Fine-ranking** — Swiss-style tournament among eligible contenders using info-theoretic pairing.

**Top-20% cutoff elimination**: After triage, variants whose `mu + 2*sigma < cutoff` (where cutoff is the top-20% mu value) are eliminated from fine-ranking.

**Budget pressure tiers** (low / medium / high) control the maximum number of comparisons per step, scaling down when budget is tight: low (40 max), medium (25), high (15).

**Draw detection**: A comparison result with confidence < 0.3 is treated as a draw.

### Swiss-Style Pairing (Fine-Ranking)

The fine-ranking step maximizes information gain per comparison. Before scoring pairs, an **eligibility filter** excludes variants where `r.mu < 3 * r.sigma` (confidently below baseline) and outside the top K by mu (configurable via `tournament.topK`, default: 5). This means a variant participates if it's in the top K *or* passes the eligibility gate — only variants that are both low-ranked and confidently weak are excluded. Among eligible variants, candidate pairs are scored by two factors: (1) **outcome uncertainty** — how close to 50/50 the expected result is, and (2) **sigma** — the real Bayesian uncertainty from the rating, giving priority to under-tested variants whose ratings are still uncertain. Pairs are selected greedily by descending score, skipping already-played and already-used variants. Convergence is sigma-based: the tournament stops when all *eligible* variant sigmas fall below the convergence threshold (default: 3.0) for 2 consecutive rounds (`convergenceChecks: 2`). The tournament also exits immediately when no new pairs remain (`maxStaleRounds: 1`).

### Logistic CDF Outcome Uncertainty

Outcome uncertainty is computed using a **logistic CDF** derived from the OpenSkill performance model. Given two variants with mu values `muA` and `muB`:

```
BETA = DEFAULT_SIGMA * sqrt(2)    // performance spread parameter
pWin = 1 / (1 + exp(-(muA - muB) / BETA))
outcomeUncertainty = 1 - |2 * pWin - 1|
```

When ratings are equal (`muA == muB`), `pWin = 0.5` and uncertainty is maximal (1.0). As the gap grows, `pWin` approaches 0 or 1 and uncertainty drops to 0. This uses the same sigma-derived BETA parameter as OpenSkill's internal performance model.

## Stratified Opponent Selection

For calibrating new entrants, opponents are drawn from different mu tiers rather than randomly. For n=5 opponents: 2 from the top quartile, 2 from the middle, and 1 from the bottom or fellow new entrants. This ensures a new variant is tested against both strong and weak competitors, producing a more accurate initial rating.

## Adaptive Calibration

Calibration uses a batched parallelism strategy with early exit. The first batch of `minOpponents` (default: 2) opponents runs in parallel. If all matches are decisive (confidence >= 0.7), the entrant's rating is considered well-established and remaining opponents are skipped. Otherwise, remaining opponents run in a second parallel batch. This reduces LLM calls by ~40% for clear-cut variants while maintaining accuracy for borderline cases.

## LLM Response Cache (ComparisonCache)

There are two separate caching layers for comparison results:

1. **In-function Map** (`comparison.ts`): A `Map` keyed by order-invariant pair IDs caches results within a single `compareWithBiasMitigation()` call scope. Only results with `confidence > 0.3` are stored; low-confidence results are excluded to allow retry.

2. **ComparisonCache class** (`core/comparisonCache.ts`): A persistent in-memory cache using SHA-256 order-invariant keys at the `compareWithBiasMitigation()` level. Results are only cached when `confidence > 0` — zero-confidence results (both LLM passes failed) are excluded so retries can re-attempt the comparison. The cache persists across iterations within a single run for cross-iteration deduplication. Both `compareWithBiasMitigation` and `compareFlowWithBiasMitigation` share this guard.

## Position Bias in LLM-as-Judge

LLMs exhibit a well-documented tendency to favor whichever text appears first in a comparison prompt. To mitigate this, every pairwise comparison runs twice with reversed presentation order (A-vs-B, then B-vs-A) **concurrently** via `run2PassReversal()` using `Promise.all` — both the forward and reverse passes run in parallel. If both rounds agree on a winner, the result gets full confidence. If they disagree, the result is treated as a low-confidence draw.

## Comparison Methods

The pipeline uses two distinct comparison approaches:

### Standard Comparison (`comparison.ts`)

`compareWithBiasMitigation()` — the primary pairwise comparison function used by `rankPool()`:
- Builds comparison prompts via `buildComparisonPrompt()`
- Runs forward + reverse rounds concurrently via `run2PassReversal()` using `Promise.all`
- Parses winner via `parseWinner()` with position-awareness
- Returns `{winner, confidence}` with order-invariant SHA-256 caching
- Used for general-purpose variant ranking

The shared 2-pass reversal pattern (`core/reversalComparison.ts`) provides a generic `run2PassReversal()` runner that comparison methods delegate to.

## Creator-Based Elo Attribution

The pipeline's ranking operation (`rankPool()`) updates variant ratings, but the **creating** operations (`generateVariants()`, `evolveVariants()`) are what actually produce the text. Elo attribution solves this by computing how much each variant's final rating differs from its parent(s), crediting the creating agent.

### Per-Variant Attribution

`computeEloAttribution(variant, parents)` in `core/eloAttribution.ts`:

- **deltaMu**: `variant.mu - avg(parent.mu)` — how much the variant improved over its parent(s) in raw skill units
- **sigmaDelta**: `sqrt(variant.sigma² + avg(parent.sigma²))` — combined uncertainty
- **gain**: `deltaMu * ELO_SCALE` — gain in the 0-3000 Elo display scale (ELO_SCALE = 400 / DEFAULT_MU = 16)
- **ci**: `1.96 * sigmaDelta * ELO_SCALE` — 95% confidence interval
- **zScore**: `deltaMu / sigmaDelta` — statistical significance (0 when sigmaDelta = 0)

For 0-parent variants (baselines): gain is measured relative to `createRating()` defaults (mu=25, sigma=8.333).

### Agent-Level Aggregation

`aggregateByAgent(variants, state)` groups attribution by creating agent (`agent_name`):

- **totalGain**: Sum of all variant gains
- **avgGain**: Mean gain per variant
- **avgCi**: Root-sum-of-squares CI: `sqrt(sum(ci²)) / N` — preserves uncertainty correctly rather than naive averaging

### Z-Score Color Coding

The `AttributionBadge` component uses z-score thresholds for visual significance:

| z-Score | Color | Interpretation |
|---------|-------|---------------|
| |z| < 1.0 | Grey | Within noise — no meaningful signal |
| 1.0 ≤ |z| < 2.0 | Amber | Suggestive — worth watching |
| |z| ≥ 2.0 | Green/Red | Statistically significant improvement/degradation |

### Persistence

Computed at pipeline finalization by `computeAndPersistAttribution()` in `persistence.ts`. Stored as JSONB:
- `evolution_variants.elo_attribution` — per-variant `{gain, ci, zScore, deltaMu, sigmaDelta}`
- `evolution_agent_invocations.agent_attribution` — per-agent `{agentName, variantCount, totalGain, avgGain, avgCi, variants[]}`

## Key Files

| File | Purpose |
|------|---------|
| `core/eloAttribution.ts` | `computeEloAttribution`, `aggregateByAgent`, `buildParentRatingResolver` |
| `core/rating.ts` | OpenSkill wrapper: `createRating`, `updateRating`, `updateDraw`, `isConverged`, `toEloScale` |
| `core/comparisonCache.ts` | Order-invariant SHA-256 cache for comparison results |
| `comparison.ts` | `compareWithBiasMitigation()`, `buildComparisonPrompt()`, `parseWinner()` |
| `core/reversalComparison.ts` | Generic `run2PassReversal()` runner shared by comparison.ts |
| `v2/rank.ts` | `rankPool()` — unified triage + Swiss fine-ranking |

## Related Documentation

- [Architecture](./architecture.md) — How rating fits into the pipeline iteration loop
- [Operations Overview](./agents/overview.md) — rankPool() operation details
- [Arena](./arena.md) — OpenSkill-based cross-run comparison (same algorithm, applied across generation methods)
- [Reference](./reference.md) — Configuration values for ranking
