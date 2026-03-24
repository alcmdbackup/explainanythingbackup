// Tests for V2 evolution run server actions: list, get, cost breakdown, logs, kill, variants, archive.
// Verifies V2 schema (no total_cost_usd column on runs, strategy_id, run_summary, budget_cap_usd).

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { logAdminAction } from '@/lib/services/auditLog';
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
  queueEvolutionRunAction,
  getEvolutionRunsAction,
  getEvolutionRunByIdAction,
  getEvolutionCostBreakdownAction,
  getEvolutionRunLogsAction,
  killEvolutionRunAction,
  listVariantsAction,
  archiveRunAction,
  unarchiveRunAction,
} from './evolutionActions';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '660e8400-e29b-41d4-a716-446655440001';
const VALID_UUID_3 = '770e8400-e29b-41d4-a716-446655440002';

const MOCK_RUN = {
  id: VALID_UUID,
  explanation_id: null,
  status: 'completed',
  budget_cap_usd: 5.0,
  error_message: null,
  completed_at: '2026-03-01T12:00:00Z',
  created_at: '2026-03-01T10:00:00Z',
  prompt_id: null,
  pipeline_version: 'v2',
  strategy_id: VALID_UUID_2,
  experiment_id: null,
  archived: false,
  run_summary: null,
  runner_id: null,
  last_heartbeat: null,
};

describe('evolutionActions', () => {
  let mockSupabase: ReturnType<typeof createSupabaseChainMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createSupabaseChainMock({ data: null, error: null });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  // ─── getEvolutionRunsAction ──────────────────────────────────

  describe('getEvolutionRunsAction', () => {
    it('returns runs enriched with costs and strategy names', async () => {
      const runs = [MOCK_RUN];
      const costs = [{ run_id: VALID_UUID, total_cost_usd: 2.5 }];
      const strategies = [{ id: VALID_UUID_2, name: 'My Strategy' }];

      // from() calls in order: evolution_runs, evolution_run_costs, evolution_experiments (none), evolution_strategies
      const mock = createTableAwareMock([
        // evolution_runs
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: runs, error: null })
          );
        },
        // evolution_run_costs
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: costs, error: null })
          );
        },
        // evolution_strategies (for strategy names)
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: strategies, error: null })
          );
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getEvolutionRunsAction(undefined);

      expect(result.success).toBe(true);
      expect(result.data!.items).toHaveLength(1);
      expect(result.data!.items[0].total_cost_usd).toBe(2.5);
      expect(result.data!.items[0].strategy_name).toBe('My Strategy');
    });

    it('returns error on DB failure', async () => {
      const mock = createTableAwareMock([
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: null, error: { message: 'connection refused' } })
          );
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getEvolutionRunsAction(undefined);

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('filters by status when provided', async () => {
      const mock = createTableAwareMock([
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null })
          );
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getEvolutionRunsAction({ status: 'running' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ items: [], total: 0 });
    });

    it('rejects invalid promptId filter', async () => {
      const result = await getEvolutionRunsAction({ promptId: 'not-a-uuid' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid promptId');
    });

    it('filters test content by excluding runs with [TEST] strategy names', async () => {
      const testStrategyId = VALID_UUID_2;
      const testStrategies = [{ id: testStrategyId }];
      const runs = [{ ...MOCK_RUN, strategy_id: VALID_UUID_3 }]; // non-test run

      const mock = createTableAwareMock([
        // evolution_strategies (test strategy lookup)
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: testStrategies, error: null })
          );
        },
        // evolution_runs
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: runs, error: null, count: 1 })
          );
        },
        // evolution_run_costs
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null })
          );
        },
        // evolution_strategies (for strategy names)
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: [{ id: VALID_UUID_3, name: 'Real Strategy' }], error: null })
          );
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getEvolutionRunsAction({ filterTestContent: true });

      expect(result.success).toBe(true);
      // Verify the .not() filter was applied via the from() calls
      expect(mock.from).toHaveBeenCalledTimes(4);
    });

    it('skips test content filter when no test strategies exist', async () => {
      const mock = createTableAwareMock([
        // evolution_strategies (no test strategies found)
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null })
          );
        },
        // evolution_runs
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null, count: 0 })
          );
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getEvolutionRunsAction({ filterTestContent: true });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ items: [], total: 0 });
    });
  });

  // ─── getEvolutionRunByIdAction ───────────────────────────────

  describe('getEvolutionRunByIdAction', () => {
    it('returns run with total_cost_usd and strategy_name', async () => {
      const mock = createTableAwareMock([
        // evolution_runs single
        (b) => {
          b.single = jest.fn().mockResolvedValue({ data: MOCK_RUN, error: null });
        },
        // evolution_strategies single
        (b) => {
          b.single = jest.fn().mockResolvedValue({ data: { name: 'Strategy Alpha' }, error: null });
        },
      ]);
      mock.rpc = jest.fn().mockResolvedValue({ data: '1.23', error: null });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getEvolutionRunByIdAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe(VALID_UUID);
      expect(result.data!.total_cost_usd).toBe(1.23);
      expect(result.data!.strategy_name).toBe('Strategy Alpha');
    });

    it('rejects invalid runId', async () => {
      const result = await getEvolutionRunByIdAction('bad-id');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid runId');
    });

    it('returns error when run not found', async () => {
      const mock = createTableAwareMock([
        (b) => {
          b.single = jest.fn().mockResolvedValue({
            data: null,
            error: { message: 'Row not found', code: 'PGRST116' },
          });
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getEvolutionRunByIdAction(VALID_UUID);

      expect(result.success).toBe(false);
    });
  });

  // ─── getEvolutionCostBreakdownAction ─────────────────────────

  describe('getEvolutionCostBreakdownAction', () => {
    it('aggregates cost by agent', async () => {
      const invocations = [
        { agent_name: 'generator', cost_usd: '0.50' },
        { agent_name: 'generator', cost_usd: '0.25' },
        { agent_name: 'judge', cost_usd: '0.10' },
      ];
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: invocations, error: null })
        ),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getEvolutionCostBreakdownAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      // generator: 0.75, judge: 0.10 — sorted descending by cost
      const [first, second] = result.data!;
      expect(first.agent).toBe('generator');
      expect(first.calls).toBe(2);
      expect(first.costUsd).toBeCloseTo(0.75);
      expect(second.agent).toBe('judge');
    });

    it('rejects invalid runId', async () => {
      const result = await getEvolutionCostBreakdownAction('nope');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid runId');
    });

    it('returns error on DB failure', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'timeout' } })
        ),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getEvolutionCostBreakdownAction(VALID_UUID);

      expect(result.success).toBe(false);
    });
  });

  // ─── getEvolutionRunLogsAction ───────────────────────────────

  describe('getEvolutionRunLogsAction', () => {
    it('returns paginated log entries', async () => {
      const logs = [
        {
          id: 1,
          created_at: '2026-03-01T10:01:00Z',
          level: 'info',
          agent_name: 'generator',
          iteration: 1,
          variant_id: VALID_UUID_3,
          message: 'Generating variant',
          context: null,
        },
      ];
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({ data: logs, error: null, count: 1 }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getEvolutionRunLogsAction({ runId: VALID_UUID });

      expect(result.success).toBe(true);
      expect(result.data!.items).toHaveLength(1);
      expect(result.data!.total).toBe(1);
      expect(result.data!.items[0].message).toBe('Generating variant');
    });

    it('rejects invalid runId', async () => {
      const result = await getEvolutionRunLogsAction({ runId: 'bad' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid runId');
    });

    it('returns error on DB failure', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({ data: null, error: { message: 'query error' }, count: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getEvolutionRunLogsAction({ runId: VALID_UUID });

      expect(result.success).toBe(false);
    });
  });

  // ─── killEvolutionRunAction ──────────────────────────────────

  describe('killEvolutionRunAction', () => {
    it('marks run as failed and logs admin action', async () => {
      const killedRun = { ...MOCK_RUN, status: 'failed', error_message: 'Manually killed by admin' };
      const chain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: killedRun, error: null }),
        insert: jest.fn(() => Promise.resolve({ error: null })),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await killEvolutionRunAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data!.status).toBe('failed');
      expect(logAdminAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'kill_evolution_run',
          entityType: 'evolution_run',
          entityId: VALID_UUID,
        }),
      );
    });

    it('rejects invalid runId', async () => {
      const result = await killEvolutionRunAction('not-a-uuid');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid runId');
    });

    it('returns error when run not found or already terminal', async () => {
      const chain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await killEvolutionRunAction(VALID_UUID);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Cannot kill run');
    });
  });

  // ─── listVariantsAction ──────────────────────────────────────

  describe('listVariantsAction', () => {
    it('returns paginated variants with strategy names', async () => {
      const variants = [
        {
          id: VALID_UUID_3,
          run_id: VALID_UUID,
          explanation_id: null,
          elo_score: 1250,
          generation: 2,
          agent_name: 'mutator',
          match_count: 5,
          is_winner: true,
          created_at: '2026-03-01T11:00:00Z',
        },
      ];
      const runs = [{ id: VALID_UUID, strategy_id: VALID_UUID_2 }];
      const strategies = [{ id: VALID_UUID_2, name: 'Strategy Beta' }];

      const mock = createTableAwareMock([
        // evolution_variants (with count)
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: variants, error: null, count: 1 })
          );
        },
        // evolution_runs (for enrichment)
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: runs, error: null })
          );
        },
        // evolution_strategies
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: strategies, error: null })
          );
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await listVariantsAction({ limit: 50, offset: 0 });

      expect(result.success).toBe(true);
      expect(result.data!.items).toHaveLength(1);
      expect(result.data!.items[0].strategy_name).toBe('Strategy Beta');
    });

    it('returns error on DB failure', async () => {
      const mock = createTableAwareMock([
        (b) => {
          b.then = jest.fn((resolve: (v: unknown) => void) =>
            resolve({ data: null, error: { message: 'query timeout' }, count: null })
          );
        },
      ]);
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await listVariantsAction({ limit: 50, offset: 0 });

      expect(result.success).toBe(false);
    });
  });

  // ─── archiveRunAction ────────────────────────────────────────

  describe('archiveRunAction', () => {
    it('sets archived=true on the run', async () => {
      const chain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: null, error: null })
        ),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await archiveRunAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ archived: true });
    });

    it('rejects invalid runId', async () => {
      const result = await archiveRunAction('bad');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid runId');
    });

    it('returns error on DB failure', async () => {
      const chain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'update failed' } })
        ),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await archiveRunAction(VALID_UUID);

      expect(result.success).toBe(false);
    });
  });

  // ─── unarchiveRunAction ──────────────────────────────────────

  describe('unarchiveRunAction', () => {
    it('sets archived=false on the run', async () => {
      const chain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) =>
          resolve({ data: null, error: null })
        ),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await unarchiveRunAction(VALID_UUID);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ unarchived: true });
    });

    it('rejects invalid runId', async () => {
      const result = await unarchiveRunAction('nope');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid runId');
    });
  });

  // ─── queueEvolutionRunAction ─────────────────────────────────

  describe('queueEvolutionRunAction', () => {
    it('inserts evolution_logs row when queueing a run', async () => {
      const createdRun = { ...MOCK_RUN, id: VALID_UUID, status: 'pending' };
      const insertedTables: string[] = [];

      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { id: VALID_UUID_2, status: 'active' }, error: null }),
        insert: jest.fn().mockImplementation(() => {
          return {
            select: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: createdRun, error: null }),
            then: jest.fn((resolve: (v: unknown) => void) => resolve({ error: null })),
          };
        }),
      };
      mockSupabase.from = jest.fn((table: string) => {
        insertedTables.push(table);
        return chain;
      });

      const result = await queueEvolutionRunAction({
        explanationId: 42,
        strategyId: VALID_UUID_2,
        budgetCapUsd: 3.0,
      });

      expect(result.success).toBe(true);
      // Verify evolution_logs was accessed (for the insert via createEntityLogger)
      expect(insertedTables).toContain('evolution_logs');
    });
  });

  // ─── Auth integration ────────────────────────────────────────

  describe('auth integration', () => {
    it('all actions fail when auth rejects', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Not authorized'));

      const results = await Promise.all([
        getEvolutionRunsAction(undefined),
        getEvolutionRunByIdAction(VALID_UUID),
        archiveRunAction(VALID_UUID),
        unarchiveRunAction(VALID_UUID),
        listVariantsAction({ limit: 10, offset: 0 }),
      ]);

      for (const result of results) {
        expect(result.success).toBe(false);
      }
    });
  });
});
