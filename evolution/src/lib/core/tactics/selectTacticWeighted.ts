// Weighted random tactic selection for generationGuidance.
// Uses SeededRandom for reproducible dispatch across parallel agents.

import { SeededRandom } from '../../shared/seededRandom';

export interface GuidanceEntry {
  tactic: string;
  percent: number;
}

/**
 * Select a tactic from generationGuidance using weighted random sampling.
 * Deterministic given the same SeededRandom instance state.
 *
 * @param guidance - Array of {tactic, percent} entries (percentages normalized internally)
 * @param rng - SeededRandom instance for reproducible selection
 * @returns Selected tactic name
 */
export function selectTacticWeighted(
  guidance: ReadonlyArray<GuidanceEntry>,
  rng: SeededRandom,
): string {
  if (guidance.length === 0) {
    throw new Error('Cannot select from empty generationGuidance');
  }

  if (guidance.length === 1) {
    return guidance[0]!.tactic;
  }

  // Normalize percentages to [0, 1] cumulative distribution
  const total = guidance.reduce((sum, entry) => sum + entry.percent, 0);
  if (total <= 0) {
    throw new Error('Cannot select from generationGuidance with total percent <= 0');
  }

  // Build cumulative distribution
  const cumulative: Array<{ tactic: string; cumulativeProb: number }> = [];
  let runningSum = 0;
  for (const entry of guidance) {
    runningSum += entry.percent / total;
    cumulative.push({ tactic: entry.tactic, cumulativeProb: runningSum });
  }

  // Draw uniform random sample from [0, 1)
  const sample = rng.next();

  // Linear search through cumulative distribution
  for (const entry of cumulative) {
    if (sample < entry.cumulativeProb) {
      return entry.tactic;
    }
  }

  // Fallback for floating-point edge case: return last tactic
  return cumulative[cumulative.length - 1]!.tactic;
}
