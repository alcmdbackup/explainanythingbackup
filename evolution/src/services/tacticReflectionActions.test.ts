// Tests for getTacticEloBoostsForReflection — mid-run live aggregate of recent
// tactic ELO performance for the reflection prompt.

import { getTacticEloBoostsForReflection } from './tacticReflectionActions';

const PROMPT_ID = '00000000-0000-4000-8000-000000000001';
const TACTIC_NAMES = ['structural_transform', 'lexical_simplify', 'grounding_enhance'];

interface VariantQueryResult {
  data?: Array<{ agent_name: string; elo_score: number }>;
  error?: { message: string };
}

interface TacticQueryResult {
  data?: Array<{ id: string; name: string }>;
  error?: { message: string };
}

interface MetricsQueryResult {
  data?: Array<{ entity_id: string; metric_name: string; value: number; uncertainty: null; ci_lower: null; ci_upper: null; n: number; origin_entity_type: null; origin_entity_id: null; aggregation_method: null; source: null; stale: false; created_at: string; updated_at: string; id: string; entity_type: 'tactic' }>;
  error?: { message: string };
}

function makeDb(opts: {
  variantQuery: VariantQueryResult;
  tacticQuery?: TacticQueryResult;
  metricsQuery?: MetricsQueryResult;
}) {
  const variantSelect = jest.fn();
  const tacticSelect = jest.fn();
  const metricsSelect = jest.fn();

  // Build a chain that resolves to the configured query result on the final await.
  const variantChain = {
    select: variantSelect,
  };
  const tacticChain = { select: tacticSelect };
  const metricsChain = { select: metricsSelect };

  variantSelect.mockReturnValue({
    eq: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnValue(Promise.resolve(opts.variantQuery)),
  });

  tacticSelect.mockReturnValue({
    in: jest.fn().mockReturnValue(Promise.resolve(opts.tacticQuery ?? { data: [] })),
  });

  metricsSelect.mockReturnValue({
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockImplementation(function chain(this: unknown, _column: string, _values: unknown[]) {
      // The third .in() (metric_name filter) is the last in the chain.
      // After the second .in(), getMetricsForEntities returns the awaited result.
      return Promise.resolve(opts.metricsQuery ?? { data: [] });
    }),
  });

  return {
    from: jest.fn((table: string) => {
      if (table === 'evolution_variants') return variantChain;
      if (table === 'evolution_tactics') return tacticChain;
      if (table === 'evolution_metrics') return metricsChain;
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

describe('getTacticEloBoostsForReflection', () => {
  it('returns Map<name, null> for cold-start prompt (no variants)', async () => {
    const db = makeDb({ variantQuery: { data: [] } });
    const result = await getTacticEloBoostsForReflection(db as never, PROMPT_ID, TACTIC_NAMES);
    expect(result.size).toBe(3);
    for (const name of TACTIC_NAMES) {
      expect(result.get(name)).toBeNull();
    }
  });

  it('returns null for a tactic with insufficient samples (n<3)', async () => {
    const db = makeDb({
      variantQuery: {
        data: [
          { agent_name: 'lexical_simplify', elo_score: 1250 },
          { agent_name: 'lexical_simplify', elo_score: 1240 },
          // only 2 samples → falls through to fallback
        ],
      },
    });
    const result = await getTacticEloBoostsForReflection(db as never, PROMPT_ID, TACTIC_NAMES);
    // 2 samples < MIN_SAMPLES_PER_TACTIC (3) → null (no fallback data either)
    expect(result.get('lexical_simplify')).toBeNull();
  });

  it('uses live aggregate for tactic with n>=3', async () => {
    const db = makeDb({
      variantQuery: {
        data: [
          { agent_name: 'structural_transform', elo_score: 1250 },
          { agent_name: 'structural_transform', elo_score: 1280 },
          { agent_name: 'structural_transform', elo_score: 1230 },
        ],
      },
    });
    const result = await getTacticEloBoostsForReflection(db as never, PROMPT_ID, TACTIC_NAMES);
    // mean(50, 80, 30) = 53.33...
    expect(result.get('structural_transform')).toBeCloseTo((50 + 80 + 30) / 3, 1);
    // Other tactics had no samples → null
    expect(result.get('lexical_simplify')).toBeNull();
    expect(result.get('grounding_enhance')).toBeNull();
  });

  it('handles DB errors gracefully (returns null map)', async () => {
    const db = makeDb({
      variantQuery: { error: { message: 'connection refused' } },
    });
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const result = await getTacticEloBoostsForReflection(db as never, PROMPT_ID, TACTIC_NAMES, logger as never);
    expect(result.size).toBe(3);
    for (const name of TACTIC_NAMES) {
      expect(result.get(name)).toBeNull();
    }
    expect(logger.warn).toHaveBeenCalled();
  });
});
