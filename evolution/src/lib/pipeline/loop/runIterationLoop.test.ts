// Tests for the orchestrator-driven evolution loop. Mocks the three agent classes
// at the module level so each iteration's behaviour is fully controllable.

import { evolveArticle } from './runIterationLoop';
import type { EvolutionConfig } from '../infra/types';

// ─── Agent mocks ────────────────────────────────────────────────────

const mockGenerateRun = jest.fn();
const mockSwissRun = jest.fn();
const mockMergeRun = jest.fn();

jest.mock('../../core/agents/generateFromSeedArticle', () => ({
  GenerateFromSeedArticleAgent: jest.fn().mockImplementation(() => ({
    name: 'generate_from_seed_article',
    run: (input: unknown, ctx: unknown) => mockGenerateRun(input, ctx),
  })),
  deepCloneRatings: jest.fn((m: Map<string, unknown>) => new Map(m)),
}));

jest.mock('../../core/agents/SwissRankingAgent', () => ({
  SwissRankingAgent: jest.fn().mockImplementation(() => ({
    name: 'swiss_ranking',
    run: (input: unknown, ctx: unknown) => mockSwissRun(input, ctx),
  })),
}));

jest.mock('../../core/agents/MergeRatingsAgent', () => ({
  MergeRatingsAgent: jest.fn().mockImplementation(() => ({
    name: 'merge_ratings',
    run: (input: unknown, ctx: unknown) => mockMergeRun(input, ctx),
  })),
}));

const mockSeedRun = jest.fn();
jest.mock('../../core/agents/createSeedArticle', () => ({
  CreateSeedArticleAgent: jest.fn().mockImplementation(() => ({
    name: 'create_seed_article',
    run: (input: unknown, ctx: unknown) => mockSeedRun(input, ctx),
  })),
}));

// Stub the LLM client factory so we don't need a real provider.
jest.mock('../infra/createEvolutionLLMClient', () => ({
  createEvolutionLLMClient: jest.fn().mockReturnValue({
    complete: jest.fn(),
    completeStructured: jest.fn(),
  }),
  calculateCost: jest.fn().mockReturnValue(0.001),
}));

jest.mock('../infra/trackBudget', () => ({
  createCostTracker: jest.fn(() => ({
    reserve: jest.fn(),
    recordSpend: jest.fn(),
    release: jest.fn(),
    getTotalSpent: jest.fn(() => 0),
    getPhaseCosts: jest.fn(() => ({})),
    getAvailableBudget: jest.fn(() => 10),
    isExhausted: jest.fn(() => false),
  })),
}));

// ─── Helpers ────────────────────────────────────────────────────────

function makeDb(): unknown {
  // Lightweight stub that resolves all kill checks to "running" (not failed/cancelled).
  const select = jest.fn().mockReturnThis();
  const eq = jest.fn().mockReturnThis();
  const single = jest.fn().mockResolvedValue({ data: { status: 'running' }, error: null });
  const update = jest.fn().mockReturnThis();
  return {
    from: jest.fn(() => ({ select, eq, single, update })),
  };
}

function makeConfig(): EvolutionConfig {
  return {
    budgetUsd: 10,
    judgeModel: 'gpt-4o',
    generationModel: 'gpt-4o',
    iterations: 5,
    strategiesPerRound: 3,
    calibrationOpponents: 5,
    tournamentTopK: 5,
    numVariants: 3,
    strategies: ['structural_transform', 'lexical_simplify', 'grounding_enhance'],
  };
}

function mkVariant(id: string, mu = 25, sigma = 8.333) {
  return { id, text: `text-${id}`, version: 0, parentIds: [], strategy: 'structural_transform', createdAt: 0, iterationBorn: 1, mu, sigma };
}

function makeProvider() {
  return { complete: jest.fn(async () => 'fake') };
}

// Successful generate-agent result helper.
function generateSuccess(variantId: string, surfaced = true) {
  return {
    success: true,
    result: {
      variant: mkVariant(variantId),
      status: 'converged',
      surfaced,
      matches: [],
    },
    cost: 0.01,
    durationMs: 5,
    invocationId: `inv-gen-${variantId}`,
  };
}

function mergeSuccess(opts?: { mutatePool?: (pool: unknown[], ratings: Map<string, unknown>) => void }) {
  return jest.fn(async (input: { pool: unknown[]; ratings: Map<string, unknown>; newVariants: Array<{ id: string }> }) => {
    // Simulate merge behaviour: append newVariants to pool, set default rating for each.
    for (const v of input.newVariants) {
      input.pool.push(v);
      if (!input.ratings.has(v.id)) {
        input.ratings.set(v.id, { mu: 25, sigma: 8.333 });
      }
    }
    if (opts?.mutatePool) opts.mutatePool(input.pool, input.ratings);
    return {
      success: true,
      result: { matchesApplied: 0, arenaRowsWritten: 0 },
      cost: 0,
      durationMs: 1,
      invocationId: 'inv-merge',
    };
  });
}

function seedSuccess(variantId: string, surfaced = true) {
  return {
    success: true,
    result: {
      variant: { id: variantId, text: `seed-text-${variantId}`, version: 0, parentIds: [], strategy: 'seed_variant', createdAt: 0, iterationBorn: 1 },
      status: 'converged',
      surfaced,
      matches: [],
    },
    cost: 0.01,
    durationMs: 5,
    invocationId: 'inv-seed',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMergeRun.mockImplementation(mergeSuccess());
  // Default: seed agent not called (seedPrompt absent in most tests)
  mockSeedRun.mockResolvedValue(seedSuccess('seed-v1'));
});

// ─── Tests ──────────────────────────────────────────────────────────

describe('evolveArticle (orchestrator)', () => {
  it('first iteration is always generate', async () => {
    mockGenerateRun
      .mockResolvedValueOnce(generateSuccess('v1'))
      .mockResolvedValueOnce(generateSuccess('v2'))
      .mockResolvedValueOnce(generateSuccess('v3'));
    // After generate, swiss returns no_pairs to halt the loop.
    mockSwissRun.mockResolvedValueOnce({
      success: true,
      result: { pairs: [], matches: [], status: 'no_pairs' },
      cost: 0,
      durationMs: 1,
      invocationId: 'inv-swiss',
    });

    const result = await evolveArticle('seed text', makeProvider(), makeDb() as never, 'run-1', makeConfig());

    expect(mockGenerateRun).toHaveBeenCalledTimes(3);
    // First-call ctx must have iteration === 1
    const firstCtx = mockGenerateRun.mock.calls[0][1] as { iteration: number };
    expect(firstCtx.iteration).toBe(1);
    expect(result.iterationsRun).toBeGreaterThanOrEqual(1);
  });

  it('dispatches N parallel generate agents in iteration 1 with cycling strategies', async () => {
    mockGenerateRun
      .mockResolvedValue(generateSuccess('vn'));
    mockSwissRun.mockResolvedValue({
      success: true,
      result: { pairs: [], matches: [], status: 'no_pairs' },
      cost: 0, durationMs: 1, invocationId: 'inv-swiss',
    });

    const cfg = makeConfig();
    cfg.numVariants = 6;
    await evolveArticle('seed', makeProvider(), makeDb() as never, 'run-1', cfg);

    expect(mockGenerateRun).toHaveBeenCalledTimes(6);
    const strategies = mockGenerateRun.mock.calls.map((c) => (c[0] as { strategy: string }).strategy);
    expect(strategies).toEqual([
      'structural_transform',
      'lexical_simplify',
      'grounding_enhance',
      'structural_transform',
      'lexical_simplify',
      'grounding_enhance',
    ]);
  });

  it('exits with stopReason=no_pairs when swiss has no candidate pairs', async () => {
    mockGenerateRun.mockResolvedValue(generateSuccess('v1'));
    mockSwissRun.mockResolvedValue({
      success: true,
      result: { pairs: [], matches: [], status: 'no_pairs' },
      cost: 0, durationMs: 1, invocationId: 'inv-swiss',
    });

    const result = await evolveArticle('seed', makeProvider(), makeDb() as never, 'run-1', makeConfig());
    expect(result.stopReason).toBe('no_pairs');
  });

  it('captures one start + one end snapshot per iteration', async () => {
    mockGenerateRun.mockResolvedValue(generateSuccess('v1'));
    mockSwissRun.mockResolvedValue({
      success: true,
      result: { pairs: [], matches: [], status: 'no_pairs' },
      cost: 0, durationMs: 1, invocationId: 'inv-swiss',
    });

    const result = await evolveArticle('seed', makeProvider(), makeDb() as never, 'run-1', makeConfig());

    // Iteration 1 (generate): 1 start + 1 end. Iteration 2 (swiss): 1 start + 1 end (early exit).
    const snapshots = result.iterationSnapshots ?? [];
    expect(snapshots.length).toBeGreaterThanOrEqual(3);
    const phases = snapshots.map((s) => `${s.iteration}-${s.iterationType}-${s.phase}`);
    expect(phases).toContain('1-generate-start');
    expect(phases).toContain('1-generate-end');
  });

  it('tracks discarded variants from generate iteration', async () => {
    mockGenerateRun
      .mockResolvedValueOnce(generateSuccess('v1', true))
      .mockResolvedValueOnce(generateSuccess('v2', false))  // discarded
      .mockResolvedValueOnce(generateSuccess('v3', true));
    mockSwissRun.mockResolvedValue({
      success: true,
      result: { pairs: [], matches: [], status: 'no_pairs' },
      cost: 0, durationMs: 1, invocationId: 'inv-swiss',
    });

    const result = await evolveArticle('seed', makeProvider(), makeDb() as never, 'run-1', makeConfig());
    expect((result.discardedVariants ?? []).map((v) => v.id)).toEqual(['v2']);
  });

  it('execution_order is monotonic across all dispatched agents', async () => {
    mockGenerateRun
      .mockResolvedValueOnce(generateSuccess('v1'))
      .mockResolvedValueOnce(generateSuccess('v2'))
      .mockResolvedValueOnce(generateSuccess('v3'));
    mockSwissRun.mockResolvedValue({
      success: true,
      result: { pairs: [], matches: [], status: 'no_pairs' },
      cost: 0, durationMs: 1, invocationId: 'inv-swiss',
    });

    await evolveArticle('seed', makeProvider(), makeDb() as never, 'run-1', makeConfig());

    const genOrders = mockGenerateRun.mock.calls.map((c) => (c[1] as { executionOrder: number }).executionOrder);
    const mergeOrders = mockMergeRun.mock.calls.map((c) => (c[1] as { executionOrder: number }).executionOrder);
    const all = [...genOrders, ...mergeOrders].sort((a, b) => a - b);
    // Sorted distinct ascending
    expect(new Set(all).size).toBe(all.length);
    // Generate agents occupy 1..3 (in dispatch order), merge gets 4
    expect(Math.min(...genOrders)).toBe(1);
    expect(Math.max(...genOrders)).toBe(3);
  });

  it('each parallel agent gets a distinct ctx object (per-call snapshot)', async () => {
    mockGenerateRun
      .mockResolvedValueOnce(generateSuccess('v1'))
      .mockResolvedValueOnce(generateSuccess('v2'))
      .mockResolvedValueOnce(generateSuccess('v3'));
    mockSwissRun.mockResolvedValue({
      success: true,
      result: { pairs: [], matches: [], status: 'no_pairs' },
      cost: 0, durationMs: 1, invocationId: 'inv-swiss',
    });

    await evolveArticle('seed', makeProvider(), makeDb() as never, 'run-1', makeConfig());

    const ctxs = mockGenerateRun.mock.calls.map((c) => c[1]);
    // All three ctx objects must be distinct references
    expect(new Set(ctxs).size).toBe(3);
    // Distinct executionOrder values per ctx
    const orders = ctxs.map((c) => (c as { executionOrder: number }).executionOrder);
    expect(new Set(orders).size).toBe(3);
  });

  it('exits on AbortSignal at iteration boundary', async () => {
    const ac = new AbortController();
    ac.abort();

    const result = await evolveArticle('seed', makeProvider(), makeDb() as never, 'run-1', makeConfig(), { signal: ac.signal });

    // Aborted before any iteration starts
    expect(result.stopReason).toBe('killed');
    expect(mockGenerateRun).not.toHaveBeenCalled();
  });

  it('exits on wall-clock deadline at iteration boundary', async () => {
    const result = await evolveArticle('seed', makeProvider(), makeDb() as never, 'run-1', makeConfig(), { deadlineMs: Date.now() - 1000 });
    expect(result.stopReason).toBe('time_limit');
  });

  it('budget exhaustion during generate marks budgetExhausted and exits next loop', async () => {
    // First call succeeds with budgetExceeded sentinel; subsequent iterations should not run.
    mockGenerateRun
      .mockResolvedValueOnce({ success: false, result: null, cost: 0, durationMs: 1, invocationId: 'inv', budgetExceeded: true })
      .mockResolvedValueOnce(generateSuccess('v2'))
      .mockResolvedValueOnce(generateSuccess('v3'));
    mockSwissRun.mockResolvedValue({
      success: true,
      result: { pairs: [], matches: [], status: 'no_pairs' },
      cost: 0, durationMs: 1, invocationId: 'inv-swiss',
    });

    const result = await evolveArticle('seed', makeProvider(), makeDb() as never, 'run-1', makeConfig());

    expect(['budget_exceeded', 'no_pairs']).toContain(result.stopReason);
    // Merge always dispatched (paid-for matches must reach global ratings)
    expect(mockMergeRun).toHaveBeenCalled();
  });

  it('one rejected generate agent does not cancel the others', async () => {
    mockGenerateRun
      .mockResolvedValueOnce(generateSuccess('v1'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(generateSuccess('v3'));
    mockSwissRun.mockResolvedValue({
      success: true,
      result: { pairs: [], matches: [], status: 'no_pairs' },
      cost: 0, durationMs: 1, invocationId: 'inv-swiss',
    });

    const result = await evolveArticle('seed', makeProvider(), makeDb() as never, 'run-1', makeConfig());

    // Pool should contain baseline + 2 surfaced surviving variants
    const ids = result.pool.map((v) => v.id);
    expect(ids).toContain('v1');
    expect(ids).toContain('v3');
    expect(ids).not.toContain('boom');
  });
});

// ─── Seed agent behavior ─────────────────────────────────────────────

describe('evolveArticle — seed agent (seedPrompt option)', () => {
  it('without seedPrompt: baseline is added to pool immediately, seed agent never runs', async () => {
    mockGenerateRun.mockResolvedValue(generateSuccess('vn'));
    mockSwissRun.mockResolvedValue({
      success: true, result: { pairs: [], matches: [], status: 'no_pairs' },
      cost: 0, durationMs: 1, invocationId: 'inv-swiss',
    });

    const result = await evolveArticle('original text', makeProvider(), makeDb() as never, 'run-1', makeConfig());

    expect(mockSeedRun).not.toHaveBeenCalled();
    const seedVariant = result.pool.find((v) => v.strategy === 'seed_variant');
    expect(seedVariant).toBeDefined();
    expect(seedVariant?.text).toBe('original text');
    expect(seedVariant?.reusedFromSeed).toBeFalsy(); // fresh, not a reused seed
    expect(result.isSeeded).toBeFalsy();
  });

  it('with seedVariantRow: pool[0] reuses seed UUID + dbToRating(mu, sigma); reusedFromSeed=true', async () => {
    mockGenerateRun.mockResolvedValue(generateSuccess('vn'));
    mockSwissRun.mockResolvedValue({
      success: true, result: { pairs: [], matches: [], status: 'no_pairs' },
      cost: 0, durationMs: 1, invocationId: 'inv-swiss',
    });

    const SEED_ID = 'seed-uuid-fed';
    const result = await evolveArticle('seed article text', makeProvider(), makeDb() as never, 'run-1', makeConfig(), {
      seedVariantRow: {
        id: SEED_ID,
        mu: 18.75,
        sigma: 7.15,
        arena_match_count: 5,
        muRaw: '18.75',
        sigmaRaw: '7.15',
      },
    });

    const seedEntry = result.pool.find((v) => v.id === SEED_ID);
    expect(seedEntry).toBeDefined();
    expect(seedEntry?.strategy).toBe('seed_variant');
    expect(seedEntry?.reusedFromSeed).toBe(true);
    expect(seedEntry?.fromArena).toBeFalsy(); // mutex with reusedFromSeed
    expect(seedEntry?.arenaMatchCount).toBe(5);
    // Rating reflects dbToRating(18.75, 7.15) — Elo ≈ 1200 + (18.75-25)*16 = 1100; uncertainty = 7.15*16 ≈ 114.4
    const rating = result.ratings.get(SEED_ID);
    expect(rating).toBeDefined();
    expect(rating?.elo).toBeCloseTo(1100, 0);
    expect(rating?.uncertainty).toBeCloseTo(114.4, 0);
  });

  it('with seedPrompt: seed agent runs before generate agents in iteration 1', async () => {
    mockSeedRun.mockResolvedValue(seedSuccess('seed-v1'));
    mockGenerateRun.mockResolvedValue(generateSuccess('gen-v'));
    mockSwissRun.mockResolvedValue({
      success: true, result: { pairs: [], matches: [], status: 'no_pairs' },
      cost: 0, durationMs: 1, invocationId: 'inv-swiss',
    });

    await evolveArticle('', makeProvider(), makeDb() as never, 'run-1', makeConfig(), { seedPrompt: 'Explain quantum computing' });

    expect(mockSeedRun).toHaveBeenCalledTimes(1);
    const seedInput = mockSeedRun.mock.calls[0][0] as { promptText: string };
    expect(seedInput.promptText).toBe('Explain quantum computing');
  });

  it('seed success: ONE seed_variant added to pool (no duplicate seedBaseline), isSeeded=true', async () => {
    mockSeedRun.mockResolvedValue(seedSuccess('seed-v1'));
    mockGenerateRun.mockResolvedValue(generateSuccess('gen-v'));
    mockSwissRun.mockResolvedValue({
      success: true, result: { pairs: [], matches: [], status: 'no_pairs' },
      cost: 0, durationMs: 1, invocationId: 'inv-swiss',
    });

    const result = await evolveArticle('', makeProvider(), makeDb() as never, 'run-1', makeConfig(), { seedPrompt: 'test' });

    expect(result.isSeeded).toBe(true);
    // The seed agent's output IS the single seed_variant pool entry — no duplicate
    // seedBaseline shadow row (eliminated 2026-04-14 to avoid double-counting the seed).
    const seedVariants = result.pool.filter((v) => v.strategy === 'seed_variant');
    expect(seedVariants).toHaveLength(1);
    expect(seedVariants[0]?.id).toBe('seed-v1');
    expect(seedVariants[0]?.text).toBe('seed-text-seed-v1');
  });

  it('generate agents after seed use the seed text as originalText', async () => {
    mockSeedRun.mockResolvedValue(seedSuccess('seed-v1'));
    mockGenerateRun.mockResolvedValue(generateSuccess('gen-v'));
    mockSwissRun.mockResolvedValue({
      success: true, result: { pairs: [], matches: [], status: 'no_pairs' },
      cost: 0, durationMs: 1, invocationId: 'inv-swiss',
    });

    await evolveArticle('ORIGINAL', makeProvider(), makeDb() as never, 'run-1', makeConfig(), { seedPrompt: 'test prompt' });

    const genInput = mockGenerateRun.mock.calls[0][0] as { originalText: string };
    // Should use seed text, not the empty original
    expect(genInput.originalText).toBe('seed-text-seed-v1');
  });

  it('seed agent failure (budget): stopReason=seed_failed, loop exits without generate', async () => {
    mockSeedRun.mockResolvedValue({
      success: true,
      result: { variant: null, status: 'budget', surfaced: false, matches: [] },
      cost: 0.002, durationMs: 3, invocationId: 'inv-seed',
    });

    const result = await evolveArticle('', makeProvider(), makeDb() as never, 'run-1', makeConfig(), { seedPrompt: 'test' });

    expect(result.stopReason).toBe('seed_failed');
    expect(mockGenerateRun).not.toHaveBeenCalled();
  });

  it('seed agent discarded (surfaced=false): stopReason=seed_failed', async () => {
    mockSeedRun.mockResolvedValue(seedSuccess('seed-v1', false /* surfaced=false */));

    const result = await evolveArticle('', makeProvider(), makeDb() as never, 'run-1', makeConfig(), { seedPrompt: 'test' });

    expect(result.stopReason).toBe('seed_failed');
    expect(mockGenerateRun).not.toHaveBeenCalled();
  });

  it('seed agent only runs once across iterations', async () => {
    mockSeedRun.mockResolvedValue(seedSuccess('seed-v1'));
    // Two generate iterations: iteration 1 runs seed + generate, iteration 2 just swiss/done
    mockGenerateRun
      .mockResolvedValue(generateSuccess('gen-v'));
    let swissCallCount = 0;
    mockSwissRun.mockImplementation(async () => {
      swissCallCount++;
      // First swiss: return pairs to trigger a second loop; second: no_pairs to stop
      if (swissCallCount < 2) {
        return {
          success: true,
          result: { pairs: [{ a: 'seed-v1', b: 'gen-v', matches: [] }], matches: [], status: 'completed' },
          cost: 0, durationMs: 1, invocationId: 'inv-swiss',
        };
      }
      return {
        success: true, result: { pairs: [], matches: [], status: 'no_pairs' },
        cost: 0, durationMs: 1, invocationId: 'inv-swiss',
      };
    });

    await evolveArticle('', makeProvider(), makeDb() as never, 'run-1', makeConfig(), { seedPrompt: 'test' });

    // Seed agent invoked exactly once
    expect(mockSeedRun).toHaveBeenCalledTimes(1);
  });

  it('with seedPrompt: no baseline in pool before seed agent runs', async () => {
    // The seed agent should receive an empty initialPool (or arena entries only — no baseline)
    mockSeedRun.mockResolvedValue(seedSuccess('seed-v1'));
    mockGenerateRun.mockResolvedValue(generateSuccess('gen-v'));
    mockSwissRun.mockResolvedValue({
      success: true, result: { pairs: [], matches: [], status: 'no_pairs' },
      cost: 0, durationMs: 1, invocationId: 'inv-swiss',
    });

    await evolveArticle('', makeProvider(), makeDb() as never, 'run-1', makeConfig(), { seedPrompt: 'test' });

    const seedInput = mockSeedRun.mock.calls[0][0] as { initialPool: Array<{ strategy: string }> };
    const seedVariantInSeedInput = seedInput.initialPool.filter((v) => v.strategy === 'seed_variant');
    expect(seedVariantInSeedInput).toHaveLength(0);
  });
});
