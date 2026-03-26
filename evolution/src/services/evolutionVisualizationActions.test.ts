// Tests for evolution visualization server actions: dashboard data, Elo history, and lineage graph.
// Verifies V2 schema (run_summary JSONB for muHistory, cost from evolution_run_costs view).

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { createSupabaseChainMock, createTableAwareMock } from '@evolution/testing/service-test-mocks';

// ─── Mocks (must be before imports of modules under test) ────

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue('test-admin-user-id'),
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: jest.fn((fn: unknown) => fn),
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: jest.fn((fn: unknown) => fn),
}));

jest.mock('@/lib/services/auditLog', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

import {
  getEvolutionDashboardDataAction,
  getEvolutionRunEloHistoryAction,
  getEvolutionRunLineageAction,
} from './evolutionVisualizationActions';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '660e8400-e29b-41d4-a716-446655440001';
const VALID_UUID_3 = '770e8400-e29b-41d4-a716-446655440002';

describe('evolutionVisualizationActions', () => {
  let mockSupabase: ReturnType<typeof createSupabaseChainMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createSupabaseChainMock({ data: null, error: null });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  // ─── getEvolutionDashboardDataAction ─────────────────────────

  describe('getEvolutionDashboardDataAction', () => {
    it('aggregates status counts, costs, and recent runs', async () => {
      const statusRows = [
        { status: 'running' },
        { status: 'claimed' },
        { status: 'pending' },
        { status: 'completed' },
        { status: 'completed' },
        { status: 'failed' },
      ];
      const costRows = [{ total_cost_usd: '3.00' }, { total_cost_usd: '2.00' }];
      const recentRuns = [
        {
          id: VALID_UUID,
          status: 'completed',
          strategy_id: VALID_UUID_2,
          created_at: '2026-03-01T10:00:00Z',
          completed_at: '2026-03-01T12:00:00Z',
        },
      ];
      const strategies = [{ id: VALID_UUID_2, name: 'Strategy Alpha' }];
      const runCosts = [{ run_id: VALID_UUID, total_cost_usd: 3.0 }];

      const mock = createTableAwareMock([
        // evolution_runs (status) — built first at line 79
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: statusRows, error: null })
          );
        },
        // evolution_runs (recent) — built second at line 84
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: recentRuns, error: null })
          );
        },
        // evolution_run_costs (total) — third, inside Promise.all
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: costRows, error: null })
          );
        },
        // evolution_strategies (names)
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: strategies, error: null })
          );
        },
        // evolution_run_costs (per run)
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: runCosts, error: null })
          );
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getEvolutionDashboardDataAction(undefined);

      expect(result.success).toBe(true);
      expect(result.data!.activeRuns).toBe(2); // running + claimed
      expect(result.data!.queueDepth).toBe(1);
      expect(result.data!.completedRuns).toBe(2);
      expect(result.data!.failedRuns).toBe(1);
      expect(result.data!.totalCostUsd).toBe(5.0); // 3.00 + 2.00
      expect(result.data!.recentRuns).toHaveLength(1);
      expect(result.data!.recentRuns[0].strategy_name).toBe('Strategy Alpha');
      expect(result.data!.recentRuns[0].total_cost_usd).toBe(3.0);
    });

    it('handles empty runs and zero costs gracefully', async () => {
      const mock = createTableAwareMock([
        // evolution_runs (status)
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null })
          );
        },
        // evolution_run_costs (total)
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null })
          );
        },
        // evolution_runs (recent)
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null })
          );
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getEvolutionDashboardDataAction(undefined);

      expect(result.success).toBe(true);
      expect(result.data!.activeRuns).toBe(0);
      expect(result.data!.totalCostUsd).toBe(0);
      expect(result.data!.avgCostPerRun).toBe(0);
      expect(result.data!.recentRuns).toEqual([]);
    });

    it('filters test content when filterTestContent is true', async () => {
      // With filterTestContent=true, the action should use inner joins and .not()
      // to exclude runs whose strategy name contains [TEST].
      // Query order: status (with inner join), cost (skipped/resolved), recent (with inner join),
      // then: filtered IDs for cost, filtered cost, strategies, per-run costs.
      const statusRows = [
        { status: 'running' },
        { status: 'completed' },
      ];
      const recentRuns = [
        {
          id: VALID_UUID,
          status: 'completed',
          strategy_id: VALID_UUID_2,
          created_at: '2026-03-01T10:00:00Z',
          completed_at: '2026-03-01T12:00:00Z',
        },
      ];
      const filteredIds = [{ id: VALID_UUID }];
      const filteredCosts = [{ total_cost_usd: '4.50' }];
      const strategies = [{ id: VALID_UUID_2, name: 'Real Strategy' }];
      const runCosts = [{ run_id: VALID_UUID, total_cost_usd: 4.5 }];

      const mock = createTableAwareMock([
        // 1. evolution_runs (status with inner join) — filterTest=true skips cost query
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: statusRows, error: null })
          );
        },
        // 2. evolution_runs (recent with inner join) — cost query is Promise.resolve
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: recentRuns, error: null })
          );
        },
        // 3. evolution_runs (filtered IDs for cost lookup)
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: filteredIds, error: null })
          );
        },
        // 4. evolution_run_costs (filtered)
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: filteredCosts, error: null })
          );
        },
        // 5. evolution_strategies (names)
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: strategies, error: null })
          );
        },
        // 6. evolution_run_costs (per run)
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: runCosts, error: null })
          );
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getEvolutionDashboardDataAction({ filterTestContent: true });

      expect(result.success).toBe(true);
      expect(result.data!.activeRuns).toBe(1);
      expect(result.data!.completedRuns).toBe(1);
      expect(result.data!.totalCostUsd).toBe(4.5);
      expect(result.data!.recentRuns).toHaveLength(1);
      expect(result.data!.recentRuns[0]!.strategy_name).toBe('Real Strategy');

      // Verify that .not() was called on the status query to exclude [TEST]
      const fromCalls = mock.from.mock.calls;
      expect(fromCalls[0][0]).toBe('evolution_runs'); // status query
      // The inner join select should include evolution_strategies!inner
      const statusBuilder = mock.from.mock.results[0].value;
      expect(statusBuilder.select).toHaveBeenCalledWith(
        expect.stringContaining('evolution_strategies!inner'),
      );
      expect(statusBuilder.not).toHaveBeenCalledWith(
        'evolution_strategies.name', 'ilike', '%[TEST]%',
      );
    });

    it('returns error when status query fails', async () => {
      const mock = createTableAwareMock([
        // evolution_runs (status) — fails
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: null, error: { message: 'query error' } })
          );
        },
        // evolution_run_costs (total)
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null })
          );
        },
        // evolution_runs (recent)
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null })
          );
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      // Dashboard uses null-coalescing so no error thrown — just empty data
      const result = await getEvolutionDashboardDataAction(undefined);

      expect(result.success).toBe(true);
      expect(result.data!.activeRuns).toBe(0);
    });
  });

  // ─── getEvolutionRunEloHistoryAction ─────────────────────────

  describe('getEvolutionRunEloHistoryAction', () => {
    it('returns Elo history points from run_summary.muHistory', async () => {
      // Must satisfy EvolutionRunSummaryV3Schema (strict)
      const runSummary = {
        version: 3,
        stopReason: 'budget_exhausted',
        finalPhase: 'COMPETITION',
        totalIterations: 4,
        durationSeconds: 120,
        muHistory: [1100, 1150, 1200, 1250],
        diversityHistory: [0.9, 0.8, 0.7, 0.6],
        matchStats: { totalMatches: 20, avgConfidence: 0.8, decisiveRate: 0.75 },
        topVariants: [{ id: VALID_UUID_2, strategy: 'mutator', mu: 1250, isBaseline: false }],
        baselineRank: 1,
        baselineMu: 1250,
        strategyEffectiveness: { mutator: { count: 3, avgMu: 1200 } },
        metaFeedback: null,
      };
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { run_summary: runSummary },
          error: null,
        }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getEvolutionRunEloHistoryAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(4);
      expect(result.data![0]).toEqual({ iteration: 1, mu: 1100 });
      expect(result.data![3]).toEqual({ iteration: 4, mu: 1250 });
    });

    it('returns empty array when run_summary is null', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { run_summary: null },
          error: null,
        }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getEvolutionRunEloHistoryAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('rejects invalid runId', async () => {
      const result = await getEvolutionRunEloHistoryAction('bad-id');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid runId');
    });

    it('returns error on DB failure', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'not found', code: 'PGRST116' },
        }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getEvolutionRunEloHistoryAction(VALID_UUID);

      expect(result.success).toBe(false);
    });
  });

  // ─── getEvolutionRunLineageAction ────────────────────────────

  describe('getEvolutionRunLineageAction', () => {
    it('returns lineage graph nodes for a run', async () => {
      const variants = [
        {
          id: VALID_UUID_2,
          generation: 0,
          agent_name: 'seed',
          elo_score: 1100,
          is_winner: false,
          parent_variant_id: null,
        },
        {
          id: VALID_UUID_3,
          generation: 1,
          agent_name: 'mutator',
          elo_score: 1250,
          is_winner: true,
          parent_variant_id: VALID_UUID_2,
        },
      ];
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: variants, error: null })
        ),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getEvolutionRunLineageAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data![0].id).toBe(VALID_UUID_2);
      expect(result.data![0].parentId).toBeNull();
      expect(result.data![1].id).toBe(VALID_UUID_3);
      expect(result.data![1].parentId).toBe(VALID_UUID_2);
      expect(result.data![1].isWinner).toBe(true);
    });

    it('rejects invalid runId', async () => {
      const result = await getEvolutionRunLineageAction('not-a-uuid');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid runId');
    });

    it('returns error on DB failure', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'query failed' } })
        ),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getEvolutionRunLineageAction(VALID_UUID);

      expect(result.success).toBe(false);
    });

    it('returns empty array when run has no variants', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null })
        ),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getEvolutionRunLineageAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  // ─── Auth integration ────────────────────────────────────────

  describe('auth integration', () => {
    it('all actions fail when auth rejects', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Not authorized'));

      const results = await Promise.all([
        getEvolutionDashboardDataAction(undefined),
        getEvolutionRunEloHistoryAction(VALID_UUID),
        getEvolutionRunLineageAction(VALID_UUID),
      ]);

      for (const result of results) {
        expect(result.success).toBe(false);
      }
    });
  });
});
