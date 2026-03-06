// Unit tests for the standalone flow critique pipeline function.
// Validates flow critiques are appended (not overwritten), dimensionScores use flow: prefix,
// and budget errors propagate correctly.

import { runFlowCritiques } from './pipeline';
import { PipelineStateImpl } from './state';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig, Critique } from '../types';
import { BudgetExceededError } from '../types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';

// Mock instrumentation
jest.mock('../../../../instrumentation', () => ({
  createAppSpan: jest.fn(() => ({
    setAttribute: jest.fn(),
    setAttributes: jest.fn(),
    setStatus: jest.fn(),
    end: jest.fn(),
    recordException: jest.fn(),
  })),
}));

// Mock Supabase (required by pipeline imports)
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn().mockResolvedValue({
    from: () => ({ upsert: () => Promise.resolve({}), update: () => ({ eq: () => Promise.resolve({}) }), select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }) }),
  }),
}));

const VALID_FLOW_CRITIQUE_JSON = JSON.stringify({
  scores: {
    local_cohesion: 3,
    global_coherence: 4,
    transition_quality: 2,
    rhythm_variety: 4,
    redundancy: 5,
  },
  friction_sentences: {
    local_cohesion: ['The next point is unclear.'],
    transition_quality: ['Moving on, we see...', 'Furthermore, ...'],
  },
});

const VALID_ARTICLE = `# Test Article

## Introduction

This is a well-formed article with proper structure. It has multiple sentences per paragraph and follows the expected format rules.

## Main Content

The main content section provides detailed information about the topic. Each paragraph contains at least two complete sentences to satisfy format validation.`;

function makeMockLLMClient(responses?: string[]): EvolutionLLMClient {
  const queue = [...(responses ?? [])];
  return {
    complete: jest.fn().mockImplementation(() => Promise.resolve(queue.shift() ?? VALID_FLOW_CRITIQUE_JSON)),
    completeStructured: jest.fn(),
  };
}

function makeMockLogger(): EvolutionLogger {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeMockCostTracker(): CostTracker {
  return {
    reserveBudget: jest.fn().mockResolvedValue(undefined),
    recordSpend: jest.fn(),
    getAgentCost: jest.fn().mockReturnValue(0.01),
    getTotalSpent: jest.fn().mockReturnValue(0),
    getAvailableBudget: jest.fn().mockReturnValue(5),
    getAllAgentCosts: jest.fn().mockReturnValue({}),
    getTotalReserved: jest.fn().mockReturnValue(0),
    getInvocationCost: jest.fn().mockReturnValue(0),
    releaseReservation: jest.fn(),
    setEventLogger: jest.fn(),
  };
}

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  const state = new PipelineStateImpl(VALID_ARTICLE);
  state.addToPool({
    id: 'v-1',
    text: VALID_ARTICLE,
    version: 1,
    parentIds: [],
    strategy: 'structural_transform',
    createdAt: Date.now() / 1000,
    iterationBorn: 0,
  });
  state.addToPool({
    id: 'v-2',
    text: VALID_ARTICLE + '\n\nMore content here.',
    version: 1,
    parentIds: [],
    strategy: 'lexical_simplify',
    createdAt: Date.now() / 1000,
    iterationBorn: 0,
  });

  return {
    payload: {
      originalText: state.originalText,
      title: 'Test',
      explanationId: 1,
      runId: 'test-run',
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    },
    state,
    llmClient: makeMockLLMClient(),
    logger: makeMockLogger(),
    costTracker: makeMockCostTracker(),
    runId: 'test-run',
    ...overrides,
  };
}

describe('runFlowCritiques', () => {
  it('appends flow critiques with scale 0-5 to state.allCritiques', async () => {
    const ctx = makeCtx();
    const logger = makeMockLogger();

    const result = await runFlowCritiques(ctx, logger);

    expect(result.critiqued).toBe(2);
    const flowCritiques = (ctx.state.allCritiques ?? []).filter((c) => c.scale === '0-5');
    expect(flowCritiques.length).toBe(2);
    expect(flowCritiques[0].dimensionScores).toHaveProperty('local_cohesion');
    expect(flowCritiques[0].dimensionScores.local_cohesion).toBe(3);
  });

  it('writes flow scores to dimensionScores with flow: prefix', async () => {
    const ctx = makeCtx();
    const logger = makeMockLogger();

    await runFlowCritiques(ctx, logger);

    // Check dimensionScores map has flow: prefixed keys
    const dimScores = ctx.state.dimensionScores;
    expect(dimScores).toBeDefined();
    expect(dimScores!['v-1']).toBeDefined();
    expect(dimScores!['v-1']['flow:local_cohesion']).toBe(3);
    expect(dimScores!['v-1']['flow:transition_quality']).toBe(2);
  });

  it('does not overwrite existing quality critiques', async () => {
    const ctx = makeCtx();
    const qualityCritique: Critique = {
      variationId: 'v-1',
      dimensionScores: { clarity: 8, engagement: 7 },
      goodExamples: {},
      badExamples: {},
      notes: {},
      reviewer: 'llm',
    };
    ctx.state.allCritiques = [qualityCritique];
    const logger = makeMockLogger();

    await runFlowCritiques(ctx, logger);

    // Quality critique should still be first
    expect(ctx.state.allCritiques[0]).toBe(qualityCritique);
    expect(ctx.state.allCritiques[0].dimensionScores).toHaveProperty('clarity');
    // Flow critiques appended after
    const flowCritiques = ctx.state.allCritiques.filter((c) => c.scale === '0-5');
    expect(flowCritiques.length).toBe(2);
  });

  it('skips variants that already have a flow critique', async () => {
    const ctx = makeCtx();
    ctx.state.allCritiques = [
      {
        variationId: 'v-1',
        dimensionScores: { local_cohesion: 4 },
        goodExamples: {},
        badExamples: {},
        notes: {},
        reviewer: 'llm',
        scale: '0-5' as const,
      },
    ];
    const logger = makeMockLogger();

    const result = await runFlowCritiques(ctx, logger);

    // Only v-2 should be critiqued (v-1 already has flow critique)
    expect(result.critiqued).toBe(1);
    expect((ctx.llmClient.complete as jest.Mock).mock.calls.length).toBe(1);
  });

  it('propagates BudgetExceededError', async () => {
    const llmClient = makeMockLLMClient();
    (llmClient.complete as jest.Mock).mockRejectedValue(
      new BudgetExceededError('flowCritique', 1.0, 0, 0.5),
    );
    const ctx = makeCtx({ llmClient });
    const logger = makeMockLogger();

    await expect(runFlowCritiques(ctx, logger)).rejects.toThrow(BudgetExceededError);
  });

  it('handles parse failure gracefully (non-fatal)', async () => {
    const llmClient = makeMockLLMClient(['not valid json at all', 'also invalid']);
    const ctx = makeCtx({ llmClient });
    const logger = makeMockLogger();

    const result = await runFlowCritiques(ctx, logger);

    expect(result.critiqued).toBe(0);
    // Warnings should be logged
    expect((logger.warn as jest.Mock).mock.calls.length).toBe(2); // CritiqueBatch logs a warning per parse failure
    // No flow critiques added
    expect((ctx.state.allCritiques ?? []).filter((c) => c.scale === '0-5').length).toBe(0);
  });

  it('stores friction sentences in badExamples', async () => {
    const ctx = makeCtx();
    const logger = makeMockLogger();

    await runFlowCritiques(ctx, logger);

    const flowCritiques = (ctx.state.allCritiques ?? []).filter((c) => c.scale === '0-5');
    expect(flowCritiques[0].badExamples).toHaveProperty('local_cohesion');
    expect(flowCritiques[0].badExamples.local_cohesion).toContain('The next point is unclear.');
    expect(flowCritiques[0].badExamples).toHaveProperty('transition_quality');
  });
});
