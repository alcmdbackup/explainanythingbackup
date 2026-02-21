/**
 * Unit tests for eloBudgetActions: server actions for Elo budget optimization dashboard.
 */

import {
  getAgentROILeaderboardAction,
  getAgentCostByModelAction,
  getStrategyLeaderboardAction,
  resolveStrategyConfigAction,
  updateStrategyAction,
  getStrategyParetoAction,
  getRecommendedStrategyAction,
  getOptimizationSummaryAction,
  getStrategyRunsAction,
  getPromptRunsAction,
} from './eloBudgetActions';
import type { StrategyConfig } from '@evolution/lib/core/strategyConfig';

// Mock admin auth
jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn(),
}));

// Mock Supabase client
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';

const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  gte: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  not: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  in: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  single: jest.fn(),
};

(createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);

describe('eloBudgetActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset chain methods
    mockSupabase.from.mockReturnThis();
    mockSupabase.select.mockReturnThis();
    mockSupabase.gte.mockReturnThis();
    mockSupabase.eq.mockReturnThis();
    mockSupabase.order.mockReturnThis();
    mockSupabase.not.mockReturnThis();
    mockSupabase.insert.mockReturnThis();
    mockSupabase.update.mockReturnThis();
    mockSupabase.in.mockReturnThis();
    mockSupabase.limit.mockReturnThis();
  });

  describe('getAgentROILeaderboardAction', () => {
    it('returns empty array when no data', async () => {
      mockSupabase.gte.mockResolvedValue({ data: [], error: null });

      const result = await getAgentROILeaderboardAction();

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('aggregates and sorts by Elo per dollar', async () => {
      mockSupabase.gte.mockResolvedValue({
        data: [
          { agent_name: 'generation', cost_usd: 0.10, elo_gain: 50, elo_per_dollar: 500 },
          { agent_name: 'generation', cost_usd: 0.15, elo_gain: 60, elo_per_dollar: 400 },
          { agent_name: 'generation', cost_usd: 0.12, elo_gain: 55, elo_per_dollar: 450 },
          { agent_name: 'generation', cost_usd: 0.11, elo_gain: 52, elo_per_dollar: 470 },
          { agent_name: 'generation', cost_usd: 0.13, elo_gain: 58, elo_per_dollar: 440 },
          { agent_name: 'calibration', cost_usd: 0.05, elo_gain: 30, elo_per_dollar: 600 },
          { agent_name: 'calibration', cost_usd: 0.06, elo_gain: 35, elo_per_dollar: 580 },
          { agent_name: 'calibration', cost_usd: 0.04, elo_gain: 25, elo_per_dollar: 620 },
          { agent_name: 'calibration', cost_usd: 0.05, elo_gain: 28, elo_per_dollar: 560 },
          { agent_name: 'calibration', cost_usd: 0.055, elo_gain: 32, elo_per_dollar: 590 },
        ],
        error: null,
      });

      const result = await getAgentROILeaderboardAction({ minSampleSize: 5 });

      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(2);
      // Calibration has higher avg Elo/dollar: (600+580+620+560+590)/5 = 590
      expect(result.data![0].agentName).toBe('calibration');
      expect(result.data![0].avgEloPerDollar).toBeCloseTo(590, 0);
      expect(result.data![0].sampleSize).toBe(5);
    });

    it('filters by minimum sample size', async () => {
      mockSupabase.gte.mockResolvedValue({
        data: [
          { agent_name: 'generation', cost_usd: 0.10, elo_gain: 50, elo_per_dollar: 500 },
          { agent_name: 'calibration', cost_usd: 0.05, elo_gain: 30, elo_per_dollar: 600 },
        ],
        error: null,
      });

      const result = await getAgentROILeaderboardAction({ minSampleSize: 5 });

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('handles query errors', async () => {
      mockSupabase.gte.mockResolvedValue({
        data: null,
        error: { message: 'Connection failed' },
      });

      const result = await getAgentROILeaderboardAction();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection failed');
    });
  });

  describe('getAgentCostByModelAction', () => {
    it('returns model cost breakdown for agent', async () => {
      mockSupabase.order.mockResolvedValue({
        data: [
          { model: 'deepseek-chat', avg_cost_usd: 0.001, sample_size: 100 },
          { model: 'gpt-4o', avg_cost_usd: 0.010, sample_size: 50 },
        ],
        error: null,
      });

      const result = await getAgentCostByModelAction('generation');

      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(2);
      expect(result.data![0]).toEqual({ model: 'deepseek-chat', avgCost: 0.001, sampleSize: 100 });
    });

    it('handles query errors', async () => {
      mockSupabase.order.mockResolvedValue({
        data: null,
        error: { message: 'Table not found' },
      });

      const result = await getAgentCostByModelAction('generation');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Table not found');
    });
  });

  describe('getStrategyLeaderboardAction', () => {
    const mockStrategyRow = {
      id: 'strat-1',
      config_hash: 'abc123def456',
      name: 'Test Strategy',
      description: 'Test desc',
      label: 'Gen: ds-chat | Judge: 4.1-nano | 10 iters',
      config: { generationModel: 'deepseek-chat', judgeModel: 'gpt-4.1-nano', iterations: 10, budgetCaps: {} },
      run_count: 5,
      total_cost_usd: 0.50,
      avg_final_elo: 1280,
      avg_elo_per_dollar: 160,
      best_final_elo: 1320,
      worst_final_elo: 1240,
      stddev_final_elo: 25,
      last_used_at: '2026-02-05T00:00:00Z',
    };

    it('returns strategy leaderboard entries', async () => {
      mockSupabase.order.mockResolvedValue({
        data: [mockStrategyRow],
        error: null,
      });

      const result = await getStrategyLeaderboardAction();

      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(1);
      expect(result.data![0].id).toBe('strat-1');
      expect(result.data![0].name).toBe('Test Strategy');
      expect(result.data![0].avgFinalElo).toBe(1280);
    });

    it('handles query errors', async () => {
      mockSupabase.order.mockResolvedValue({
        data: null,
        error: { message: 'Query failed' },
      });

      const result = await getStrategyLeaderboardAction();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Query failed');
    });
  });

  describe('resolveStrategyConfigAction', () => {
    const testConfig: StrategyConfig = {
      generationModel: 'deepseek-chat',
      judgeModel: 'gpt-4.1-nano',
      iterations: 10,
      budgetCaps: { generation: 0.3 },
    };

    it('returns existing strategy if hash matches', async () => {
      mockSupabase.single.mockResolvedValue({
        data: { id: 'existing-id' },
        error: null,
      });

      const result = await resolveStrategyConfigAction(testConfig);

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe('existing-id');
      expect(result.data!.isNew).toBe(false);
    });

    it('creates new strategy if none exists', async () => {
      mockSupabase.single
        .mockResolvedValueOnce({ data: null, error: null }) // First call: check exists
        .mockResolvedValueOnce({ data: { id: 'new-id' }, error: null }); // Second call: insert

      const result = await resolveStrategyConfigAction(testConfig, 'My Custom Name');

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe('new-id');
      expect(result.data!.isNew).toBe(true);
    });

    it('handles insert errors', async () => {
      mockSupabase.single
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: null, error: { message: 'Insert failed' } });

      const result = await resolveStrategyConfigAction(testConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insert failed');
    });
  });

  describe('updateStrategyAction', () => {
    it('updates strategy name and description', async () => {
      const updatedRow = {
        id: 'strat-1',
        config_hash: 'abc123',
        name: 'Updated Name',
        description: 'Updated desc',
        label: 'Gen: ds-chat | Judge: 4.1-nano | 10 iters',
        config: { generationModel: 'deepseek-chat', judgeModel: 'gpt-4.1-nano', iterations: 10, budgetCaps: {} },
        run_count: 5,
        total_cost_usd: 0.50,
        avg_final_elo: 1280,
        avg_elo_per_dollar: 160,
        best_final_elo: 1320,
        worst_final_elo: 1240,
        stddev_final_elo: 25,
        last_used_at: '2026-02-05T00:00:00Z',
      };
      mockSupabase.single.mockResolvedValue({ data: updatedRow, error: null });

      const result = await updateStrategyAction('strat-1', { name: 'Updated Name', description: 'Updated desc' });

      expect(result.success).toBe(true);
      expect(result.data!.name).toBe('Updated Name');
      expect(result.data!.description).toBe('Updated desc');
    });

    it('handles update errors', async () => {
      mockSupabase.single.mockResolvedValue({ data: null, error: { message: 'Not found' } });

      const result = await updateStrategyAction('invalid-id', { name: 'New' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not found');
    });
  });

  describe('getStrategyParetoAction', () => {
    it('identifies Pareto-optimal strategies', async () => {
      mockSupabase.not.mockResolvedValue({
        data: [
          { id: 'a', name: 'A', label: 'A', run_count: 3, total_cost_usd: 0.30, avg_final_elo: 1300 }, // Pareto: high Elo, mid cost
          { id: 'b', name: 'B', label: 'B', run_count: 3, total_cost_usd: 0.15, avg_final_elo: 1250 }, // Pareto: mid Elo, low cost
          { id: 'c', name: 'C', label: 'C', run_count: 3, total_cost_usd: 0.30, avg_final_elo: 1250 }, // Dominated by A
        ],
        error: null,
      });

      const result = await getStrategyParetoAction();

      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(3);

      const paretoPoints = result.data!.filter(p => p.isPareto);
      expect(paretoPoints.length).toBe(2);
      expect(paretoPoints.map(p => p.strategyId).sort()).toEqual(['a', 'b']);
    });

    it('returns empty array when no data', async () => {
      mockSupabase.not.mockResolvedValue({ data: [], error: null });

      const result = await getStrategyParetoAction();

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('handles query errors', async () => {
      mockSupabase.not.mockResolvedValue({ data: null, error: { message: 'Failed' } });

      const result = await getStrategyParetoAction();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed');
    });
  });

  describe('getRecommendedStrategyAction', () => {
    const strategies = [
      {
        id: 'cheap',
        config_hash: 'aaa',
        name: 'Cheap',
        description: null,
        label: 'Cheap',
        config: {},
        run_count: 5,
        total_cost_usd: 0.25,
        avg_final_elo: 1260,
        avg_elo_per_dollar: 240,
        best_final_elo: 1280,
        worst_final_elo: 1240,
        stddev_final_elo: 15,
        last_used_at: '2026-02-05T00:00:00Z',
      },
      {
        id: 'expensive',
        config_hash: 'bbb',
        name: 'Expensive',
        description: null,
        label: 'Expensive',
        config: {},
        run_count: 5,
        total_cost_usd: 2.50,
        avg_final_elo: 1320,
        avg_elo_per_dollar: 48,
        best_final_elo: 1350,
        worst_final_elo: 1290,
        stddev_final_elo: 20,
        last_used_at: '2026-02-05T00:00:00Z',
      },
      {
        id: 'balanced',
        config_hash: 'ccc',
        name: 'Balanced',
        description: null,
        label: 'Balanced',
        config: {},
        run_count: 5,
        total_cost_usd: 0.50,
        avg_final_elo: 1280,
        avg_elo_per_dollar: 160,
        best_final_elo: 1300,
        worst_final_elo: 1260,
        stddev_final_elo: 10,
        last_used_at: '2026-02-05T00:00:00Z',
      },
    ];

    it('recommends best Elo strategy within budget', async () => {
      mockSupabase.not.mockResolvedValue({ data: strategies, error: null });

      const result = await getRecommendedStrategyAction({ budgetUsd: 0.08, optimizeFor: 'elo' });

      expect(result.success).toBe(true);
      // Only "Cheap" fits within $0.08 budget (avg cost = $0.05)
      expect(result.data!.recommended!.name).toBe('Cheap');
      expect(result.data!.reasoning).toContain('Cheap');
    });

    it('recommends best Elo/dollar strategy', async () => {
      mockSupabase.not.mockResolvedValue({ data: strategies, error: null });

      const result = await getRecommendedStrategyAction({ budgetUsd: 1.00, optimizeFor: 'elo_per_dollar' });

      expect(result.success).toBe(true);
      // "Cheap" has highest Elo/dollar (240)
      expect(result.data!.recommended!.name).toBe('Cheap');
    });

    it('recommends most consistent strategy', async () => {
      mockSupabase.not.mockResolvedValue({ data: strategies, error: null });

      const result = await getRecommendedStrategyAction({ budgetUsd: 1.00, optimizeFor: 'consistency' });

      expect(result.success).toBe(true);
      // "Balanced" has lowest stddev (10)
      expect(result.data!.recommended!.name).toBe('Balanced');
    });

    it('returns null when no strategies within budget', async () => {
      mockSupabase.not.mockResolvedValue({ data: strategies, error: null });

      const result = await getRecommendedStrategyAction({ budgetUsd: 0.01, optimizeFor: 'elo' });

      expect(result.success).toBe(true);
      expect(result.data!.recommended).toBeNull();
      expect(result.data!.reasoning).toContain('No strategies found within');
    });

    it('returns null when no data', async () => {
      mockSupabase.not.mockResolvedValue({ data: [], error: null });

      const result = await getRecommendedStrategyAction({ budgetUsd: 1.00, optimizeFor: 'elo' });

      expect(result.success).toBe(true);
      expect(result.data!.recommended).toBeNull();
      expect(result.data!.reasoning).toContain('No strategies with sufficient run history');
    });
  });

  describe('getOptimizationSummaryAction', () => {
    it('aggregates summary stats', async () => {
      const strategyData = [
        { id: 'a', name: 'A', run_count: 5, total_cost_usd: 1.00, avg_final_elo: 1280, avg_elo_per_dollar: 80 },
        { id: 'b', name: 'B', run_count: 3, total_cost_usd: 0.50, avg_final_elo: 1320, avg_elo_per_dollar: 240 },
      ];
      const agentData = [
        { agent_name: 'generation', elo_per_dollar: 500 },
        { agent_name: 'generation', elo_per_dollar: 600 },
        { agent_name: 'calibration', elo_per_dollar: 400 },
      ];

      // Mock strategy query (first from call)
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'evolution_strategy_configs') {
          return {
            select: jest.fn().mockResolvedValue({ data: strategyData, error: null }),
          };
        }
        if (table === 'evolution_run_agent_metrics') {
          return {
            select: jest.fn().mockResolvedValue({ data: agentData, error: null }),
          };
        }
        return mockSupabase;
      });

      const result = await getOptimizationSummaryAction();

      expect(result.success).toBe(true);
      expect(result.data!.totalRuns).toBe(8); // 5 + 3
      expect(result.data!.totalStrategies).toBe(2);
      expect(result.data!.totalSpentUsd).toBe(1.50); // 1.00 + 0.50
      expect(result.data!.bestStrategy!.name).toBe('B');
      expect(result.data!.bestStrategy!.avgElo).toBe(1320);
      expect(result.data!.topAgent!.name).toBe('generation');
      expect(result.data!.topAgent!.eloPerDollar).toBeCloseTo(550, 0); // (500+600)/2
    });

    it('handles no data gracefully', async () => {
      mockSupabase.from.mockImplementation(() => ({
        select: jest.fn().mockResolvedValue({ data: [], error: null }),
      }));

      const result = await getOptimizationSummaryAction();

      expect(result.success).toBe(true);
      expect(result.data!.totalRuns).toBe(0);
      expect(result.data!.totalStrategies).toBe(0);
      expect(result.data!.bestStrategy).toBeNull();
      expect(result.data!.topAgent).toBeNull();
    });

    it('handles strategy query error', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'evolution_strategy_configs') {
          return {
            select: jest.fn().mockResolvedValue({ data: null, error: { message: 'Failed' } }),
          };
        }
        return mockSupabase;
      });

      const result = await getOptimizationSummaryAction();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed');
    });
  });

  describe('getStrategyRunsAction', () => {
    it('returns runs for a strategy', async () => {
      const strategyConfig = { config_hash: 'abc123', config: {} };
      const runs = [
        {
          id: 'run-1',
          explanation_id: 1,
          status: 'completed',
          total_cost_usd: 0.5,
          current_iteration: 10,
          started_at: '2026-02-05T10:00:00Z',
          completed_at: '2026-02-05T10:05:00Z',
          config: {},
          run_summary: { finalTopElo: 1350 },
        },
      ];
      const explanations = [{ id: 1, title: 'Test Explanation' }];

      mockSupabase.from.mockImplementation((table: string) => {
        const chain = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          single: jest.fn(),
        };

        if (table === 'evolution_strategy_configs') {
          chain.single.mockResolvedValue({ data: strategyConfig, error: null });
        } else if (table === 'evolution_runs') {
          chain.limit.mockResolvedValue({ data: runs, error: null });
        } else if (table === 'explanations') {
          chain.in.mockResolvedValue({ data: explanations, error: null });
        }

        return chain;
      });

      const result = await getStrategyRunsAction('strat-1');

      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(1);
      expect(result.data![0].runId).toBe('run-1');
      expect(result.data![0].finalElo).toBe(1350);
      expect(result.data![0].explanationTitle).toBe('Test Explanation');
      expect(result.data![0].duration).toBe(300); // 5 minutes
    });

    it('returns empty array when no runs found', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        const chain = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          single: jest.fn(),
        };

        if (table === 'evolution_strategy_configs') {
          chain.single.mockResolvedValue({ data: { config_hash: 'abc', config: {} }, error: null });
        } else {
          chain.limit.mockResolvedValue({ data: [], error: null });
        }

        return chain;
      });

      const result = await getStrategyRunsAction('strat-1');

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('handles strategy not found error', async () => {
      mockSupabase.single.mockResolvedValue({ data: null, error: { message: 'Not found' } });

      const result = await getStrategyRunsAction('invalid-id');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not found');
    });
  });

  describe('getPromptRunsAction', () => {
    it('returns runs for a prompt', async () => {
      const runs = [
        {
          id: 'run-p1',
          explanation_id: 42,
          status: 'completed',
          total_cost_usd: 0.25,
          current_iteration: 5,
          started_at: '2026-02-10T12:00:00Z',
          completed_at: '2026-02-10T12:03:00Z',
        },
      ];
      const explanations = [{ id: 42, title: 'Quantum Computing' }];

      mockSupabase.from.mockImplementation((table: string) => {
        const chain = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
        };

        if (table === 'evolution_runs') {
          chain.limit.mockResolvedValue({ data: runs, error: null });
        } else if (table === 'explanations') {
          chain.in.mockResolvedValue({ data: explanations, error: null });
        }

        return chain;
      });

      const result = await getPromptRunsAction('prompt-1');

      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(1);
      expect(result.data![0].runId).toBe('run-p1');
      expect(result.data![0].explanationTitle).toBe('Quantum Computing');
      expect(result.data![0].totalCostUsd).toBe(0.25);
      expect(result.data![0].duration).toBe(180); // 3 minutes
    });

    it('returns empty array when no runs for prompt', async () => {
      mockSupabase.from.mockImplementation(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      }));

      const result = await getPromptRunsAction('prompt-empty');

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('handles DB error gracefully', async () => {
      mockSupabase.from.mockImplementation(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      }));

      const result = await getPromptRunsAction('prompt-bad');

      expect(result.success).toBe(false);
      expect(result.error).toBe('DB error');
    });
  });
});
