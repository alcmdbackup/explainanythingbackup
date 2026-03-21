// Tests for V2 finalizeRun — persist results in V1-compatible format.

import { finalizeRun } from './finalize';
import { DEFAULT_MU, toEloScale } from '../shared/rating';
import type { EvolutionResult, V2Match } from './types';
import type { TextVariation } from '../types';
import type { Rating } from '../shared/rating';

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
    makeVariant('gen-2', 'lexical_simplify'),
  ];
  const ratings = new Map<string, Rating>([
    ['baseline-1', { mu: 25, sigma: 5 }],
    ['gen-1', { mu: 30, sigma: 4 }],
    ['gen-2', { mu: 28, sigma: 4.5 }],
  ]);
  const matchHistory: V2Match[] = [
    { winnerId: 'gen-1', loserId: 'baseline-1', result: 'win', confidence: 0.9, judgeModel: 'gpt-4.1-nano', reversed: false },
    { winnerId: 'gen-1', loserId: 'gen-2', result: 'win', confidence: 0.7, judgeModel: 'gpt-4.1-nano', reversed: false },
    { winnerId: 'gen-2', loserId: 'baseline-1', result: 'draw', confidence: 0.4, judgeModel: 'gpt-4.1-nano', reversed: false },
  ];

  return {
    winner: pool[1],
    pool,
    ratings,
    matchHistory,
    totalCost: 0.15,
    iterationsRun: 3,
    stopReason: 'iterations_complete',
    muHistory: [[30, 28, 25]],
    diversityHistory: [],
    matchCounts: { 'baseline-1': 2, 'gen-1': 2, 'gen-2': 2 },
    ...overrides,
  };
}

function makeMockDb() {
  const updates: Array<{ table: string; data: Record<string, unknown> }> = [];
  const upserts: Array<{ table: string; data: unknown }> = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  return {
    db: {
      from: jest.fn((table: string) => ({
        update: jest.fn((data: Record<string, unknown>) => {
          updates.push({ table, data });
          return {
            eq: jest.fn(() => ({
              in: jest.fn(async () => ({ error: null })),
              eq: jest.fn(async () => ({ error: null })),
            })),
            in: jest.fn(async () => ({ error: null })),
          };
        }),
        upsert: jest.fn((data: unknown) => {
          upserts.push({ table, data });
          return Promise.resolve({ error: null });
        }),
      })),
      rpc: jest.fn(async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return { error: null };
      }),
    } as never,
    updates,
    upserts,
    rpcCalls,
  };
}

describe('finalizeRun', () => {
  it('sets run to completed with run_summary', async () => {
    const { db, updates } = makeMockDb();
    await finalizeRun('run-1', makeResult(), { experiment_id: null, explanation_id: null, strategy_config_id: null }, db, 120);
    const runUpdate = updates.find((u) => u.table === 'evolution_runs' && u.data.status === 'completed');
    expect(runUpdate).toBeDefined();
    expect(runUpdate!.data.run_summary).toBeDefined();
    const summary = runUpdate!.data.run_summary as Record<string, unknown>;
    expect(summary.version).toBe(3);
    expect(summary.stopReason).toBe('iterations_complete');
  });

  it('persists all local pool variants', async () => {
    const { db, upserts } = makeMockDb();
    await finalizeRun('run-1', makeResult(), { experiment_id: null, explanation_id: null, strategy_config_id: null }, db, 120);
    const variantUpserts = upserts.filter((u) => u.table === 'evolution_variants');
    expect(variantUpserts.length).toBe(1);
    const rows = variantUpserts[0].data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
  });

  it('winner variant has is_winner=true', async () => {
    const { db, upserts } = makeMockDb();
    await finalizeRun('run-1', makeResult(), { experiment_id: null, explanation_id: null, strategy_config_id: null }, db, 120);
    const rows = (upserts.find((u) => u.table === 'evolution_variants')?.data ?? []) as Array<Record<string, unknown>>;
    const winners = rows.filter((r) => r.is_winner === true);
    expect(winners).toHaveLength(1);
    expect(winners[0].id).toBe('gen-1'); // Highest mu
  });

  it('matchStats computed correctly', async () => {
    const { db, updates } = makeMockDb();
    await finalizeRun('run-1', makeResult(), { experiment_id: null, explanation_id: null, strategy_config_id: null }, db, 120);
    const summary = updates.find((u) => u.data.run_summary)?.data.run_summary as Record<string, unknown>;
    const matchStats = summary.matchStats as { totalMatches: number; avgConfidence: number; decisiveRate: number };
    expect(matchStats.totalMatches).toBe(3);
    expect(matchStats.avgConfidence).toBeCloseTo((0.9 + 0.7 + 0.4) / 3);
    expect(matchStats.decisiveRate).toBeCloseTo(2 / 3); // 0.9 and 0.7 > 0.6
  });

  it('topVariants: top 5 by mu with isBaseline flag', async () => {
    const { db, updates } = makeMockDb();
    await finalizeRun('run-1', makeResult(), { experiment_id: null, explanation_id: null, strategy_config_id: null }, db, 120);
    const summary = updates.find((u) => u.data.run_summary)?.data.run_summary as Record<string, unknown>;
    const topVariants = summary.topVariants as Array<{ isBaseline: boolean; mu: number }>;
    expect(topVariants[0].mu).toBe(30); // gen-1 highest
    const baseline = topVariants.find((v) => v.isBaseline);
    expect(baseline).toBeDefined();
  });

  it('baselineRank/baselineMu correct', async () => {
    const { db, updates } = makeMockDb();
    await finalizeRun('run-1', makeResult(), { experiment_id: null, explanation_id: null, strategy_config_id: null }, db, 120);
    const summary = updates.find((u) => u.data.run_summary)?.data.run_summary as Record<string, unknown>;
    expect(summary.baselineRank).toBe(3); // 3rd of 3
    expect(summary.baselineMu).toBe(25);
  });

  it('strategyEffectiveness computed', async () => {
    const { db, updates } = makeMockDb();
    await finalizeRun('run-1', makeResult(), { experiment_id: null, explanation_id: null, strategy_config_id: null }, db, 120);
    const summary = updates.find((u) => u.data.run_summary)?.data.run_summary as Record<string, unknown>;
    const se = summary.strategyEffectiveness as Record<string, { count: number; avgMu: number }>;
    expect(se['baseline'].count).toBe(1);
    expect(se['baseline'].avgMu).toBe(25);
    expect(se['structural_transform'].count).toBe(1);
  });

  it('empty pool marks run failed', async () => {
    const { db, updates } = makeMockDb();
    const result = makeResult({ pool: [] });
    await finalizeRun('run-1', result, { experiment_id: null, explanation_id: null, strategy_config_id: null }, db, 120);
    const failUpdate = updates.find((u) => u.data.status === 'failed');
    expect(failUpdate).toBeDefined();
  });

  it('fromArena filtering: arena entries not persisted', async () => {
    const pool = [
      makeVariant('local-1', 'test'),
      makeVariant('arena-1', 'test', { fromArena: true }),
    ];
    const ratings = new Map<string, Rating>([
      ['local-1', { mu: 30, sigma: 4 }],
      ['arena-1', { mu: 28, sigma: 4 }],
    ]);
    const result = makeResult({ pool, ratings });
    const { db, upserts } = makeMockDb();
    await finalizeRun('run-1', result, { experiment_id: null, explanation_id: null, strategy_config_id: null }, db, 120);
    const rows = (upserts.find((u) => u.table === 'evolution_variants')?.data ?? []) as Array<Record<string, unknown>>;
    expect(rows.every((r) => r.id !== 'arena-1')).toBe(true);
  });

  it('strategy aggregate update called with correct args', async () => {
    const { db, rpcCalls } = makeMockDb();
    await finalizeRun('run-1', makeResult(), { experiment_id: null, explanation_id: null, strategy_config_id: 'strat-1' }, db, 120);
    const rpc = rpcCalls.find((c) => c.fn === 'update_strategy_aggregates');
    expect(rpc).toBeDefined();
    expect(rpc!.args.p_strategy_id).toBe('strat-1');
    expect(rpc!.args.p_final_elo).toBe(toEloScale(30)); // winner mu = 30
  });

  it('null strategy_config_id skips aggregate update', async () => {
    const { db, rpcCalls } = makeMockDb();
    await finalizeRun('run-1', makeResult(), { experiment_id: null, explanation_id: null, strategy_config_id: null }, db, 120);
    const rpc = rpcCalls.find((c) => c.fn === 'update_strategy_aggregates');
    expect(rpc).toBeUndefined();
  });

  it('experiment auto-completion triggered', async () => {
    const { db, updates } = makeMockDb();
    await finalizeRun('run-1', makeResult(), { experiment_id: 'exp-1', explanation_id: null, strategy_config_id: null }, db, 120);
    const expUpdate = updates.find((u) => u.table === 'evolution_experiments');
    expect(expUpdate).toBeDefined();
    expect(expUpdate!.data.status).toBe('completed');
  });

  it('missing ratings use default', async () => {
    const pool = [makeVariant('v1', 'test')];
    const ratings = new Map<string, Rating>(); // Empty!
    const result = makeResult({ pool, ratings });
    const { db, upserts } = makeMockDb();
    await finalizeRun('run-1', result, { experiment_id: null, explanation_id: null, strategy_config_id: null }, db, 120);
    const rows = (upserts.find((u) => u.table === 'evolution_variants')?.data ?? []) as Array<Record<string, unknown>>;
    expect(rows[0].elo_score).toBe(toEloScale(DEFAULT_MU));
  });

  it('explanation_id passed through to variants', async () => {
    const { db, upserts } = makeMockDb();
    await finalizeRun('run-1', makeResult(), { experiment_id: null, explanation_id: 42, strategy_config_id: null }, db, 120);
    const rows = (upserts.find((u) => u.table === 'evolution_variants')?.data ?? []) as Array<Record<string, unknown>>;
    expect(rows.every((r) => r.explanation_id === 42)).toBe(true);
  });
});
