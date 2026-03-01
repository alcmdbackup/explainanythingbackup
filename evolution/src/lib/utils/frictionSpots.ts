// Shared helper to extract friction spots for a specific variant from match history.
// Collects and deduplicates friction sentences relevant to a given variant ID.

import type { Match } from '../types';

/**
 * Collect friction spots for a given variant from match history.
 * Returns deduplicated friction sentences from all matches where the variant participated.
 */
export function getVariantFrictionSpots(variantId: string, matchHistory: Match[]): string[] {
  const spots: string[] = [];
  for (const match of matchHistory) {
    if (!match.frictionSpots) continue;
    if (match.variationA === variantId) {
      spots.push(...match.frictionSpots.a);
    } else if (match.variationB === variantId) {
      spots.push(...match.frictionSpots.b);
    }
  }
  return [...new Set(spots)];
}

/**
 * Format friction spots as a prompt section. Returns empty string if no spots.
 */
export function formatFrictionSpots(frictionSpots: string[]): string {
  if (frictionSpots.length === 0) return '';
  return `\n## Known Friction Points (from prior comparisons)
These specific issues were identified in comparative analysis — pay special attention to addressing them:
${frictionSpots.map(s => `- ${s}`).join('\n')}
`;
}
