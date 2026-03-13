// Shared helper functions for experiment data extraction.
// Separated from experimentActions.ts because 'use server' files require all exports to be async.

import { toEloScale } from '@evolution/lib/core/rating';

/** Extract topElo from run_summary JSONB. Same pattern as experiment-driver cron. */
export function extractTopElo(runSummary: Record<string, unknown> | null): number | null {
  if (!runSummary) return null;
  const topVariants = runSummary.topVariants as Array<{ mu?: number; ordinal?: number; elo?: number }> | undefined;
  if (!topVariants?.[0]) return null;
  if (topVariants[0].mu != null) return toEloScale(topVariants[0].mu);
  // V2 legacy: ordinal used the old Elo scale (1200 + ord * 16)
  if (topVariants[0].ordinal != null) return Math.max(0, Math.min(3000, 1200 + topVariants[0].ordinal * 16));
  return topVariants[0].elo ?? null;
}
