// Tests for evolution server actions: cost breakdown, date filtering, cost estimation, and kill.

import {
  getEvolutionCostBreakdownAction,
  getEvolutionRunsAction,
  estimateRunCostAction,
  getEvolutionVariantsAction,
  getEvolutionRunByIdAction,
  killEvolutionRunAction,
} from './evolutionActions';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: (fn: unknown) => fn,
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: (fn: unknown) => fn,
}));

jest.mock('@/lib/services/auditLog', () => ({
  logAdminAction: jest.fn(),
}));

const mockBuildVariantsFromCheckpoint = jest.fn();
jest.mock('@evolution/services/evolutionVisualizationActions', () => ({
  buildVariantsFromCheckpoint: (...args: unknown[]) => mockBuildVariantsFromCheckpoint(...args),
}));

const mockEstimateRunCostWithAgentModels = jest.fn();
jest.mock('@evolution/lib', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require('zod');
  return {
    estimateRunCostWithAgentModels: (...args: unknown[]) => mockEstimateRunCostWithAgentModels(...args),
    RunCostEstimateSchema: z.object({
      totalUsd: z.number(),
      perAgent: z.record(z.number()),
      perIteration: z.number(),
      confidence: z.enum(['high', 'medium', 'low']),
    }),
  };
});

/** Build a Supabase mock where every method chains and .single()/.limit() are terminal. */
function createChainMock() {
  const mock: Record<string, jest.Mock> = {};
  const chain = () => mock;
  // All chain methods return the mock itself (chainable)
  for (const m of ['from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'like', 'ilike', 'in', 'is',
    'order', 'limit', 'range', 'single', 'maybeSingle']) {
    mock[m] = jest.fn(chain);
  }
  return mock;
}

describe('Evolution Actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
  });

  // ─── Cost Breakdown ────────────────────────────────────────────

  describe('getEvolutionCostBreakdownAction', () => {
    it('groups costs by agent using SUM(cost_usd) across iterations', async () => {
      const mock = createChainMock();

      // .order() is terminal for the invocations query; one row per (run_id, iteration, agent_name)
      mock.order.mockResolvedValueOnce({
        data: [
          { agent_name: 'generation', cost_usd: 0.01, iteration: 1 },
          { agent_name: 'calibration', cost_usd: 0.005, iteration: 1 },
          { agent_name: 'generation', cost_usd: 0.03, iteration: 2 },
        ],
        error: null,
      });

      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getEvolutionCostBreakdownAction('run-1');
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      // Sorted by costUsd desc; SUM(cost_usd) per agent across iterations
      expect(result.data![0]).toEqual({ agent: 'generation', calls: 2, costUsd: 0.04 });
      expect(result.data![1]).toEqual({ agent: 'calibration', calls: 1, costUsd: 0.005 });
    });

    it('returns empty array when no invocations found', async () => {
      const mock = createChainMock();
      mock.order.mockResolvedValueOnce({ data: [], error: null });

      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getEvolutionCostBreakdownAction('run-1');
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('returns error when invocations query fails', async () => {
      const mock = createChainMock();
      mock.order.mockResolvedValueOnce({ data: null, error: { message: 'db error' } });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await getEvolutionCostBreakdownAction('run-missing');
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  // ─── Date filter ───────────────────────────────────────────────

  describe('getEvolutionRunsAction with startDate', () => {
    it('applies gte filter when startDate provided', async () => {
      const mock = createChainMock();
      // The chain is: from→select→order→limit then gte is applied
      // The result resolves from limit (after gte)
      mock.gte.mockResolvedValueOnce({ data: [], error: null });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      await getEvolutionRunsAction({ startDate: '2026-01-01T00:00:00Z' });
      expect(mock.gte).toHaveBeenCalledWith('created_at', '2026-01-01T00:00:00Z');
    });

    it('does not apply gte filter without startDate', async () => {
      const mock = createChainMock();
      // Without startDate, chain ends at eq (for status filter) or limit
      mock.eq.mockResolvedValueOnce({ data: [], error: null });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      await getEvolutionRunsAction({ status: 'completed' });
      expect(mock.gte).not.toHaveBeenCalled();
    });
  });

  // ─── Queue with cost estimate ──────────────────────────────────

  describe('queueEvolutionRunAction cost estimation', () => {
    it('populates estimated_cost_usd when strategy is provided', async () => {
      const mock = createChainMock();
      let singleCallCount = 0;
      mock.single.mockImplementation(() => {
        singleCallCount++;
        if (singleCallCount === 1) {
          // prompt lookup
          return Promise.resolve({ data: { id: 'prompt-1' }, error: null });
        }
        if (singleCallCount === 2) {
          // strategy lookup
          return Promise.resolve({
            data: {
              id: 'strat-1',
              config: { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterations: 3 },
            },
            error: null,
          });
        }
        // insert().select().single() — return inserted row
        return Promise.resolve({
          data: { id: 'run-1', estimated_cost_usd: 2.50 },
          error: null,
        });
      });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);
      mockEstimateRunCostWithAgentModels.mockResolvedValueOnce({
        totalUsd: 2.50,
        perAgent: { generation: 1.0, calibration: 1.5 },
        perIteration: 0.25,
        confidence: 'medium',
      });

      const { queueEvolutionRunAction } = await import('./evolutionActions');
      const result = await queueEvolutionRunAction({
        promptId: 'prompt-1',
        strategyId: '12345678-1234-4123-8123-123456789abc',
      });
      expect(result.success).toBe(true);

      // Verify insert was called with estimated_cost_usd
      const insertCall = mock.insert.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(insertCall.estimated_cost_usd).toBe(2.50);
      expect(insertCall.cost_estimate_detail).toBeTruthy();
    });

    it('queues successfully even if estimation throws', async () => {
      const mock = createChainMock();
      let singleCallCount = 0;
      mock.single.mockImplementation(() => {
        singleCallCount++;
        if (singleCallCount === 1) {
          return Promise.resolve({ data: { id: 'prompt-1' }, error: null });
        }
        if (singleCallCount === 2) {
          return Promise.resolve({
            data: {
              id: 'strat-1',
              config: { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterations: 3 },
            },
            error: null,
          });
        }
        return Promise.resolve({
          data: { id: 'run-2', estimated_cost_usd: null },
          error: null,
        });
      });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);
      mockEstimateRunCostWithAgentModels.mockRejectedValueOnce(new Error('DB timeout'));

      const { queueEvolutionRunAction } = await import('./evolutionActions');
      const result = await queueEvolutionRunAction({
        promptId: 'prompt-1',
        strategyId: '12345678-1234-4123-8123-123456789abc',
      });
      expect(result.success).toBe(true);

      // Estimated cost should be null due to failure
      const insertCall = mock.insert.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(insertCall.estimated_cost_usd).toBeNull();
      expect(insertCall.cost_estimate_detail).toBeNull();
    });

    it('passes enabledAgents and singleArticle from strategy config into run config', async () => {
      const mock = createChainMock();
      let singleCallCount = 0;
      mock.single.mockImplementation(() => {
        singleCallCount++;
        if (singleCallCount === 1) {
          return Promise.resolve({ data: { id: 'prompt-1' }, error: null });
        }
        if (singleCallCount === 2) {
          return Promise.resolve({
            data: {
              id: 'strat-1',
              config: {
                generationModel: 'gpt-4.1-mini',
                judgeModel: 'gpt-4.1-nano',
                iterations: 3,
                enabledAgents: ['reflection', 'debate'],
                singleArticle: true,
              },
            },
            error: null,
          });
        }
        return Promise.resolve({
          data: { id: 'run-cfg', estimated_cost_usd: null },
          error: null,
        });
      });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);
      mockEstimateRunCostWithAgentModels.mockResolvedValueOnce({
        totalUsd: 1.50,
        perAgent: { generation: 0.5, calibration: 1.0 },
        perIteration: 0.15,
        confidence: 'medium',
      });

      const { queueEvolutionRunAction } = await import('./evolutionActions');
      const result = await queueEvolutionRunAction({
        promptId: 'prompt-1',
        strategyId: '12345678-1234-4123-8123-123456789abc',
      });
      expect(result.success).toBe(true);

      const insertCall = mock.insert.mock.calls[0]?.[0] as Record<string, unknown>;
      const runConfig = insertCall.config as Record<string, unknown>;
      expect(runConfig).toBeDefined();
      expect(runConfig.enabledAgents).toEqual(['reflection', 'debate']);
      expect(runConfig.singleArticle).toBe(true);
      expect(runConfig.maxIterations).toBe(3);
      expect(runConfig.generationModel).toBe('gpt-4.1-mini');
      expect(runConfig.judgeModel).toBe('gpt-4.1-nano');
    });

    it('copies model and iteration fields even without enabledAgents or singleArticle', async () => {
      const mock = createChainMock();
      let singleCallCount = 0;
      mock.single.mockImplementation(() => {
        singleCallCount++;
        if (singleCallCount === 1) {
          return Promise.resolve({ data: { id: 'prompt-1' }, error: null });
        }
        if (singleCallCount === 2) {
          return Promise.resolve({
            data: {
              id: 'strat-1',
              config: { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterations: 3 },
            },
            error: null,
          });
        }
        return Promise.resolve({
          data: { id: 'run-no-cfg', estimated_cost_usd: null },
          error: null,
        });
      });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);
      mockEstimateRunCostWithAgentModels.mockResolvedValueOnce({
        totalUsd: 2.0,
        perAgent: { generation: 1.0, calibration: 1.0 },
        perIteration: 0.20,
        confidence: 'medium',
      });

      const { queueEvolutionRunAction } = await import('./evolutionActions');
      const result = await queueEvolutionRunAction({
        promptId: 'prompt-1',
        strategyId: '12345678-1234-4123-8123-123456789abc',
      });
      expect(result.success).toBe(true);

      const insertCall = mock.insert.mock.calls[0]?.[0] as Record<string, unknown>;
      const runConfig = insertCall.config as Record<string, unknown>;
      expect(runConfig).toBeDefined();
      expect(runConfig.maxIterations).toBe(3);
      expect(runConfig.generationModel).toBe('gpt-4.1-mini');
      expect(runConfig.judgeModel).toBe('gpt-4.1-nano');
      // No enabledAgents or singleArticle since strategy doesn't have them
      expect(runConfig.enabledAgents).toBeUndefined();
      expect(runConfig.singleArticle).toBeUndefined();
    });

    it('sets null when Zod validation fails on estimate result', async () => {
      const mock = createChainMock();
      let singleCallCount = 0;
      mock.single.mockImplementation(() => {
        singleCallCount++;
        if (singleCallCount === 1) {
          return Promise.resolve({ data: { id: 'prompt-1' }, error: null });
        }
        if (singleCallCount === 2) {
          return Promise.resolve({
            data: {
              id: 'strat-1',
              config: { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterations: 3 },
            },
            error: null,
          });
        }
        return Promise.resolve({ data: { id: 'run-z', estimated_cost_usd: null }, error: null });
      });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);
      // Return invalid shape — missing required fields
      mockEstimateRunCostWithAgentModels.mockResolvedValueOnce({ totalUsd: 'not-a-number' });

      const { queueEvolutionRunAction } = await import('./evolutionActions');
      const result = await queueEvolutionRunAction({
        promptId: 'prompt-1',
        strategyId: '12345678-1234-4123-8123-123456789abc',
      });
      expect(result.success).toBe(true);

      const insertCall = mock.insert.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(insertCall.estimated_cost_usd).toBeNull();
      expect(insertCall.cost_estimate_detail).toBeNull();
    });
  });

  // ─── COST-1: Pre-queue budget validation ───────────────────────

  describe('queueEvolutionRunAction budget validation (COST-1)', () => {
    it('rejects when estimated cost exceeds budget cap', async () => {
      const mock = createChainMock();
      let singleCallCount = 0;
      mock.single.mockImplementation(() => {
        singleCallCount++;
        if (singleCallCount === 1) {
          return Promise.resolve({ data: { id: 'prompt-1' }, error: null });
        }
        if (singleCallCount === 2) {
          return Promise.resolve({
            data: {
              id: 'strat-1',
              config: { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterations: 10, budgetCapUsd: 1.00 },
            },
            error: null,
          });
        }
        return Promise.resolve({ data: { id: 'run-x' }, error: null });
      });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);
      // Estimate exceeds the $1.00 budget cap
      mockEstimateRunCostWithAgentModels.mockResolvedValueOnce({
        totalUsd: 5.00,
        perAgent: { generation: 3.0, calibration: 2.0 },
        perIteration: 0.50,
        confidence: 'medium',
      });

      const { queueEvolutionRunAction } = await import('./evolutionActions');
      const result = await queueEvolutionRunAction({
        promptId: 'prompt-1',
        strategyId: '12345678-1234-4123-8123-123456789abc',
        budgetCapUsd: 1.00,
      });
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('exceeds budget cap');
      // Should NOT have called insert
      expect(mock.insert).not.toHaveBeenCalled();
    });

    it('accepts when estimated cost is null (no strategy config estimate)', async () => {
      const mock = createChainMock();
      let singleCallCount = 0;
      mock.single.mockImplementation(() => {
        singleCallCount++;
        if (singleCallCount === 1) {
          return Promise.resolve({ data: { id: 42 }, error: null });
        }
        return Promise.resolve({
          data: { id: 'run-ok', estimated_cost_usd: null },
          error: null,
        });
      });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const { queueEvolutionRunAction } = await import('./evolutionActions');
      const result = await queueEvolutionRunAction({
        explanationId: 42,
        budgetCapUsd: 1.00,
      });
      expect(result.success).toBe(true);
      expect(mock.insert).toHaveBeenCalled();
    });

    it('accepts when estimated cost is within budget cap', async () => {
      const mock = createChainMock();
      let singleCallCount = 0;
      mock.single.mockImplementation(() => {
        singleCallCount++;
        if (singleCallCount === 1) {
          return Promise.resolve({ data: { id: 'prompt-1' }, error: null });
        }
        if (singleCallCount === 2) {
          return Promise.resolve({
            data: {
              id: 'strat-1',
              config: { generationModel: 'gpt-4.1-mini', iterations: 3 },
            },
            error: null,
          });
        }
        return Promise.resolve({ data: { id: 'run-ok', estimated_cost_usd: 2.0 }, error: null });
      });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);
      mockEstimateRunCostWithAgentModels.mockResolvedValueOnce({
        totalUsd: 2.00,
        perAgent: { generation: 1.0, calibration: 1.0 },
        perIteration: 0.20,
        confidence: 'medium',
      });

      const { queueEvolutionRunAction } = await import('./evolutionActions');
      const result = await queueEvolutionRunAction({
        promptId: 'prompt-1',
        strategyId: '12345678-1234-4123-8123-123456789abc',
        budgetCapUsd: 5.00,
      });
      expect(result.success).toBe(true);
      expect(mock.insert).toHaveBeenCalled();
    });
  });

  // ─── Config propagation edge cases ─────────────────────────────

  describe('queueEvolutionRunAction config propagation edge cases', () => {
    /** Helper: set up mock for queue with a given strategy config. Returns the mock for assertion. */
    function setupQueueMock(strategyConfig: Record<string, unknown>) {
      const mock = createChainMock();
      let singleCallCount = 0;
      mock.single.mockImplementation(() => {
        singleCallCount++;
        if (singleCallCount === 1) {
          return Promise.resolve({ data: { id: 'prompt-1' }, error: null });
        }
        if (singleCallCount === 2) {
          return Promise.resolve({
            data: { id: 'strat-1', config: strategyConfig },
            error: null,
          });
        }
        return Promise.resolve({
          data: { id: 'run-edge', estimated_cost_usd: null },
          error: null,
        });
      });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);
      mockEstimateRunCostWithAgentModels.mockResolvedValueOnce({
        totalUsd: 1.0, perAgent: {}, perIteration: 0.1, confidence: 'low',
      });
      return mock;
    }

    it('clamps iterations: 0 to maxIterations: 1', async () => {
      const mock = setupQueueMock({ iterations: 0 });
      const { queueEvolutionRunAction } = await import('./evolutionActions');
      const result = await queueEvolutionRunAction({
        promptId: 'prompt-1',
        strategyId: '12345678-1234-4123-8123-123456789abc',
      });
      expect(result.success).toBe(true);
      const insertCall = mock.insert.mock.calls[0]?.[0] as Record<string, unknown>;
      const runConfig = insertCall.config as Record<string, unknown>;
      expect(runConfig.maxIterations).toBe(1);
    });

    it('clamps iterations: -5 to maxIterations: 1', async () => {
      const mock = setupQueueMock({ iterations: -5 });
      const { queueEvolutionRunAction } = await import('./evolutionActions');
      const result = await queueEvolutionRunAction({
        promptId: 'prompt-1',
        strategyId: '12345678-1234-4123-8123-123456789abc',
      });
      expect(result.success).toBe(true);
      const insertCall = mock.insert.mock.calls[0]?.[0] as Record<string, unknown>;
      const runConfig = insertCall.config as Record<string, unknown>;
      expect(runConfig.maxIterations).toBe(1);
    });

    it('copies iterations: 1 as maxIterations: 1 (boundary)', async () => {
      const mock = setupQueueMock({ iterations: 1 });
      const { queueEvolutionRunAction } = await import('./evolutionActions');
      const result = await queueEvolutionRunAction({
        promptId: 'prompt-1',
        strategyId: '12345678-1234-4123-8123-123456789abc',
      });
      expect(result.success).toBe(true);
      const insertCall = mock.insert.mock.calls[0]?.[0] as Record<string, unknown>;
      const runConfig = insertCall.config as Record<string, unknown>;
      expect(runConfig.maxIterations).toBe(1);
    });

    it('does not copy budgetCaps when null', async () => {
      const mock = setupQueueMock({ budgetCaps: null });
      const { queueEvolutionRunAction } = await import('./evolutionActions');
      const result = await queueEvolutionRunAction({
        promptId: 'prompt-1',
        strategyId: '12345678-1234-4123-8123-123456789abc',
      });
      expect(result.success).toBe(true);
      const insertCall = mock.insert.mock.calls[0]?.[0] as Record<string, unknown>;
      // No config field since budgetCaps: null is skipped
      expect(insertCall.config).toBeUndefined();
    });

    it('does not copy budgetCaps when empty object', async () => {
      const mock = setupQueueMock({ budgetCaps: {} });
      const { queueEvolutionRunAction } = await import('./evolutionActions');
      const result = await queueEvolutionRunAction({
        promptId: 'prompt-1',
        strategyId: '12345678-1234-4123-8123-123456789abc',
      });
      expect(result.success).toBe(true);
      const insertCall = mock.insert.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(insertCall.config).toBeUndefined();
    });

    it('copies budgetCaps as a separate object (no reference sharing)', async () => {
      const budgetCaps = { generation: 0.2, pairwise: 0.3 };
      const mock = setupQueueMock({ budgetCaps });
      const { queueEvolutionRunAction } = await import('./evolutionActions');
      const result = await queueEvolutionRunAction({
        promptId: 'prompt-1',
        strategyId: '12345678-1234-4123-8123-123456789abc',
      });
      expect(result.success).toBe(true);
      const insertCall = mock.insert.mock.calls[0]?.[0] as Record<string, unknown>;
      const runConfig = insertCall.config as Record<string, unknown>;
      expect(runConfig.budgetCaps).toEqual({ generation: 0.2, pairwise: 0.3 });
      expect(runConfig.budgetCaps).not.toBe(budgetCaps); // separate object
    });

    it('copies only present fields (partial config: generationModel but no judgeModel)', async () => {
      const mock = setupQueueMock({ generationModel: 'deepseek-chat' });
      const { queueEvolutionRunAction } = await import('./evolutionActions');
      const result = await queueEvolutionRunAction({
        promptId: 'prompt-1',
        strategyId: '12345678-1234-4123-8123-123456789abc',
      });
      expect(result.success).toBe(true);
      const insertCall = mock.insert.mock.calls[0]?.[0] as Record<string, unknown>;
      const runConfig = insertCall.config as Record<string, unknown>;
      expect(runConfig.generationModel).toBe('deepseek-chat');
      expect(runConfig.judgeModel).toBeUndefined();
      expect(runConfig.maxIterations).toBeUndefined();
    });

    it('omits config when strategy has no copyable fields', async () => {
      const mock = setupQueueMock({});
      const { queueEvolutionRunAction } = await import('./evolutionActions');
      const result = await queueEvolutionRunAction({
        promptId: 'prompt-1',
        strategyId: '12345678-1234-4123-8123-123456789abc',
      });
      expect(result.success).toBe(true);
      const insertCall = mock.insert.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(insertCall.config).toBeUndefined();
    });
  });

  // ─── Config validation at queue time ───────────────────────────

  describe('queueEvolutionRunAction config validation', () => {
    it('rejects a strategy with an invalid model name', async () => {
      const mock = createChainMock();
      let singleCallCount = 0;
      mock.single.mockImplementation(() => {
        singleCallCount++;
        if (singleCallCount === 1) {
          return Promise.resolve({ data: { id: 'prompt-1' }, error: null });
        }
        if (singleCallCount === 2) {
          return Promise.resolve({
            data: {
              id: 'strat-bad',
              config: {
                generationModel: 'nonexistent-model',
                judgeModel: 'gpt-4.1-nano',
                iterations: 5,
                budgetCaps: { generation: 0.2 },
              },
            },
            error: null,
          });
        }
        return Promise.resolve({ data: { id: 'run-1' }, error: null });
      });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);
      mockEstimateRunCostWithAgentModels.mockResolvedValueOnce({
        totalUsd: 1.0, perAgent: {}, perIteration: 0.1, confidence: 'low',
      });

      const { queueEvolutionRunAction } = await import('./evolutionActions');
      const result = await queueEvolutionRunAction({
        promptId: 'prompt-1',
        strategyId: '12345678-1234-4123-8123-123456789abc',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid strategy config');
      expect(result.error?.message).toContain('nonexistent-model');
      // Should NOT have inserted a run into DB
      expect(mock.insert).not.toHaveBeenCalled();
    });
  });

  // ─── Estimate Run Cost ──────────────────────────────────────────

  describe('estimateRunCostAction', () => {
    const validStrategyId = '12345678-1234-4123-8123-123456789abc';

    const mockEstimateResult = {
      totalUsd: 2.50,
      perAgent: { generation: 0.80, calibration: 1.20, evolution: 0.50 },
      perIteration: 0.25,
      confidence: 'medium' as const,
    };

    it('returns cost estimate for valid strategy', async () => {
      const mock = createChainMock();
      mock.single.mockResolvedValueOnce({
        data: {
          config: {
            generationModel: 'gpt-4.1-mini',
            judgeModel: 'gpt-4.1-nano',
            iterations: 5,
          },
        },
        error: null,
      });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);
      mockEstimateRunCostWithAgentModels.mockResolvedValueOnce(mockEstimateResult);

      const result = await estimateRunCostAction({ strategyId: validStrategyId });
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockEstimateResult);
      expect(mockEstimateRunCostWithAgentModels).toHaveBeenCalledWith(
        {
          generationModel: 'gpt-4.1-mini',
          judgeModel: 'gpt-4.1-nano',
          maxIterations: 5,
          agentModels: undefined,
          enabledAgents: undefined,
          singleArticle: undefined,
        },
        5000, // default textLength
      );
    });

    it('passes enabledAgents and singleArticle to estimator', async () => {
      const mock = createChainMock();
      mock.single.mockResolvedValueOnce({
        data: {
          config: {
            generationModel: 'gpt-4.1-mini',
            judgeModel: 'gpt-4.1-nano',
            iterations: 5,
            enabledAgents: ['reflection', 'debate'],
            singleArticle: true,
          },
        },
        error: null,
      });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);
      mockEstimateRunCostWithAgentModels.mockResolvedValueOnce(mockEstimateResult);

      const result = await estimateRunCostAction({ strategyId: validStrategyId });
      expect(result.success).toBe(true);
      expect(mockEstimateRunCostWithAgentModels).toHaveBeenCalledWith(
        expect.objectContaining({
          enabledAgents: ['reflection', 'debate'],
          singleArticle: true,
        }),
        5000,
      );
    });

    it('rejects invalid strategyId (non-UUID)', async () => {
      const result = await estimateRunCostAction({ strategyId: 'not-a-uuid' });
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid strategyId');
    });

    it('rejects budgetCapUsd out of range', async () => {
      const result = await estimateRunCostAction({
        strategyId: validStrategyId,
        budgetCapUsd: 999,
      });
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('budgetCapUsd');
    });

    it('clamps textLength to max 100000', async () => {
      const mock = createChainMock();
      mock.single.mockResolvedValueOnce({
        data: { config: { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterations: 3 } },
        error: null,
      });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);
      mockEstimateRunCostWithAgentModels.mockResolvedValueOnce(mockEstimateResult);

      await estimateRunCostAction({ strategyId: validStrategyId, textLength: 200000 });
      expect(mockEstimateRunCostWithAgentModels).toHaveBeenCalledWith(
        expect.anything(),
        100000,
      );
    });

    it('falls back to default textLength for invalid values', async () => {
      const mock = createChainMock();
      mock.single.mockResolvedValueOnce({
        data: { config: { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterations: 3 } },
        error: null,
      });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);
      mockEstimateRunCostWithAgentModels.mockResolvedValueOnce(mockEstimateResult);

      await estimateRunCostAction({ strategyId: validStrategyId, textLength: -10 });
      expect(mockEstimateRunCostWithAgentModels).toHaveBeenCalledWith(
        expect.anything(),
        5000, // default
      );
    });

    it('returns error when strategy not found', async () => {
      const mock = createChainMock();
      mock.single.mockResolvedValueOnce({ data: null, error: { message: 'not found', code: 'PGRST116' } });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

      const result = await estimateRunCostAction({ strategyId: validStrategyId });
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('passes through low confidence from cold-start estimator', async () => {
      const mock = createChainMock();
      mock.single.mockResolvedValueOnce({
        data: { config: { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterations: 3 } },
        error: null,
      });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);
      mockEstimateRunCostWithAgentModels.mockResolvedValueOnce({
        ...mockEstimateResult,
        confidence: 'low',
      });

      const result = await estimateRunCostAction({ strategyId: validStrategyId });
      expect(result.success).toBe(true);
      expect(result.data?.confidence).toBe('low');
    });
  });
});

// ─── getEvolutionRunByIdAction ────────────────────────────────────

describe('getEvolutionRunByIdAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
  });

  it('returns a single run by ID', async () => {
    const mock = createChainMock();
    mock.single.mockResolvedValueOnce({
      data: { id: 'run-42', status: 'running', total_cost_usd: 1.23 },
      error: null,
    });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunByIdAction('run-42');
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 'run-42', status: 'running', total_cost_usd: 1.23 });
    expect(mock.from).toHaveBeenCalledWith('evolution_runs');
    expect(mock.eq).toHaveBeenCalledWith('id', 'run-42');
    expect(mock.single).toHaveBeenCalled();
  });

  it('returns error when run not found', async () => {
    const mock = createChainMock();
    mock.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunByIdAction('run-missing');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ─── getEvolutionVariantsAction fallback ─────────────────────────

describe('getEvolutionVariantsAction fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
  });

  it('returns DB data when evolution_variants has rows', async () => {
    const mock = createChainMock();
    const dbVariants = [
      { id: 'v-1', run_id: 'run-1', elo_score: 1400, is_winner: true, variant_content: 'text', generation: 1, agent_name: 'gen', match_count: 5, created_at: '2026-01-01', explanation_id: 1 },
    ];

    mock.order.mockResolvedValueOnce({ data: dbVariants, error: null });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionVariantsAction('run-1');

    expect(result.success).toBe(true);
    expect(result.data).toEqual(dbVariants);
    expect(mockBuildVariantsFromCheckpoint).not.toHaveBeenCalled();
  });

  it('falls back to checkpoint when DB returns empty array', async () => {
    const mock = createChainMock();
    const checkpointVariants = [
      { id: 'v-cp', run_id: 'run-1', elo_score: 1250, is_winner: false, variant_content: 'text', generation: 1, agent_name: 'gen', match_count: 2, created_at: '2026-01-01', explanation_id: null },
    ];

    mock.order.mockResolvedValueOnce({ data: [], error: null });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);
    mockBuildVariantsFromCheckpoint.mockResolvedValueOnce({ success: true, data: checkpointVariants, error: null });

    const result = await getEvolutionVariantsAction('run-1');

    expect(result.success).toBe(true);
    expect(result.data).toEqual(checkpointVariants);
    expect(mockBuildVariantsFromCheckpoint).toHaveBeenCalledWith('run-1');
  });

  it('returns empty array when both DB and checkpoint are empty', async () => {
    const mock = createChainMock();
    mock.order.mockResolvedValueOnce({ data: [], error: null });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);
    mockBuildVariantsFromCheckpoint.mockResolvedValueOnce({ success: true, data: [], error: null });

    const result = await getEvolutionVariantsAction('run-1');

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('propagates DB errors without fallback', async () => {
    const mock = createChainMock();
    mock.order.mockResolvedValueOnce({ data: null, error: { message: 'DB connection failed' } });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionVariantsAction('run-1');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(mockBuildVariantsFromCheckpoint).not.toHaveBeenCalled();
  });
});


// ─── killEvolutionRunAction ─────────────────────────────────────

describe('killEvolutionRunAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
  });

  it('kills a running run and sets error_message', async () => {
    const mock = createChainMock();
    mock.single.mockResolvedValueOnce({
      data: { id: 'run-1', status: 'failed', error_message: 'Manually killed by admin', completed_at: '2026-01-01T00:00:00Z' },
      error: null,
    });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await killEvolutionRunAction('run-1');
    expect(result.success).toBe(true);
    expect(result.data?.error_message).toBe('Manually killed by admin');

    // Verify update was called with correct status
    expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error_message: 'Manually killed by admin',
    }));
    // Verify .in() status guard
    expect(mock.in).toHaveBeenCalledWith('status', ['pending', 'claimed', 'running', 'continuation_pending']);
  });

  it('kills a pending run (pre-execution kill)', async () => {
    const mock = createChainMock();
    mock.single.mockResolvedValueOnce({
      data: { id: 'run-2', status: 'failed', error_message: 'Manually killed by admin' },
      error: null,
    });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await killEvolutionRunAction('run-2');
    expect(result.success).toBe(true);
  });

  it('kills a claimed run', async () => {
    const mock = createChainMock();
    mock.single.mockResolvedValueOnce({
      data: { id: 'run-3', status: 'failed', error_message: 'Manually killed by admin' },
      error: null,
    });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await killEvolutionRunAction('run-3');
    expect(result.success).toBe(true);
  });

  it('fails for a completed run (terminal state)', async () => {
    const mock = createChainMock();
    mock.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'no rows returned', code: 'PGRST116' },
    });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await killEvolutionRunAction('run-completed');
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('already in terminal state');
  });

  it('fails for an already-failed run', async () => {
    const mock = createChainMock();
    mock.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'no rows returned', code: 'PGRST116' },
    });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await killEvolutionRunAction('run-failed');
    expect(result.success).toBe(false);
  });

  it('logs admin action with correct entity info', async () => {
    const { logAdminAction } = await import('@/lib/services/auditLog');
    const mock = createChainMock();
    mock.single.mockResolvedValueOnce({
      data: { id: 'run-audit', status: 'failed', error_message: 'Manually killed by admin' },
      error: null,
    });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    await killEvolutionRunAction('run-audit');

    expect(logAdminAction).toHaveBeenCalledWith({
      adminUserId: 'admin-123',
      action: 'kill_evolution_run',
      entityType: 'evolution_run',
      entityId: 'run-audit',
    });
  });
});

