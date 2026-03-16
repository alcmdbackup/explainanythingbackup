/**
 * Unit tests for eloBudgetActions: strategy run history and peak stats.
 */

import {
  getStrategyRunsAction,
  getStrategiesPeakStatsAction,
} from './eloBudgetActions';

// Mock admin auth
jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue('admin-user-id'),
}));

// Mock Supabase client
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  withLogging: (fn: Function, _name: string) => fn,
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  serverReadRequestId: (fn: Function) => fn,
}));

jest.mock('@/lib/errorHandling', () => ({
  handleError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
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

      const mockRpc = jest.fn().mockResolvedValue({
        data: [{ total_variants: 8, median_elo: 1200, p90_elo: 1340, max_elo: 1400 }],
        error: null,
      });

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
      // Add rpc mock to the supabase mock object
      (mockSupabase as Record<string, unknown>).rpc = mockRpc;

      const result = await getStrategyRunsAction({ strategyId: 'strat-1' });

      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(1);
      expect(result.data![0].runId).toBe('run-1');
      expect(result.data![0].finalElo).toBe(1350);
      expect(result.data![0].p90Elo).toBe(1340);
      expect(result.data![0].maxElo).toBe(1400);
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

      const result = await getStrategyRunsAction({ strategyId: 'strat-1' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('returns null p90/max for non-completed runs', async () => {
      const strategyConfig = { config_hash: 'abc123', config: {} };
      const runs = [
        {
          id: 'run-running',
          explanation_id: 1,
          status: 'running',
          total_cost_usd: 0.2,
          current_iteration: 3,
          started_at: '2026-02-05T10:00:00Z',
          completed_at: null,
          config: {},
          run_summary: null,
        },
      ];
      const explanations = [{ id: 1, title: 'Test' }];

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

      const result = await getStrategyRunsAction({ strategyId: 'strat-1' });
      expect(result.success).toBe(true);
      expect(result.data![0].p90Elo).toBeNull();
      expect(result.data![0].maxElo).toBeNull();
    });

    it('gracefully handles RPC failure', async () => {
      const strategyConfig = { config_hash: 'abc123', config: {} };
      const runs = [
        {
          id: 'run-rpc-fail',
          explanation_id: 1,
          status: 'completed',
          total_cost_usd: 0.5,
          current_iteration: 10,
          started_at: '2026-02-05T10:00:00Z',
          completed_at: '2026-02-05T10:05:00Z',
          config: {},
          run_summary: { finalTopElo: 1300 },
        },
      ];
      const explanations = [{ id: 1, title: 'Test' }];

      const mockRpc = jest.fn().mockRejectedValue(new Error('RPC timeout'));

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
      (mockSupabase as Record<string, unknown>).rpc = mockRpc;

      const result = await getStrategyRunsAction({ strategyId: 'strat-1' });
      expect(result.success).toBe(true);
      // p90/max should be null due to RPC failure, but action itself succeeds
      expect(result.data![0].p90Elo).toBeNull();
      expect(result.data![0].maxElo).toBeNull();
      expect(result.data![0].finalElo).toBe(1300);
    });

    it('handles strategy not found error', async () => {
      mockSupabase.from.mockImplementation(() => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
          }),
        }),
      }));

      const result = await getStrategyRunsAction({ strategyId: 'invalid-id' });

      expect(result.success).toBe(false);
      expect(result.error).toEqual({ message: 'Not found' });
    });
  });

  describe('getStrategiesPeakStatsAction', () => {
    it('returns empty array for empty input', async () => {
      const result = await getStrategiesPeakStatsAction([]);
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('returns null stats when no completed runs', async () => {
      mockSupabase.from.mockImplementation(() => ({
        select: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }));

      const result = await getStrategiesPeakStatsAction(['strat-1', 'strat-2']);
      expect(result.success).toBe(true);
      expect(result.data).toEqual([
        { strategyId: 'strat-1', bestP90Elo: null, bestMaxElo: null },
        { strategyId: 'strat-2', bestP90Elo: null, bestMaxElo: null },
      ]);
    });

    it('aggregates best p90/max across runs per strategy', async () => {
      mockSupabase.from.mockImplementation(() => ({
        select: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [
                { id: 'run-1', strategy_config_id: 'strat-1' },
                { id: 'run-2', strategy_config_id: 'strat-1' },
                { id: 'run-3', strategy_config_id: 'strat-2' },
              ],
              error: null,
            }),
          }),
        }),
      }));

      const mockRpc = jest.fn()
        .mockResolvedValueOnce({ data: [{ p90_elo: 1400, max_elo: 1500 }], error: null })
        .mockResolvedValueOnce({ data: [{ p90_elo: 1450, max_elo: 1480 }], error: null })
        .mockResolvedValueOnce({ data: [{ p90_elo: 1300, max_elo: 1350 }], error: null });
      (mockSupabase as Record<string, unknown>).rpc = mockRpc;

      const result = await getStrategiesPeakStatsAction(['strat-1', 'strat-2']);
      expect(result.success).toBe(true);
      expect(result.data).toEqual([
        { strategyId: 'strat-1', bestP90Elo: 1450, bestMaxElo: 1500 },
        { strategyId: 'strat-2', bestP90Elo: 1300, bestMaxElo: 1350 },
      ]);
    });
  });
});
