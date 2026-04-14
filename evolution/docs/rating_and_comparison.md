# Rating and Comparison

This document covers the ranking subsystem: Elo ratings with per-variant uncertainty,
ranking algorithms, bias-mitigated comparisons, winner parsing, and comparison caching.
Together these components turn pairwise LLM judgments into stable skill estimates for
every text variant in the pool.

> **Related research:** Empirical judge model agreement data (80 calls/model,
> 4 temperatures, 2 variant pairs) across 5 judge models (nano, mini, deepseek,
> gpt-oss-20b, qwen3-8b, qwen-2.5-7b) is preserved in
> [`docs/research/judge_agreement_summary_tables.md`](../../docs/research/judge_agreement_summary_tables.md).
> The beta=0 choice, Qwen 2.5 7B default judge, and parseWinner "Your answer:"
> fallback all trace to findings in that document.

> **Architecture note (Phase: orchestrator-driven parallel pipeline).** Ranking is
> now split across two distinct algorithms, each owned by a different agent:
>
> - **Binary-search single-variant ranking** (`rankSingleVariant`) lives inside
>   `GenerateFromSeedArticleAgent`. Each parallel generate agent ranks its newly
>   generated variant against a deep-cloned local snapshot of the iteration-start
>   pool/ratings/matchCounts, using a continuous opponent-selection formula
>   (`entropy(pWin) / uncertainty^UNCERTAINTY_WEIGHT`). Stops on convergence, elimination,
>   opponent exhaustion, or budget. The agent owns the surface/discard decision locally.
>
> - **Swiss pair comparisons** (`SwissRankingAgent`) refine the eligible top-15% pool
>   in subsequent iterations. Pairs are computed by `swissPairing()` (overlap allowed,
>   capped at `MAX_PAIRS_PER_ROUND`), dispatched in parallel, and the raw match buffer
>   is handed to `MergeRatingsAgent` which applies rating updates (OpenSkill internally,
>   projected into Elo space) to the global ratings in randomized (Fisher-Yates) order.
>   The merge agent is dispatched unconditionally so paid-for matches always reach global
>   ratings even on budget exit.
>
> The legacy two-phase `triage + Swiss` flow described in the "Two-Phase Ranking
> Pipeline" section below has been replaced by this orchestrator-driven model. The
> opponent-selection rationale (low-uncertainty preference, information-gain reasoning)
> still applies — it is now realised through the continuous entropy/uncertainty formula
> instead of stratified quartile sampling.

## Elo Ratings with Uncertainty

**Source:** `evolution/src/lib/shared/rating.ts`

The public API is framed in Elo terms. Each variant carries two numbers:

| Field         | Meaning                                           | Default             |
|---------------|---------------------------------------------------|---------------------|
| `elo`         | Skill estimate (center), Elo-scale                | 1200                |
| `uncertainty` | Standard deviation around `elo`, Elo-scale        | 400/3 ≈ 133.33      |

`uncertainty` shrinks with every match. When `uncertainty < DEFAULT_CONVERGENCE_UNCERTAINTY (72)`,
the rating is considered converged -- enough data has been observed to be confident in
the estimate.

> **Implementation note.** Under the hood, rating updates use
> [OpenSkill](https://github.com/philihp/openskill.js) (Weng-Lin Bayesian model). The
> OpenSkill `mu`/`sigma` fields are encapsulated inside `computeRatings.ts` (the adapter);
> the public API exposes only Elo-scale `{elo, uncertainty}`. The DB boundary (see
> `dbToRating` / `ratingToDb`) converts between the legacy `evolution_variants.mu`/`sigma`
> columns and the public `Rating` type — those columns are unchanged to preserve the
> stale trigger and `sync_to_arena` RPC.

### Why Track Uncertainty

Traditional Elo has no concept of uncertainty: a new player and a 1000-game veteran both
update by the same K-factor formula. Tracking `uncertainty` explicitly lets new entrants
see large rating swings (high uncertainty) while established variants barely move (low
uncertainty). This property is critical for the evolution pipeline, where new variants
are generated every iteration and must be calibrated quickly against the existing pool
without destabilizing established rankings.

The `Rating` type is a simple object:

```typescript
export type Rating = { elo: number; uncertainty: number };
```

### Constants Reference

| Constant                          | Value    | Purpose                                                                 |
|-----------------------------------|----------|-------------------------------------------------------------------------|
| `DEFAULT_ELO`                     | 1200     | Starting skill estimate (Elo-scale)                                     |
| `DEFAULT_UNCERTAINTY`             | 400/3 ≈ 133.33 | Starting uncertainty (Elo-scale)                                  |
| `DEFAULT_CONVERGENCE_UNCERTAINTY` | 72       | Uncertainty below which rating is "settled" (Elo-scale; formerly `DEFAULT_CONVERGENCE_SIGMA=4.5`, scaled by 16) |
| `DECISIVE_CONFIDENCE_THRESHOLD`   | 0.6      | Arena-level decisive match threshold                                    |
| `BETA_ELO`                        | `DEFAULT_UNCERTAINTY * sqrt(2)` ≈ 188.6 | Bradley-Terry scale (Elo space)                          |
| `beta` (openskill, internal)      | 0        | Performance variability passed to `osRate()`. Zero assumed noise — ratings update aggressively per match. Safe for text quality ranking where 2-pass reversal mitigates judge noise. See [`docs/research/judging_accuracy_20260412.md`](../../docs/research/judging_accuracy_20260412.md) for empirical calibration data. |

### Core Functions

```typescript
/** Create a fresh rating with default elo/uncertainty. */
export function createRating(): Rating; // {elo: 1200, uncertainty: 400/3}

/** Update ratings after a decisive match. Returns [newWinner, newLoser]. */
export function updateRating(winner: Rating, loser: Rating): [Rating, Rating];

/** Update ratings after a draw. Returns [newA, newB]. */
export function updateDraw(a: Rating, b: Rating): [Rating, Rating];

/** Check if a rating has converged (uncertainty below Elo-scale threshold). */
export function isConverged(r: Rating, threshold?: number): boolean;
```

`updateRating()` and `updateDraw()` wrap the internal OpenSkill adapter (converting
`{elo, uncertainty}` → OpenSkill space, applying `osRate()`, converting back). Both
calls reduce `uncertainty` for every participant, even losers -- uncertainty always
decreases when you observe an outcome.

### Rating Invariants (Property-Tested)

The following invariants are verified by property-based tests in `computeRatings.property.test.ts` using `fast-check` against the real openskill library:

- **Uncertainty decrease:** Both players' uncertainty decreases after `updateRating()` and `updateDraw()` (above OpenSkill's internal convergence floor; very low uncertainties may fluctuate slightly).
- **Finite outputs:** All `elo` and `uncertainty` values after any rating update are finite numbers.
- **Draw symmetry:** `updateDraw(a, b)` and `updateDraw(b, a)` produce symmetric results.
- **Display-Elo monotonicity:** `toDisplayElo()` is monotonically increasing in `elo`.
- **Display-Elo range:** `toDisplayElo()` output is always in [0, 3000].
- **Aggregation shape:** `aggregateWinners()` always returns a valid `ComparisonResult` with winner in {A, B, TIE}, confidence in [0, 1], and turns = 2.

### Display Clamping

For UI display (leaderboards, the [Arena](./arena.md) UI), raw `elo` is clamped to a
0-3000 range via `toDisplayElo(elo)`:

```
displayElo = clamp(elo, 0, 3000)
```

A fresh variant starts at 1200. The clamp is purely cosmetic -- all internal ranking math
operates on unclamped `{elo, uncertainty}`.

A related helper, `computeEloPerDollar()`, divides the Elo delta above 1200 by total cost
in USD, giving a cost-efficiency metric surfaced in the Arena dashboard.

> **Note:** A 400-Elo gap corresponds to ~10:1 win odds, matching chess convention.

> **DB boundary helpers:** `dbToRating(mu, sigma)` lifts the unchanged
> `evolution_variants.mu`/`sigma` columns to `{elo, uncertainty}`, and `ratingToDb(r)`
> projects a public `Rating` back down for persistence. A private `toEloScale()` helper
> implements the underlying conversion. These helpers are the only code paths that
> should touch OpenSkill-scale numbers.

---

## Elo Confidence Intervals

Run-level elo metrics carry uncertainty information derived directly from the source
variant's `uncertainty` field. This propagates the rating system's built-in uncertainty
into the metrics layer.

### Run-Level CI (From Variant Uncertainty)

For run-level metrics like `winner_elo`, the 95% CI is computed directly from the winning
variant's Elo-scale uncertainty:

```
ci_lower = elo - 1.96 * uncertainty
ci_upper = elo + 1.96 * uncertainty
```

These are stored in the `uncertainty`, `ci_lower`, and `ci_upper` columns of the
`evolution_metrics` row. A variant with low uncertainty (well-calibrated) produces a
tight CI; a variant with high uncertainty (few matches) produces a wide CI.

### Propagated CI (Bootstrap)

At the strategy and experiment level, elo metrics are aggregated across multiple runs using `bootstrap_mean` aggregation. The CI at these levels comes from `bootstrapMeanCI()` — a resampling-based estimate of the mean's uncertainty — not from the per-variant uncertainty. This is appropriate because the cross-run variance (different runs producing different winner elos) is the dominant source of uncertainty at the aggregate level.

---

## Two-Phase Ranking Pipeline

**Source:** `evolution/src/lib/pipeline/rank.ts`

The public entry point is `rankPool()`. It orchestrates two phases -- triage then Swiss
fine-ranking -- and returns a `RankResult`:

```typescript
export interface RankResult {
  matches: V2Match[];                       // all matches from both phases
  ratingUpdates: Record<string, Rating>;    // full rating snapshot (every variant)
  matchCountIncrements: Record<string, number>; // per-variant deltas this round
  converged: boolean;
}
```

### Flow Diagram

```
                         rankPool()
                            |
                  +---------+---------+
                  |                   |
            Has existing         All new
            + new entrants?      (first iter)
                  |                   |
           Phase 1: Triage      skip triage
                  |                   |
                  +----->+<-----------+
                         |
                  Phase 2: Swiss
                  Fine-Ranking
                         |
                    RankResult
                    {matches, ratingUpdates,
                     matchCountIncrements,
                     converged}
```

### Phase 1 -- Triage (New Entrant Calibration)

Triage gives each new variant a quick skill estimate by matching it against a stratified
sample of existing variants. This avoids wasting expensive Swiss rounds on variants that
are clearly weak.

**Entry criteria:** variants whose Elo-scale uncertainty is above the calibration
threshold (formerly `sigma >= 5.0`, now the Elo-scale equivalent).
Already-calibrated variants skip triage entirely.

**Opponent selection** (`selectOpponents()`): for `n=5` calibration opponents, the system
picks from the sorted pool:

- 2 from the top quartile
- 2 from the middle
- 1 from the bottom quartile (preferring fellow new entrants)

Within each quartile slice, candidates are sub-sorted by uncertainty ascending before picking, so **low-uncertainty opponents are preferred**. This uncertainty-weighted selection means new entrants are more likely to face well-calibrated anchors. Matching against a low-uncertainty opponent is roughly 2x more effective per match due to cubic scaling -- the information gain scales as uncertainty_opponent^3 / c^3, so halving opponent uncertainty yields ~8x less noise per comparison.

This stratified approach ensures new variants are tested against a representative cross-
section rather than clustered at one skill level. When the pool is too small for proper
stratification (fewer than `n - 1` existing variants), the function falls back to padding
with fellow new entrants. When no existing variants have ratings yet (first iteration
with prior entrants), it uses position-based selection from the sorted list.

The number of calibration opponents defaults to 5 but is configurable via
`config.calibrationOpponents`.

**Early exit conditions** -- after at least 2 matches (`MIN_TRIAGE_OPPONENTS`):

1. **Decisive exit:** at least 2 matches with confidence >= 0.7 AND average confidence
   across all matches >= 0.8. The variant's skill is sufficiently clear.
2. **Elimination:** `elo + 2 * uncertainty < top20Cutoff`. Even the optimistic bound (elo
   plus two standard deviations) falls below the top 20% of the pool. The variant is
   marked eliminated and excluded from Phase 2.

### Phase 2 -- Swiss Fine-Ranking

Swiss-system pairing matches similarly-rated variants to maximize information gain per
comparison. Only variants that survived triage participate.

**Eligibility filter:** a variant enters Phase 2 if it was not eliminated AND either:
- `r.elo + ELIGIBILITY_Z_SCORE * r.uncertainty >= top15Cutoff` (upper-bound estimate reaches the top 15%, all Elo-scale), OR
- it is in the current top-K by `elo` (default K=5, configurable via `config.tournamentTopK`)

`ELIGIBILITY_Z_SCORE` is 1.04 (the 85th percentile z-score). `top15Cutoff` is the `elo`
of the variant at the 15th percentile of non-eliminated variants, recomputed each Swiss
round as ratings change. This upper-bound check asks: could this variant plausibly be in
the top tier? If the optimistic projection of its skill reaches the cutoff, it remains
eligible.

The top-K safety net ensures the current best variants by `elo` always participate in
fine-ranking regardless of their uncertainty, which matters when a strong variant has
been recently generated and still has high uncertainty.

**Minimum pool floor:** if fewer than 3 variants pass the eligibility filter, the system
falls back to the top-3 variants by `elo`. This prevents degenerate rounds where too few
variants are eligible for meaningful pairwise comparisons.

Both `topKIds` and `top15Cutoff` are recomputed at the start of each Swiss round, so
eligibility adapts as ratings shift during fine-ranking.

**Bradley-Terry pairing.** For each candidate pair `(A, B)`, in Elo space:

```
pWin = 1 / (1 + exp(-(eloA - eloB) / BETA_ELO))
```

where `BETA_ELO = DEFAULT_UNCERTAINTY * sqrt(2) ≈ 188.6`. The pairing score combines
outcome uncertainty with average rating uncertainty:

```
outcomeUncertainty = 1 - |2 * pWin - 1|
pairScore = outcomeUncertainty * avgUncertainty
```

Pairs with the highest score are selected greedily (descending score, no variant used
twice per round). Already-completed pairs (tracked in a `completedPairs` Set using
order-invariant keys) are excluded from candidate generation, preventing rematches.

**Termination.** The Swiss loop runs up to 20 rounds and exits when:

- The budget-tier comparison limit is reached (see below), or
- All eligible variants have `uncertainty < DEFAULT_CONVERGENCE_UNCERTAINTY` for 2 consecutive rounds, or
- No new pairs remain

**Budget tiers** control the maximum number of comparisons in Phase 2:

| Budget fraction consumed | Tier   | Max comparisons |
|--------------------------|--------|-----------------|
| < 50%                    | low    | 40              |
| 50% - 79%               | medium | 25              |
| >= 80%                   | high   | 15              |

As the run consumes more of its budget, the ranking phase becomes more conservative,
preserving remaining budget for generation.

> **Note:** Draw handling is consistent across both phases. A match is treated as a draw
> when `confidence < 0.3` or `winnerId === loserId`. Both triage and fine-ranking use the
> same threshold and both call `updateDraw()` which shifts both ratings toward each other.

---

## Bias Mitigation: 2-Pass A/B Reversal

**Sources:** `evolution/src/lib/comparison.ts`, `evolution/src/lib/shared/reversalComparison.ts`

LLMs exhibit position bias -- they tend to favor whichever text appears first (or last,
depending on the model). The system mitigates this with a two-pass reversal protocol.

### The Reversal Framework

`run2PassReversal()` in `reversalComparison.ts` is a generic runner:

1. Build two prompts (forward: A then B; reverse: B then A).
2. Call the LLM on both prompts **in parallel** (`Promise.all`).
3. Parse each response.
4. Aggregate the two parsed results into a final verdict.

The framework is generic over `<TParsed, TResult>`, enabling reuse for both A/B pairwise
comparisons and diff-based direction reversal.

```typescript
export interface ReversalConfig<TParsed, TResult> {
  buildPrompts: () => { forward: string; reverse: string };
  callLLM: (prompt: string) => Promise<string>;
  parseResponse: (response: string) => TParsed;
  aggregate: (forwardParsed: TParsed, reverseParsed: TParsed) => TResult;
}

export async function run2PassReversal<TParsed, TResult>(
  config: ReversalConfig<TParsed, TResult>,
): Promise<TResult>;
```

For the pairwise comparison use case, `TParsed` is `string | null` (the output of
`parseWinner()`) and `TResult` is `ComparisonResult`. The `aggregate` function is
`aggregateWinners()`, described next.

### Confidence Scoring

`aggregateWinners()` in `comparison.ts` maps the two parsed responses to a confidence
level. The reverse-pass result is flipped back to the original A/B frame before comparison.

| Forward | Reverse (flipped) | Result     | Confidence |
|---------|-------------------|------------|------------|
| A       | A                 | A wins     | 1.0        |
| B       | B                 | B wins     | 1.0        |
| TIE     | TIE               | TIE        | 1.0        |
| A       | TIE               | A wins     | 0.7        |
| TIE     | B                 | B wins     | 0.7        |
| A       | B                 | TIE        | 0.5        |
| A       | null              | A wins     | 0.3        |
| null    | null              | TIE        | 0.0        |

The rules:

- **Both agree** (same winner after flip): confidence 1.0
- **One says TIE** (the other picks a winner): confidence 0.7, the non-TIE result wins
- **Disagree** (one says A, the other says B): confidence 0.5, result forced to TIE
- **Partial failure** (one pass returns null): confidence 0.3, use the surviving result
- **Total failure** (both null): confidence 0.0, result is TIE

**Draw logic in the ranking pipeline:** a match is treated as a draw when
`confidence < 0.3` OR the result is already `'draw'`. This means partial and total
failures never move ratings in a decisive direction.

> **Note:** The two LLM calls run concurrently via `Promise.all`, so bias mitigation does
> not double wall-clock latency -- only cost.

---

## parseWinner() Priority

**Source:** `evolution/src/lib/comparison.ts` (function `parseWinner`)

LLM responses are noisy. The parser uses a strict priority chain to extract a winner
label, designed to avoid ambiguous matches (e.g., "ACTUALLY B" should not match 'A' via
a naive `startsWith` check).

**Priority order:**

1. **Exact token.** The trimmed, uppercased response is exactly `"A"`, `"B"`, or `"TIE"`.
2. **Phrase match.** Contains `"TEXT A"` or `"TEXT B"` (but not both -- ambiguous cases
   fall through).
3. **TIE keywords.** Contains `"TIE"`, `"DRAW"`, or `"EQUAL"`.
4. **First-word match.** The first whitespace-delimited token is `"A"`, `"A."`, `"A,"`,
   `"B"`, `"B."`, or `"B,"`.
5. **null.** Unparseable -- the response did not match any pattern.

The function is annotated with `PARSE-4` in the source, referring to the fourth iteration
of the parsing logic. Earlier versions were vulnerable to ambiguous matches -- for example,
a response like "ACTUALLY B IS BETTER" would incorrectly match 'A' via a naive
`startsWith('A')` check. The current version avoids this by requiring exact first-word
matches in step 4 and checking for `"TEXT A"` / `"TEXT B"` phrases (which are more specific)
before falling through to keyword or positional checks.

> **Warning:** Returning `null` triggers the partial-failure path in `aggregateWinners()`
> (confidence 0.3 if the other pass succeeded, 0.0 if both failed). Prompt the judge
> model to respond with a single token when possible.

---

## Comparison Cache

**Source:** `evolution/src/lib/shared/comparisonCache.ts`

The `ComparisonCache` class eliminates redundant LLM calls when the same text pair is
re-encountered across iterations.

### Key Design

Cache keys are **order-invariant**: the two text contents are independently SHA-256 hashed,
then the hashes are sorted lexicographically before concatenation. This means
`compare(A, B)` and `compare(B, A)` hit the same cache entry. The key also encodes whether
the comparison was structured and the comparison mode (defaulting to `'quality'`).

Individual text-to-hash mappings are cached in a secondary `textHashCache` Map to avoid
re-hashing the same content across different pairs.

### Cache Key Format

The full key format is `${hashA}|${hashB}|${structured}|${mode}` where:
- `hashA` and `hashB` are the SHA-256 hex digests of the two texts, sorted lexicographically
- `structured` is a boolean indicating whether structured comparison was used
- `mode` defaults to `'quality'`

Because the hashes are sorted, the key is the same regardless of argument order.

### Eviction

LRU eviction based on `Map` insertion order. When the cache exceeds `MAX_CACHE_SIZE` (500
entries), the oldest entries are deleted until the cache is within bounds.

### What Gets Cached

Only results where a winner was resolved (`winnerId !== null`) or an explicit draw
(`isDraw === true`) are cached. Error results and null outcomes are **not** cached, allowing
the system to retry on the next encounter.

At the `compareWithBiasMitigation()` level, an additional filter applies: only results
with `confidence > 0.3` are cached. Partial failures (0.3) and total failures (0.0) are
excluded.

### Lifetime

The `ComparisonCache` supports serialization via `entries()` and restoration via
`ComparisonCache.fromEntries()`. This enables checkpoint persistence across pipeline
restarts. The `fromEntries()` method respects `maxSize`, keeping only the most recent
entries if the input exceeds the limit.

```typescript
// Persist
const serialized = cache.entries();

// Restore
const restored = ComparisonCache.fromEntries(serialized, 500);
```

---

## Comparison Prompt Structure

**Source:** `evolution/src/lib/comparison.ts` (function `buildComparisonPrompt`)

The prompt presented to the judge model evaluates five criteria:

1. **Clarity and readability**
2. **Structure and flow**
3. **Engagement and impact**
4. **Grammar and style**
5. **Overall effectiveness**

The prompt instructs the model to respond with exactly one of `"A"`, `"B"`, or `"TIE"`.
The two texts are labeled `## Text A` and `## Text B` with no additional framing that
might bias the judge.

In the reverse pass, the texts swap positions: what was Text A becomes Text B and vice
versa. The `flipWinner()` function translates the reverse-pass response back to the
original frame before aggregation.

> **Note:** The prompt deliberately avoids mentioning which text is the "original" or
> "evolved" version. The judge sees only "Text A" and "Text B" with no metadata about
> provenance, generation method, or iteration number. This prevents the judge from
> developing a bias toward novelty or incumbency.

---

## How the Pieces Connect

The ranking subsystem sits between generation and selection in the
[pipeline loop](./architecture.md). After the generation phase produces new text variants,
`rankPool()` is called to integrate them into the existing rating pool. The function:

1. Initializes fresh `{elo: 1200, uncertainty: 400/3}` ratings for any variant not yet rated.
2. Runs triage to calibrate new entrants (or skips it on the first iteration when all
   variants are new).
3. Runs Swiss fine-ranking to refine ratings among survivors.
4. Returns the full rating snapshot, which is persisted to the [data model](./data_model.md).

The `compareWithBiasMitigation()` function is the single comparison primitive used by both
phases. It handles prompt construction, 2-pass reversal, parsing, confidence scoring, and
caching. Neither the triage nor Swiss code interacts with the LLM directly -- they call
`runComparison()`, which delegates to `compareWithBiasMitigation()`.

Match results and rating snapshots flow downstream to the [Arena](./arena.md) for display
and to the selection/evolution logic for choosing parents and culling weak variants.

---

## Cross-References

- [Architecture](./architecture.md) -- pipeline structure and the generate-rank-evolve loop
- [Agents](./agents/overview.md) -- how generated variants enter the ranking pool
- [Data Model](./data_model.md) -- persistence of ratings, matches, and match counts
- [Arena](./arena.md) -- public-facing Elo display and leaderboard
- [Cost Optimization](./cost_optimization.md) -- budget tiers and their effect on ranking
