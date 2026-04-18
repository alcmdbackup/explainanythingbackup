// Pure helpers for computing pool-eligibility ID sets from a ratings map.
// Used by resolveParent() to build the eligible parent pool for pool-mode iterations.

import type { Rating } from '../../shared/computeRatings';

/**
 * Return the IDs of the top N variants by ELO. Ties broken by lexicographic ID for determinism.
 * If n >= pool size, returns all IDs. If n <= 0 or pool is empty, returns [].
 */
export function computeTopNIds(
  ratings: ReadonlyMap<string, Rating>,
  n: number,
): string[] {
  if (n <= 0 || ratings.size === 0) return [];
  const entries = Array.from(ratings.entries());
  entries.sort((a, b) => {
    const eloDiff = b[1].elo - a[1].elo;
    if (eloDiff !== 0) return eloDiff;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  return entries.slice(0, n).map((e) => e[0]);
}

/**
 * Return the IDs of variants in the top X% by ELO. pct is 0 < pct <= 100.
 * Always returns at least 1 variant if the pool is non-empty (rounded up via Math.ceil).
 */
export function computeTopPercentIds(
  ratings: ReadonlyMap<string, Rating>,
  pct: number,
): string[] {
  if (pct <= 0 || ratings.size === 0) return [];
  const n = Math.max(1, Math.ceil((pct / 100) * ratings.size));
  return computeTopNIds(ratings, n);
}
