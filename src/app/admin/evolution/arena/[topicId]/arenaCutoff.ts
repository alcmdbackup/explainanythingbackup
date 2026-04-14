// Top-15% eligibility cutoff computation for the arena leaderboard.

/** Z-score for 85th percentile (top 15%). Matches ELIGIBILITY_Z_SCORE in rankVariants.ts. */
const ELIGIBILITY_Z_SCORE = 1.04;

/** Minimum entries required to compute a meaningful cutoff. */
const MIN_ENTRIES_FOR_CUTOFF = 3;

/**
 * Compute the Elo cutoff for top-15% eligibility.
 * Returns null when there are too few entries to compute a meaningful cutoff.
 */
export function computeEloCutoff(
  entries: Array<{ elo_score: number | null; uncertainty: number | null }>,
): number | null {
  const valid = entries.filter((e): e is { elo_score: number; uncertainty: number } =>
    e.elo_score != null && e.uncertainty != null,
  );
  if (valid.length < MIN_ENTRIES_FOR_CUTOFF) return null;

  const elos = valid.map(e => e.elo_score);
  const mean = elos.reduce((s, v) => s + v, 0) / elos.length;
  const variance = elos.reduce((s, v) => s + (v - mean) ** 2, 0) / elos.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return null;

  return mean + ELIGIBILITY_Z_SCORE * stdDev;
}
