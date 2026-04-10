// Integration test for seed cost tracking and seed reuse across runs.
// Exercises the full buildRunContext → evolveArticle chain with a mocked DB and LLM,
// verifying: (1) first run creates seed via CreateSeedArticleAgent, (2) second run
// reuses arena seed without invoking the agent, (3) explanation-based runs are unaffected.

import { buildRunContext, type ClaimedRun } from '../setup/buildRunContext';
import { evolveArticle } from './runIterationLoop';
import type { EvolutionConfig } from '../infra/types';

// ─── Agent mocks ──────────────────────────────────────────────────

const mockSeedRun = jest.fn();
const mockGenerateRun = jest.fn();
const mockSwissRun = jest.fn();
const mockMergeRun = jest.fn();

jest.mock('../../core/agents/createSeedArticle', () => ({
  CreateSeedArticleAgent: jest.fn().mockImplementation(() => ({
    name: 'create_seed_article',
    run: (input: unknown, ctx: unknown) => mockSeedRun(input, ctx),
  })),
}));

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

jest.mock('../infra/createLLMClient', () => ({
  createV2LLMClient: jest.fn().mockReturnValue({
    complete: jest.fn(),
    completeStructured: jest.fn(),
  }),
}));

jest.mock('../infra/trackBudget', () => ({
  createCostTracker: jest.fn(() => ({
    reserve: jest.fn(),
    recordSpend: jest.fn(),
    release: jest.fn(),
    getTotalSpent: jest.fn(() => 0),
    getPhaseCosts: jest.fn(() => ({})),
    getAvailableBudget: jest.fn(() => 10),
  })),
}));

// ─── Helpers ──────────────────────────────────────────────────────

const STRATEGY_CONFIG = { generationModel: 'gpt-4o', judgeModel: 'gpt-4o', iterations: 1 };
const PROMPT_TEXT = 'Explain neural networks in simple terms';
const SEED_CONTENT = '# Neural Networks\n\n## Introduction\nA neural network is...';

function makeRun(opts: { explanationId?: number; promptId?: string }): ClaimedRun {
  return {
    id: 'run-1',
    explanation_id: opts.explanationId ?? null,
    prompt_id: opts.promptId ?? null,
    experiment_id: null,
    strategy_id: 'strat-1',
    budget_cap_usd: 2.0,
  };
}

/**
 * Build a mock DB for buildRunContext.
 * hasSeedInArena: whether evolution_variants has a seed entry.
 */
function makeDb(opts: { hasSeedInArena?: boolean; explanationContent?: string; promptText?: string } = {}) {
  return {
    from: jest.fn((table: string) => {
      const chain: Record<string, jest.Mock> = {} as Record<string, jest.Mock>;
      chain.select = jest.fn(() => chain);
      chain.eq = jest.fn(() => chain);
      chain.insert = jest.fn(() => ({
        select: jest.fn(() => ({ single: jest.fn(async () => ({ data: { id: 'log-1' }, error: null })) })),
      }));
      chain.update = jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: null })),
      }));

      // .is() → thenable-chain for seed query; awaitable for loadArenaEntries
      chain.is = jest.fn(() => {
        const t: Record<string, unknown> = {};
        t.order = jest.fn(() => t);
        t.limit = jest.fn(() => t);
        t.single = jest.fn(async () => ({
          data: opts.hasSeedInArena ? { variant_content: SEED_CONTENT } : null,
          error: null,
        }));
        t.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return t;
      });

      chain.single = jest.fn(async () => {
        if (table === 'evolution_strategies') return { data: { config: STRATEGY_CONFIG }, error: null };
        if (table === 'evolution_prompts') return { data: { prompt: opts.promptText ?? PROMPT_TEXT }, error: null };
        if (table === 'explanations') return { data: { content: opts.explanationContent ?? null }, error: opts.explanationContent ? null : { message: 'not found' } };
        if (table === 'evolution_runs') return { data: { random_seed: '42' }, error: null };
        return { data: null, error: null };
      });

      return chain;
    }),
  } as never;
}

function makeProvider() {
  return { complete: jest.fn(async () => 'irrelevant') };
}

function makeConfig(): EvolutionConfig {
  return { budgetUsd: 2.0, judgeModel: 'gpt-4o', generationModel: 'gpt-4o', iterations: 1, numVariants: 1 };
}

function makeLoopDb() {
  const single = jest.fn().mockResolvedValue({ data: { status: 'running' }, error: null });
  return { from: jest.fn(() => ({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single })) };
}

function seedSuccess(text: string) {
  return {
    success: true,
    result: { variant: { id: 'seed-v', text, version: 0, parentIds: [], strategy: 'seed_article', createdAt: 0, iterationBorn: 1 }, status: 'converged', surfaced: true, matches: [] },
    cost: 0.01, durationMs: 5, invocationId: 'inv-seed',
  };
}

function generateSuccess() {
  return {
    success: true,
    result: { variant: { id: 'gen-v', text: '# Gen', version: 0, parentIds: [], strategy: 'structural_transform', createdAt: 0, iterationBorn: 1 }, status: 'converged', surfaced: true, matches: [] },
    cost: 0.01, durationMs: 5, invocationId: 'inv-gen',
  };
}

// ─── Tests ────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockMergeRun.mockImplementation(async (input: { pool: unknown[]; ratings: Map<string, unknown>; newVariants: Array<{ id: string }> }) => {
    for (const v of input.newVariants) {
      input.pool.push(v);
      if (!input.ratings.has(v.id)) input.ratings.set(v.id, { mu: 25, sigma: 8.333 });
    }
    return { success: true, result: { matchesApplied: 0, arenaRowsWritten: 0 }, cost: 0, durationMs: 1, invocationId: 'inv-merge' };
  });
  mockSwissRun.mockResolvedValue({ success: true, result: { pairs: [], matches: [], status: 'no_pairs' }, cost: 0, durationMs: 1, invocationId: 'inv-swiss' });
  mockGenerateRun.mockResolvedValue(generateSuccess());
});

describe('seed cost integration — buildRunContext seed query', () => {
  it('no seed in arena: context has seedPrompt, no originalText', async () => {
    const db = makeDb({ hasSeedInArena: false });
    const result = await buildRunContext('run-1', makeRun({ promptId: 'prompt-abc' }), db, makeProvider());

    expect('context' in result).toBe(true);
    if ('context' in result) {
      expect(result.context.originalText).toBeNull();
      expect(result.context.seedPrompt).toBe(PROMPT_TEXT);
    }
  });

  it('seed exists in arena: context has originalText from seed, no seedPrompt', async () => {
    const db = makeDb({ hasSeedInArena: true });
    const result = await buildRunContext('run-1', makeRun({ promptId: 'prompt-abc' }), db, makeProvider());

    expect('context' in result).toBe(true);
    if ('context' in result) {
      expect(result.context.originalText).toBe(SEED_CONTENT);
      expect(result.context.seedPrompt).toBeUndefined();
    }
  });

  it('explanation-based run: returns originalText, no seedPrompt ever set', async () => {
    const db = makeDb({ explanationContent: '# Article\n\n## Intro\nContent here.' });
    const result = await buildRunContext('run-1', makeRun({ explanationId: 42 }), db, makeProvider());

    expect('context' in result).toBe(true);
    if ('context' in result) {
      expect(result.context.originalText).toBeTruthy();
      expect(result.context.seedPrompt).toBeUndefined();
    }
  });
});

describe('seed cost integration — evolveArticle seed agent flow', () => {
  it('first run (no arena seed): CreateSeedArticleAgent runs, isSeeded=true', async () => {
    mockSeedRun.mockResolvedValue(seedSuccess('seed article text'));

    const result = await evolveArticle(
      '',
      makeProvider(),
      makeLoopDb() as never,
      'run-1',
      makeConfig(),
      { seedPrompt: PROMPT_TEXT },
    );

    expect(mockSeedRun).toHaveBeenCalledTimes(1);
    const seedInput = mockSeedRun.mock.calls[0][0] as { promptText: string };
    expect(seedInput.promptText).toBe(PROMPT_TEXT);
    expect(result.isSeeded).toBe(true);
  });

  it('second run (arena seed exists): seedPrompt absent, seed agent never called', async () => {
    // When buildRunContext finds an arena seed, it returns originalText (no seedPrompt).
    // evolveArticle receives originalText directly and never invokes the seed agent.
    const result = await evolveArticle(
      SEED_CONTENT,   // originalText provided → no seedPrompt
      makeProvider(),
      makeLoopDb() as never,
      'run-1',
      makeConfig(),
      { /* seedPrompt absent */ },
    );

    expect(mockSeedRun).not.toHaveBeenCalled();
    // Baseline should be created from seed content
    const baseline = result.pool.find((v) => v.strategy === 'baseline');
    expect(baseline?.text).toBe(SEED_CONTENT);
    expect(result.isSeeded).toBeFalsy();
  });

  it('explanation-based run: no seed agent, no seedPrompt, baseline from explanation content', async () => {
    const explanationContent = '# Article\n\n## Intro\nThis explains the topic.';
    const result = await evolveArticle(
      explanationContent,
      makeProvider(),
      makeLoopDb() as never,
      'run-1',
      makeConfig(),
      { /* no seedPrompt */ },
    );

    expect(mockSeedRun).not.toHaveBeenCalled();
    const baseline = result.pool.find((v) => v.strategy === 'baseline');
    expect(baseline?.text).toBe(explanationContent);
    expect(result.isSeeded).toBeFalsy();
  });

  it('concurrent runs both create seeds independently when no arena seed exists', async () => {
    let callCount = 0;
    mockSeedRun.mockImplementation(async () => {
      callCount++;
      return seedSuccess(`seed text for run ${callCount}`);
    });

    // Two concurrent evolveArticle calls, each with seedPrompt set
    const [resultA, resultB] = await Promise.all([
      evolveArticle('', makeProvider(), makeLoopDb() as never, 'run-A', makeConfig(), { seedPrompt: PROMPT_TEXT }),
      evolveArticle('', makeProvider(), makeLoopDb() as never, 'run-B', makeConfig(), { seedPrompt: PROMPT_TEXT }),
    ]);

    // Both should have called the seed agent independently
    expect(mockSeedRun).toHaveBeenCalledTimes(2);
    expect(resultA.isSeeded).toBe(true);
    expect(resultB.isSeeded).toBe(true);
  });
});
