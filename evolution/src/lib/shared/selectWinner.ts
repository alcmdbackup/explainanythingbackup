// Unified winner selection: highest mu, tie-broken by lowest sigma. Replaces duplicated logic
// in runIterationLoop.ts and persistRunResults.ts with consistent unrated-variant semantics.

import type { Rating } from './computeRatings';

export interface WinnerCandidate {
  id: string;
}

export interface SelectWinnerResult {
  winnerId: string;
  mu: number;
  sigma: number;
}

/**
 * Select the winner from a pool of candidates using their ratings.
 * Highest mu wins; ties broken by lowest sigma.
 * Unrated variants get mu=-Infinity, sigma=Infinity (they explicitly lose).
 *
 * @throws {Error} if pool is empty
 */
export function selectWinner(
  pool: readonly WinnerCandidate[],
  ratings: ReadonlyMap<string, Rating>,
): SelectWinnerResult {
  if (pool.length === 0) {
    throw new Error('selectWinner: pool must not be empty');
  }

  let winnerId = pool[0]!.id;
  let bestMu = -Infinity;
  let bestSigma = Infinity;

  for (const v of pool) {
    const r = ratings.get(v.id);
    const mu = r?.mu ?? -Infinity;
    const sigma = r?.sigma ?? Infinity;
    if (mu > bestMu || (mu === bestMu && sigma < bestSigma)) {
      bestMu = mu;
      bestSigma = sigma;
      winnerId = v.id;
    }
  }

  return { winnerId, mu: bestMu, sigma: bestSigma };
}
