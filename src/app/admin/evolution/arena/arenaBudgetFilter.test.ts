// Tests for arena budget tier filter utility.

import { filterByBudgetTier } from './arenaBudgetFilter';
import type { ArenaEntry } from '@evolution/services/arenaActions';

function makeEntry(overrides: Partial<ArenaEntry> = {}): ArenaEntry {
  return {
    id: 'entry-1',
    prompt_id: 'topic-1',
    run_id: null,
    variant_content: 'Test content',
    synced_to_arena: true,
    generation_method: 'manual',
    is_seed: false,
    model: null,
    cost_usd: null,
    elo_score: 1200,
    uncertainty: 100,
    arena_match_count: 0,
    archived_at: null,
    created_at: '2026-03-01T00:00:00Z',
    generation: null,
    parent_variant_id: null,
    parent_elo: null,
    parent_uncertainty: null,
    parent_run_id: null,
    agent_name: null,
    tactic_id: null,
    ...overrides,
  };
}

describe('filterByBudgetTier', () => {
  const entries: ArenaEntry[] = [
    makeEntry({ id: 'e1', cost_usd: 0.05 }),
    makeEntry({ id: 'e2', cost_usd: 0.10 }),
    makeEntry({ id: 'e3', cost_usd: 0.30 }),
    makeEntry({ id: 'e4', cost_usd: 0.50 }),
    makeEntry({ id: 'e5', cost_usd: 1.00 }),
    makeEntry({ id: 'e6', cost_usd: null }),
  ];

  it('returns all entries for tier "all"', () => {
    const result = filterByBudgetTier(entries, 'all');
    expect(result).toHaveLength(6);
  });

  it('returns entries with cost < 0.10 for tier "low"', () => {
    const result = filterByBudgetTier(entries, 'low');
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('e1');
  });

  it('returns entries with 0.10 <= cost < 0.50 for tier "medium"', () => {
    const result = filterByBudgetTier(entries, 'medium');
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(['e2', 'e3']);
  });

  it('returns entries with cost >= 0.50 for tier "high"', () => {
    const result = filterByBudgetTier(entries, 'high');
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(['e4', 'e5']);
  });

  it('excludes null cost entries from non-all tiers', () => {
    const result = filterByBudgetTier(entries, 'low');
    expect(result.every((e) => e.cost_usd != null)).toBe(true);
  });

  it('handles empty array', () => {
    expect(filterByBudgetTier([], 'high')).toEqual([]);
  });
});
