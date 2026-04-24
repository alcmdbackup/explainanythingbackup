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
 * Thrown by {@link selectWinner} when the pool has no rated candidates (B035). Previously
 * the function returned `{ elo: -Infinity, uncertainty: Infinity }`, which JSON-serialized
 * to `null` in some paths and was accepted by DB NUMERIC writers only to land as NaN in
 * PostgreSQL. Failing fast surfaces the missing-rating condition at the source.
 */
export class NoRatedCandidatesError extends Error {
  constructor(poolSize: number) {
    super(`selectWinner: no rated candidates in pool (pool size: ${poolSize})`);
    this.name = 'NoRatedCandidatesError';
  }
}

/**
 * Select the winner from a pool of candidates using their ratings.
 * Highest elo wins; ties broken by lowest uncertainty.
 * B035: throws `NoRatedCandidatesError` if no candidate has a rating entry — previously
 * this path returned `{ elo: -Infinity, uncertainty: Infinity }` which poisoned DB writes.
 *
 * @throws {Error} if pool is empty
 * @throws {NoRatedCandidatesError} if no candidate has a rating
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
  let foundRated = false;

  for (const v of pool) {
    const r = ratings.get(v.id);
    if (!r) continue;
    foundRated = true;
    const elo = r.elo;
    const uncertainty = r.uncertainty;
    if (elo > bestElo || (elo === bestElo && uncertainty < bestUncertainty)) {
      bestElo = elo;
      bestUncertainty = uncertainty;
      winnerId = v.id;
    }
  }

  if (!foundRated) {
    throw new NoRatedCandidatesError(pool.length);
  }

  return { winnerId, elo: bestElo, uncertainty: bestUncertainty };
}
