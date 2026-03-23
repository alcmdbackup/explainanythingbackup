// Tests for claimAndExecuteRun: claim logic, concurrent limits, LLM provider, and pipeline execution.

import { claimAndExecuteRun } from './claimAndExecuteRun';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { callLLM } from '@/lib/services/llms';

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('@/lib/services/llms', () => ({
  callLLM: jest.fn().mockResolvedValue('Generated text.'),
}));

const mockBuildRunContext = jest.fn();
const mockEvolveArticle = jest.fn();
const mockFinalizeRun = jest.fn();
const mockSyncToArena = jest.fn();

jest.mock('./setup/buildRunContext', () => ({
  buildRunContext: (...args: unknown[]) => mockBuildRunContext(...args),
}));

jest.mock('./loop/runIterationLoop', () => ({
  evolveArticle: (...args: unknown[]) => mockEvolveArticle(...args),
}));

jest.mock('./finalize/persistRunResults', () => ({
  finalizeRun: (...args: unknown[]) => mockFinalizeRun(...args),
  syncToArena: (...args: unknown[]) => mockSyncToArena(...args),
}));

/** Minimal chainable supabase mock with concurrent run count support. */
function createChainMock(activeRunCount = 0) {
  const mock: Record<string, jest.Mock> = {};
  let isCountQuery = false;
  const chain = () => mock;
  for (const m of [
    'from', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'in', 'is',
    'order', 'limit', 'range', 'single', 'maybeSingle',
  ]) {
    mock[m] = jest.fn(chain);
  }
  mock.select = jest.fn().mockImplementation((_cols?: string, opts?: { count?: string; head?: boolean }) => {
    if (opts?.count === 'exact' && opts?.head === true) {
      isCountQuery = true;
    } else {
      isCountQuery = false;
    }
    return mock;
  });
  mock.in = jest.fn().mockImplementation(() => {
    if (isCountQuery) {
      isCountQuery = false;
      return Promise.resolve({ count: activeRunCount, error: null });
    }
    return mock;
  });
  return mock;
}

describe('claimAndExecuteRun', () => {
  let mockRpc: jest.Mock;
  let supabaseMock: ReturnType<typeof createChainMock> & { rpc: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    mockRpc = jest.fn();
    supabaseMock = Object.assign(createChainMock(), { rpc: mockRpc });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(supabaseMock);
  });

  describe('targetRunId passthrough', () => {
    it('passes p_run_id and p_max_concurrent to the claim RPC when targetRunId is provided', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await claimAndExecuteRun({
        runnerId: 'test-runner',
        targetRunId: 'run-abc',
      });

      expect(mockRpc).toHaveBeenCalledWith('claim_evolution_run', {
        p_runner_id: 'test-runner',
        p_max_concurrent: 5,
        p_run_id: 'run-abc',
      });
    });

    it('omits p_run_id but includes p_max_concurrent when targetRunId is not provided', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await claimAndExecuteRun({ runnerId: 'test-runner' });

      expect(mockRpc).toHaveBeenCalledWith('claim_evolution_run', {
        p_runner_id: 'test-runner',
        p_max_concurrent: 5,
      });
      const rpcArgs = mockRpc.mock.calls[0][1];
      expect(rpcArgs).not.toHaveProperty('p_run_id');
    });
  });

  it('returns { claimed: false } when no pending run is found', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await claimAndExecuteRun({ runnerId: 'test-runner' });
    expect(result).toEqual({ claimed: false });
  });

  it('returns { claimed: false } with error when claim RPC fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'db down' } });

    const result = await claimAndExecuteRun({ runnerId: 'test-runner' });
    expect(result.claimed).toBe(false);
    expect(result.error).toContain('db down');
  });

  describe('concurrent run limits (server-side via RPC advisory lock)', () => {
    it('passes p_max_concurrent to RPC (limit enforced server-side)', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      const result = await claimAndExecuteRun({ runnerId: 'test-runner' });
      expect(result.claimed).toBe(false);
      expect(mockRpc).toHaveBeenCalledWith('claim_evolution_run', expect.objectContaining({
        p_max_concurrent: 5,
      }));
    });

    it('RPC returns empty when concurrent limit reached server-side', async () => {
      // RPC returns empty array when advisory lock check finds >= max concurrent
      mockRpc.mockResolvedValue({ data: [], error: null });

      const result = await claimAndExecuteRun({ runnerId: 'test-runner' });
      expect(result.claimed).toBe(false);
    });
  });

  describe('LLM provider', () => {
    const claimedRow = {
      id: 'run-123',
      explanation_id: 'exp-1',
      prompt_id: null,
      experiment_id: null,
      strategy_id: 'strat-1',
      budget_cap_usd: '2.0',
    };

    beforeEach(() => {
      mockRpc.mockResolvedValue({ data: [claimedRow], error: null });
      mockBuildRunContext.mockResolvedValue({
        context: {
          originalText: 'test text',
          config: { iterations: 1, budgetUsd: 2, judgeModel: 'gpt-4.1-nano', generationModel: 'gpt-4.1-nano' },
          logger: { info: jest.fn(), warn: jest.fn() },
          initialPool: [],
        },
      });
      mockEvolveArticle.mockResolvedValue({
        winner: { id: 'v1', text: 'test', strategy: 'baseline' },
        pool: [],
        ratings: new Map(),
        matchHistory: [],
        totalCost: 0.01,
        iterationsRun: 1,
        stopReason: 'iterations_complete',
        muHistory: [],
        diversityHistory: [],
        matchCounts: {},
      });
      mockFinalizeRun.mockResolvedValue(undefined);
    });

    it('creates provider that delegates to callLLM with evolution_ prefix', async () => {
      await claimAndExecuteRun({ runnerId: 'test-runner' });

      expect(mockBuildRunContext).toHaveBeenCalledTimes(1);
      // Get the llmProvider passed to buildRunContext
      const provider = mockBuildRunContext.mock.calls[0][3];
      await provider.complete('test prompt', 'generation', { model: 'gpt-4.1' });

      expect(callLLM).toHaveBeenCalledWith(
        'test prompt',
        'evolution_generation',
        '00000000-0000-4000-8000-000000000001',
        'gpt-4.1',
        false,
        null,
        null,
        null,
        false,
        {},
      );
    });

    it('uses deepseek-chat as default model when opts.model is undefined', async () => {
      await claimAndExecuteRun({ runnerId: 'test-runner' });

      const provider = mockBuildRunContext.mock.calls[0][3];
      await provider.complete('prompt', 'evolve');

      expect(callLLM).toHaveBeenCalledWith(
        'prompt',
        'evolution_evolve',
        '00000000-0000-4000-8000-000000000001',
        'deepseek-chat',
        false,
        null,
        null,
        null,
        false,
        {},
      );
    });

    it('returns completed result after successful pipeline execution', async () => {
      const result = await claimAndExecuteRun({ runnerId: 'test-runner' });

      expect(result.claimed).toBe(true);
      expect(result.runId).toBe('run-123');
      expect(result.stopReason).toBe('completed');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns error when buildRunContext fails', async () => {
      mockBuildRunContext.mockResolvedValue({ error: 'Strategy not found' });

      const result = await claimAndExecuteRun({ runnerId: 'test-runner' });

      expect(result.claimed).toBe(true);
      expect(result.error).toContain('Strategy not found');
    });
  });
});
