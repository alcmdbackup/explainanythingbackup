# Rating & Comparison

OpenSkill Bayesian rating system, Swiss-style tournament, bias mitigation, calibration, and comparison methods used within the evolution pipeline to rank text variants.

**Note:** This doc covers the **within-run** rating system (OpenSkill). For the **cross-run** rating system (Elo K-32) used in the Hall of Fame, see [Hall of Fame](./hall_of_fame.md).

## OpenSkill Bayesian Rating System

Variants are rated using an OpenSkill (Weng-Lin Bayesian) rating system (`core/rating.ts`) where each variant has a `{mu, sigma}` pair: `mu` is the estimated skill and `sigma` is the uncertainty. New variants start at `mu=25, sigma=8.333`. After each pairwise comparison, the winner's `mu` increases and the loser's decreases, while both sigmas shrink (uncertainty decreases). The **ordinal** (`mu - 3*sigma`) provides a conservative skill estimate used for ranking — it penalizes variants with few matches (high sigma). The system converges when all sigmas fall below a threshold (default: 3.0). For backward compatibility with the existing `elo_score` DB column (0-3000 range), ordinal values are mapped via `ordinalToEloScale()`.

### Rating Updates

Rating updates use the OpenSkill pairwise functions (`core/rating.ts`):

- **`updateRating(winner, loser)`**: Updates both ratings after a decisive match. Winner's mu increases, loser's decreases, both sigmas shrink.
- **`updateDraw(a, b)`**: Updates both ratings toward each other (used for low-confidence comparisons).
- **Confidence-weighted updates**: When position-bias mitigation produces disagreement between rounds, the confidence score determines whether `updateRating` (confidence >= 0.7) or `updateDraw` (confidence < 0.7) is applied. Full agreement = decisive update. Disagreement = draw.
- **Sigma-based convergence**: Unlike Elo's fixed K-factor, OpenSkill automatically adjusts update magnitude via sigma decay. High-sigma (uncertain) variants see larger updates; low-sigma (well-tested) variants see smaller updates.

## Swiss-Style Tournament (Info-Theoretic Pairing)

A pairing strategy that maximizes information gain per comparison. Instead of greedy adjacent matching after ordinal sort, candidate pairs are scored by three factors: (1) **outcome uncertainty** — how close to 50/50 the expected result is (from ordinal gap), (2) **sigma** — the real Bayesian uncertainty from the rating, giving priority to under-tested variants whose ratings are still uncertain, and (3) **top-K boost** — a 1.5x multiplier when both variants are in the top third of the pool, since accurate ranking at the top matters most. Pairs are selected greedily by descending score, skipping already-played and already-used variants. Convergence is sigma-based: the tournament stops when all variant sigmas fall below the convergence threshold (default: 3.0).

## Stratified Opponent Selection

For calibrating new entrants, opponents are drawn from different ordinal tiers rather than randomly. For n=5 opponents: 2 from the top quartile, 2 from the middle, and 1 from the bottom or fellow new entrants. This ensures a new variant is tested against both strong and weak competitors, producing a more accurate initial rating.

## Adaptive Calibration

Calibration uses a batched parallelism strategy with early exit. The first batch of `minOpponents` (default: 2) opponents runs in parallel. If all matches are decisive (confidence >= 0.7), the entrant's rating is considered well-established and remaining opponents are skipped. Otherwise, remaining opponents run in a second parallel batch. This reduces LLM calls by ~40% for clear-cut variants while maintaining accuracy for borderline cases.

## LLM Response Cache (ComparisonCache)

Bias-mitigated comparison results are cached in-memory using SHA-256 order-invariant keys (`core/comparisonCache.ts`). Caching occurs at the `compareWithBiasMitigation()` level — not at `comparePair()` — to preserve the full forward+reverse bias mitigation protocol. Only valid results (confidence >= 0.5) are cached; partial failures (null winner, low confidence) are excluded to allow retry on the next encounter. The cache persists across iterations within a single run for cross-iteration deduplication.

## Position Bias in LLM-as-Judge

LLMs exhibit a well-documented tendency to favor whichever text appears first in a comparison prompt. To mitigate this, every pairwise comparison runs twice with reversed presentation order (A-vs-B, then B-vs-A) **concurrently via `Promise.all`** — the two calls are independent and halve wall-clock time per comparison. If both rounds agree on a winner, the result gets full confidence. If they disagree, the result is treated as a low-confidence draw.

## Comparison Methods

The pipeline uses two distinct comparison approaches:

### Standard Comparison (`comparison.ts`)

`compareWithBiasMitigation()` — the primary pairwise comparison function used by CalibrationRanker and Tournament:
- Builds comparison prompts via `buildComparisonPrompt()`
- Runs forward + reverse rounds concurrently via `Promise.all`
- Parses winner via `parseWinner()` with position-awareness
- Returns `{winner, confidence}` with order-invariant SHA-256 caching
- Used for general-purpose variant ranking

### Diff-Based Comparison (`diffComparison.ts`)

`compareWithDiff()` — specialized comparison used by IterativeEditingAgent for judging surgical edits:
- Generates CriticMarkup diffs between original and edited text
- Presents the diff (not full texts) to the LLM judge
- Uses direction-reversal bias mitigation (forward + reverse diff passes)
- Evaluates whether the edit improved or degraded the text
- 5-outcome truth table: ACCEPT, REJECT, UNSURE (from agreement/disagreement matrix)

Both methods share the same position-bias mitigation principle (dual evaluation) but differ in what the judge sees: full texts vs. diffs.

## Key Files

| File | Purpose |
|------|---------|
| `core/rating.ts` | OpenSkill wrapper: `createRating`, `updateRating`, `updateDraw`, `getOrdinal`, `isConverged`, `ordinalToEloScale` |
| `core/comparisonCache.ts` | Order-invariant SHA-256 cache for comparison results |
| `comparison.ts` | `compareWithBiasMitigation()`, `buildComparisonPrompt()`, `parseWinner()` |
| `diffComparison.ts` | `compareWithDiff()` — CriticMarkup diff-based comparison with direction reversal |
| `agents/tournament.ts` | Swiss-style tournament with info-theoretic pairing |
| `agents/calibrationRanker.ts` | Stratified opponent selection with adaptive early exit |

## Related Documentation

- [Architecture](./architecture.md) — How rating fits into the pipeline phases
- [Editing Agents](./agents/editing.md) — How diff-based comparison is used for edit judging
- [Agent Overview](./agents/overview.md) — CalibrationRanker and Tournament as ranking agents
- [Hall of Fame](./hall_of_fame.md) — The separate Elo K-32 system for cross-run comparison
- [Reference](./reference.md) — Configuration values for calibration and tournament
