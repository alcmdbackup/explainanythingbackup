// Utility for filtering arena entries by cost tier (low/medium/high).
// Thresholds: low < $0.10, medium $0.10-$0.50, high >= $0.50.

import type { ArenaEntry } from '@evolution/services/arenaActions';

export function filterByBudgetTier(
  entries: ArenaEntry[],
  tier: 'all' | 'low' | 'medium' | 'high',
): ArenaEntry[] {
  if (tier === 'all') return entries;

  return entries.filter((entry) => {
    const cost = entry.cost_usd;
    if (cost == null) return false;

    switch (tier) {
      case 'low':
        return cost < 0.10;
      case 'medium':
        return cost >= 0.10 && cost < 0.50;
      case 'high':
        return cost >= 0.50;
      default:
        return true;
    }
  });
}
