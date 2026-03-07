# Rating & Comparison

OpenSkill Bayesian rating system, Swiss-style tournament, bias mitigation, calibration, and comparison methods used within the evolution pipeline to rank text variants.

**Note:** The pipeline uses a single unified OpenSkill rating system. Arena entries are loaded into the pool at run start with their pre-existing ratings, so in-run ranking and cross-run Arena ranking share one continuous rating space. See [Arena](./arena.md) for Arena-specific details.

## OpenSkill Bayesian Rating System

Variants are rated using an OpenSkill (Weng-Lin Bayesian) rating system (`core/rating.ts`) where each variant has a `{mu, sigma}` pair: `mu` is the estimated skill and `sigma` is the uncertainty. New variants start at `mu=25, sigma=8.333`. After each pairwise comparison, the winner's `mu` increases and the loser's decreases, while both sigmas shrink (uncertainty decreases). The **ordinal** (`mu - 3*sigma`) provides a conservative skill estimate used for ranking — it penalizes variants with few matches (high sigma). The system converges when all sigmas fall below a threshold (default: 3.0). For backward compatibility with the existing `elo_score` DB column (0-3000 range), ordinal values are mapped via `ordinalToEloScale()`.

### Rating Updates

Rating updates use the OpenSkill pairwise functions (`core/rating.ts`):

- **`updateRating(winner, loser)`**: Updates both ratings after a decisive match. Winner's mu increases, loser's decreases, both sigmas shrink.
- **`updateDraw(a, b)`**: Updates both ratings toward each other (used when the result is a draw).
- **Draw detection**: A result is a draw when `confidence === 0` (complete disagreement between forward/reverse rounds) or `winnerId === loserId` (degenerate match). Any positive confidence with distinct winner/loser → `updateRating`. This is a binary check, not a threshold. Note: the `confidence >= 0.7` threshold used in adaptive calibration (see below) is for early-exit decisions only and is unrelated to draw detection.
- **Sigma-based convergence**: Unlike Elo's fixed K-factor, OpenSkill automatically adjusts update magnitude via sigma decay. High-sigma (uncertain) variants see larger updates; low-sigma (well-tested) variants see smaller updates.

## Swiss-Style Tournament (Info-Theoretic Pairing)

A pairing strategy that maximizes information gain per comparison. Before scoring pairs, an **eligibility filter** excludes variants that are both below baseline (ordinal < 0, i.e., confidently below Elo 1200) and outside the top K by ordinal (configurable via `tournament.topK`, default: 5). This means a variant participates if it's in the top K *or* above baseline — only variants that are both low-ranked and confidently weak are excluded. Among eligible variants, candidate pairs are scored by two factors: (1) **outcome uncertainty** — how close to 50/50 the expected result is, and (2) **sigma** — the real Bayesian uncertainty from the rating, giving priority to under-tested variants whose ratings are still uncertain. Pairs are selected greedily by descending score, skipping already-played and already-used variants. Convergence is sigma-based: the tournament stops when all *eligible* variant sigmas fall below the convergence threshold (default: 3.0) for 2 consecutive rounds (`convergenceChecks: 2`). The tournament also exits immediately when no new pairs remain (`maxStaleRounds: 1`).

### Logistic CDF Outcome Uncertainty

Outcome uncertainty is computed using a **logistic CDF** derived from the OpenSkill performance model. Given two variants with ordinals `ordA` and `ordB`:

```
BETA = DEFAULT_SIGMA * sqrt(2)    // performance spread parameter
pWin = 1 / (1 + exp(-(ordA - ordB) / BETA))
outcomeUncertainty = 1 - |2 * pWin - 1|
```

When ratings are equal (`ordA == ordB`), `pWin = 0.5` and uncertainty is maximal (1.0). As the gap grows, `pWin` approaches 0 or 1 and uncertainty drops to 0. This replaces the previous ad-hoc formula `1/(1 + ordGap/10)` with a principled model that uses the same sigma-derived BETA parameter as OpenSkill's internal performance model.

## Stratified Opponent Selection

For calibrating new entrants, opponents are drawn from different ordinal tiers rather than randomly. For n=5 opponents: 2 from the top quartile, 2 from the middle, and 1 from the bottom or fellow new entrants. This ensures a new variant is tested against both strong and weak competitors, producing a more accurate initial rating.

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

`compareWithBiasMitigation()` — the primary pairwise comparison function used by CalibrationRanker and Tournament:
- Builds comparison prompts via `buildComparisonPrompt()`
- Runs forward + reverse rounds concurrently via `run2PassReversal()` using `Promise.all`
- Parses winner via `parseWinner()` with position-awareness
- Returns `{winner, confidence}` with order-invariant SHA-256 caching
- Used for general-purpose variant ranking

### Diff-Based Comparison (`diffComparison.ts`)

`compareWithDiff()` — specialized comparison used by IterativeEditingAgent for judging surgical edits:
- Generates CriticMarkup diffs between original and edited text
- Presents the diff (not full texts) to the LLM judge
- Uses direction-reversal bias mitigation (forward + reverse diff passes)
- Evaluates whether the edit improved or degraded the text
- 3 verdict values: `ACCEPT | REJECT | UNSURE`. Counter-intuitively, **disagreement** between forward and reverse diff passes produces high confidence (the change clearly helps or hurts regardless of presentation order), while **agreement** produces `UNSURE` (both passes may be exhibiting the same position bias)

Both methods share the same position-bias mitigation principle (dual evaluation) but differ in what the judge sees: full texts vs. diffs. The shared 2-pass reversal pattern (`core/reversalComparison.ts`) provides a generic `run2PassReversal()` runner that both comparison methods delegate to, eliminating the duplicated forward+reverse orchestration logic.

## Creator-Based Elo Attribution

The pipeline's ranking agents (CalibrationRanker, Tournament) update variant ratings, but the **creating** agents (GenerationAgent, IterativeEditing, EvolutionAgent, etc.) are what actually produce the text. Elo attribution solves this by computing how much each variant's final rating differs from its parent(s), crediting the creating agent.

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
| `core/rating.ts` | OpenSkill wrapper: `createRating`, `updateRating`, `updateDraw`, `getOrdinal`, `isConverged`, `ordinalToEloScale` |
| `core/comparisonCache.ts` | Order-invariant SHA-256 cache for comparison results |
| `comparison.ts` | `compareWithBiasMitigation()`, `buildComparisonPrompt()`, `parseWinner()` |
| `diffComparison.ts` | `compareWithDiff()` — CriticMarkup diff-based comparison with direction reversal |
| `core/reversalComparison.ts` | Generic `run2PassReversal()` runner shared by comparison.ts and diffComparison.ts |
| `agents/tournament.ts` | Swiss-style tournament with info-theoretic pairing |
| `agents/calibrationRanker.ts` | Stratified opponent selection with adaptive early exit |

## Related Documentation

- [Architecture](./architecture.md) — How rating fits into the pipeline phases
- [Editing Agents](./agents/editing.md) — How diff-based comparison is used for edit judging
- [Agent Overview](./agents/overview.md) — CalibrationRanker and Tournament as ranking agents
- [Arena](./arena.md) — OpenSkill-based cross-run comparison (same algorithm, applied across generation methods)
- [Reference](./reference.md) — Configuration values for calibration and tournament
