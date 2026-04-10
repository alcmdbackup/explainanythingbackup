// Tests for CreateSeedArticleAgent: LLM call order, variant creation,
// ranking integration, budget/format failures, cost isolation, surfaced/discarded paths.

import { CreateSeedArticleAgent } from './createSeedArticle';
import { createRating, type Rating, type ComparisonResult } from '../../shared/computeRatings';
import type { AgentContext } from '../types';
import type { Variant, EvolutionLLMClient } from '../../types';
import { BudgetExceededError } from '../../types';

// ─── Mocks ────────────────────────────────────────────────────────

jest.mock('../../pipeline/infra/trackInvocations', () => ({
  createInvocation: jest.fn().mockResolvedValue('inv-csa'),
  updateInvocation: jest.fn().mockResolvedValue(undefined),
}));

let mockRankSurfaced = true;
let mockRankStatus = 'converged';
let mockRankMatches: unknown[] = [];
let mockRankingCost = 0.002;

jest.mock('../../pipeline/loop/rankNewVariant', () => ({
  rankNewVariant: jest.fn(async () => ({
    rankingCost: mockRankingCost,
    rankResult: {
      status: mockRankStatus,
      matches: mockRankMatches,
      comparisonsRun: 1,
      detail: { localPoolSize: 2, stopReason: mockRankStatus, totalComparisons: 1, finalLocalMu: 25, finalLocalSigma: 8 },
    },
    surfaced: mockRankSurfaced,
    discardReason: mockRankSurfaced ? undefined : { localMu: 10, localTop15Cutoff: 30 },
  })),
}));

let mockGeneratedTitle = 'Test Article Title';
jest.mock('../../pipeline/setup/generateSeedArticle', () => ({
  generateTitle: jest.fn(async (_promptText: string, completeFn: (p: string) => Promise<string>) => {
    // Call the completion function once (to trigger cost tracking)
    await completeFn('generate title prompt');
    return mockGeneratedTitle;
  }),
}));

let mockFormatValid = true;
jest.mock('../../shared/enforceVariantFormat', () => ({
  validateFormat: jest.fn(() => ({ valid: mockFormatValid, issues: [] })),
  FORMAT_RULES: 'mock-format-rules',
}));

// ─── Helpers ──────────────────────────────────────────────────────

const mkVariant = (id: string): Variant => ({
  id, text: `text-${id}`, version: 0, parentIds: [],
  strategy: 'baseline', createdAt: 0, iterationBorn: 0,
});

function makeCtx(overrides?: Partial<AgentContext>): AgentContext {
  let totalSpent = 0;
  return {
    db: {} as never,
    runId: 'run-1',
    iteration: 1,
    executionOrder: 1,
    invocationId: 'inv-csa',
    randomSeed: BigInt(0),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    costTracker: {
      reserve: jest.fn(),
      recordSpend: jest.fn((_phase, cost) => { totalSpent += cost; }),
      release: jest.fn(),
      getTotalSpent: jest.fn(() => totalSpent),
      getPhaseCosts: jest.fn(() => ({})),
      getAvailableBudget: jest.fn(() => 10),
    } as unknown as AgentContext['costTracker'],
    config: {
      iterations: 3,
      budgetUsd: 5,
      judgeModel: 'gpt-4o',
      generationModel: 'gpt-4o',
    },
    ...overrides,
  };
}

function makeLlm(articleContent = '## Introduction\nFirst sentence. Second sentence.'): EvolutionLLMClient & { complete: jest.Mock } {
  return {
    complete: jest.fn(async (_prompt: string, label: string) => {
      if (label === 'seed_article') return articleContent;
      // seed_title is handled by the generateTitle mock
      return articleContent;
    }),
    completeStructured: jest.fn(async () => { throw new Error('not used'); }),
  } as unknown as EvolutionLLMClient & { complete: jest.Mock };
}

function makeInput(overrides?: { articleContent?: string; pool?: Variant[] }) {
  const pool = overrides?.pool ?? [mkVariant('existing')];
  return {
    promptText: 'Explain quantum computing',
    llm: makeLlm(overrides?.articleContent) as EvolutionLLMClient,
    initialPool: pool as ReadonlyArray<Variant>,
    initialRatings: new Map<string, Rating>(pool.map((v) => [v.id, createRating()])),
    initialMatchCounts: new Map<string, number>(),
    cache: new Map<string, ComparisonResult>(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockRankSurfaced = true;
  mockRankStatus = 'converged';
  mockRankMatches = [];
  mockRankingCost = 0.002;
  mockGeneratedTitle = 'Test Article Title';
  mockFormatValid = true;
});

describe('CreateSeedArticleAgent', () => {
  it('has the correct name', () => {
    expect(new CreateSeedArticleAgent().name).toBe('create_seed_article');
  });

  it('calls generateTitle (seed_title), then article LLM (seed_article) in order', async () => {
    const { generateTitle: mockGenTitle } = jest.requireMock('../../pipeline/setup/generateSeedArticle') as { generateTitle: jest.Mock };
    const input = makeInput();
    const llmComplete = input.llm.complete as jest.Mock;

    const agent = new CreateSeedArticleAgent();
    await agent.run(input, makeCtx());

    // generateTitle mock calls completeFn once for 'seed_title' label
    expect(mockGenTitle).toHaveBeenCalledTimes(1);
    // article body called with 'seed_article' label
    expect(llmComplete).toHaveBeenCalledWith(
      expect.stringContaining('Test Article Title'),
      'seed_article',
      expect.any(Object),
    );
  });

  it('creates variant with strategy seed_article', async () => {
    const agent = new CreateSeedArticleAgent();
    const result = await agent.run(makeInput(), makeCtx());
    expect(result.success).toBe(true);
    expect(result.result?.variant?.strategy).toBe('seed_article');
  });

  it('calls rankNewVariant with initial pool deep-cloned (does not mutate input)', async () => {
    const { rankNewVariant: mockRank } = jest.requireMock('../../pipeline/loop/rankNewVariant') as { rankNewVariant: jest.Mock };
    const input = makeInput();
    const poolSizeBefore = input.initialPool.length;

    const agent = new CreateSeedArticleAgent();
    await agent.run(input, makeCtx());

    // rankNewVariant was called
    expect(mockRank).toHaveBeenCalledTimes(1);
    // input pool is not mutated
    expect(input.initialPool.length).toBe(poolSizeBefore);
    expect(input.initialRatings.size).toBe(poolSizeBefore);
  });

  it('returns status=budget and no variant when title LLM throws BudgetExceededError', async () => {
    const { generateTitle: mockGenTitle } = jest.requireMock('../../pipeline/setup/generateSeedArticle') as { generateTitle: jest.Mock };
    mockGenTitle.mockRejectedValueOnce(new BudgetExceededError('generation', 1, 0, 1));

    const agent = new CreateSeedArticleAgent();
    const result = await agent.run(makeInput(), makeCtx());

    expect(result.success).toBe(true);
    expect(result.result?.status).toBe('budget');
    expect(result.result?.variant).toBeNull();
    expect(result.result?.surfaced).toBe(false);
  });

  it('returns status=budget and no variant when article LLM throws BudgetExceededError', async () => {
    const input = makeInput();
    (input.llm.complete as jest.Mock).mockImplementation(async (_p: string, label: string) => {
      if (label === 'seed_article') throw new BudgetExceededError('generation', 1, 0, 1);
      return 'fallback';
    });

    const agent = new CreateSeedArticleAgent();
    const result = await agent.run(input, makeCtx());

    expect(result.success).toBe(true);
    expect(result.result?.status).toBe('budget');
    expect(result.result?.variant).toBeNull();
  });

  it('returns status=generation_failed when format validation fails', async () => {
    mockFormatValid = false;

    const agent = new CreateSeedArticleAgent();
    const result = await agent.run(makeInput(), makeCtx());

    expect(result.success).toBe(true);
    expect(result.result?.status).toBe('generation_failed');
    expect(result.result?.variant).toBeNull();
  });

  it('surfaces variant when rankNewVariant returns surfaced=true', async () => {
    mockRankSurfaced = true;
    mockRankStatus = 'converged';
    const fakeMatch = { winnerId: 'new', loserId: 'existing', confidence: 1, turns: 2, matchType: 'ranking' as const };
    mockRankMatches = [fakeMatch];

    const agent = new CreateSeedArticleAgent();
    const result = await agent.run(makeInput(), makeCtx());

    expect(result.success).toBe(true);
    expect(result.result?.surfaced).toBe(true);
    expect(result.result?.matches).toHaveLength(1);
    expect(result.result?.variant).not.toBeNull();
  });

  it('discards variant when rankNewVariant returns surfaced=false; matches is empty array', async () => {
    mockRankSurfaced = false;
    mockRankStatus = 'budget';

    const agent = new CreateSeedArticleAgent();
    const result = await agent.run(makeInput(), makeCtx());

    expect(result.success).toBe(true);
    expect(result.result?.surfaced).toBe(false);
    expect(result.result?.matches).toEqual([]);
    expect(result.result?.discardReason).toBeDefined();
  });

  it('execution detail captures generation cost and ranking cost independently', async () => {
    // Execute directly (bypassing Agent.run wrapper) to access execution detail.
    mockRankingCost = 0.007;

    let spentSoFar = 0;
    const ctx = makeCtx();
    // Simulate generation cost: make getTotalSpent return 0.003 after title+article calls
    const origRecordSpend = ctx.costTracker.recordSpend as jest.Mock;
    origRecordSpend.mockImplementation((_phase: string, cost: number) => { spentSoFar += cost; });
    (ctx.costTracker.getTotalSpent as jest.Mock).mockImplementation(() => spentSoFar);

    // Call the underlying LLM to simulate cost before rank
    const agent = new CreateSeedArticleAgent();
    const input = makeInput();
    // Simulate LLM spending 0.003 total during generation
    (input.llm.complete as jest.Mock).mockImplementation(async (_p: string, label: string) => {
      if (label === 'seed_article') {
        origRecordSpend('generation', 0.003);
        return '## Introduction\nFirst sentence. Second sentence.';
      }
      return '';
    });

    const output = await agent.execute(input, ctx);
    expect(output.detail.generation.cost).toBeCloseTo(0.003, 3);
    expect(output.detail.ranking?.cost).toBeCloseTo(0.007, 3);
    expect(output.detail.totalCost).toBeCloseTo(0.01, 3);
  });
});
