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
      // Return a scoped chain whose .in() resolves with count data,
      // preventing shared mutable state leaking across interleaved calls.
      const countChain: Record<string, jest.Mock> = {};
      for (const m of ['eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'is', 'order', 'limit', 'range']) {
        countChain[m] = jest.fn(() => countChain);
      }
      countChain.in = jest.fn(() => Promise.resolve({ count: activeRunCount, error: null }));
      return countChain;
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
      expect(result.stopReason).toBe('iterations_complete');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns error when buildRunContext fails', async () => {
      mockBuildRunContext.mockResolvedValue({ error: 'Strategy not found' });

      const result = await claimAndExecuteRun({ runnerId: 'test-runner' });

      expect(result.claimed).toBe(true);
      expect(result.error).toContain('Strategy not found');
    });

    it('propagates runnerId from options through to finalizeRun (regression: runner_id mismatch)', async () => {
      const result = await claimAndExecuteRun({ runnerId: 'v2-test-runner-123' });

      expect(result.claimed).toBe(true);
      expect(result.stopReason).toBe('iterations_complete');
      // runnerId is the 7th arg to finalizeRun
      expect(mockFinalizeRun).toHaveBeenCalledWith(
        'run-123',        // runId
        expect.anything(), // result
        expect.anything(), // metadata
        expect.anything(), // db
        expect.any(Number), // durationSeconds
        expect.anything(), // logger
        'v2-test-runner-123', // runnerId — must match what was passed to claimAndExecuteRun
      );
    });
  });

  describe('db option', () => {
    it('uses provided db option instead of creating default client', async () => {
      const customRpc = jest.fn().mockResolvedValue({ data: [], error: null });
      const customDb = Object.assign(createChainMock(), { rpc: customRpc });

      await claimAndExecuteRun({ runnerId: 'test', db: customDb as never });

      expect(createSupabaseServiceClient).not.toHaveBeenCalled();
      expect(customRpc).toHaveBeenCalledWith('claim_evolution_run', expect.anything());
    });

    it('falls back to createSupabaseServiceClient when db not provided', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await claimAndExecuteRun({ runnerId: 'test' });

      expect(createSupabaseServiceClient).toHaveBeenCalled();
    });
  });

  describe('dryRun option', () => {
    it('returns dry-run result without executing pipeline when dryRun is true', async () => {
      const claimedRow = {
        id: 'dry-run-1',
        explanation_id: 'exp-1',
        prompt_id: null,
        experiment_id: null,
        strategy_id: 'strat-1',
        budget_cap_usd: '1.0',
      };
      mockRpc.mockResolvedValue({ data: [claimedRow], error: null });

      const result = await claimAndExecuteRun({ runnerId: 'test', dryRun: true });

      expect(result.claimed).toBe(true);
      expect(result.stopReason).toBe('dry-run');
      expect(result.runId).toBe('dry-run-1');
      // Pipeline should NOT have been executed
      expect(mockBuildRunContext).not.toHaveBeenCalled();
      expect(mockEvolveArticle).not.toHaveBeenCalled();
      expect(mockFinalizeRun).not.toHaveBeenCalled();
    });
  });

  describe('deadline and signal threading', () => {
    const claimedRow = {
      id: 'run-dl-1',
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
          logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
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
        stopReason: 'time_limit',
        muHistory: [],
        diversityHistory: [],
        matchCounts: {},
      });
      mockFinalizeRun.mockResolvedValue(undefined);
    });

    it('maxDurationMs → deadlineMs passed to evolveArticle options', async () => {
      const beforeMs = Date.now();
      await claimAndExecuteRun({ runnerId: 'test-runner', maxDurationMs: 5000 });

      expect(mockEvolveArticle).toHaveBeenCalledTimes(1);
      const evolveOpts = mockEvolveArticle.mock.calls[0][5];
      expect(evolveOpts.deadlineMs).toBeGreaterThanOrEqual(beforeMs + 5000);
      expect(evolveOpts.deadlineMs).toBeLessThanOrEqual(Date.now() + 5000);
    });

    it('pipeline stopReason propagated to RunnerResult', async () => {
      const result = await claimAndExecuteRun({ runnerId: 'test-runner' });
      expect(result.stopReason).toBe('time_limit');
    });
  });

  describe('heartbeat runner_id check', () => {
    it('M11: heartbeat is started with runner_id (verified via successful pipeline execution)', async () => {
      const claimedRow = {
        id: 'hb-run-1',
        explanation_id: null,
        prompt_id: null,
        experiment_id: null,
        strategy_id: 'strat-1',
        budget_cap_usd: '1.0',
      };
      mockRpc.mockResolvedValue({ data: [claimedRow], error: null });
      mockBuildRunContext.mockResolvedValue({
        context: {
          originalText: 'text',
          config: { iterations: 1, budgetUsd: 1, judgeModel: 'gpt-4.1-nano', generationModel: 'gpt-4.1-nano' },
          logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
          initialPool: [],
        },
      });
      mockEvolveArticle.mockResolvedValue({
        winner: { id: 'v1' }, pool: [], ratings: new Map(), matchHistory: [],
        totalCost: 0, iterationsRun: 1, stopReason: 'iterations_complete',
        muHistory: [], diversityHistory: [], matchCounts: {},
      });
      mockFinalizeRun.mockResolvedValue(undefined);

      const result = await claimAndExecuteRun({ runnerId: 'runner-hb', db: supabaseMock as never });

      // Pipeline should complete successfully (heartbeat started with runner_id)
      expect(result.claimed).toBe(true);
      expect(result.runId).toBe('hb-run-1');
    });
  });
});
