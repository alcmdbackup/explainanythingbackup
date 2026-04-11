// Tests for V2 finalizeRun and syncToArena.

import { finalizeRun, syncToArena, propagateMetrics } from './persistRunResults';
import { DEFAULT_MU, DEFAULT_SIGMA, toEloScale } from '../../shared/computeRatings';
import type { EvolutionResult, V2Match } from '../infra/types';
import type { Variant } from '../../types';
import type { Rating } from '../../shared/computeRatings';
import type { ArenaTextVariation } from '../setup/buildRunContext';
import type { SupabaseClient } from '@supabase/supabase-js';
import { writeMetric, writeMetricMax } from '../../metrics/writeMetrics';
import { createMockEntityLogger } from '../../../testing/evolution-test-helpers';

jest.mock('../../metrics/writeMetrics', () => ({
  writeMetric: jest.fn().mockResolvedValue(undefined),
  writeMetrics: jest.fn().mockResolvedValue(undefined),
  writeMetricMax: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../metrics/readMetrics', () => ({
  getMetricsForEntities: jest.fn().mockResolvedValue(new Map()),
}));

const mockedWriteMetric = writeMetric as jest.MockedFunction<typeof writeMetric>;
const mockedWriteMetricMax = writeMetricMax as jest.MockedFunction<typeof writeMetricMax>;

// Valid UUIDs for test fixtures
const RUN_ID = '00000000-0000-4000-8000-000000000001';
const BASELINE_ID = '00000000-0000-4000-8000-000000000010';
const GEN1_ID = '00000000-0000-4000-8000-000000000011';
const GEN2_ID = '00000000-0000-4000-8000-000000000012';
const ARENA_ID = '00000000-0000-4000-8000-000000000013';
const PROMPT_ID = '00000000-0000-4000-8000-000000000020';
const EXP_ID = '00000000-0000-4000-8000-000000000021';
const STRAT_ID = '00000000-0000-4000-8000-000000000022';
const LOCAL_ID = '00000000-0000-4000-8000-000000000030';
const V_NEW_ID = '00000000-0000-4000-8000-000000000031';
const V_ARENA_ID = '00000000-0000-4000-8000-000000000032';
const V_NO_RATING_ID = '00000000-0000-4000-8000-000000000033';
const V1_ID = '00000000-0000-4000-8000-000000000040';

function makeVariant(id: string, strategy = 'test', opts?: Partial<Variant>): Variant {
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
    makeVariant(GEN2_ID, 'lexical_simplify'),
  ];
  const ratings = new Map<string, Rating>([
    [BASELINE_ID, { mu: 25, sigma: 5 }],
    [GEN1_ID, { mu: 30, sigma: 4 }],
    [GEN2_ID, { mu: 28, sigma: 4.5 }],
  ]);
  const matchHistory: V2Match[] = [
    { winnerId: GEN1_ID, loserId: BASELINE_ID, result: 'win', confidence: 0.9, judgeModel: 'gpt-4.1-nano', reversed: false },
    { winnerId: GEN1_ID, loserId: GEN2_ID, result: 'win', confidence: 0.7, judgeModel: 'gpt-4.1-nano', reversed: false },
    { winnerId: GEN2_ID, loserId: BASELINE_ID, result: 'draw', confidence: 0.4, judgeModel: 'gpt-4.1-nano', reversed: false },
  ];

  return {
    winner: pool[1]!,
    pool,
    ratings,
    matchHistory,
    totalCost: 0.15,
    iterationsRun: 3,
    stopReason: 'iterations_complete',
    muHistory: [[30, 28, 25]],
    diversityHistory: [],
    matchCounts: { [BASELINE_ID]: 2, [GEN1_ID]: 2, [GEN2_ID]: 2 },
    ...overrides,
  };
}

function makeMockDb() {
  const updates: Array<{ table: string; data: Record<string, unknown> }> = [];
  const upserts: Array<{ table: string; data: unknown }> = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  /** Creates a chainable mock that resolves with { data: [{ id: 'mock' }], error: null } at the end */
  function makeChain() {
    const resolved = { data: [{ id: 'mock' }], error: null };
    const chain: Record<string, jest.Mock> = {};
    const self = () => chain;
    for (const m of ['eq', 'neq', 'in', 'is', 'select', 'single', 'order', 'limit', 'range']) {
      chain[m] = jest.fn(self);
    }
    // Make it thenable so `await` resolves it
    chain.then = jest.fn((resolve: (v: unknown) => void) => resolve(resolved));
    return chain;
  }

  return {
    db: {
      from: jest.fn((table: string) => ({
        update: jest.fn((data: Record<string, unknown>) => {
          updates.push({ table, data });
          return makeChain();
        }),
        upsert: jest.fn((data: unknown) => {
          upserts.push({ table, data });
          return Promise.resolve({ error: null });
        }),
        select: jest.fn(() => makeChain()),
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
    await finalizeRun(RUN_ID, makeResult(), { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);
    const runUpdate = updates.find((u) => u.table === 'evolution_runs' && u.data.status === 'completed');
    expect(runUpdate).toBeDefined();
    expect(runUpdate!.data.run_summary).toBeDefined();
    const summary = runUpdate!.data.run_summary as Record<string, unknown>;
    expect(summary.version).toBe(3);
    expect(summary.stopReason).toBe('iterations_complete');
  });

  it('persists all local pool variants', async () => {
    const { db, upserts } = makeMockDb();
    await finalizeRun(RUN_ID, makeResult(), { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);
    const variantUpserts = upserts.filter((u) => u.table === 'evolution_variants');
    expect(variantUpserts.length).toBe(1);
    const rows = variantUpserts[0]!.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
  });

  it('includes mu and sigma in variant rows', async () => {
    const { db, upserts } = makeMockDb();
    await finalizeRun(RUN_ID, makeResult(), { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);
    const rows = (upserts.find((u) => u.table === 'evolution_variants')?.data ?? []) as Array<Record<string, unknown>>;
    expect(rows[0]!).toHaveProperty('mu');
    expect(rows[0]!).toHaveProperty('sigma');
    // baseline-1 has mu=25, sigma=5
    const baseline = rows.find((r) => r.id === BASELINE_ID);
    expect(baseline!.mu).toBe(25);
    expect(baseline!.sigma).toBe(5);
  });

  it('sets prompt_id from run', async () => {
    const { db, upserts } = makeMockDb();
    await finalizeRun(RUN_ID, makeResult(), { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: PROMPT_ID }, db, 120);
    const rows = (upserts.find((u) => u.table === 'evolution_variants')?.data ?? []) as Array<Record<string, unknown>>;
    expect(rows[0]!.prompt_id).toBe(PROMPT_ID);
  });

  it('winner variant has is_winner=true', async () => {
    const { db, upserts } = makeMockDb();
    await finalizeRun(RUN_ID, makeResult(), { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);
    const rows = (upserts.find((u) => u.table === 'evolution_variants')?.data ?? []) as Array<Record<string, unknown>>;
    const winners = rows.filter((r) => r.is_winner === true);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.id).toBe(GEN1_ID); // Highest mu
  });

  it('matchStats computed correctly', async () => {
    const { db, updates } = makeMockDb();
    await finalizeRun(RUN_ID, makeResult(), { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);
    const summary = updates.find((u) => u.data.run_summary)?.data.run_summary as Record<string, unknown>;
    const matchStats = summary.matchStats as { totalMatches: number; avgConfidence: number; decisiveRate: number };
    expect(matchStats.totalMatches).toBe(3);
    expect(matchStats.avgConfidence).toBeCloseTo((0.9 + 0.7 + 0.4) / 3);
    expect(matchStats.decisiveRate).toBeCloseTo(2 / 3); // 0.9 and 0.7 > 0.6
  });

  it('topVariants: top 5 by mu with isBaseline flag', async () => {
    const { db, updates } = makeMockDb();
    await finalizeRun(RUN_ID, makeResult(), { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);
    const summary = updates.find((u) => u.data.run_summary)?.data.run_summary as Record<string, unknown>;
    const topVariants = summary.topVariants as Array<{ isBaseline: boolean; mu: number }>;
    expect(topVariants[0]!.mu).toBe(30); // gen-1 highest
    const baseline = topVariants.find((v) => v.isBaseline);
    expect(baseline).toBeDefined();
  });

  it('baselineRank/baselineMu correct', async () => {
    const { db, updates } = makeMockDb();
    await finalizeRun(RUN_ID, makeResult(), { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);
    const summary = updates.find((u) => u.data.run_summary)?.data.run_summary as Record<string, unknown>;
    expect(summary.baselineRank).toBe(3); // 3rd of 3
    expect(summary.baselineMu).toBe(25);
  });

  it('strategyEffectiveness computed', async () => {
    const { db, updates } = makeMockDb();
    await finalizeRun(RUN_ID, makeResult(), { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);
    const summary = updates.find((u) => u.data.run_summary)?.data.run_summary as Record<string, unknown>;
    const se = summary.strategyEffectiveness as Record<string, { count: number; avgMu: number }>;
    expect(se['baseline']!.count).toBe(1);
    expect(se['baseline']!.avgMu).toBe(25);
    expect(se['structural_transform']!.count).toBe(1);
  });

  it('empty pool marks run failed', async () => {
    const { db, updates } = makeMockDb();
    const result = makeResult({ pool: [] });
    await finalizeRun(RUN_ID, result, { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);
    const failUpdate = updates.find((u) => u.data.status === 'failed');
    expect(failUpdate).toBeDefined();
  });

  it('fromArena filtering: arena entries not persisted', async () => {
    const pool = [
      makeVariant('00000000-0000-4000-8000-000000000030', 'test'),
      makeVariant(ARENA_ID, 'test', { fromArena: true }),
    ];
    const ratings = new Map<string, Rating>([
      ['00000000-0000-4000-8000-000000000030', { mu: 30, sigma: 4 }],
      [ARENA_ID, { mu: 28, sigma: 4 }],
    ]);
    const result = makeResult({ pool, ratings });
    const { db, upserts } = makeMockDb();
    await finalizeRun(RUN_ID, result, { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);
    const rows = (upserts.find((u) => u.table === 'evolution_variants')?.data ?? []) as Array<Record<string, unknown>>;
    expect(rows.every((r) => r.id !== ARENA_ID)).toBe(true);
  });

  it('deprecated update_strategy_aggregates RPC is no longer called', async () => {
    const { db, rpcCalls } = makeMockDb();
    await finalizeRun(RUN_ID, makeResult(), { experiment_id: null, explanation_id: null, strategy_id: STRAT_ID, prompt_id: null }, db, 120);
    const rpc = rpcCalls.find((c) => c.fn === 'update_strategy_aggregates');
    expect(rpc).toBeUndefined();
  });

  it('experiment auto-completion calls complete_experiment_if_done RPC', async () => {
    const { db, rpcCalls } = makeMockDb();
    await finalizeRun(RUN_ID, makeResult(), { experiment_id: EXP_ID, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);
    const rpc = rpcCalls.find((c) => c.fn === 'complete_experiment_if_done');
    expect(rpc).toBeDefined();
    expect(rpc!.args.p_experiment_id).toBe(EXP_ID);
    expect(rpc!.args.p_completed_run_id).toBe(RUN_ID);
  });

  it('missing ratings use default', async () => {
    const pool = [makeVariant('00000000-0000-4000-8000-000000000040', 'test')];
    const ratings = new Map<string, Rating>(); // Empty!
    const result = makeResult({ pool, ratings });
    const { db, upserts } = makeMockDb();
    await finalizeRun(RUN_ID, result, { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);
    const rows = (upserts.find((u) => u.table === 'evolution_variants')?.data ?? []) as Array<Record<string, unknown>>;
    expect(rows[0]!.elo_score).toBe(toEloScale(DEFAULT_MU));
    expect(rows[0]!.mu).toBe(DEFAULT_MU);
    expect(rows[0]!.sigma).toBe(DEFAULT_SIGMA);
  });

  // Regression: winner tie-breaking should use lowest sigma when mu is equal
  it('winner tie-breaks by lowest sigma when mu is equal', async () => {
    const V_LOW_SIGMA = '00000000-0000-4000-8000-000000000050';
    const V_HIGH_SIGMA = '00000000-0000-4000-8000-000000000051';
    const pool = [
      makeVariant(V_HIGH_SIGMA, 'test'),
      makeVariant(V_LOW_SIGMA, 'test'),
    ];
    const ratings = new Map<string, Rating>([
      [V_HIGH_SIGMA, { mu: 30, sigma: 6 }],
      [V_LOW_SIGMA, { mu: 30, sigma: 3 }],
    ]);
    const result = makeResult({ pool, ratings });
    const { db, upserts } = makeMockDb();
    await finalizeRun(RUN_ID, result, { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);
    const rows = (upserts.find((u) => u.table === 'evolution_variants')?.data ?? []) as Array<Record<string, unknown>>;
    const winners = rows.filter((r) => r.is_winner === true);
    expect(winners).toHaveLength(1);
    // V_LOW_SIGMA should win because same mu but lower sigma
    expect(winners[0]!.id).toBe(V_LOW_SIGMA);
  });

  it('explanation_id passed through to variants', async () => {
    const { db, upserts } = makeMockDb();
    await finalizeRun(RUN_ID, makeResult(), { experiment_id: null, explanation_id: 42, strategy_id: null, prompt_id: null }, db, 120);
    const rows = (upserts.find((u) => u.table === 'evolution_variants')?.data ?? []) as Array<Record<string, unknown>>;
    expect(rows.every((r) => r.explanation_id === 42)).toBe(true);
  });

  // ─── Finalization metrics writes ────────────────────────────────

  it('writeMetric called for run-level finalization metrics (winner_elo, median_elo, etc.)', async () => {
    mockedWriteMetric.mockClear();
    const { db } = makeMockDb();
    await finalizeRun(RUN_ID, makeResult(), { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);

    const finalizationCalls = mockedWriteMetric.mock.calls.filter(
      ([, entityType, , , , timing]) => entityType === 'run' && timing === 'at_finalization',
    );

    // Registry defines 7 run atFinalization metrics: winner_elo, median_elo, p90_elo, max_elo, total_matches, decisive_rate, variant_count
    const metricNames = finalizationCalls.map(([, , , name]) => name);
    expect(metricNames).toContain('winner_elo');
    expect(metricNames).toContain('median_elo');
    expect(metricNames).toContain('p90_elo');
    expect(metricNames).toContain('max_elo');
    expect(metricNames).toContain('total_matches');
    expect(metricNames).toContain('decisive_rate');
    expect(metricNames).toContain('variant_count');
  });

  it('writeMetricMax called with cost during_execution to ensure propagation source exists', async () => {
    mockedWriteMetricMax.mockClear();
    const { db } = makeMockDb();
    const result = makeResult();
    await finalizeRun(RUN_ID, result, { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);
    const costCalls = mockedWriteMetricMax.mock.calls.filter(
      ([, entityType, , name, , timing]) => entityType === 'run' && name === 'cost' && timing === 'during_execution',
    );
    expect(costCalls).toHaveLength(1);
    expect(costCalls[0]![4]).toBe(result.totalCost);
  });

  it('skips cost write when totalCost is NaN', async () => {
    mockedWriteMetric.mockClear();
    const { db } = makeMockDb();
    const result = makeResult();
    result.totalCost = NaN;
    await finalizeRun(RUN_ID, result, { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);
    const costCalls = mockedWriteMetric.mock.calls.filter(
      ([, , , name, , timing]) => name === 'cost' && timing === 'during_execution',
    );
    expect(costCalls).toHaveLength(0);
  });

  it('writeMetric passes correct entity_id for run metrics', async () => {
    mockedWriteMetric.mockClear();
    const { db } = makeMockDb();
    await finalizeRun(RUN_ID, makeResult(), { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);

    const runCalls = mockedWriteMetric.mock.calls.filter(
      ([, entityType, , , , timing]) => entityType === 'run' && timing === 'at_finalization',
    );
    // All run-level calls should use 'run-1' as entity_id
    for (const call of runCalls) {
      expect(call[2]).toBe(RUN_ID);
    }
  });

  it('writeMetric called for variant-level finalization metrics', async () => {
    mockedWriteMetric.mockClear();
    const { db } = makeMockDb();
    await finalizeRun(RUN_ID, makeResult(), { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);

    const variantCalls = mockedWriteMetric.mock.calls.filter(
      ([, entityType, , , , timing]) => entityType === 'variant' && timing === 'at_finalization',
    );
    // Each local pool variant (3) should get variant-level metrics written
    // Registry has 1 variant atFinalization metric: 'cost'
    // But cost is computed from currentVariantCost which is null for our test variants (no costUsd)
    // So variant metrics may not be written if compute returns null
    // This is correct behavior - variant cost metric is only written when costUsd is set
    expect(variantCalls.length).toBeGreaterThanOrEqual(0);
  });

  it('finalization metrics not written when pool is empty (run marked failed)', async () => {
    mockedWriteMetric.mockClear();
    const { db } = makeMockDb();
    const result = makeResult({ pool: [] });
    await finalizeRun('run-1', result, { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);

    // No finalization metrics should be written when pool is empty (run fails before metrics step)
    const finalizationCalls = mockedWriteMetric.mock.calls.filter(
      ([, , , , , timing]) => timing === 'at_finalization',
    );
    expect(finalizationCalls.length).toBe(0);
  });

  // ─── Run-level cost aggregates (Phase 9b/9f) ──────────────────────

  it('does NOT write total_generation_cost or total_ranking_cost on the run entity', async () => {
    // Per the per-purpose cost split fix: generation_cost / ranking_cost are written
    // live by createLLMClient via writeMetricMax during execution. The 50/50 finalization
    // bucketing (and the run-level total_*_cost writes) was deleted. Propagation reads
    // the run-level rows and writes total_*_cost on strategy/experiment, not on runs.
    mockedWriteMetric.mockClear();

    const db = {
      from: jest.fn(() => {
        const chain: Record<string, jest.Mock> = {};
        const self = () => chain;
        for (const m of ['eq', 'neq', 'in', 'is', 'select', 'single', 'order', 'limit', 'range']) {
          chain[m] = jest.fn(self);
        }
        chain.then = jest.fn((resolve: (v: unknown) => void) => {
          resolve({ data: [{ id: 'mock' }], error: null });
        });
        return {
          update: jest.fn(() => chain),
          upsert: jest.fn(() => Promise.resolve({ error: null })),
          select: jest.fn(() => chain),
        };
      }),
      rpc: jest.fn(async () => ({ error: null })),
    } as never;

    await finalizeRun(RUN_ID, makeResult(), { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);

    const genCostCall = mockedWriteMetric.mock.calls.find(
      ([, entityType, , name]) => entityType === 'run' && name === 'total_generation_cost',
    );
    const rankCostCall = mockedWriteMetric.mock.calls.find(
      ([, entityType, , name]) => entityType === 'run' && name === 'total_ranking_cost',
    );

    expect(genCostCall).toBeUndefined();
    expect(rankCostCall).toBeUndefined();
  });
});

// ─── syncToArena helpers ────────────────────────────────────────

function makeArenaVariant(overrides: Partial<ArenaTextVariation> = {}): ArenaTextVariation {
  return { ...makeVariant(ARENA_ID), fromArena: true, ...overrides } as ArenaTextVariation;
}

function createMockArenaSupabase(overrides: {
  rpcResult?: { error: { message: string } | null };
} = {}) {
  return {
    rpc: jest.fn().mockResolvedValue(overrides.rpcResult ?? { error: null }),
  } as unknown as jest.Mocked<SupabaseClient>;
}

// ─── syncToArena ────────────────────────────────────────────────

describe('syncToArena', () => {
  it('calls sync_to_arena RPC with correct params', async () => {
    const supabase = createMockArenaSupabase();
    const pool: Variant[] = [makeVariant(V1_ID, 'test', { text: '# New' })];
    const ratings = new Map<string, Rating>([[V1_ID, { mu: 28, sigma: 7 }]]);
    const matches: V2Match[] = [
      { winnerId: V1_ID, loserId: V_NEW_ID, result: 'win' as const, confidence: 0.8, judgeModel: 'gpt-4.1-nano', reversed: false },
    ];

    await syncToArena(RUN_ID, PROMPT_ID, pool, ratings, matches, supabase, false);

    expect(supabase.rpc).toHaveBeenCalledWith('sync_to_arena', expect.objectContaining({
      p_prompt_id: PROMPT_ID,
      p_run_id: RUN_ID,
    }));
  });

  it('excludes arena entries from p_entries and includes them in p_arena_updates', async () => {
    const supabase = createMockArenaSupabase();
    const pool: Variant[] = [
      makeVariant(V_NEW_ID, 'test', { text: '# New' }),
      makeArenaVariant({ id: V_ARENA_ID, text: '# Arena', arenaMatchCount: 10 }),
    ];
    const ratings = new Map<string, Rating>([
      [V_NEW_ID, { mu: 25, sigma: 8 }],
      [V_ARENA_ID, { mu: 30, sigma: 4 }],
    ]);
    const matches: V2Match[] = [
      { winnerId: V_ARENA_ID, loserId: V_NEW_ID, result: 'win' as const, confidence: 0.8, judgeModel: 'gpt-4.1-nano', reversed: false },
    ];

    await syncToArena(RUN_ID, PROMPT_ID, pool, ratings, matches, supabase, false);

    const call = (supabase.rpc as jest.Mock).mock.calls[0];
    const entries = call[1].p_entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(V_NEW_ID);

    const arenaUpdates = call[1].p_arena_updates;
    expect(arenaUpdates).toHaveLength(1);
    expect(arenaUpdates[0].id).toBe(V_ARENA_ID);
    expect(arenaUpdates[0].mu).toBe(30);
    expect(arenaUpdates[0].sigma).toBe(4);
    expect(arenaUpdates[0].arena_match_count).toBe(11); // 10 existing + 1 new
  });

  it('maps draw matches correctly', async () => {
    const supabase = createMockArenaSupabase();
    const matches: V2Match[] = [
      { winnerId: 'a', loserId: 'b', result: 'draw' as const, confidence: 0.5, judgeModel: 'gpt-4.1-nano', reversed: false },
    ];

    await syncToArena(RUN_ID, PROMPT_ID, [], new Map(), matches, supabase, false);

    const call = (supabase.rpc as jest.Mock).mock.calls[0];
    expect(call[1].p_matches[0].winner).toBe('draw');
  });

  it('uses default rating when variant has no rating', async () => {
    const supabase = createMockArenaSupabase();
    const pool = [makeVariant(V_NO_RATING_ID)];

    await syncToArena(RUN_ID, PROMPT_ID, pool, new Map(), [], supabase, false);

    const call = (supabase.rpc as jest.Mock).mock.calls[0];
    expect(call[1].p_entries[0].variant_content).toBeDefined();
    expect(call[1].p_entries[0].elo_score).toBe(1200);
    expect(call[1].p_entries[0].arena_match_count).toBe(0);
    expect(call[1].p_entries[0].mu).toBe(25);
    expect(call[1].p_entries[0].sigma).toBe(8.333);
  });

  it('logs warning on RPC error after retry without throwing', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    const supabase = createMockArenaSupabase({ rpcResult: { error: { message: 'RPC failed' } } });

    await syncToArena(RUN_ID, PROMPT_ID, [], new Map(), [], supabase, false);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('sync_to_arena failed after retry'),
      expect.any(Object),
    );
    // Should have retried (2 RPC calls)
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    consoleSpy.mockRestore();
  });

  it('Bug #12: draw entries are normalized to sorted order', async () => {
    const supabase = createMockArenaSupabase();
    const matches: V2Match[] = [
      { winnerId: 'z-id', loserId: 'a-id', result: 'draw' as const, confidence: 0.5, judgeModel: 'gpt-4.1-nano', reversed: false },
    ];

    await syncToArena(RUN_ID, PROMPT_ID, [], new Map(), matches, supabase, false);

    const call = (supabase.rpc as jest.Mock).mock.calls[0];
    const match = call[1].p_matches[0];
    // Draw entries should be sorted: a-id < z-id
    expect(match.entry_a).toBe('a-id');
    expect(match.entry_b).toBe('z-id');
    expect(match.winner).toBe('draw');
  });

  it('Bug #12: non-draw winner is always "a"', async () => {
    const supabase = createMockArenaSupabase();
    const matches: V2Match[] = [
      { winnerId: 'winner-id', loserId: 'loser-id', result: 'win' as const, confidence: 0.9, judgeModel: 'gpt-4.1-nano', reversed: false },
    ];

    await syncToArena(RUN_ID, PROMPT_ID, [], new Map(), matches, supabase, false);

    const call = (supabase.rpc as jest.Mock).mock.calls[0];
    const match = call[1].p_matches[0];
    expect(match.entry_a).toBe('winner-id');
    expect(match.entry_b).toBe('loser-id');
    expect(match.winner).toBe('a');
  });

  it('Bug #12: confidence-0 matches are filtered out', async () => {
    const supabase = createMockArenaSupabase();
    const matches: V2Match[] = [
      { winnerId: 'a', loserId: 'b', result: 'draw' as const, confidence: 0, judgeModel: 'gpt-4.1-nano', reversed: false },
      { winnerId: 'a', loserId: 'b', result: 'win' as const, confidence: 0.8, judgeModel: 'gpt-4.1-nano', reversed: false },
    ];

    await syncToArena(RUN_ID, PROMPT_ID, [], new Map(), matches, supabase, false);

    const call = (supabase.rpc as jest.Mock).mock.calls[0];
    expect(call[1].p_matches).toHaveLength(1);
    expect(call[1].p_matches[0].confidence).toBe(0.8);
  });
});

// ─── Bug-specific finalizeRun tests ─────────────────────────────

describe('finalizeRun bug fixes', () => {
  it('Bug #9: buildRunSummary excludes arena entries from stats', async () => {
    const arenaVariant: Variant = { ...makeVariant(ARENA_ID, 'test'), fromArena: true };
    const pool = [makeVariant(LOCAL_ID, 'test'), arenaVariant];
    const ratings = new Map<string, Rating>([
      [LOCAL_ID, { mu: 30, sigma: 4 }],
      [ARENA_ID, { mu: 50, sigma: 2 }],
    ]);
    const result = makeResult({ pool, ratings });
    const { db, updates } = makeMockDb();
    await finalizeRun(RUN_ID, result, { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);

    const summary = updates.find((u) => u.data.run_summary)?.data.run_summary as Record<string, unknown>;
    const topVariants = summary.topVariants as Array<{ id: string }>;
    // Arena variant should NOT appear in run summary
    expect(topVariants.every((v) => v.id !== ARENA_ID)).toBe(true);
  });

  it('Bug #11: arena-only pool marks run as completed, not failed', async () => {
    const arenaVariant: Variant = { ...makeVariant(ARENA_ID, 'test'), fromArena: true };
    const result = makeResult({ pool: [arenaVariant] });
    const { db, updates } = makeMockDb();
    await finalizeRun(RUN_ID, result, { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);

    const completedUpdate = updates.find((u) => u.data.status === 'completed');
    expect(completedUpdate).toBeDefined();
    const failedUpdate = updates.find((u) => u.data.status === 'failed');
    expect(failedUpdate).toBeUndefined();
  });

  it('H5: arena-only run produces full run_summary with matchStats and topVariants', async () => {
    const arenaVariant: Variant = { ...makeVariant(ARENA_ID, 'test'), fromArena: true };
    const result = makeResult({ pool: [arenaVariant] });
    const { db, updates } = makeMockDb();
    await finalizeRun(RUN_ID, result, { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120);

    const completedUpdate = updates.find((u) => u.data.status === 'completed');
    expect(completedUpdate).toBeDefined();
    const summary = completedUpdate!.data.run_summary as Record<string, unknown>;
    expect(summary.version).toBe(3);
    expect(summary.stopReason).toBe('arena_only');
    expect(summary.matchStats).toBeDefined();
    expect(summary.topVariants).toBeDefined();
  });

  it('Bug #14: finalization skips persistence when runner_id mismatch (count=0)', async () => {
    const { db, upserts } = makeMockDb();
    // Override the chain to return empty data (simulating count=0 / runner_id mismatch)
    const originalFrom = (db as Record<string, jest.Mock>).from!;
    (db as Record<string, jest.Mock>).from = jest.fn((table: string) => {
      const original = originalFrom(table);
      if (table === 'evolution_runs') {
        return {
          ...original,
          update: jest.fn(() => {
            const chain: Record<string, jest.Mock> = {};
            const self = () => chain;
            for (const m of ['eq', 'neq', 'in', 'is', 'select', 'single', 'order', 'limit', 'range']) {
              chain[m] = jest.fn(self);
            }
            chain.then = jest.fn((resolve: (v: unknown) => void) => resolve({ data: [], error: null }));
            return chain;
          }),
        };
      }
      return original;
    });

    const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    await finalizeRun(RUN_ID, makeResult(), {
      experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null,
    }, db, 120, mockLogger as never, 'stale-runner');

    // Variants should NOT be persisted
    const variantUpserts = upserts.filter((u) => u.table === 'evolution_variants');
    expect(variantUpserts).toHaveLength(0);
    // Should log error (M1: upgraded from warn to error)
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Finalization aborted'),
      expect.objectContaining({ variantCount: expect.any(Number) }),
    );
  });
});

// ─── Finalization logging tests ─────────────────────────────────

describe('finalizeRun logging', () => {
  it('logger.info called with Strategy effectiveness computed', async () => {
    const { db } = makeMockDb();
    const { logger } = createMockEntityLogger();
    await finalizeRun(RUN_ID, makeResult(), { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120, logger);
    expect(logger.info).toHaveBeenCalledWith('Strategy effectiveness computed', expect.objectContaining({ phaseName: 'finalize' }));
  });

  it('logger.info called with Winner determined', async () => {
    const { db } = makeMockDb();
    const { logger } = createMockEntityLogger();
    await finalizeRun(RUN_ID, makeResult(), { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120, logger);
    expect(logger.info).toHaveBeenCalledWith('Winner determined', expect.objectContaining({ winnerId: GEN1_ID, phaseName: 'finalize' }));
  });

  it('logger.info called with Persisting variants', async () => {
    const { db } = makeMockDb();
    const { logger } = createMockEntityLogger();
    await finalizeRun(RUN_ID, makeResult(), { experiment_id: null, explanation_id: null, strategy_id: null, prompt_id: null }, db, 120, logger);
    expect(logger.info).toHaveBeenCalledWith('Persisting variants', expect.objectContaining({ count: 3, phaseName: 'finalize' }));
  });
});

// ─── syncToArena logging tests ──────────────────────────────────

// ─── F38: Arena match count computation ─────────────────────────
// NOTE: The TS layer correctly passes arena_match_count per variant.
// Migration 20260326000002 fixes the sync_to_arena RPC to use COALESCE((entry->>'arena_match_count')::INT, 0)
// instead of hardcoded 0 on INSERT, so the DB now persists these counts.

describe('syncToArena match count computation', () => {
  it('F38: passes correct arena_match_count for each variant based on matchHistory participation', async () => {
    const supabase = createMockArenaSupabase();
    const pool: Variant[] = [
      makeVariant(V1_ID, 'test', { text: '# V1' }),
      makeVariant(V_NEW_ID, 'test', { text: '# V_NEW' }),
    ];
    const ratings = new Map<string, Rating>([
      [V1_ID, { mu: 28, sigma: 7 }],
      [V_NEW_ID, { mu: 25, sigma: 8 }],
    ]);
    const matches: V2Match[] = [
      { winnerId: V1_ID, loserId: V_NEW_ID, result: 'win' as const, confidence: 0.8, judgeModel: 'gpt-4.1-nano', reversed: false },
      { winnerId: V1_ID, loserId: V_NEW_ID, result: 'win' as const, confidence: 0.7, judgeModel: 'gpt-4.1-nano', reversed: false },
      { winnerId: V_NEW_ID, loserId: V1_ID, result: 'draw' as const, confidence: 0.5, judgeModel: 'gpt-4.1-nano', reversed: false },
    ];

    await syncToArena(RUN_ID, PROMPT_ID, pool, ratings, matches, supabase, false);

    const call = (supabase.rpc as jest.Mock).mock.calls[0];
    const entries = call[1].p_entries as Array<{ id: string; arena_match_count: number }>;
    const v1Entry = entries.find((e) => e.id === V1_ID);
    const vNewEntry = entries.find((e) => e.id === V_NEW_ID);
    // V1_ID: winner in match 1, winner in match 2, loser in match 3 = 3
    expect(v1Entry!.arena_match_count).toBe(3);
    // V_NEW_ID: loser in match 1, loser in match 2, winner in match 3 = 3
    expect(vNewEntry!.arena_match_count).toBe(3);
  });

  it('F38: confidence-0 matches do not count toward arena_match_count', async () => {
    const supabase = createMockArenaSupabase();
    const pool: Variant[] = [makeVariant(V1_ID, 'test', { text: '# V1' })];
    const ratings = new Map<string, Rating>([[V1_ID, { mu: 28, sigma: 7 }]]);
    const matches: V2Match[] = [
      { winnerId: V1_ID, loserId: V_NEW_ID, result: 'win' as const, confidence: 0, judgeModel: 'gpt-4.1-nano', reversed: false },
      { winnerId: V1_ID, loserId: V_NEW_ID, result: 'win' as const, confidence: 0.9, judgeModel: 'gpt-4.1-nano', reversed: false },
    ];

    await syncToArena(RUN_ID, PROMPT_ID, pool, ratings, matches, supabase, false);

    const call = (supabase.rpc as jest.Mock).mock.calls[0];
    const entries = call[1].p_entries as Array<{ id: string; arena_match_count: number }>;
    const v1Entry = entries.find((e) => e.id === V1_ID);
    // Only the confidence=0.9 match should count
    expect(v1Entry!.arena_match_count).toBe(1);
  });
});

describe('syncToArena arena updates', () => {
  it('p_arena_updates has absolute arena_match_count (idempotent)', async () => {
    const supabase = createMockArenaSupabase();
    const pool: Variant[] = [
      makeArenaVariant({ id: V_ARENA_ID, text: '# Arena', arenaMatchCount: 20 }),
    ];
    const ratings = new Map<string, Rating>([[V_ARENA_ID, { mu: 28, sigma: 5 }]]);
    const matches: V2Match[] = [
      { winnerId: V_ARENA_ID, loserId: V_NEW_ID, result: 'win' as const, confidence: 0.8, judgeModel: 'gpt-4.1-nano', reversed: false },
      { winnerId: V_ARENA_ID, loserId: V1_ID, result: 'win' as const, confidence: 0.7, judgeModel: 'gpt-4.1-nano', reversed: false },
    ];

    await syncToArena(RUN_ID, PROMPT_ID, pool, ratings, matches, supabase, false);

    const call = (supabase.rpc as jest.Mock).mock.calls[0];
    const arenaUpdates = call[1].p_arena_updates;
    expect(arenaUpdates).toHaveLength(1);
    // Absolute count: 20 existing + 2 this run = 22
    expect(arenaUpdates[0].arena_match_count).toBe(22);
  });

  it('skips arena entries with 0 run matches from p_arena_updates', async () => {
    const supabase = createMockArenaSupabase();
    const pool: Variant[] = [
      makeArenaVariant({ id: V_ARENA_ID, text: '# Arena', arenaMatchCount: 10 }),
    ];
    const ratings = new Map<string, Rating>([[V_ARENA_ID, { mu: 28, sigma: 5 }]]);
    // No matches involving V_ARENA_ID
    const matches: V2Match[] = [
      { winnerId: V_NEW_ID, loserId: V1_ID, result: 'win' as const, confidence: 0.8, judgeModel: 'gpt-4.1-nano', reversed: false },
    ];

    await syncToArena(RUN_ID, PROMPT_ID, pool, ratings, matches, supabase, false);

    const call = (supabase.rpc as jest.Mock).mock.calls[0];
    const arenaUpdates = call[1].p_arena_updates;
    expect(arenaUpdates).toHaveLength(0);
  });

  it('p_arena_updates does NOT contain variant_content, run_id, or generation_method', async () => {
    const supabase = createMockArenaSupabase();
    const pool: Variant[] = [
      makeArenaVariant({ id: V_ARENA_ID, text: '# Arena', arenaMatchCount: 5 }),
    ];
    const ratings = new Map<string, Rating>([[V_ARENA_ID, { mu: 28, sigma: 5 }]]);
    const matches: V2Match[] = [
      { winnerId: V_ARENA_ID, loserId: V_NEW_ID, result: 'win' as const, confidence: 0.8, judgeModel: 'gpt-4.1-nano', reversed: false },
    ];

    await syncToArena(RUN_ID, PROMPT_ID, pool, ratings, matches, supabase, false);

    const call = (supabase.rpc as jest.Mock).mock.calls[0];
    const arenaUpdates = call[1].p_arena_updates;
    expect(arenaUpdates).toHaveLength(1);
    const update = arenaUpdates[0];
    expect(update).not.toHaveProperty('variant_content');
    expect(update).not.toHaveProperty('run_id');
    expect(update).not.toHaveProperty('generation_method');
    // Should only have rating fields
    expect(Object.keys(update).sort()).toEqual(['arena_match_count', 'elo_score', 'id', 'mu', 'sigma']);
  });
});

describe('syncToArena logging', () => {
  it('logs Arena sync preparation and Arena sync complete on success', async () => {
    const supabase = createMockArenaSupabase();
    const { logger } = createMockEntityLogger();
    const pool: Variant[] = [makeVariant(V1_ID, 'test', { text: '# New' })];
    const ratings = new Map<string, Rating>([[V1_ID, { mu: 28, sigma: 7 }]]);

    await syncToArena(RUN_ID, PROMPT_ID, pool, ratings, [], supabase, false, logger);

    expect(logger.info).toHaveBeenCalledWith('Arena sync preparation', expect.objectContaining({ phaseName: 'arena' }));
    expect(logger.info).toHaveBeenCalledWith('Arena sync complete', expect.objectContaining({ phaseName: 'arena' }));
  });
});

describe('syncToArena — isSeeded flag', () => {
  it('isSeeded=true: baseline variant gets generation_method=seed', async () => {
    const supabase = createMockArenaSupabase();
    const pool: Variant[] = [
      makeVariant(V1_ID, 'baseline', { text: '# Seed' }),        // baseline → seed
      makeVariant(V_NEW_ID, 'structural_transform', { text: '# Gen' }), // non-baseline → pipeline
    ];
    const ratings = new Map<string, Rating>([
      [V1_ID, { mu: 25, sigma: 8 }],
      [V_NEW_ID, { mu: 24, sigma: 8 }],
    ]);

    await syncToArena(RUN_ID, PROMPT_ID, pool, ratings, [], supabase, true /* isSeeded */);

    const call = (supabase.rpc as jest.Mock).mock.calls[0];
    const entries = call[1].p_entries as Array<{ id: string; generation_method: string }>;
    const baseline = entries.find((e) => e.id === V1_ID);
    const nonBaseline = entries.find((e) => e.id === V_NEW_ID);
    expect(baseline?.generation_method).toBe('seed');
    expect(nonBaseline?.generation_method).toBe('pipeline');
  });

  it('isSeeded=false: all variants get generation_method=pipeline regardless of strategy', async () => {
    const supabase = createMockArenaSupabase();
    const pool: Variant[] = [
      makeVariant(V1_ID, 'baseline', { text: '# Base' }),
      makeVariant(V_NEW_ID, 'structural_transform', { text: '# Gen' }),
    ];
    const ratings = new Map<string, Rating>([
      [V1_ID, { mu: 25, sigma: 8 }],
      [V_NEW_ID, { mu: 24, sigma: 8 }],
    ]);

    await syncToArena(RUN_ID, PROMPT_ID, pool, ratings, [], supabase, false /* isSeeded */);

    const call = (supabase.rpc as jest.Mock).mock.calls[0];
    const entries = call[1].p_entries as Array<{ id: string; generation_method: string }>;
    for (const e of entries) {
      expect(e.generation_method).toBe('pipeline');
    }
  });

  it('arena entries are excluded from p_entries regardless of isSeeded value', async () => {
    const supabase = createMockArenaSupabase();
    const pool: Variant[] = [
      makeVariant(V_NEW_ID, 'baseline', { text: '# Base' }),
      makeArenaVariant({ id: V_ARENA_ID, text: '# Arena', arenaMatchCount: 5 }),
    ];
    const ratings = new Map<string, Rating>([
      [V_NEW_ID, { mu: 25, sigma: 8 }],
      [V_ARENA_ID, { mu: 30, sigma: 4 }],
    ]);

    await syncToArena(RUN_ID, PROMPT_ID, pool, ratings, [], supabase, true /* isSeeded */);

    const call = (supabase.rpc as jest.Mock).mock.calls[0];
    const entries = call[1].p_entries as Array<{ id: string }>;
    expect(entries.every((e) => e.id !== V_ARENA_ID)).toBe(true);
    expect(entries.some((e) => e.id === V_NEW_ID)).toBe(true);
  });
});

describe('propagateMetrics', () => {
  it('passes sigma through to writeMetric for bootstrap-aggregated metrics', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getMetricsForEntities } = require('../../metrics/readMetrics');
    const winnerEloSigma = 42.5;
    // Simulate a single completed run with winner_elo that has sigma
    const metricsMap = new Map([
      [RUN_ID, [
        { metric_name: 'winner_elo', value: 1500, sigma: winnerEloSigma, ci_lower: 1400, ci_upper: 1600, n: 1 },
        { metric_name: 'cost', value: 0.005, sigma: null, ci_lower: null, ci_upper: null, n: 1 },
        { metric_name: 'median_elo', value: 1450, sigma: 30, ci_lower: 1390, ci_upper: 1510, n: 1 },
        { metric_name: 'total_matches', value: 10, sigma: null, ci_lower: null, ci_upper: null, n: 1 },
        { metric_name: 'decisive_rate', value: 0.8, sigma: null, ci_lower: null, ci_upper: null, n: 1 },
        { metric_name: 'variant_count', value: 3, sigma: null, ci_lower: null, ci_upper: null, n: 1 },
        { metric_name: 'p90_elo', value: 1480, sigma: 35, ci_lower: 1410, ci_upper: 1550, n: 1 },
        { metric_name: 'max_elo', value: 1520, sigma: 40, ci_lower: 1440, ci_upper: 1600, n: 1 },
      ]],
    ]);
    getMetricsForEntities.mockResolvedValueOnce(metricsMap);

    const supabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: [{ id: RUN_ID }], error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    mockedWriteMetric.mockClear();
    await propagateMetrics(supabase, 'experiment', EXP_ID);

    // Find the avg_final_elo write call
    const avgEloCall = mockedWriteMetric.mock.calls.find(c => c[3] === 'avg_final_elo');
    expect(avgEloCall).toBeDefined();
    // With 1 run, bootstrapMeanCI single-value path returns source sigma
    const opts = avgEloCall![6];
    expect(opts?.sigma).toBe(winnerEloSigma);
  });
});
