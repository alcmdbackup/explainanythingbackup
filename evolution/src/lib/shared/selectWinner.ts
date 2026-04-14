// Unified winner selection: highest elo, tie-broken by lowest uncertainty. Replaces duplicated logic
// in runIterationLoop.ts and persistRunResults.ts with consistent unrated-variant semantics.

import type { Rating } from './computeRatings';

export interface WinnerCandidate {
  id: string;
}

export interface SelectWinnerResult {
  winnerId: string;
  elo: number;
  uncertainty: number;
}

/**
 * Select the winner from a pool of candidates using their ratings.
 * Highest elo wins; ties broken by lowest uncertainty.
 * Unrated variants get elo=-Infinity, uncertainty=Infinity (they explicitly lose).
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
  let bestElo = -Infinity;
  let bestUncertainty = Infinity;

  for (const v of pool) {
    const r = ratings.get(v.id);
    const elo = r?.elo ?? -Infinity;
    const uncertainty = r?.uncertainty ?? Infinity;
    if (elo > bestElo || (elo === bestElo && uncertainty < bestUncertainty)) {
      bestElo = elo;
      bestUncertainty = uncertainty;
      winnerId = v.id;
    }
  }

  return { winnerId, elo: bestElo, uncertainty: bestUncertainty };
}
