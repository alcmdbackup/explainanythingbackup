// Shared helper functions for experiment data extraction.
// Separated from experimentActions.ts because 'use server' files require all exports to be async.

import { toEloScale } from '@evolution/lib/core/rating';

/** Extract topElo from run_summary JSONB. Same pattern as experiment-driver cron. */
export function extractTopElo(runSummary: Record<string, unknown> | null): number | null {
  if (!runSummary) return null;
  const topVariants = runSummary.topVariants as Array<{ mu?: number; ordinal?: number; elo?: number }> | undefined;
  if (!topVariants?.[0]) return null;
  if (topVariants[0].mu != null) return toEloScale(topVariants[0].mu);
  if (topVariants[0].ordinal != null) return toEloScale(topVariants[0].ordinal);  // V2 fallback
  return topVariants[0].elo ?? null;
}
