// Invariant tests for ReflectAndGenerateFromPreviousArticleAgent that require
// mocking the inner GenerateFromPreviousArticleAgent. Kept in a separate file
// so the broad jest.mock at the top doesn't perturb the example-based tests
// in reflectAndGenerateFromPreviousArticle.test.ts.

import {
  ReflectAndGenerateFromPreviousArticleAgent,
  type ReflectAndGenerateInput,
  type TacticCandidate,
} from './reflectAndGenerateFromPreviousArticle';
import type { AgentContext } from '../types';
import type { Variant, EvolutionLLMClient } from '../../types';
import { BudgetExceededError } from '../../types';
import type { Rating } from '../../shared/computeRatings';
import { createRating } from '../../shared/computeRatings';

// Mock trackInvocations so wrapper's pre-throw partial-detail writes don't error.
jest.mock('../../pipeline/infra/trackInvocations', () => ({
  createInvocation: jest.fn().mockResolvedValue('inv-invariants'),
  updateInvocation: jest.fn().mockResolvedValue(undefined),
}));

// Mock the inner GFPA module so we can return a controlled cost stack and verify
// the wrapper's totalCost recompute invariant. We replace the class with a stub
// whose execute() returns a fixed AgentOutput.
const innerGfpaExecuteSpy = jest.fn();
jest.mock('./generateFromPreviousArticle', () => {
  return {
    GenerateFromPreviousArticleAgent: jest.fn().mockImplementation(() => ({
      execute: innerGfpaExecuteSpy,
    })),
  };
});

// Side-effect import in the real module registers an attribution extractor; the mock
// above bypasses that, but the metrics aggregator only runs in production paths.

const RUN_ID = '00000000-0000-4000-8000-000000000001';
const INV_ID = '00000000-0000-4000-8000-000000000002';
const PARENT_ID = '00000000-0000-4000-8000-000000000003';

const SAMPLE_CANDIDATES: TacticCandidate[] = [
  { name: 'structural_transform', label: 'Structural Transform', summary: 'X' },
  { name: 'lexical_simplify', label: 'Lexical Simplify', summary: 'Y' },
  { name: 'grounding_enhance', label: 'Grounding Enhance', summary: 'Z' },
];

const HAPPY_REFLECTION = `1. Tactic: lexical_simplify
   Reasoning: Vocabulary is dense.

2. Tactic: structural_transform
   Reasoning: Sections feel out of order.

3. Tactic: grounding_enhance
   Reasoning: Needs more examples.`;

function makeMockLlm(responseFn: () => string | Promise<string>): EvolutionLLMClient {
  return {
    complete: jest.fn(async (_prompt: string, _label: string) => responseFn()),
  } as unknown as EvolutionLLMClient;
}

/**
 * Build a context with a working in-memory cost tracker. ownSpent advances each
 * time the test calls `addSpend(amount)` so the wrapper sees realistic deltas
 * across the reflection LLM call vs the inner GFPA call.
 */
function makeCtx() {
  let ownSpent = 0;
  const addSpend = (amount: number) => { ownSpent += amount; };
  const ctx: AgentContext = {
    db: { from: jest.fn() } as never,
    runId: RUN_ID,
    iteration: 1,
    executionOrder: 1,
    invocationId: INV_ID,
    randomSeed: BigInt(42),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    costTracker: {
      reserve: jest.fn(() => 0.001),
      recordSpend: jest.fn(),
      release: jest.fn(),
      getTotalSpent: jest.fn(() => ownSpent),
      getOwnSpent: jest.fn(() => ownSpent),
      getPhaseCosts: jest.fn(() => ({})),
      getAvailableBudget: jest.fn(() => 10 - ownSpent),
    } as unknown as AgentContext['costTracker'],
    config: {
      iterationConfigs: [{ agentType: 'reflect_and_generate', budgetPercent: 100 }],
      budgetUsd: 10,
      judgeModel: 'gpt-4.1-nano',
      generationModel: 'gpt-4.1-nano',
      maxComparisonsPerVariant: 5,
    } as never,
  };
  return { ctx, addSpend, getOwnSpent: () => ownSpent };
}

function baseInput(llm: EvolutionLLMClient): ReflectAndGenerateInput {
  return {
    parentText: '# Sample Article\n\nThe quick brown fox jumps over the lazy dog.',
    parentVariantId: PARENT_ID,
    tacticCandidates: SAMPLE_CANDIDATES,
    tacticEloBoosts: new Map([['structural_transform', 50], ['lexical_simplify', null]]),
    reflectionTopN: 3,
    llm,
    initialPool: [] as Variant[],
    initialRatings: new Map<string, Rating>([['baseline', createRating()]]),
    initialMatchCounts: new Map<string, number>(),
    cache: new Map(),
  };
}

describe('ReflectAndGenerateFromPreviousArticleAgent — cost-attribution invariants', () => {
  beforeEach(() => {
    innerGfpaExecuteSpy.mockReset();
  });

  it('totalCost === reflectionCost + gfpaDetail.totalCost (load-bearing recompute)', async () => {
    // The reflection LLM advances ownSpent by 0.001; the inner GFPA advances by 0.005.
    // After both calls complete, the wrapper must recompute merged.totalCost = 0.001 + 0.005.
    // Direct GFPA totalCost = generation+ranking only; without the wrapper's recompute,
    // the merged detail would under-count by reflectionCost.
    const { ctx, addSpend } = makeCtx();
    const llm = makeMockLlm(() => {
      addSpend(0.001); // simulate reflection LLM cost
      return HAPPY_REFLECTION;
    });

    innerGfpaExecuteSpy.mockImplementation(async () => {
      addSpend(0.005); // simulate inner GFPA total cost
      return {
        result: { variants: [{ id: 'v1', tactic: 'lexical_simplify' } as unknown as Variant], surfaced: true },
        detail: {
          detailType: 'generate_from_previous_article',
          variantId: 'v1',
          tactic: 'lexical_simplify',
          generation: { cost: 0.003, durationMs: 100, model: 'gpt-4.1-nano' },
          ranking: { cost: 0.002, durationMs: 200, comparisons: [] },
          totalCost: 0.005,
          estimatedTotalCost: 0.005,
          estimationErrorPct: 0,
          surfaced: true,
        } as unknown as Record<string, unknown>,
        childVariantIds: ['v1'],
      };
    });

    const agent = new ReflectAndGenerateFromPreviousArticleAgent();
    const out = await agent.execute(baseInput(llm), ctx);

    const detail = out.detail;
    const reflectionCost = detail.reflection?.cost ?? NaN;
    const totalCost = detail.totalCost ?? NaN;
    // Invariant: merged totalCost = reflection + gfpa.totalCost
    expect(totalCost).toBeCloseTo(0.001 + 0.005, 9);
    // Reflection sub-detail records the reflection cost in isolation.
    expect(reflectionCost).toBeCloseTo(0.001, 9);
    // GFPA sub-detail's total is preserved (gen + rank, no reflection).
    expect(totalCost - reflectionCost).toBeCloseTo(0.005, 9);
  });

  it('totalCost matches getOwnSpent: invocation row cost_usd will be in sync with detail', async () => {
    // Agent.run() writes invocation.cost_usd = costTracker.getOwnSpent(). The detail's
    // totalCost must equal getOwnSpent() at end-of-execute, otherwise the invocation
    // page shows a number that disagrees with the cost-stack breakdown.
    const { ctx, addSpend, getOwnSpent } = makeCtx();
    const llm = makeMockLlm(() => {
      addSpend(0.0008);
      return HAPPY_REFLECTION;
    });
    innerGfpaExecuteSpy.mockImplementation(async () => {
      addSpend(0.0042);
      return {
        result: { variants: [{ id: 'v1', tactic: 'lexical_simplify' } as unknown as Variant], surfaced: true },
        detail: {
          detailType: 'generate_from_previous_article',
          variantId: 'v1',
          tactic: 'lexical_simplify',
          generation: { cost: 0.0025, durationMs: 100, model: 'gpt-4.1-nano' },
          ranking: { cost: 0.0017, durationMs: 200, comparisons: [] },
          totalCost: 0.0042,
          estimatedTotalCost: 0.0042,
          estimationErrorPct: 0,
          surfaced: true,
        } as unknown as Record<string, unknown>,
        childVariantIds: ['v1'],
      };
    });

    const agent = new ReflectAndGenerateFromPreviousArticleAgent();
    const out = await agent.execute(baseInput(llm), makeCtx().ctx);

    // Re-run with the original ctx so we can check getOwnSpent at the end:
    const { ctx: ctx2, addSpend: addSpend2, getOwnSpent: getOwnSpent2 } = makeCtx();
    const llm2 = makeMockLlm(() => { addSpend2(0.0008); return HAPPY_REFLECTION; });
    innerGfpaExecuteSpy.mockImplementation(async () => {
      addSpend2(0.0042);
      return {
        result: { variants: [{ id: 'v2', tactic: 'lexical_simplify' } as unknown as Variant], surfaced: true },
        detail: {
          detailType: 'generate_from_previous_article',
          variantId: 'v2',
          tactic: 'lexical_simplify',
          generation: { cost: 0.0025, durationMs: 100, model: 'gpt-4.1-nano' },
          ranking: { cost: 0.0017, durationMs: 200, comparisons: [] },
          totalCost: 0.0042,
          estimatedTotalCost: 0.0042,
          estimationErrorPct: 0,
          surfaced: true,
        } as unknown as Record<string, unknown>,
        childVariantIds: ['v2'],
      };
    });
    const out2 = await agent.execute(baseInput(llm2), ctx2);

    expect(out2.detail.totalCost).toBeCloseTo(getOwnSpent2(), 9);
    // Sanity check on first invocation too (no leak).
    expect(out.detail.totalCost).toBeGreaterThan(0);
  });
});

describe('ReflectAndGenerateFromPreviousArticleAgent — reservation no-leak on failure', () => {
  beforeEach(() => {
    innerGfpaExecuteSpy.mockReset();
  });

  it('reflection LLM throws → no inner GFPA dispatch (no orphaned reservation)', async () => {
    const { ctx } = makeCtx();
    const llm = makeMockLlm(() => {
      throw new Error('LLM provider down');
    });
    const agent = new ReflectAndGenerateFromPreviousArticleAgent();

    await expect(agent.execute(baseInput(llm), ctx)).rejects.toThrow();
    // Critical: inner GFPA was never dispatched, so its (potentially expensive)
    // generation+ranking reservation never happened. This is what protects budget
    // when the reflection step fails.
    expect(innerGfpaExecuteSpy).not.toHaveBeenCalled();
  });

  it('reflection succeeds, inner GFPA throws BudgetExceededError → propagates without swallowing', async () => {
    const { ctx, addSpend } = makeCtx();
    const llm = makeMockLlm(() => {
      addSpend(0.001);
      return HAPPY_REFLECTION;
    });
    innerGfpaExecuteSpy.mockImplementation(async () => {
      throw new BudgetExceededError('generate_from_previous_article', 0.001, 0.005, 0.005);
    });

    const agent = new ReflectAndGenerateFromPreviousArticleAgent();
    await expect(agent.execute(baseInput(llm), ctx)).rejects.toThrow(BudgetExceededError);

    // The reflection LLM call DID happen (one call to llm.complete with label 'reflection').
    expect((llm.complete as jest.Mock).mock.calls.length).toBe(1);
    expect((llm.complete as jest.Mock).mock.calls[0]![1]).toBe('reflection');
    // Inner GFPA was attempted (and threw).
    expect(innerGfpaExecuteSpy).toHaveBeenCalledTimes(1);
  });
});
