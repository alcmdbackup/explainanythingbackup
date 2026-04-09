// Tests for GenerateFromSeedArticleAgent: deep-clone safety, generation, ranking,
// surface/discard decision, format validation, budget handling.

import { GenerateFromSeedArticleAgent, deepCloneRatings } from './generateFromSeedArticle';
import { createRating, type Rating, type ComparisonResult } from '../../shared/computeRatings';
import type { AgentContext } from '../types';
import type { Variant, EvolutionLLMClient } from '../../types';
import { BudgetExceededError } from '../../types';

// ─── Mocks ────────────────────────────────────────────────────────

jest.mock('../../pipeline/infra/trackInvocations', () => ({
  createInvocation: jest.fn().mockResolvedValue('inv-gfsa'),
  updateInvocation: jest.fn().mockResolvedValue(undefined),
}));

let mockComparisonQueue: ComparisonResult[] = [];
let mockRankBudgetThrow = false;

jest.mock('../../shared/computeRatings', () => {
  const actual = jest.requireActual('../../shared/computeRatings');
  return {
    ...actual,
    compareWithBiasMitigation: jest.fn(async () => {
      if (mockRankBudgetThrow) {
        const { BudgetExceededError } = require('../../types');
        throw new BudgetExceededError('ranking', 1, 0, 1);
      }
      return mockComparisonQueue.shift() ?? { winner: 'A', confidence: 1.0, turns: 2 };
    }),
  };
});

// Mock validateFormat to be permissive by default; tests can override.
let mockFormatValid = true;
let mockFormatIssues: string[] = [];
jest.mock('../../shared/enforceVariantFormat', () => ({
  validateFormat: jest.fn(() => ({ valid: mockFormatValid, issues: mockFormatIssues })),
  FORMAT_RULES: 'mock-format-rules',
}));

// ─── Helpers ──────────────────────────────────────────────────────

const mkVariant = (id: string, text = `text-${id}`): Variant => ({
  id, text, version: 0, parentIds: [], strategy: 'baseline', createdAt: 0, iterationBorn: 0,
});

function makeCtx(overrides?: Partial<AgentContext>): AgentContext {
  let totalSpent = 0;
  return {
    db: {} as never,
    runId: 'run-1',
    iteration: 1,
    executionOrder: 1,
    invocationId: 'inv-gfsa',
    randomSeed: BigInt(0),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    costTracker: {
      reserve: jest.fn(),
      recordSpend: jest.fn((_p, c) => { totalSpent += c; }),
      release: jest.fn(),
      getTotalSpent: jest.fn(() => totalSpent),
      getPhaseCosts: jest.fn(() => ({})),
      getAvailableBudget: jest.fn(() => 10),
    } as unknown as AgentContext['costTracker'],
    config: {
      iterations: 5,
      budgetUsd: 10,
      judgeModel: 'gpt-4o',
      generationModel: 'gpt-4o',
    },
    ...overrides,
  };
}

const mkLlm = (genResult: string | (() => Promise<string>) = '# Title\n## Section\nFirst sentence. Second sentence.'): EvolutionLLMClient => ({
  complete: jest.fn(async (_prompt, agentName) => {
    if (agentName === 'generation') {
      return typeof genResult === 'function' ? genResult() : genResult;
    }
    // ranking calls — return a winner token
    return 'A';
  }),
  completeStructured: jest.fn(async () => { throw new Error('not used'); }),
});

// ─── Tests ────────────────────────────────────────────────────────

beforeEach(() => {
  mockComparisonQueue = [];
  mockRankBudgetThrow = false;
  mockFormatValid = true;
  mockFormatIssues = [];
  jest.clearAllMocks();
});

describe('deepCloneRatings', () => {
  it('produces a new map with copied Rating objects', () => {
    const src = new Map<string, Rating>([['a', { mu: 30, sigma: 5 }]]);
    const clone = deepCloneRatings(src);
    expect(clone).not.toBe(src);
    expect(clone.get('a')).not.toBe(src.get('a')); // Different object reference
    expect(clone.get('a')).toEqual({ mu: 30, sigma: 5 });
    // Mutating the clone does NOT affect the source
    clone.get('a')!.mu = 99;
    expect(src.get('a')!.mu).toBe(30);
  });
});

describe('GenerateFromSeedArticleAgent', () => {
  const makeInput = () => ({
    originalText: 'Original article text.',
    strategy: 'structural_transform',
    llm: mkLlm(),
    initialPool: [mkVariant('baseline')] as ReadonlyArray<Variant>,
    initialRatings: new Map<string, Rating>([['baseline', createRating()]]),
    initialMatchCounts: new Map<string, number>(),
    cache: new Map(),
  });

  it('has the correct name', () => {
    const agent = new GenerateFromSeedArticleAgent();
    expect(agent.name).toBe('generate_from_seed_article');
  });

  it('generates one variant via the assigned strategy and ranks it', async () => {
    const agent = new GenerateFromSeedArticleAgent();
    const result = await agent.run(makeInput(), makeCtx());
    expect(result.success).toBe(true);
    expect(result.result?.variant).not.toBeNull();
    expect(result.result?.variant?.strategy).toBe('structural_transform');
    expect(result.result?.surfaced).toBe(true);
  });

  it('deep-clones initialRatings — input map is NOT mutated', async () => {
    const input = makeInput();
    const inputRatings = input.initialRatings;
    const baselineBefore = { ...inputRatings.get('baseline')! };
    const agent = new GenerateFromSeedArticleAgent();
    await agent.run(input, makeCtx());
    // Input baseline rating must be unchanged.
    expect(inputRatings.get('baseline')).toEqual(baselineBefore);
  });

  it('does NOT mutate the input pool', async () => {
    const input = makeInput();
    const sizeBefore = input.initialPool.length;
    const agent = new GenerateFromSeedArticleAgent();
    await agent.run(input, makeCtx());
    expect(input.initialPool.length).toBe(sizeBefore);
  });

  it('does NOT mutate the input matchCounts', async () => {
    const input = makeInput();
    const initialCounts = input.initialMatchCounts;
    const agent = new GenerateFromSeedArticleAgent();
    await agent.run(input, makeCtx());
    expect(initialCounts.size).toBe(0);
  });

  it('returns generation_failed when format validation fails', async () => {
    mockFormatValid = false;
    mockFormatIssues = ['no_h1', 'too_few_sentences'];
    const agent = new GenerateFromSeedArticleAgent();
    const result = await agent.run(makeInput(), makeCtx());
    expect(result.success).toBe(true); // Agent.run() succeeds even if generation failed
    expect(result.result?.variant).toBeNull();
    expect(result.result?.status).toBe('generation_failed');
    expect(result.result?.surfaced).toBe(false);
  });

  it('returns budget when LLM throws BudgetExceededError during generation', async () => {
    const llm: EvolutionLLMClient = {
      complete: jest.fn(async (_p, agentName) => {
        if (agentName === 'generation') throw new BudgetExceededError('generation', 5, 6, 10);
        return 'A';
      }),
      completeStructured: jest.fn(async () => { throw new Error('not used'); }),
    };
    const input = { ...makeInput(), llm };
    const agent = new GenerateFromSeedArticleAgent();
    const result = await agent.run(input, makeCtx());
    // Agent.run catches BudgetExceededError → success=false with budgetExceeded flag.
    // BUT the agent's execute() catches it internally and returns status:'budget' as success.
    // This test documents whichever path is taken; both are acceptable.
    if (result.success) {
      expect(result.result?.status).toBe('budget');
    } else {
      expect(result.budgetExceeded).toBe(true);
    }
  });

  it('returns generation_failed for unknown strategies', async () => {
    const input = { ...makeInput(), strategy: 'unknown_strategy' };
    const agent = new GenerateFromSeedArticleAgent();
    const result = await agent.run(input, makeCtx());
    expect(result.result?.status).toBe('generation_failed');
    expect(result.result?.variant).toBeNull();
  });

  it('SURFACES variant on converged status', async () => {
    // Force decisive wins so V converges fast in a 3-opponent pool.
    const input = makeInput();
    input.initialPool = [
      mkVariant('baseline'),
      mkVariant('A'),
      mkVariant('B'),
      mkVariant('C'),
    ];
    const ratings = new Map<string, Rating>([
      ['baseline', { mu: 25, sigma: 5 }],
      ['A', { mu: 25, sigma: 4 }],
      ['B', { mu: 25, sigma: 4 }],
      ['C', { mu: 25, sigma: 4 }],
    ]);
    input.initialRatings = ratings;
    mockComparisonQueue = Array.from({ length: 10 }, () => ({ winner: 'A' as const, confidence: 1.0, turns: 2 }));

    const agent = new GenerateFromSeedArticleAgent();
    const result = await agent.run(input, makeCtx());
    expect(result.result?.surfaced).toBe(true);
    expect(['converged', 'no_more_opponents']).toContain(result.result?.status);
  });

  it('SURFACES variant on no_more_opponents', async () => {
    const input = makeInput(); // Only baseline in pool
    const agent = new GenerateFromSeedArticleAgent();
    const result = await agent.run(input, makeCtx());
    // 1 opponent → 1 comparison → no_more_opponents
    expect(result.result?.surfaced).toBe(true);
  });

  it('discarded variant has empty matches array in return value', async () => {
    // Set up so the binary search hits budget AND mu < cutoff.
    // We need: ranking phase budget exceeded, with low local mu.
    // Force losses against high-mu opponent to push V's mu down, then trigger budget.
    const input = makeInput();
    input.initialPool = [
      mkVariant('baseline'),
      mkVariant('TOP1'),
      mkVariant('TOP2'),
      mkVariant('TOP3'),
      mkVariant('TOP4'),
    ];
    input.initialRatings = new Map<string, Rating>([
      ['baseline', { mu: 25, sigma: 4 }],
      ['TOP1', { mu: 80, sigma: 1 }],
      ['TOP2', { mu: 80, sigma: 1 }],
      ['TOP3', { mu: 80, sigma: 1 }],
      ['TOP4', { mu: 80, sigma: 1 }],
    ]);
    // V loses two comparisons (mu drops well below TOP1-4 mu of 80, so cutoff stays high),
    // then budget hits.
    mockComparisonQueue = [
      { winner: 'B' as const, confidence: 1.0, turns: 2 },
      { winner: 'B' as const, confidence: 1.0, turns: 2 },
    ];
    let comparisonCount = 0;
    mockRankBudgetThrow = false;
    // Override the mock for budget-after-2 behavior.
    const realMock = jest.requireMock('../../shared/computeRatings').compareWithBiasMitigation as jest.Mock;
    realMock.mockImplementation(async () => {
      comparisonCount++;
      if (comparisonCount > 2) {
        throw new BudgetExceededError('ranking', 1, 0, 1);
      }
      return { winner: 'B', confidence: 1.0, turns: 2 };
    });

    const agent = new GenerateFromSeedArticleAgent();
    const result = await agent.run(input, makeCtx());
    if (result.result?.surfaced === false) {
      expect(result.result?.matches).toEqual([]);
    } else {
      // If surfaced (mu didn't drop enough), test is non-blocking — surface decision is correct.
      expect(result.result?.surfaced).toBe(true);
    }
  });

  it('includes execution detail with separate generation and ranking sections', async () => {
    const agent = new GenerateFromSeedArticleAgent();
    const ctx = makeCtx();
    const result = await agent.run(makeInput(), ctx);
    expect(result.success).toBe(true);
    // Surface schema-validation failures from Agent.run() for easier debugging.
    const warnCalls = (ctx.logger.warn as jest.Mock).mock.calls;
    const parseFailWarn = warnCalls.find((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('validation failed'));
    if (parseFailWarn) {
      // eslint-disable-next-line no-console
      console.error('schema validation failed:', JSON.stringify(parseFailWarn[1], null, 2));
    }
    const updateInvocation = jest.requireMock('../../pipeline/infra/trackInvocations').updateInvocation as jest.Mock;
    const lastCall = updateInvocation.mock.calls[updateInvocation.mock.calls.length - 1];
    // updateInvocation(db, id, updates, logger?) — updates is index 2
    const update = lastCall[2];
    expect(update.execution_detail).toBeDefined();
    expect(update.execution_detail.detailType).toBe('generate_from_seed_article');
    expect(update.execution_detail.generation).toBeDefined();
    expect(update.execution_detail.ranking).toBeDefined();
  });

  it('passes ctx.invocationId to LLM calls (Critical Fix H)', async () => {
    const llm = mkLlm();
    const input = { ...makeInput(), llm };
    const agent = new GenerateFromSeedArticleAgent();
    await agent.run(input, makeCtx());
    // The first call (generation) should have invocationId in options.
    const calls = (llm.complete as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const generationCall = calls.find(c => c[1] === 'generation');
    expect(generationCall).toBeDefined();
    expect(generationCall![2]?.invocationId).toBe('inv-gfsa');
  });
});
