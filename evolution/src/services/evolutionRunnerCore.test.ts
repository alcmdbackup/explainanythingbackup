// Tests for evolutionRunnerCore: claim logic, raw provider, and concurrent run limits.

import { claimAndExecuteEvolutionRun } from './evolutionRunnerCore';
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

const mockExecuteV2Run = jest.fn().mockResolvedValue(undefined);

jest.mock('@evolution/lib/pipeline', () => ({
  executeV2Run: (...args: unknown[]) => mockExecuteV2Run(...args),
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
  // Detect concurrent run count query: .select('id', { count: 'exact', head: true })
  mock.select = jest.fn().mockImplementation((_cols?: string, opts?: { count?: string; head?: boolean }) => {
    if (opts?.count === 'exact' && opts?.head === true) {
      isCountQuery = true;
    } else {
      isCountQuery = false;
    }
    return mock;
  });
  // .in() resolves differently for count queries vs chain queries
  mock.in = jest.fn().mockImplementation(() => {
    if (isCountQuery) {
      isCountQuery = false;
      return Promise.resolve({ count: activeRunCount, error: null });
    }
    return mock;
  });
  return mock;
}

describe('claimAndExecuteEvolutionRun', () => {
  let mockRpc: jest.Mock;
  let supabaseMock: ReturnType<typeof createChainMock> & { rpc: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    mockRpc = jest.fn();
    supabaseMock = Object.assign(createChainMock(), { rpc: mockRpc });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(supabaseMock);
  });

  // ─── targetRunId passthrough ───────────────────────────────────

  describe('targetRunId passthrough', () => {
    it('passes p_run_id to the claim RPC when targetRunId is provided', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await claimAndExecuteEvolutionRun({
        runnerId: 'test-runner',
        targetRunId: 'run-abc',
      });

      expect(mockRpc).toHaveBeenCalledWith('claim_evolution_run', {
        p_runner_id: 'test-runner',
        p_run_id: 'run-abc',
      });
    });

    it('omits p_run_id from RPC args when targetRunId is not provided', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await claimAndExecuteEvolutionRun({
        runnerId: 'test-runner',
      });

      expect(mockRpc).toHaveBeenCalledWith('claim_evolution_run', {
        p_runner_id: 'test-runner',
      });
      const rpcArgs = mockRpc.mock.calls[0][1];
      expect(rpcArgs).not.toHaveProperty('p_run_id');
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────

  it('returns { claimed: false } when no pending run is found', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await claimAndExecuteEvolutionRun({ runnerId: 'test-runner' });
    expect(result).toEqual({ claimed: false });
  });

  it('returns { claimed: false } with error when claim RPC fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'db down' } });

    const result = await claimAndExecuteEvolutionRun({ runnerId: 'test-runner' });
    expect(result.claimed).toBe(false);
    expect(result.error).toContain('db down');
  });

  // ─── Concurrent run limits ─────────────────────────────────────

  describe('concurrent run limits', () => {
    it('rejects claim when concurrent run count >= max', async () => {
      supabaseMock = Object.assign(createChainMock(5), { rpc: mockRpc });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(supabaseMock);

      const result = await claimAndExecuteEvolutionRun({ runnerId: 'test-runner' });
      expect(result.claimed).toBe(false);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('allows claim when concurrent run count < max', async () => {
      supabaseMock = Object.assign(createChainMock(3), { rpc: mockRpc });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(supabaseMock);
      mockRpc.mockResolvedValue({ data: [], error: null });

      const result = await claimAndExecuteEvolutionRun({ runnerId: 'test-runner' });
      expect(result.claimed).toBe(false);
      expect(mockRpc).toHaveBeenCalledWith('claim_evolution_run', expect.anything());
    });
  });

  // ─── Raw LLM provider ──────────────────────────────────────────

  describe('raw LLM provider', () => {
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
      mockExecuteV2Run.mockResolvedValue(undefined);
    });

    it('passes raw provider with correct callLLM arguments to executeV2Run', async () => {
      await claimAndExecuteEvolutionRun({ runnerId: 'test-runner' });

      expect(mockExecuteV2Run).toHaveBeenCalledTimes(1);
      const [runId, run, db, provider] = mockExecuteV2Run.mock.calls[0];
      expect(runId).toBe('run-123');
      expect(run.budget_cap_usd).toBe(2.0);

      // Call the provider to verify it delegates to callLLM correctly
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
      await claimAndExecuteEvolutionRun({ runnerId: 'test-runner' });

      const provider = mockExecuteV2Run.mock.calls[0][3];
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

    it('prefixes label with evolution_', async () => {
      await claimAndExecuteEvolutionRun({ runnerId: 'test-runner' });

      const provider = mockExecuteV2Run.mock.calls[0][3];
      (callLLM as jest.Mock).mockClear();
      await provider.complete('p', 'ranking');

      expect(callLLM).toHaveBeenCalledWith(
        'p',
        'evolution_ranking',
        expect.any(String),
        expect.any(String),
        false,
        null,
        null,
        null,
        false,
        {},
      );
    });
  });
});
