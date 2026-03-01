// Tests for evolutionRunnerCore: targetRunId passthrough and maxDurationMs defaults.

import { claimAndExecuteEvolutionRun } from './evolutionRunnerCore';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockExecuteFullPipeline = jest.fn().mockResolvedValue({ stopReason: 'completed' });
const mockPreparePipelineRun = jest.fn().mockReturnValue({
  ctx: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } },
  agents: {},
});

jest.mock('@evolution/lib', () => ({
  executeFullPipeline: (...args: unknown[]) => mockExecuteFullPipeline(...args),
  preparePipelineRun: (...args: unknown[]) => mockPreparePipelineRun(...args),
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

  // ─── maxDurationMs defaults ────────────────────────────────────

  describe('maxDurationMs', () => {
    function setupSuccessfulFreshRun() {
      mockRpc.mockResolvedValue({
        data: [{
          id: 'run-1',
          explanation_id: 1,
          prompt_id: null,
          continuation_count: 0,
          config: {},
        }],
        error: null,
      });

      supabaseMock.single.mockResolvedValue({
        data: { id: 1, explanation_title: 'Test Title', content: 'Original text.' },
        error: null,
      });
    }

    it('defaults maxDurationMs to 740_000 when not provided in options', async () => {
      setupSuccessfulFreshRun();

      await claimAndExecuteEvolutionRun({ runnerId: 'test-runner' });

      expect(mockExecuteFullPipeline).toHaveBeenCalledTimes(1);
      const pipelineOpts = mockExecuteFullPipeline.mock.calls[0][4];
      expect(pipelineOpts.maxDurationMs).toBe(740_000);
    });

    it('respects an explicit maxDurationMs override', async () => {
      setupSuccessfulFreshRun();

      await claimAndExecuteEvolutionRun({
        runnerId: 'test-runner',
        maxDurationMs: 500_000,
      });

      expect(mockExecuteFullPipeline).toHaveBeenCalledTimes(1);
      const pipelineOpts = mockExecuteFullPipeline.mock.calls[0][4];
      expect(pipelineOpts.maxDurationMs).toBe(500_000);
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
      // Rebuild supabase mock with 5 active runs
      supabaseMock = Object.assign(createChainMock(5), { rpc: mockRpc });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(supabaseMock);

      const result = await claimAndExecuteEvolutionRun({ runnerId: 'test-runner' });
      expect(result.claimed).toBe(false);
      // Should NOT call claim RPC
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('allows claim when concurrent run count < max', async () => {
      supabaseMock = Object.assign(createChainMock(3), { rpc: mockRpc });
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(supabaseMock);
      mockRpc.mockResolvedValue({ data: [], error: null });

      const result = await claimAndExecuteEvolutionRun({ runnerId: 'test-runner' });
      expect(result.claimed).toBe(false); // No pending runs, but claim RPC was called
      expect(mockRpc).toHaveBeenCalledWith('claim_evolution_run', expect.anything());
    });
  });
});
