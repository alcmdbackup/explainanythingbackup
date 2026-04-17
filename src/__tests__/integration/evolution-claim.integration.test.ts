// Integration test for Bug #1: concurrent claim limit via advisory lock RPC.
// Verifies claimAndExecuteRun calls claim_evolution_run with p_max_concurrent and handles empty/non-empty results.

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Mocks (must be before imports of module under test) ────

const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('@/lib/services/llms', () => ({
  callLLM: jest.fn().mockResolvedValue('mock LLM response'),
}));

const mockBuildRunContext = jest.fn();
const mockEvolveArticle = jest.fn();
const mockFinalizeRun = jest.fn();
const mockSyncToArena = jest.fn();

jest.mock('@evolution/lib/pipeline/setup/buildRunContext', () => ({
  buildRunContext: (...args: unknown[]) => mockBuildRunContext(...args),
}));

jest.mock('@evolution/lib/pipeline/loop/runIterationLoop', () => ({
  evolveArticle: (...args: unknown[]) => mockEvolveArticle(...args),
}));

jest.mock('@evolution/lib/pipeline/finalize/persistRunResults', () => ({
  finalizeRun: (...args: unknown[]) => mockFinalizeRun(...args),
  syncToArena: (...args: unknown[]) => mockSyncToArena(...args),
}));

const mockWriteMetricMax = jest.fn().mockResolvedValue(undefined);
jest.mock('@evolution/lib/metrics/writeMetrics', () => ({
  writeMetricMax: (...args: unknown[]) => mockWriteMetricMax(...args),
}));

import { claimAndExecuteRun } from '@evolution/lib/pipeline/claimAndExecuteRun';

// ─── Helpers ─────────────────────────────────────────────────

function makeChain() {
  const chain: Record<string, jest.Mock> = {};
  const self = () => chain;
  for (const m of ['eq', 'neq', 'in', 'is', 'select', 'single', 'order', 'limit', 'range', 'update']) {
    chain[m] = jest.fn(self);
  }
  chain.then = jest.fn((resolve: (v: unknown) => void) => resolve({ data: [{ id: 'mock' }], error: null }));
  return chain;
}

// ─── Tests ───────────────────────────────────────────────────

describe('Evolution Claim Integration (Bug #1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue({
      update: jest.fn(() => makeChain()),
    });
  });

  it('calls claim_evolution_run RPC with p_max_concurrent parameter', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    await claimAndExecuteRun({ runnerId: 'runner-1' });

    expect(mockRpc).toHaveBeenCalledWith('claim_evolution_run', expect.objectContaining({
      p_runner_id: 'runner-1',
      p_max_concurrent: expect.any(Number),
    }));
  });

  it('uses EVOLUTION_MAX_CONCURRENT_RUNS env var when set', async () => {
    const original = process.env.EVOLUTION_MAX_CONCURRENT_RUNS;
    try {
      process.env.EVOLUTION_MAX_CONCURRENT_RUNS = '3';
      mockRpc.mockResolvedValue({ data: [], error: null });

      await claimAndExecuteRun({ runnerId: 'runner-2' });

      expect(mockRpc).toHaveBeenCalledWith('claim_evolution_run', expect.objectContaining({
        p_max_concurrent: 3,
      }));
    } finally {
      process.env.EVOLUTION_MAX_CONCURRENT_RUNS = original;
    }
  });

  it('defaults to 5 concurrent runs when env var is not set', async () => {
    const original = process.env.EVOLUTION_MAX_CONCURRENT_RUNS;
    try {
      delete process.env.EVOLUTION_MAX_CONCURRENT_RUNS;
      mockRpc.mockResolvedValue({ data: [], error: null });

      await claimAndExecuteRun({ runnerId: 'runner-3' });

      expect(mockRpc).toHaveBeenCalledWith('claim_evolution_run', expect.objectContaining({
        p_max_concurrent: 5,
      }));
    } finally {
      process.env.EVOLUTION_MAX_CONCURRENT_RUNS = original;
    }
  });

  it('returns { claimed: false } when RPC returns empty (limit reached)', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await claimAndExecuteRun({ runnerId: 'runner-4' });

    expect(result).toEqual({ claimed: false });
  });

  it('returns { claimed: false } with error when RPC returns an error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'advisory lock timeout' } });

    const result = await claimAndExecuteRun({ runnerId: 'runner-5' });

    expect(result.claimed).toBe(false);
    expect(result.error).toContain('advisory lock timeout');
  });

  it('executes full pipeline flow when RPC returns a claimed row', async () => {
    const claimedRow = {
      id: 'run-abc',
      explanation_id: 42,
      prompt_id: null,
      experiment_id: 'exp-1',
      strategy_id: 'strat-1',
      budget_cap_usd: 2.5,
    };
    mockRpc.mockResolvedValue({ data: [claimedRow], error: null });

    mockBuildRunContext.mockResolvedValue({
      context: {
        originalText: 'Hello world',
        config: { iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }], budgetUsd: 2.5, judgeModel: 'gpt-4.1-nano', generationModel: 'gpt-4.1-nano' },
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        initialPool: [],
        // randomSeed is required by the orchestrator (Phase E of the parallel pipeline);
        // claimAndExecuteRun calls randomSeed.toString() so undefined would throw.
        randomSeed: BigInt(0),
      },
    });

    mockEvolveArticle.mockResolvedValue({
      winner: { id: 'v1', text: 'Evolved' },
      pool: [{ id: 'v1', text: 'Evolved', strategy: 'test' }],
      ratings: new Map(),
      matchHistory: [],
      totalCost: 0.05,
      iterationsRun: 2,
      stopReason: 'budget_exhausted',
      muHistory: [],
      diversityHistory: [],
      matchCounts: {},
    });

    mockFinalizeRun.mockResolvedValue(undefined);

    const result = await claimAndExecuteRun({ runnerId: 'runner-6' });

    expect(result.claimed).toBe(true);
    expect(result.runId).toBe('run-abc');
    expect(mockBuildRunContext).toHaveBeenCalled();
    expect(mockEvolveArticle).toHaveBeenCalled();
    expect(mockFinalizeRun).toHaveBeenCalled();
  });

  it('passes targetRunId as p_run_id when provided', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    await claimAndExecuteRun({ runnerId: 'runner-7', targetRunId: 'specific-run' });

    expect(mockRpc).toHaveBeenCalledWith('claim_evolution_run', expect.objectContaining({
      p_run_id: 'specific-run',
    }));
  });

  it('does not include p_run_id when targetRunId is not provided', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    await claimAndExecuteRun({ runnerId: 'runner-8' });

    const callArgs = mockRpc.mock.calls[0][1];
    expect(callArgs).not.toHaveProperty('p_run_id');
  });

  // ─── Phase 4b: empty-run cost zero-init ─────────────────────────
  // Verifies that executePipeline calls writeMetricMax for cost / generation_cost / ranking_cost / seed_cost
  // BEFORE buildRunContext, so even runs that fail before any LLM call have rows in
  // evolution_metrics for downstream propagation. The fix lives in
  // evolution/src/lib/pipeline/claimAndExecuteRun.ts inside executePipeline().

  it('writes zero-init for cost / generation_cost / ranking_cost / seed_cost before buildRunContext', async () => {
    const claimedRow = {
      id: 'run-zero-init',
      explanation_id: null,
      prompt_id: null,
      experiment_id: null,
      strategy_id: 'strat-1',
      budget_cap_usd: 1.0,
    };
    mockRpc.mockResolvedValue({ data: [claimedRow], error: null });

    // buildRunContext will throw — simulating a failure before any LLM call. The
    // zero-init writes must STILL have happened BEFORE this point.
    mockBuildRunContext.mockRejectedValue(new Error('simulated buildRunContext failure'));

    await claimAndExecuteRun({ runnerId: 'runner-zero-init' });

    // Four writeMetricMax calls expected: cost, generation_cost, ranking_cost, seed_cost — all with value=0
    expect(mockWriteMetricMax).toHaveBeenCalledTimes(4);
    const metricNames = mockWriteMetricMax.mock.calls.map((c) => c[3]);
    expect(metricNames).toEqual(['cost', 'generation_cost', 'ranking_cost', 'seed_cost']);
    for (const call of mockWriteMetricMax.mock.calls) {
      expect(call[1]).toBe('run');               // entityType
      expect(call[2]).toBe('run-zero-init');      // entityId
      expect(call[4]).toBe(0);                    // value
      expect(call[5]).toBe('during_execution');   // timing
    }

    // Verify ordering: all 3 zero-init calls happened BEFORE buildRunContext
    const initOrders = mockWriteMetricMax.mock.invocationCallOrder;
    const buildOrder = mockBuildRunContext.mock.invocationCallOrder[0]!;
    for (const initOrder of initOrders) {
      expect(initOrder).toBeLessThan(buildOrder);
    }
  });

  it('zero-init is non-fatal: writeMetricMax failure does not abort the pipeline', async () => {
    const claimedRow = {
      id: 'run-init-fail',
      explanation_id: null,
      prompt_id: null,
      experiment_id: null,
      strategy_id: 'strat-1',
      budget_cap_usd: 1.0,
    };
    mockRpc.mockResolvedValue({ data: [claimedRow], error: null });

    mockWriteMetricMax.mockRejectedValueOnce(new Error('simulated DB blip'));
    mockBuildRunContext.mockRejectedValue(new Error('subsequent failure to short-circuit'));

    // Should NOT throw despite the writeMetricMax rejection
    const result = await claimAndExecuteRun({ runnerId: 'runner-init-fail' });
    expect(result.claimed).toBe(true); // claim succeeded; pipeline failed downstream as expected

    // All 4 zero-init calls were still attempted (try/catch around each)
    expect(mockWriteMetricMax).toHaveBeenCalledTimes(4);
  });
});
