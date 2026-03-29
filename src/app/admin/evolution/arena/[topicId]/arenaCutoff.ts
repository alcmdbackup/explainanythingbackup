// Top-15% eligibility cutoff computation for the arena leaderboard.

import { toEloScale } from '@evolution/lib/shared/computeRatings';

/** Z-score for 85th percentile (top 15%). Matches ELIGIBILITY_Z_SCORE in rankVariants.ts. */
const ELIGIBILITY_Z_SCORE = 1.04;

/** Minimum entries required to compute a meaningful cutoff. */
const MIN_ENTRIES_FOR_CUTOFF = 3;

/**
 * Compute the Elo cutoff for top-15% eligibility.
 * Returns null when there are too few entries to compute a meaningful cutoff.
 */
export function computeEloCutoff(
  entries: Array<{ mu: number | null; sigma: number | null }>,
): number | null {
  const valid = entries.filter((e): e is { mu: number; sigma: number } =>
    e.mu != null && e.sigma != null,
  );
  if (valid.length < MIN_ENTRIES_FOR_CUTOFF) return null;

  const elos = valid.map(e => toEloScale(e.mu));
  const mean = elos.reduce((s, v) => s + v, 0) / elos.length;
  const variance = elos.reduce((s, v) => s + (v - mean) ** 2, 0) / elos.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return null;

  return mean + ELIGIBILITY_Z_SCORE * stdDev;
}
