// Tests for arena budget tier filtering logic.
import { filterByBudgetTier, type BudgetTier } from './arenaBudgetFilter';
import type { ArenaEloEntry } from '@evolution/services/arenaActions';

function makeEntry(overrides: Partial<ArenaEloEntry> = {}): ArenaEloEntry {
  return {
    id: 'id-1',
    entry_id: 'e1',
    mu: 25,
    sigma: 8.33,
    display_elo: 1500,
    elo_per_dollar: null,
    match_count: 10,
    generation_method: 'evolution_winner',
    model: 'gpt-4.1-mini',
    total_cost_usd: 0.30,
    created_at: '2026-01-01T00:00:00Z',
    run_cost_usd: null,
    evolution_run_id: null,
    strategy_label: null,
    experiment_name: null,
    run_budget_cap_usd: null,
    ci_lower: 1200,
    ci_upper: 1800,
    ...overrides,
  };
}

describe('filterByBudgetTier', () => {
  const entries: ArenaEloEntry[] = [
    makeEntry({ entry_id: 'e-null', run_budget_cap_usd: null }),
    makeEntry({ entry_id: 'e-010', run_budget_cap_usd: 0.10 }),
    makeEntry({ entry_id: 'e-025', run_budget_cap_usd: 0.25 }),
    makeEntry({ entry_id: 'e-030', run_budget_cap_usd: 0.30 }),
    makeEntry({ entry_id: 'e-050', run_budget_cap_usd: 0.50 }),
    makeEntry({ entry_id: 'e-075', run_budget_cap_usd: 0.75 }),
    makeEntry({ entry_id: 'e-100', run_budget_cap_usd: 1.00 }),
  ];

  it('returns all entries when tier is "all"', () => {
    const result = filterByBudgetTier(entries, 'all');
    expect(result).toHaveLength(7);
  });

  it('filters ≤$0.25 tier (0 < budget ≤ 0.25)', () => {
    const result = filterByBudgetTier(entries, '0.25');
    const ids = result.map(e => e.entry_id);
    expect(ids).toEqual(['e-010', 'e-025']);
  });

  it('filters $0.25–$0.50 tier (0.25 < budget ≤ 0.50)', () => {
    const result = filterByBudgetTier(entries, '0.50');
    const ids = result.map(e => e.entry_id);
    expect(ids).toEqual(['e-030', 'e-050']);
  });

  it('filters $0.50–$1.00 tier (0.50 < budget ≤ 1.00)', () => {
    const result = filterByBudgetTier(entries, '1.00');
    const ids = result.map(e => e.entry_id);
    expect(ids).toEqual(['e-075', 'e-100']);
  });

  it('excludes entries with null budget from non-all tiers', () => {
    const tiers: BudgetTier[] = ['0.25', '0.50', '1.00'];
    for (const tier of tiers) {
      const result = filterByBudgetTier(entries, tier);
      expect(result.every(e => e.run_budget_cap_usd != null)).toBe(true);
    }
  });

  it('returns empty array when no entries match tier', () => {
    const nullOnly = [makeEntry({ entry_id: 'e-null', run_budget_cap_usd: null })];
    expect(filterByBudgetTier(nullOnly, '0.25')).toEqual([]);
  });

  it('handles empty leaderboard', () => {
    expect(filterByBudgetTier([], 'all')).toEqual([]);
    expect(filterByBudgetTier([], '0.50')).toEqual([]);
  });
});
