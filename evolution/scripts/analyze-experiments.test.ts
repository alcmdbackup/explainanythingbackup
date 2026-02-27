/**
 * @jest-environment node
 */
// Unit tests for analyze-experiments.ts helper functions.
// Tests the pure analysis logic without database access.

import {
  analyzeRuns,
  analyzeStrategies,
  analyzeAgents,
  analyzeHofEntries,
  extractTopElo,
  extractStopReason,
  extractBaselineRank,
  countBy,
  avg,
  stddev,
  type RunRow,
  type StrategyRow,
  type AgentMetricRow,
  type HofEntryRow,
  type HofEloRow,
} from './analyze-experiments';

// ─── Helper Factories ─────────────────────────────────────────────

function makeRun(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: 'run-1',
    status: 'completed',
    phase: 'COMPETITION',
    total_cost_usd: 1.5,
    budget_cap_usd: 3.0,
    estimated_cost_usd: 1.2,
    current_iteration: 10,
    pipeline_type: 'full',
    config: {},
    run_summary: {
      stopReason: 'max_iterations',
      topVariants: [{ ordinal: 5.0 }],
      baselineRank: 3,
    },
    strategy_config_id: 'strat-1',
    prompt_id: 'prompt-1',
    created_at: '2026-02-20T00:00:00Z',
    completed_at: '2026-02-20T00:10:00Z',
    error_message: null,
    ...overrides,
  };
}

function makeStrategy(overrides: Partial<StrategyRow> = {}): StrategyRow {
  return {
    id: 'strat-1',
    name: 'Test Strategy',
    label: 'Gen: ds-chat | Judge: 4.1-nano | 10 iters',
    config: {
      generationModel: 'deepseek-chat',
      judgeModel: 'gpt-4.1-nano',
      iterations: 10,
      enabledAgents: ['reflection', 'iterativeEditing'],
    },
    config_hash: 'abc123def456',
    run_count: 5,
    total_cost_usd: 7.5,
    avg_final_elo: 1450,
    avg_elo_per_dollar: 33,
    stddev_final_elo: 50,
    ...overrides,
  };
}

function makeAgentMetric(overrides: Partial<AgentMetricRow> = {}): AgentMetricRow {
  return {
    run_id: 'run-1',
    agent_name: 'generation',
    cost_usd: 0.5,
    variants_generated: 3,
    avg_elo: 1350,
    elo_gain: 150,
    elo_per_dollar: 300,
    ...overrides,
  };
}

function makeHofEntry(overrides: Partial<HofEntryRow> = {}): HofEntryRow {
  return {
    id: 'entry-1',
    topic_id: 'topic-1',
    generation_method: 'oneshot',
    total_cost_usd: 0.05,
    model: 'gpt-4.1-mini',
    evolution_run_id: null,
    ...overrides,
  };
}

function makeHofElo(overrides: Partial<HofEloRow> = {}): HofEloRow {
  return {
    entry_id: 'entry-1',
    topic_id: 'topic-1',
    elo_rating: 1500,
    elo_per_dollar: 30000,
    mu: 25,
    sigma: 3,
    match_count: 10,
    ...overrides,
  };
}

// ─── Utility Tests ────────────────────────────────────────────────

describe('countBy', () => {
  it('counts occurrences of each item', () => {
    expect(countBy(['a', 'b', 'a', 'c', 'a'])).toEqual({ a: 3, b: 1, c: 1 });
  });

  it('returns empty object for empty array', () => {
    expect(countBy([])).toEqual({});
  });
});

describe('avg', () => {
  it('computes average of numbers', () => {
    expect(avg([10, 20, 30])).toBe(20);
  });

  it('returns 0 for empty array', () => {
    expect(avg([])).toBe(0);
  });

  it('handles single element', () => {
    expect(avg([42])).toBe(42);
  });
});

describe('stddev', () => {
  it('computes sample standard deviation', () => {
    const result = stddev([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(result).toBeCloseTo(2.138, 2);
  });

  it('returns 0 for fewer than 2 elements', () => {
    expect(stddev([])).toBe(0);
    expect(stddev([5])).toBe(0);
  });
});

// ─── Extraction Tests ─────────────────────────────────────────────

describe('extractTopElo', () => {
  it('extracts Elo from ordinal via ordinalToEloScale', () => {
    const result = extractTopElo({ topVariants: [{ ordinal: 0 }] });
    // ordinalToEloScale(0) should give base Elo (1200)
    expect(result).toBe(1200);
  });

  it('falls back to elo field when ordinal missing', () => {
    const result = extractTopElo({ topVariants: [{ elo: 1500 }] });
    expect(result).toBe(1500);
  });

  it('returns null for missing summary', () => {
    expect(extractTopElo(null)).toBeNull();
  });

  it('returns null for empty topVariants', () => {
    expect(extractTopElo({ topVariants: [] })).toBeNull();
  });

  it('returns null when topVariants not present', () => {
    expect(extractTopElo({})).toBeNull();
  });
});

describe('extractStopReason', () => {
  it('extracts stop reason from summary', () => {
    expect(extractStopReason({ stopReason: 'plateau' })).toBe('plateau');
  });

  it('returns null for missing summary', () => {
    expect(extractStopReason(null)).toBeNull();
  });

  it('returns null when stopReason not present', () => {
    expect(extractStopReason({})).toBeNull();
  });
});

describe('extractBaselineRank', () => {
  it('extracts baseline rank from summary', () => {
    expect(extractBaselineRank({ baselineRank: 5 })).toBe(5);
  });

  it('returns null for missing summary', () => {
    expect(extractBaselineRank(null)).toBeNull();
  });
});

// ─── analyzeRuns Tests ────────────────────────────────────────────

describe('analyzeRuns', () => {
  it('computes correct stats for completed runs', () => {
    const runs = [
      makeRun({ id: 'r1', total_cost_usd: 1.0 }),
      makeRun({ id: 'r2', total_cost_usd: 2.0 }),
    ];
    const result = analyzeRuns(runs);
    expect(result.total).toBe(2);
    expect(result.completed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.costs.total).toBe(3.0);
    expect(result.costs.avg).toBe(1.5);
  });

  it('tracks failed runs and error messages', () => {
    const runs = [
      makeRun({ id: 'r1' }),
      makeRun({ id: 'r2', status: 'failed', error_message: 'Budget exceeded' }),
    ];
    const result = analyzeRuns(runs);
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failureRate).toBe('50.0%');
    expect(result.errorMessages).toContain('Budget exceeded');
  });

  it('handles empty runs array', () => {
    const result = analyzeRuns([]);
    expect(result.total).toBe(0);
    expect(result.completed).toBe(0);
    expect(result.failureRate).toBe('N/A');
  });

  it('counts stop reasons', () => {
    const runs = [
      makeRun({ run_summary: { stopReason: 'plateau', topVariants: [{ ordinal: 5 }] } }),
      makeRun({ run_summary: { stopReason: 'plateau', topVariants: [{ ordinal: 5 }] } }),
      makeRun({ run_summary: { stopReason: 'max_iterations', topVariants: [{ ordinal: 5 }] } }),
    ];
    const result = analyzeRuns(runs);
    expect(result.stopReasons).toEqual({ plateau: 2, max_iterations: 1 });
  });

  it('computes duration from created_at and completed_at', () => {
    const runs = [
      makeRun({
        created_at: '2026-02-20T00:00:00Z',
        completed_at: '2026-02-20T00:10:00Z', // 10 minutes
      }),
    ];
    const result = analyzeRuns(runs);
    expect(result.duration.avgMinutes).toBe('10.0');
  });
});

// ─── analyzeStrategies Tests ──────────────────────────────────────

describe('analyzeStrategies', () => {
  it('sorts strategies by Elo/dollar descending', () => {
    const strategies = [
      makeStrategy({ name: 'Low', avg_elo_per_dollar: 10 }),
      makeStrategy({ name: 'High', avg_elo_per_dollar: 50 }),
    ];
    const result = analyzeStrategies(strategies);
    expect(result[0].name).toBe('High');
    expect(result[1].name).toBe('Low');
  });

  it('filters out strategies with zero runs', () => {
    const strategies = [
      makeStrategy({ run_count: 0 }),
      makeStrategy({ name: 'Active', run_count: 3 }),
    ];
    const result = analyzeStrategies(strategies);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Active');
  });

  it('extracts config fields correctly', () => {
    const strategies = [makeStrategy()];
    const result = analyzeStrategies(strategies);
    expect(result[0].config.genModel).toBe('deepseek-chat');
    expect(result[0].config.judgeModel).toBe('gpt-4.1-nano');
    expect(result[0].config.iterations).toBe(10);
  });
});

// ─── analyzeAgents Tests ──────────────────────────────────────────

describe('analyzeAgents', () => {
  it('aggregates metrics by agent name', () => {
    const metrics = [
      makeAgentMetric({ agent_name: 'generation', cost_usd: 0.5, elo_gain: 100 }),
      makeAgentMetric({ agent_name: 'generation', cost_usd: 0.3, elo_gain: 120 }),
      makeAgentMetric({ agent_name: 'tournament', cost_usd: 0.2, elo_gain: 50 }),
    ];
    const result = analyzeAgents(metrics);
    const gen = result.find((a) => a.agent === 'generation')!;
    expect(gen.samples).toBe(2);
    expect(gen.avgCost).toBe('0.4000');
    expect(gen.totalCost).toBe('0.80');
  });

  it('sorts by Elo/dollar descending', () => {
    const metrics = [
      makeAgentMetric({ agent_name: 'cheap', cost_usd: 0.1, elo_gain: 100 }),
      makeAgentMetric({ agent_name: 'expensive', cost_usd: 1.0, elo_gain: 100 }),
    ];
    const result = analyzeAgents(metrics);
    expect(result[0].agent).toBe('cheap');
  });

  it('handles agents with no Elo gain', () => {
    const metrics = [
      makeAgentMetric({ agent_name: 'proximity', cost_usd: 0.01, elo_gain: null }),
    ];
    const result = analyzeAgents(metrics);
    expect(result[0].avgEloGain).toBe('N/A');
    expect(result[0].eloPerDollar).toBe('N/A');
  });
});

// ─── analyzeHofEntries Tests ──────────────────────────────────────

describe('analyzeHofEntries', () => {
  it('groups entries by generation method', () => {
    const entries = [
      makeHofEntry({ id: 'e1', generation_method: 'oneshot' }),
      makeHofEntry({ id: 'e2', generation_method: 'oneshot' }),
      makeHofEntry({ id: 'e3', generation_method: 'evolution_winner' }),
    ];
    const elos = [
      makeHofElo({ entry_id: 'e1', elo_rating: 1400 }),
      makeHofElo({ entry_id: 'e2', elo_rating: 1600 }),
      makeHofElo({ entry_id: 'e3', elo_rating: 1800 }),
    ];
    const result = analyzeHofEntries(entries, elos);
    const oneshot = result.find((r) => r.method === 'oneshot')!;
    expect(oneshot.count).toBe(2);
    expect(oneshot.comparedCount).toBe(2);
    expect(oneshot.avgElo).toBe('1500');
  });

  it('handles entries with no Elo data', () => {
    const entries = [makeHofEntry({ id: 'e1' })];
    const result = analyzeHofEntries(entries, []);
    expect(result[0].avgElo).toBe('N/A');
    expect(result[0].comparedCount).toBe(0);
  });

  it('tracks cost per method', () => {
    const entries = [
      makeHofEntry({ id: 'e1', generation_method: 'oneshot', total_cost_usd: 0.05 }),
      makeHofEntry({ id: 'e2', generation_method: 'oneshot', total_cost_usd: 0.10 }),
    ];
    const result = analyzeHofEntries(entries, []);
    expect(result[0].avgCost).toBe('0.0750');
  });
});
