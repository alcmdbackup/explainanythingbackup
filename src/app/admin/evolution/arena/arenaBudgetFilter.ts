// Budget tier filtering logic for arena leaderboard entries.
// Extracted for testability and reuse.

import type { ArenaEloEntry } from '@evolution/services/arenaActions';

export type BudgetTier = 'all' | '0.25' | '0.50' | '1.00';

/** Filter leaderboard entries by budget tier. Entries with null budget only appear in 'all'. */
export function filterByBudgetTier(
  leaderboard: ArenaEloEntry[],
  tier: BudgetTier,
): ArenaEloEntry[] {
  if (tier === 'all') return leaderboard;
  const maxBudget = parseFloat(tier);
  const minBudget = tier === '0.25' ? 0 : tier === '0.50' ? 0.25 : 0.50;
  return leaderboard.filter((e) => {
    if (e.run_budget_cap_usd == null) return false;
    return e.run_budget_cap_usd > minBudget && e.run_budget_cap_usd <= maxBudget;
  });
}
