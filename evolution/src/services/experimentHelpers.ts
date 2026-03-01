// Shared helper functions for experiment data extraction.
// Separated from experimentActions.ts because 'use server' files require all exports to be async.

import { ordinalToEloScale } from '@evolution/lib/core/rating';

/** Extract topElo from run_summary JSONB. Same pattern as experiment-driver cron. */
export function extractTopElo(runSummary: Record<string, unknown> | null): number | null {
  if (!runSummary) return null;
  const topVariants = runSummary.topVariants as Array<{ ordinal?: number; elo?: number }> | undefined;
  if (!topVariants?.[0]) return null;
  if (topVariants[0].ordinal != null) return ordinalToEloScale(topVariants[0].ordinal);
  return topVariants[0].elo ?? null;
}
