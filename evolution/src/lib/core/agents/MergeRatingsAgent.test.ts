// Tests for MergeRatingsAgent: shuffle, OpenSkill apply, before/after snapshots,
// arena_comparisons writes (Critical Fix J), iteration type handling.

import { MergeRatingsAgent, type MergeMatchEntry, type MergeRatingsInput } from './MergeRatingsAgent';
import type { AgentContext } from '../types';
import type { Variant } from '../../types';
import type { Rating } from '../../shared/computeRatings';
import { createRating } from '../../shared/computeRatings';
import type { V2Match } from '../../pipeline/infra/types';

// ─── Mocks ────────────────────────────────────────────────────────

jest.mock('../../pipeline/infra/trackInvocations', () => ({
  createInvocation: jest.fn().mockResolvedValue('inv-merge'),
  updateInvocation: jest.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ──────────────────────────────────────────────────────

const mkVariant = (id: string): Variant => ({
  id, text: `text-${id}`, version: 0, parentIds: [], strategy: 'baseline',
  createdAt: 0, iterationBorn: 0,
});

const mkMatch = (winnerId: string, loserId: string, confidence = 0.9): V2Match => ({
  winnerId, loserId, result: 'win', confidence, judgeModel: 'gpt-4o', reversed: false,
});

interface SupabaseMockState {
  inserts: Array<{ table: string; rows: unknown[] }>;
  insertError: { message: string } | null;
}

function makeDbMock(state: SupabaseMockState) {
  return {
    from: jest.fn((table: string) => ({
      insert: jest.fn(async (rows: unknown[]) => {
        state.inserts.push({ table, rows });
        return { data: null, error: state.insertError };
      }),
    })),
  };
}

function makeCtx(dbState: SupabaseMockState): AgentContext {
  return {
    db: makeDbMock(dbState) as unknown as AgentContext['db'],
    runId: 'run-1',
    iteration: 1,
    executionOrder: 10,
    invocationId: 'inv-merge',
    randomSeed: BigInt(42),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    costTracker: {
      reserve: jest.fn(),
      recordSpend: jest.fn(),
      release: jest.fn(),
      getTotalSpent: jest.fn(() => 0),
      getPhaseCosts: jest.fn(() => ({})),
      getAvailableBudget: jest.fn(() => 10),
    } as unknown as AgentContext['costTracker'],
    config: {
      iterations: 5,
      budgetUsd: 10,
      judgeModel: 'gpt-4o',
      generationModel: 'gpt-4o',
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────

describe('MergeRatingsAgent', () => {
  const baseInput = (): MergeRatingsInput => {
    const baseline = mkVariant('baseline');
    return {
      iterationType: 'generate',
      matchBuffers: [] as MergeMatchEntry[][],
      newVariants: [] as Variant[],
      pool: [baseline],
      ratings: new Map<string, Rating>([['baseline', createRating()]]),
      matchCounts: new Map<string, number>(),
      matchHistory: [] as V2Match[],
    };
  };

  it('has the correct name', () => {
    expect(new MergeRatingsAgent().name).toBe('merge_ratings');
  });

  it('handles empty match buffers gracefully (no-op merge)', async () => {
    const dbState: SupabaseMockState = { inserts: [], insertError: null };
    const agent = new MergeRatingsAgent();
    const result = await agent.run(baseInput(), makeCtx(dbState));
    expect(result.success).toBe(true);
    expect(result.result?.matchesApplied).toBe(0);
    expect(result.result?.arenaRowsWritten).toBe(0);
    expect(dbState.inserts.length).toBe(0);
  });

  it('adds new variants to the global pool (generate iteration)', async () => {
    const input = baseInput();
    const newV = mkVariant('v1');
    input.newVariants = [newV];
    const dbState: SupabaseMockState = { inserts: [], insertError: null };
    const agent = new MergeRatingsAgent();
    await agent.run(input, makeCtx(dbState));
    expect(input.pool.length).toBe(2);
    expect(input.pool.map(v => v.id)).toContain('v1');
    expect(input.ratings.has('v1')).toBe(true);
  });

  it('applies OpenSkill updates to the global ratings map', async () => {
    const input = baseInput();
    const newV = mkVariant('v1');
    input.newVariants = [newV];
    input.ratings.set('v1', createRating());
    const buffer: MergeMatchEntry[] = [
      { match: mkMatch('v1', 'baseline', 0.9), idA: 'v1', idB: 'baseline' },
    ];
    input.matchBuffers = [buffer];
    const dbState: SupabaseMockState = { inserts: [], insertError: null };
    const agent = new MergeRatingsAgent();
    await agent.run(input, makeCtx(dbState));
    // v1's elo should rise after winning (it was tied at default 1200).
    expect(input.ratings.get('v1')!.elo).toBeGreaterThan(1200);
    expect(input.ratings.get('baseline')!.elo).toBeLessThan(1200);
  });

  it('writes one arena_comparisons row per match (Critical Fix J)', async () => {
    const input = baseInput();
    const newV1 = mkVariant('v1');
    const newV2 = mkVariant('v2');
    input.newVariants = [newV1, newV2];
    const buffer: MergeMatchEntry[] = [
      { match: mkMatch('v1', 'baseline', 0.9), idA: 'v1', idB: 'baseline' },
      { match: mkMatch('v2', 'baseline', 0.8), idA: 'v2', idB: 'baseline' },
    ];
    input.matchBuffers = [buffer];
    const dbState: SupabaseMockState = { inserts: [], insertError: null };
    const agent = new MergeRatingsAgent();
    const result = await agent.run(input, makeCtx(dbState));
    expect(result.result?.arenaRowsWritten).toBe(2);
    expect(dbState.inserts.length).toBe(1);
    expect(dbState.inserts[0]!.table).toBe('evolution_arena_comparisons');
    const rows = dbState.inserts[0]!.rows as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    // Each row should have iteration, invocation_id, mu/sigma before/after.
    expect(rows[0]!.iteration).toBe(1);
    expect(rows[0]!.invocation_id).toBe('inv-merge');
    expect(rows[0]!.entry_a_mu_before).toBeDefined();
    expect(rows[0]!.entry_a_mu_after).toBeDefined();
  });

  it('does NOT throw when arena_comparisons insert fails (best-effort)', async () => {
    const input = baseInput();
    const newV = mkVariant('v1');
    input.newVariants = [newV];
    const buffer: MergeMatchEntry[] = [
      { match: mkMatch('v1', 'baseline', 0.9), idA: 'v1', idB: 'baseline' },
    ];
    input.matchBuffers = [buffer];
    const dbState: SupabaseMockState = { inserts: [], insertError: { message: 'connection refused' } };
    const agent = new MergeRatingsAgent();
    const ctx = makeCtx(dbState);
    const result = await agent.run(input, ctx);
    expect(result.success).toBe(true);
    expect(result.result?.arenaRowsWritten).toBe(0);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('arena_comparisons insert failed'),
      expect.any(Object),
    );
  });

  it('shuffles matches deterministically given the same randomSeed', async () => {
    // Two identical merges with the same randomSeed should produce identical
    // pool ratings (proves the seeded shuffle is deterministic).
    const buildInput = () => {
      const input = baseInput();
      input.pool = [mkVariant('baseline'), mkVariant('A'), mkVariant('B'), mkVariant('C')];
      input.ratings = new Map<string, Rating>([
        ['baseline', createRating()],
        ['A', createRating()],
        ['B', createRating()],
        ['C', createRating()],
      ]);
      const buffer: MergeMatchEntry[] = [
        { match: mkMatch('A', 'baseline', 0.9), idA: 'A', idB: 'baseline' },
        { match: mkMatch('B', 'baseline', 0.9), idA: 'B', idB: 'baseline' },
        { match: mkMatch('C', 'baseline', 0.9), idA: 'C', idB: 'baseline' },
        { match: mkMatch('A', 'B', 0.8), idA: 'A', idB: 'B' },
        { match: mkMatch('A', 'C', 0.7), idA: 'A', idB: 'C' },
      ];
      input.matchBuffers = [buffer];
      return input;
    };
    const i1 = buildInput();
    const i2 = buildInput();
    const dbState: SupabaseMockState = { inserts: [], insertError: null };
    const agent = new MergeRatingsAgent();
    await agent.run(i1, makeCtx(dbState));
    await agent.run(i2, makeCtx(dbState));
    // Same seed → identical resulting ratings
    expect(i1.ratings.get('A')!.elo).toBe(i2.ratings.get('A')!.elo);
    expect(i1.ratings.get('B')!.elo).toBe(i2.ratings.get('B')!.elo);
  });

  it('captures BEFORE and AFTER variant snapshots in execution detail', async () => {
    const input = baseInput();
    const newV = mkVariant('v1');
    input.newVariants = [newV];
    const buffer: MergeMatchEntry[] = [
      { match: mkMatch('v1', 'baseline', 0.9), idA: 'v1', idB: 'baseline' },
    ];
    input.matchBuffers = [buffer];
    const dbState: SupabaseMockState = { inserts: [], insertError: null };
    const agent = new MergeRatingsAgent();
    await agent.run(input, makeCtx(dbState));
    const updateInvocation = jest.requireMock('../../pipeline/infra/trackInvocations').updateInvocation as jest.Mock;
    const lastCall = updateInvocation.mock.calls[updateInvocation.mock.calls.length - 1];
    const update = lastCall[2];
    expect(update.execution_detail).toBeDefined();
    expect(update.execution_detail.before.poolSize).toBe(1); // baseline only before
    expect(update.execution_detail.after.poolSize).toBe(2); // baseline + v1 after
    expect(update.execution_detail.iterationType).toBe('generate');
  });

  it('caps matchesApplied snapshot at 50 with truncation flag', async () => {
    const input = baseInput();
    const ids = Array.from({ length: 60 }, (_, i) => `v${i}`);
    input.pool = ids.map(mkVariant);
    input.ratings = new Map<string, Rating>(ids.map((id) => [id, createRating()]));
    const buffer: MergeMatchEntry[] = ids.slice(1).map((id) => ({
      match: mkMatch(id, 'v0', 0.9),
      idA: id,
      idB: 'v0',
    }));
    input.matchBuffers = [buffer];
    const dbState: SupabaseMockState = { inserts: [], insertError: null };
    const agent = new MergeRatingsAgent();
    await agent.run(input, makeCtx(dbState));
    const updateInvocation = jest.requireMock('../../pipeline/infra/trackInvocations').updateInvocation as jest.Mock;
    const lastCall = updateInvocation.mock.calls[updateInvocation.mock.calls.length - 1];
    const update = lastCall[2];
    expect(update.execution_detail.matchesApplied.length).toBe(50);
    expect(update.execution_detail.matchesAppliedTotal).toBe(59);
    expect(update.execution_detail.matchesAppliedTruncated).toBe(true);
  });

  it('handles swiss iteration type correctly', async () => {
    const input = baseInput();
    input.iterationType = 'swiss';
    input.pool = [mkVariant('a'), mkVariant('b')];
    input.ratings = new Map<string, Rating>([
      ['a', createRating()],
      ['b', createRating()],
    ]);
    const buffer: MergeMatchEntry[] = [
      { match: mkMatch('a', 'b', 0.9), idA: 'a', idB: 'b' },
    ];
    input.matchBuffers = [buffer];
    const dbState: SupabaseMockState = { inserts: [], insertError: null };
    const agent = new MergeRatingsAgent();
    await agent.run(input, makeCtx(dbState));
    const updateInvocation = jest.requireMock('../../pipeline/infra/trackInvocations').updateInvocation as jest.Mock;
    const lastCall = updateInvocation.mock.calls[updateInvocation.mock.calls.length - 1];
    const update = lastCall[2];
    expect(update.execution_detail.iterationType).toBe('swiss');
  });

  it('skips rating updates for zero-confidence (failed) matches', async () => {
    const input = baseInput();
    const newV = mkVariant('v1');
    input.newVariants = [newV];
    const buffer: MergeMatchEntry[] = [
      { match: { ...mkMatch('v1', 'baseline'), confidence: 0 }, idA: 'v1', idB: 'baseline' },
    ];
    input.matchBuffers = [buffer];
    const dbState: SupabaseMockState = { inserts: [], insertError: null };
    const agent = new MergeRatingsAgent();
    await agent.run(input, makeCtx(dbState));
    // v1 was just added with default rating. Should remain unchanged.
    expect(input.ratings.get('v1')!.elo).toBe(1200);
  });

  it('appends matches to matchHistory in shuffled order', async () => {
    const input = baseInput();
    input.pool = [mkVariant('baseline'), mkVariant('a'), mkVariant('b')];
    input.ratings = new Map<string, Rating>([
      ['baseline', createRating()],
      ['a', createRating()],
      ['b', createRating()],
    ]);
    const buffer: MergeMatchEntry[] = [
      { match: mkMatch('a', 'b', 0.9), idA: 'a', idB: 'b' },
      { match: mkMatch('a', 'baseline', 0.8), idA: 'a', idB: 'baseline' },
    ];
    input.matchBuffers = [buffer];
    const dbState: SupabaseMockState = { inserts: [], insertError: null };
    const agent = new MergeRatingsAgent();
    await agent.run(input, makeCtx(dbState));
    expect(input.matchHistory.length).toBe(2);
  });

  it('reuses for both generate and swiss without errors (no discard logic)', async () => {
    // Both iteration types should work end-to-end.
    for (const iterationType of ['generate', 'swiss'] as const) {
      const input = baseInput();
      input.iterationType = iterationType;
      const dbState: SupabaseMockState = { inserts: [], insertError: null };
      const agent = new MergeRatingsAgent();
      const result = await agent.run(input, makeCtx(dbState));
      expect(result.success).toBe(true);
    }
  });
});
