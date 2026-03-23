// Integration test for Bug #4: experiment auto-completion with NOT EXISTS check.
// Verifies finalizeRun calls complete_experiment_if_done RPC only when experiment_id is set.

import { finalizeRun } from '@evolution/lib/pipeline/finalize/persistRunResults';
import type { EvolutionResult, V2Match } from '@evolution/lib/pipeline/infra/types';
import type { TextVariation } from '@evolution/lib/types';
import type { Rating } from '@evolution/lib/shared/computeRatings';

// ─── Helpers ─────────────────────────────────────────────────

function makeVariant(id: string, strategy = 'test', opts?: Partial<TextVariation>): TextVariation {
  return {
    id,
    text: `Content for ${id}`,
    version: 1,
    parentIds: [],
    strategy,
    createdAt: Date.now() / 1000,
    iterationBorn: 1,
    ...opts,
  };
}

function makeResult(overrides?: Partial<EvolutionResult>): EvolutionResult {
  const pool = [
    makeVariant('baseline-1', 'baseline'),
    makeVariant('gen-1', 'structural_transform'),
  ];
  const ratings = new Map<string, Rating>([
    ['baseline-1', { mu: 25, sigma: 5 }],
    ['gen-1', { mu: 30, sigma: 4 }],
  ]);
  const matchHistory: V2Match[] = [
    { winnerId: 'gen-1', loserId: 'baseline-1', result: 'win', confidence: 0.9, judgeModel: 'gpt-4.1-nano', reversed: false },
  ];

  return {
    winner: pool[1],
    pool,
    ratings,
    matchHistory,
    totalCost: 0.10,
    iterationsRun: 2,
    stopReason: 'iterations_complete',
    muHistory: [[30, 25]],
    diversityHistory: [],
    matchCounts: { 'baseline-1': 1, 'gen-1': 1 },
    ...overrides,
  };
}

function makeMockDb() {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  function makeChain() {
    const resolved = { data: [{ id: 'mock' }], error: null };
    const chain: Record<string, jest.Mock> = {};
    const self = () => chain;
    for (const m of ['eq', 'neq', 'in', 'is', 'select', 'single', 'order', 'limit', 'range']) {
      chain[m] = jest.fn(self);
    }
    chain.then = jest.fn((resolve: (v: unknown) => void) => resolve(resolved));
    return chain;
  }

  return {
    db: {
      from: jest.fn(() => ({
        update: jest.fn(() => makeChain()),
        upsert: jest.fn(() => Promise.resolve({ error: null })),
      })),
      rpc: jest.fn(async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return { error: null };
      }),
    } as never,
    rpcCalls,
  };
}

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

// ─── Tests ───────────────────────────────────────────────────

describe('Evolution Experiment Completion Integration (Bug #4)', () => {
  it('calls complete_experiment_if_done RPC with correct args when experiment_id is set', async () => {
    const { db, rpcCalls } = makeMockDb();

    await finalizeRun(
      'run-1',
      makeResult(),
      { experiment_id: 'exp-abc', explanation_id: null, strategy_id: null, prompt_id: null },
      db,
      120,
      mockLogger as never,
    );

    const rpc = rpcCalls.find((c) => c.fn === 'complete_experiment_if_done');
    expect(rpc).toBeDefined();
    expect(rpc!.args).toEqual({
      p_experiment_id: 'exp-abc',
      p_completed_run_id: 'run-1',
    });
  });

  it('does NOT call complete_experiment_if_done when experiment_id is null', async () => {
    const { db, rpcCalls } = makeMockDb();

    await finalizeRun(
      'run-2',
      makeResult(),
      { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null },
      db,
      120,
      mockLogger as never,
    );

    const rpc = rpcCalls.find((c) => c.fn === 'complete_experiment_if_done');
    expect(rpc).toBeUndefined();
  });

  it('passes correct p_completed_run_id matching the current run', async () => {
    const { db, rpcCalls } = makeMockDb();

    await finalizeRun(
      'run-xyz-123',
      makeResult(),
      { experiment_id: 'exp-1', explanation_id: null, strategy_id: null, prompt_id: null },
      db,
      60,
      mockLogger as never,
    );

    const rpc = rpcCalls.find((c) => c.fn === 'complete_experiment_if_done');
    expect(rpc!.args.p_completed_run_id).toBe('run-xyz-123');
  });

  it('logs warning when complete_experiment_if_done RPC fails (non-fatal)', async () => {
    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

    function makeChain() {
      const resolved = { data: [{ id: 'mock' }], error: null };
      const chain: Record<string, jest.Mock> = {};
      const self = () => chain;
      for (const m of ['eq', 'neq', 'in', 'is', 'select', 'single', 'order', 'limit', 'range']) {
        chain[m] = jest.fn(self);
      }
      chain.then = jest.fn((resolve: (v: unknown) => void) => resolve(resolved));
      return chain;
    }

    const db = {
      from: jest.fn(() => ({
        update: jest.fn(() => makeChain()),
        upsert: jest.fn(() => Promise.resolve({ error: null })),
      })),
      rpc: jest.fn(async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        if (fn === 'complete_experiment_if_done') {
          throw new Error('RPC timeout');
        }
        return { error: null };
      }),
    } as never;

    // Should NOT throw — experiment completion is non-fatal
    await finalizeRun(
      'run-3',
      makeResult(),
      { experiment_id: 'exp-fail', explanation_id: null, strategy_id: null, prompt_id: null },
      db,
      120,
      logger as never,
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Experiment auto-completion failed'),
      expect.any(Object),
    );
  });

  it('calls strategy aggregate update before experiment completion', async () => {
    const { db, rpcCalls } = makeMockDb();

    await finalizeRun(
      'run-4',
      makeResult(),
      { experiment_id: 'exp-2', explanation_id: null, strategy_id: 'strat-1', prompt_id: null },
      db,
      90,
      mockLogger as never,
    );

    const strategyRpc = rpcCalls.find((c) => c.fn === 'update_strategy_aggregates');
    const completionRpc = rpcCalls.find((c) => c.fn === 'complete_experiment_if_done');
    expect(strategyRpc).toBeDefined();
    expect(completionRpc).toBeDefined();

    // Strategy aggregate should be called before experiment completion
    const stratIdx = rpcCalls.indexOf(strategyRpc!);
    const compIdx = rpcCalls.indexOf(completionRpc!);
    expect(stratIdx).toBeLessThan(compIdx);
  });
});
