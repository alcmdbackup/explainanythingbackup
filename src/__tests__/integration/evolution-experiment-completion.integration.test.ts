// Integration test for Bug #4: experiment auto-completion with NOT EXISTS check.
// Verifies finalizeRun calls complete_experiment_if_done RPC only when experiment_id is set.

import { finalizeRun } from '@evolution/lib/pipeline/finalize/persistRunResults';
import type { EvolutionResult, V2Match } from '@evolution/lib/pipeline/infra/types';
import type { TextVariation } from '@evolution/lib/types';
import type { Rating } from '@evolution/lib/shared/computeRatings';

// ─── Constants ─────────────────────────────────────────────────
const RUN_ID = '00000000-0000-4000-8000-000000000001';
const BASELINE_ID = '00000000-0000-4000-8000-000000000010';
const GEN1_ID = '00000000-0000-4000-8000-000000000011';
const EXP_ID = '00000000-0000-4000-8000-000000000021';
const STRAT_ID = '00000000-0000-4000-8000-000000000022';

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
    makeVariant(BASELINE_ID, 'baseline'),
    makeVariant(GEN1_ID, 'structural_transform'),
  ];
  const ratings = new Map<string, Rating>([
    [BASELINE_ID, { mu: 25, sigma: 5 }],
    [GEN1_ID, { mu: 30, sigma: 4 }],
  ]);
  const matchHistory: V2Match[] = [
    { winnerId: GEN1_ID, loserId: BASELINE_ID, result: 'win', confidence: 0.9, judgeModel: 'gpt-4.1-nano', reversed: false },
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
    matchCounts: { BASELINE_ID: 1, GEN1_ID: 1 },
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
      RUN_ID,
      makeResult(),
      { experiment_id: EXP_ID, explanation_id: null, strategy_id: null, prompt_id: null },
      db,
      120,
      mockLogger as never,
    );

    const rpc = rpcCalls.find((c) => c.fn === 'complete_experiment_if_done');
    expect(rpc).toBeDefined();
    expect(rpc!.args).toEqual({
      p_experiment_id: EXP_ID,
      p_completed_run_id: RUN_ID,
    });
  });

  it('does NOT call complete_experiment_if_done when experiment_id is null', async () => {
    const { db, rpcCalls } = makeMockDb();

    await finalizeRun(
      '00000000-0000-4000-8000-000000000002',
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
      '00000000-0000-4000-8000-000000000005',
      makeResult(),
      { experiment_id: EXP_ID, explanation_id: null, strategy_id: null, prompt_id: null },
      db,
      60,
      mockLogger as never,
    );

    const rpc = rpcCalls.find((c) => c.fn === 'complete_experiment_if_done');
    expect(rpc!.args.p_completed_run_id).toBe('00000000-0000-4000-8000-000000000005');
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
      '00000000-0000-4000-8000-000000000003',
      makeResult(),
      { experiment_id: '00000000-0000-4000-8000-000000000023', explanation_id: null, strategy_id: null, prompt_id: null },
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
      '00000000-0000-4000-8000-000000000004',
      makeResult(),
      { experiment_id: '00000000-0000-4000-8000-000000000024', explanation_id: null, strategy_id: STRAT_ID, prompt_id: null },
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
