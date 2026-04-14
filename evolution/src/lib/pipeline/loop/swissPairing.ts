// Swiss-system pair selection for the parallel evolution pipeline.
// Extracted (and modified) from the legacy rankVariants.ts swissPairing helper.
//
// Differences from the legacy version:
//   - Returns top-K candidate pairs by score (capped by MAX_PAIRS_PER_ROUND).
//   - DROPS the non-overlapping `used` set: a variant CAN appear in multiple pairs.
//     This lets a single SwissRankingAgent invocation dispatch all candidate pairs
//     in parallel via Promise.allSettled — even if two pairs share a variant, the
//     deferred merge in MergeRatingsAgent applies them sequentially in randomized order
//     so there's no race on rating state.

import type { Rating } from '../../shared/computeRatings';
import { createRating, DEFAULT_UNCERTAINTY } from '../../shared/computeRatings';

/** Bradley-Terry beta in Elo space (DEFAULT_UNCERTAINTY * sqrt(2) ≈ 188.56). */
const BETA_ELO = DEFAULT_UNCERTAINTY * Math.SQRT2;

/** Cap on candidate pairs returned per swiss iteration (matches LLM semaphore limit). */
export const MAX_PAIRS_PER_ROUND = 20;

/** Order-invariant pair key, sorted lexicographically. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

interface PairCandidate {
  idA: string;
  idB: string;
  score: number;
}

/**
 * Compute the top-K candidate pairs from `eligibleIds` by descending score.
 *
 * Score = outcomeUncertainty(pWin) * avgSigma — same formula as the legacy Swiss pairing,
 * but WITHOUT the non-overlapping greedy filter. Pairs in `completedPairs` are excluded.
 *
 * Returns at most MAX_PAIRS_PER_ROUND pairs. Empty array if no eligible pairs remain.
 */
export function swissPairing(
  eligibleIds: ReadonlyArray<string>,
  ratings: ReadonlyMap<string, Rating>,
  completedPairs: ReadonlySet<string>,
  maxPairs: number = MAX_PAIRS_PER_ROUND,
): Array<[string, string]> {
  if (eligibleIds.length < 2) return [];

  const candidates: PairCandidate[] = [];

  for (let i = 0; i < eligibleIds.length; i++) {
    for (let j = i + 1; j < eligibleIds.length; j++) {
      const idA = eligibleIds[i]!;
      const idB = eligibleIds[j]!;
      const key = pairKey(idA, idB);
      if (completedPairs.has(key)) continue;

      const rA = ratings.get(idA) ?? createRating();
      const rB = ratings.get(idB) ?? createRating();

      // Bradley-Terry win probability (Elo space)
      const pWin = 1 / (1 + Math.exp(-(rA.elo - rB.elo) / BETA_ELO));
      const outcomeUncertaintyVal = 1 - Math.abs(2 * pWin - 1);
      const uncertaintyWeight = (rA.uncertainty + rB.uncertainty) / 2;
      const score = outcomeUncertaintyVal * uncertaintyWeight;

      candidates.push({ idA, idB, score });
    }
  }

  // Sort by descending score and take the top-K (overlap allowed).
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, maxPairs);
  return top.map((c) => [c.idA, c.idB] as [string, string]);
}
