// Tests for V2 experiment server actions: create, addRun, get, list, cancel.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { createSupabaseChainMock } from '@evolution/testing/service-test-mocks';

// ─── Mocks (must be before imports of modules under test) ────

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue('test-admin-user-id'),
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: jest.fn((fn: unknown) => fn),
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: jest.fn((fn: unknown) => fn),
}));

const mockCreateExperiment = jest.fn();
const mockAddRunToExperiment = jest.fn();
const mockComputeExperimentMetrics = jest.fn();

jest.mock('@evolution/lib/pipeline/manageExperiments', () => ({
  createExperiment: (...args: unknown[]) => mockCreateExperiment(...args),
  addRunToExperiment: (...args: unknown[]) => mockAddRunToExperiment(...args),
  computeExperimentMetrics: (...args: unknown[]) => mockComputeExperimentMetrics(...args),
}));

import {
  createExperimentAction,
  addRunToExperimentAction,
  createExperimentWithRunsAction,
  getExperimentAction,
  listExperimentsAction,
  cancelExperimentAction,
  getPromptsAction,
  getStrategiesAction,
} from './experimentActions';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '660e8400-e29b-41d4-a716-446655440001';

describe('experimentActions', () => {
  let mockSupabase: ReturnType<typeof createSupabaseChainMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createSupabaseChainMock({ data: null, error: null });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  // ─── createExperimentAction ─────────────────────────────────

  describe('createExperimentAction', () => {
    it('calls createExperiment with name, promptId, and supabase', async () => {
      mockCreateExperiment.mockResolvedValue({ id: VALID_UUID });

      const result = await createExperimentAction({ name: 'Test', promptId: VALID_UUID });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: VALID_UUID });
      expect(mockCreateExperiment).toHaveBeenCalledWith('Test', VALID_UUID, mockSupabase);
    });

    it('rejects invalid promptId', async () => {
      const result = await createExperimentAction({ name: 'Test', promptId: 'bad-id' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid promptId');
      expect(mockCreateExperiment).not.toHaveBeenCalled();
    });

    it('wraps createExperiment errors in ActionResult', async () => {
      mockCreateExperiment.mockRejectedValue(new Error('DB insert failed'));

      const result = await createExperimentAction({ name: 'Test', promptId: VALID_UUID });

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  // ─── addRunToExperimentAction ───────────────────────────────

  describe('addRunToExperimentAction', () => {
    it('calls addRunToExperiment with experimentId, config, and supabase', async () => {
      mockAddRunToExperiment.mockResolvedValue({ runId: VALID_UUID_2 });
      const config = { strategy_id: VALID_UUID_2, budget_cap_usd: 0.5 };

      const result = await addRunToExperimentAction({ experimentId: VALID_UUID, config });

      expect(result.success).toBe(true);
      expect(mockAddRunToExperiment).toHaveBeenCalledWith(VALID_UUID, config, mockSupabase);
    });

    it('rejects invalid experimentId via Zod validation', async () => {
      const result = await addRunToExperimentAction({ experimentId: 'nope', config: { strategy_id: 'strat-1', budget_cap_usd: 0.5 } });

      expect(result.success).toBe(false);
    });

    it('wraps addRunToExperiment errors in ActionResult', async () => {
      mockAddRunToExperiment.mockRejectedValue(new Error('Experiment not found'));

      const result = await addRunToExperimentAction({ experimentId: VALID_UUID, config: { strategy_id: 'strat-1', budget_cap_usd: 0.5 } });

      expect(result.success).toBe(false);
    });
  });

  // ─── getExperimentAction ────────────────────────────────────

  describe('getExperimentAction', () => {
    it('fetches experiment with runs and computes metrics', async () => {
      const experiment = { id: VALID_UUID, name: 'Test', evolution_runs: [] };
      // Override the chain mock to return experiment data
      const chainResult = { data: experiment, error: null };
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue(chainResult),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);
      mockComputeExperimentMetrics.mockResolvedValue({ totalRuns: 0, avgElo: 1200 });

      const result = await getExperimentAction({ experimentId: VALID_UUID });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        ...experiment,
        metrics: { totalRuns: 0, avgElo: 1200 },
      });
      expect(mockSupabase.from).toHaveBeenCalledWith('evolution_experiments');
      expect(mockComputeExperimentMetrics).toHaveBeenCalledWith(VALID_UUID, mockSupabase);
    });

    it('rejects invalid experimentId', async () => {
      const result = await getExperimentAction({ experimentId: 'bad' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid experimentId');
    });

    it('returns error when experiment not found', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: { message: 'Not found', code: 'PGRST116' } }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getExperimentAction({ experimentId: VALID_UUID });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('not found');
    });

    it('returns error when DB query fails', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: { message: 'Connection lost' } }),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getExperimentAction({ experimentId: VALID_UUID });

      expect(result.success).toBe(false);
    });
  });

  // ─── listExperimentsAction ──────────────────────────────────

  describe('listExperimentsAction', () => {
    it('lists all experiments without filter', async () => {
      const experiments = [
        { id: VALID_UUID, name: 'Exp1', evolution_runs: [{ id: 'r1' }, { id: 'r2' }] },
        { id: VALID_UUID_2, name: 'Exp2', evolution_runs: [] },
      ];
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) => resolve({ data: experiments, error: null })),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await listExperimentsAction(undefined);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data![0].runCount).toBe(2);
      expect(result.data![1].runCount).toBe(0);
    });

    it('filters experiments by status when provided', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) => resolve({ data: [], error: null })),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      await listExperimentsAction({ status: 'running' });

      expect(chain.eq).toHaveBeenCalledWith('status', 'running');
    });

    it('returns error on DB failure', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) => resolve({ data: null, error: { message: 'timeout' } })),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await listExperimentsAction(undefined);

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('returns empty array when no data', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) => resolve({ data: null, error: null })),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await listExperimentsAction(undefined);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  // ─── listExperimentsAction filterTestContent ────────────────

  describe('listExperimentsAction filterTestContent', () => {
    it('calls .not() when filterTestContent is true', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) => resolve({ data: [], error: null })),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await listExperimentsAction({ filterTestContent: true });

      expect(result.success).toBe(true);
      expect(chain.not).toHaveBeenCalledWith('name', 'ilike', '%[TEST]%');
    });

    it('does not call .not() when filterTestContent is false', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) => resolve({ data: [], error: null })),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await listExperimentsAction({ filterTestContent: false });

      expect(result.success).toBe(true);
      expect(chain.not).not.toHaveBeenCalled();
    });
  });

  // ─── getPromptsAction filterTestContent ────────────────────

  describe('getPromptsAction filterTestContent', () => {
    it('calls .not() on name when filterTestContent is true', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) => resolve({ data: [], error: null })),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getPromptsAction({ status: 'active', filterTestContent: true });

      expect(result.success).toBe(true);
      expect(chain.not).toHaveBeenCalledWith('name', 'ilike', '%[TEST]%');
    });

    it('does not call .not() when filterTestContent is false', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) => resolve({ data: [], error: null })),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getPromptsAction({ status: 'active', filterTestContent: false });

      expect(result.success).toBe(true);
      expect(chain.not).not.toHaveBeenCalled();
    });
  });

  // ─── getStrategiesAction filterTestContent ─────────────────

  describe('getStrategiesAction filterTestContent', () => {
    it('calls .not() on name when filterTestContent is true', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) => resolve({ data: [], error: null })),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getStrategiesAction({ status: 'active', filterTestContent: true });

      expect(result.success).toBe(true);
      expect(chain.not).toHaveBeenCalledWith('name', 'ilike', '%[TEST]%');
    });

    it('does not call .not() when filterTestContent is false', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: (v: unknown) => void) => resolve({ data: [], error: null })),
      };
      mockSupabase.from = jest.fn().mockReturnValue(chain);

      const result = await getStrategiesAction({ status: 'active', filterTestContent: false });

      expect(result.success).toBe(true);
      expect(chain.not).not.toHaveBeenCalled();
    });
  });

  // ─── cancelExperimentAction ─────────────────────────────────

  describe('cancelExperimentAction', () => {
    it('calls RPC cancel_experiment with correct params', async () => {
      mockSupabase.rpc = jest.fn().mockResolvedValue({ error: null });

      const result = await cancelExperimentAction({ experimentId: VALID_UUID });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ cancelled: true });
      expect(mockSupabase.rpc).toHaveBeenCalledWith('cancel_experiment', {
        p_experiment_id: VALID_UUID,
      });
    });

    it('rejects invalid experimentId', async () => {
      const result = await cancelExperimentAction({ experimentId: 'bad' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid experimentId');
    });

    it('returns error when RPC fails', async () => {
      mockSupabase.rpc = jest.fn().mockResolvedValue({ error: { message: 'RPC timeout' } });

      const result = await cancelExperimentAction({ experimentId: VALID_UUID });

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  // ─── Bug #6: Budget validation ──────────────────────────────

  describe('addRunToExperimentAction budget validation', () => {
    it('Bug #6: rejects budget > $10 via Zod', async () => {
      const result = await addRunToExperimentAction({
        experimentId: VALID_UUID,
        config: { strategy_id: VALID_UUID_2, budget_cap_usd: 15 },
      });
      expect(result.success).toBe(false);
    });

    it('Bug #6: rejects budget <= 0 via Zod', async () => {
      const result = await addRunToExperimentAction({
        experimentId: VALID_UUID,
        config: { strategy_id: VALID_UUID_2, budget_cap_usd: 0 },
      });
      expect(result.success).toBe(false);
    });

    it('Bug #6: accepts valid budget', async () => {
      mockAddRunToExperiment.mockResolvedValue({ runId: 'r-1' });
      const result = await addRunToExperimentAction({
        experimentId: VALID_UUID,
        config: { strategy_id: VALID_UUID_2, budget_cap_usd: 5 },
      });
      expect(result.success).toBe(true);
    });
  });

  // ─── Bug #7: Batch experiment creation ─────────────────────

  describe('createExperimentWithRunsAction', () => {
    it('Bug #7: creates experiment and adds all runs', async () => {
      mockCreateExperiment.mockResolvedValue({ id: 'exp-new' });
      mockAddRunToExperiment
        .mockResolvedValueOnce({ runId: 'r-1' })
        .mockResolvedValueOnce({ runId: 'r-2' });

      const result = await createExperimentWithRunsAction({
        name: 'Test Exp',
        promptId: VALID_UUID,
        runs: [
          { strategy_id: VALID_UUID, budget_cap_usd: 1 },
          { strategy_id: VALID_UUID_2, budget_cap_usd: 2 },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.data!.experimentId).toBe('exp-new');
      expect(mockCreateExperiment).toHaveBeenCalledTimes(1);
      expect(mockAddRunToExperiment).toHaveBeenCalledTimes(2);
    });

    it('Bug #7: rolls back on run failure', async () => {
      mockCreateExperiment.mockResolvedValue({ id: 'exp-fail' });
      mockAddRunToExperiment
        .mockResolvedValueOnce({ runId: 'r-1' })
        .mockRejectedValueOnce(new Error('DB error'));

      // Mock delete operations
      const deleteMock = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
      mockSupabase.from = jest.fn().mockReturnValue({ delete: deleteMock });

      const result = await createExperimentWithRunsAction({
        name: 'Fail Exp',
        promptId: VALID_UUID,
        runs: [
          { strategy_id: VALID_UUID, budget_cap_usd: 1 },
          { strategy_id: VALID_UUID_2, budget_cap_usd: 2 },
        ],
      });

      expect(result.success).toBe(false);
      // Should have attempted cleanup
      expect(mockSupabase.from).toHaveBeenCalled();
    });

    it('Bug #7: rejects budget > $10 in batch', async () => {
      const result = await createExperimentWithRunsAction({
        name: 'Over Budget',
        promptId: VALID_UUID,
        runs: [{ strategy_id: VALID_UUID, budget_cap_usd: 15 }],
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── Auth integration ───────────────────────────────────────

  describe('auth integration', () => {
    it('all actions fail when auth rejects', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Not authorized'));

      const results = await Promise.all([
        createExperimentAction({ name: 'Test', promptId: VALID_UUID }),
        addRunToExperimentAction({ experimentId: VALID_UUID, config: { strategy_id: 'strat-1', budget_cap_usd: 0.5 } }),
        getExperimentAction({ experimentId: VALID_UUID }),
        listExperimentsAction(undefined),
        cancelExperimentAction({ experimentId: VALID_UUID }),
      ]);

      for (const result of results) {
        expect(result.success).toBe(false);
      }
    });
  });
});
