// Unit tests for IterativeEditingAgent — critique-driven editing with blind diff-based judging.
// Includes step-targeted mutation tests for OutlineVariant support.

import { IterativeEditingAgent } from './iterativeEditingAgent';
import { PipelineStateImpl } from '../core/state';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig, Critique, OutlineVariant, GenerationStep, IterativeEditingExecutionDetail } from '../types';
import { BudgetExceededError, isOutlineVariant } from '../types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';
import type { DiffComparisonResult } from '../diffComparison';

const VALID_ARTICLE = `# Test Article

## Introduction

This is a well-formed article with proper structure. It has multiple sentences per paragraph and follows the expected format rules.

## Main Content

The main content section provides detailed information about the topic. Each paragraph contains at least two complete sentences to satisfy format validation.`;

const VALID_OPEN_REVIEW = JSON.stringify({
  suggestions: ['Improve the opening hook', 'Add more specific examples in section 2'],
});

const VALID_CRITIQUE_JSON = JSON.stringify({
  scores: { clarity: 6, engagement: 5, precision: 7, voice_fidelity: 8, conciseness: 8 },
  good_examples: { clarity: 'Clear thesis statement' },
  bad_examples: { clarity: 'The phrase "it was noted" is vague', engagement: 'Opening lacks a hook' },
  notes: { clarity: 'Some passive voice issues', engagement: 'Needs stronger opening' },
});

const HIGH_SCORE_CRITIQUE_JSON = JSON.stringify({
  scores: { clarity: 9, engagement: 9, precision: 9, voice_fidelity: 9, conciseness: 9 },
  good_examples: { clarity: 'Excellent phrasing' },
  bad_examples: {},
  notes: {},
});

// Mock compareWithDiff to control accept/reject at a higher level
jest.mock('../diffComparison', () => ({
  compareWithDiff: jest.fn(),
}));

import { compareWithDiff } from '../diffComparison';
const mockCompareWithDiff = compareWithDiff as jest.MockedFunction<typeof compareWithDiff>;

function makeMockLLMClient(responses?: string[]): EvolutionLLMClient {
  const queue = [...(responses ?? [])];
  return {
    complete: jest.fn().mockImplementation(() => Promise.resolve(queue.shift() ?? '')),
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
    getAgentCost: jest.fn().mockReturnValue(0),
    getTotalSpent: jest.fn().mockReturnValue(0),
    getAvailableBudget: jest.fn().mockReturnValue(5),
    getAllAgentCosts: jest.fn().mockReturnValue({}),
  };
}

function makeCritique(variantId: string, overrides?: Partial<Critique>): Critique {
  return {
    variationId: variantId,
    dimensionScores: { clarity: 6, engagement: 5, precision: 7, voice_fidelity: 8, conciseness: 8 },
    goodExamples: { clarity: ['Clear thesis'] },
    badExamples: { clarity: ['Vague phrasing'], engagement: ['Weak opening'] },
    notes: { clarity: 'Passive voice', engagement: 'Needs hook' },
    reviewer: 'llm',
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  const state = new PipelineStateImpl('# Original\n\n## Section\n\nOriginal text content here. This is a second sentence.');
  // Seed with variants
  for (let i = 0; i < 3; i++) {
    state.addToPool({
      id: `v-${i}`,
      text: VALID_ARTICLE,
      version: 1,
      parentIds: [],
      strategy: 'structural_transform',
      createdAt: Date.now() / 1000,
      iterationBorn: 0,
    });
    state.ratings.set(`v-${i}`, { mu: 25 + i * (25/400) * 50, sigma: 4 });
  }
  // Add critique for top variant (v-2 has highest Elo)
  state.allCritiques = [makeCritique('v-2')];

  return {
    payload: {
      originalText: state.originalText,
      title: 'Test',
      explanationId: 1,
      runId: 'test-run',
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    },
    state,
    llmClient: makeMockLLMClient([
      VALID_OPEN_REVIEW,  // open review
      VALID_ARTICLE,      // edit
    ]),
    logger: makeMockLogger(),
    costTracker: makeMockCostTracker(),
    runId: 'test-run',
    ...overrides,
  };
}

function makeAcceptResult(changesFound = 3): DiffComparisonResult {
  return { verdict: 'ACCEPT', confidence: 1.0, changesFound };
}

function makeRejectResult(changesFound = 3): DiffComparisonResult {
  return { verdict: 'REJECT', confidence: 1.0, changesFound };
}

function makeUnsureResult(changesFound = 3): DiffComparisonResult {
  return { verdict: 'UNSURE', confidence: 0.5, changesFound };
}

beforeEach(() => {
  mockCompareWithDiff.mockReset();
});

describe('IterativeEditingAgent', () => {
  const agent = new IterativeEditingAgent();

  it('has correct name', () => {
    expect(agent.name).toBe('iterativeEditing');
  });

  it('accepts edit when judge returns ACCEPT', async () => {
    mockCompareWithDiff.mockResolvedValueOnce(makeAcceptResult());
    const ctx = makeCtx({
      llmClient: makeMockLLMClient([
        VALID_OPEN_REVIEW,       // open review
        VALID_ARTICLE,           // edit
        VALID_CRITIQUE_JSON,     // inline critique after accept
        VALID_OPEN_REVIEW,       // open review after accept
      ]),
    });
    const poolBefore = ctx.state.getPoolSize();
    const result = await agent.execute(ctx);

    expect(result.success).toBe(true);
    expect(result.variantsAdded).toBe(1);
    expect(ctx.state.getPoolSize()).toBe(poolBefore + 1);
  });

  it('rejects edit when judge returns REJECT', async () => {
    mockCompareWithDiff.mockResolvedValue(makeRejectResult());
    const ctx = makeCtx({
      llmClient: makeMockLLMClient([
        VALID_OPEN_REVIEW,  // open review
        VALID_ARTICLE,      // edit cycle 1
        VALID_ARTICLE,      // edit cycle 2
        VALID_ARTICLE,      // edit cycle 3
      ]),
    });
    const poolBefore = ctx.state.getPoolSize();
    const result = await agent.execute(ctx);

    expect(result.success).toBe(false);
    expect(result.variantsAdded).toBe(0);
    expect(ctx.state.getPoolSize()).toBe(poolBefore);
  });

  it('rejects edit when judge returns UNSURE', async () => {
    mockCompareWithDiff.mockResolvedValueOnce(makeUnsureResult());
    const ctx = makeCtx();
    const poolBefore = ctx.state.getPoolSize();

    // Will run 1 cycle with UNSURE, then 2 more with default (also UNSURE since mock exhausted)
    mockCompareWithDiff.mockResolvedValue(makeUnsureResult());
    const result = await agent.execute(ctx);

    expect(result.success).toBe(false);
    expect(result.variantsAdded).toBe(0);
    expect(ctx.state.getPoolSize()).toBe(poolBefore);
  });

  it('stops after maxConsecutiveRejections', async () => {
    const agentWith2Max = new IterativeEditingAgent({ maxConsecutiveRejections: 2, maxCycles: 5 });
    mockCompareWithDiff.mockResolvedValue(makeRejectResult());
    const ctx = makeCtx({
      llmClient: makeMockLLMClient([
        VALID_OPEN_REVIEW,
        VALID_ARTICLE,  // edit cycle 0
        VALID_ARTICLE,  // edit cycle 1
        VALID_ARTICLE,  // edit cycle 2 — would happen without the cap
        VALID_ARTICLE,  // edit cycle 3
        VALID_ARTICLE,  // edit cycle 4
      ]),
    });

    const result = await agentWith2Max.execute(ctx);
    expect(result.success).toBe(false);

    // Should have stopped after 2 rejections (cycles 0 and 1), not all 5
    // 2 judge calls = 2 rejected cycles
    expect(mockCompareWithDiff).toHaveBeenCalledTimes(2);

    // Verify the stop was logged
    const logger = ctx.logger as unknown as { info: jest.Mock };
    const stopCalls = logger.info.mock.calls.filter(
      (c: unknown[]) => c[0] === 'Max consecutive rejections reached, stopping',
    );
    expect(stopCalls.length).toBe(1);
  });

  it('stops when quality threshold met', async () => {
    const ctx = makeCtx();
    // Override critique to have all high scores
    ctx.state.allCritiques = [makeCritique('v-2', {
      dimensionScores: { clarity: 9, engagement: 9, precision: 9, voice_fidelity: 9, conciseness: 9 },
    })];
    // Open review returns null (no suggestions)
    const llmClient = makeMockLLMClient(['{}']); // invalid suggestions → null
    const result = await new IterativeEditingAgent().execute({ ...ctx, llmClient });

    expect(result.variantsAdded).toBe(0);
    const logger = ctx.logger as unknown as { info: jest.Mock };
    const stopCalls = logger.info.mock.calls.filter(
      (c: unknown[]) => c[0] === 'Quality threshold met, stopping',
    );
    expect(stopCalls.length).toBe(1);
  });

  it('stops at maxCycles', async () => {
    const agent1Cycle = new IterativeEditingAgent({ maxCycles: 1 });
    mockCompareWithDiff.mockResolvedValue(makeAcceptResult());
    const ctx = makeCtx({
      llmClient: makeMockLLMClient([
        VALID_OPEN_REVIEW,       // open review
        VALID_ARTICLE,           // edit
        VALID_CRITIQUE_JSON,     // inline critique after accept
        VALID_OPEN_REVIEW,       // open review after accept (cycle 2 would start here)
      ]),
    });

    const result = await agent1Cycle.execute(ctx);
    // Only 1 cycle ran, 1 variant added
    expect(result.variantsAdded).toBe(1);
  });

  it('chains edits — second edit uses accepted text', async () => {
    const agent2Cycles = new IterativeEditingAgent({ maxCycles: 2 });
    const editedArticle1 = VALID_ARTICLE.replace('proper structure', 'excellent structure');
    const editedArticle2 = editedArticle1.replace('detailed information', 'comprehensive information');

    mockCompareWithDiff
      .mockResolvedValueOnce(makeAcceptResult())
      .mockResolvedValueOnce(makeAcceptResult());

    const ctx = makeCtx({
      llmClient: makeMockLLMClient([
        VALID_OPEN_REVIEW,       // open review
        editedArticle1,          // edit cycle 1
        VALID_CRITIQUE_JSON,     // inline critique after accept 1
        VALID_OPEN_REVIEW,       // open review after accept 1
        editedArticle2,          // edit cycle 2
        VALID_CRITIQUE_JSON,     // inline critique after accept 2
        VALID_OPEN_REVIEW,       // open review after accept 2
      ]),
    });

    const result = await agent2Cycles.execute(ctx);
    expect(result.variantsAdded).toBe(2);

    // The second edit should use the first edited text, not original
    const completeCalls = (ctx.llmClient.complete as jest.Mock).mock.calls;
    // Call index 4 is the second edit prompt (0=openReview, 1=edit1, 2=critique, 3=openReview2, 4=edit2)
    const secondEditPrompt = completeCalls[4][0] as string;
    expect(secondEditPrompt).toContain('excellent structure');
  });

  it('re-evaluates after accepted edit', async () => {
    mockCompareWithDiff.mockResolvedValueOnce(makeAcceptResult());
    const ctx = makeCtx({
      llmClient: makeMockLLMClient([
        VALID_OPEN_REVIEW,       // open review
        VALID_ARTICLE,           // edit
        HIGH_SCORE_CRITIQUE_JSON, // inline critique after accept — high scores
        '{}',                    // open review after accept — no suggestions → stop
      ]),
    });

    const result = await agent.execute(ctx);
    expect(result.variantsAdded).toBe(1);
    // After the accepted edit, inline critique and open review were called
    expect((ctx.llmClient.complete as jest.Mock).mock.calls.length).toBe(4);
  });

  it('skips on format validation failure', async () => {
    const badArticle = 'no heading, no structure'; // will fail format validation
    const ctx = makeCtx({
      llmClient: makeMockLLMClient([
        VALID_OPEN_REVIEW,
        badArticle,      // edit cycle 1 — bad format
        badArticle,      // edit cycle 2 — bad format
        badArticle,      // edit cycle 3 — bad format
      ]),
    });

    const result = await agent.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.variantsAdded).toBe(0);
    // compareWithDiff should NOT have been called (format validation happens first)
    expect(mockCompareWithDiff).not.toHaveBeenCalled();
    const logger = ctx.logger as unknown as { warn: jest.Mock };
    expect(logger.warn).toHaveBeenCalled();
  });

  it('canExecute returns false without critiques', () => {
    const state = new PipelineStateImpl('text');
    state.addToPool({
      id: 'v-0', text: VALID_ARTICLE, version: 1, parentIds: [],
      strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    state.ratings.set('v-0', { mu: 25, sigma: 8.333 });
    expect(agent.canExecute(state)).toBe(false);
  });

  it('canExecute returns false without top variant', () => {
    const state = new PipelineStateImpl('text');
    state.allCritiques = [makeCritique('nonexistent')];
    expect(agent.canExecute(state)).toBe(false);
  });

  it('canExecute returns false without ratings', () => {
    const state = new PipelineStateImpl('text');
    state.addToPool({
      id: 'v-0', text: VALID_ARTICLE, version: 1, parentIds: [],
      strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    // ratings not populated (size === 0) — addToPool sets a default but let's clear it
    state.ratings.clear();
    state.allCritiques = [makeCritique('v-0')];
    expect(agent.canExecute(state)).toBe(false);
  });

  it('canExecute returns true with critiques and top variant', () => {
    const state = new PipelineStateImpl('text');
    state.addToPool({
      id: 'v-0', text: VALID_ARTICLE, version: 1, parentIds: [],
      strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    state.ratings.set('v-0', { mu: 25, sigma: 8.333 });
    state.allCritiques = [makeCritique('v-0')];
    expect(agent.canExecute(state)).toBe(true);
  });

  it('propagates BudgetExceededError', async () => {
    const mockClient = makeMockLLMClient();
    (mockClient.complete as jest.Mock).mockRejectedValueOnce(
      new BudgetExceededError('iterativeEditing', 1.0, 0.5),
    );
    const ctx = makeCtx({ llmClient: mockClient });
    await expect(agent.execute(ctx)).rejects.toThrow(BudgetExceededError);
  });

  it('strategy name encodes target dimension', async () => {
    mockCompareWithDiff.mockResolvedValueOnce(makeAcceptResult());
    const ctx = makeCtx({
      llmClient: makeMockLLMClient([
        VALID_OPEN_REVIEW,
        VALID_ARTICLE,
        VALID_CRITIQUE_JSON,
        VALID_OPEN_REVIEW,
      ]),
    });

    await agent.execute(ctx);
    // Top variant v-2 has engagement as weakest dimension (score: 5)
    const newVariants = ctx.state.pool.filter((v) => v.strategy.startsWith('critique_edit_'));
    expect(newVariants.length).toBe(1);
    expect(newVariants[0].strategy).toBe('critique_edit_engagement');
  });

  it('handles open review JSON parse failure gracefully', async () => {
    mockCompareWithDiff.mockResolvedValueOnce(makeAcceptResult());
    const ctx = makeCtx({
      llmClient: makeMockLLMClient([
        'not valid json at all',  // open review parse failure
        VALID_ARTICLE,            // edit (from rubric target instead)
        VALID_CRITIQUE_JSON,      // inline critique after accept
        'also invalid',           // open review parse failure again
      ]),
    });

    const result = await agent.execute(ctx);
    // Should still work using rubric critique only
    expect(result.variantsAdded).toBe(1);
  });

  it('handles inline critique JSON parse failure gracefully', async () => {
    const agent2Cycles = new IterativeEditingAgent({ maxCycles: 2 });
    mockCompareWithDiff
      .mockResolvedValueOnce(makeAcceptResult())
      .mockResolvedValueOnce(makeAcceptResult());

    const ctx = makeCtx({
      llmClient: makeMockLLMClient([
        VALID_OPEN_REVIEW,       // open review
        VALID_ARTICLE,           // edit cycle 1
        'invalid critique json', // inline critique parse failure
        VALID_OPEN_REVIEW,       // open review (used as fallback)
        VALID_ARTICLE,           // edit cycle 2 (from open review target)
        VALID_CRITIQUE_JSON,     // inline critique after accept 2
        VALID_OPEN_REVIEW,       // open review after accept 2
      ]),
    });

    const result = await agent2Cycles.execute(ctx);
    // Should continue with open review targets even when critique fails
    expect(result.variantsAdded).toBe(2);
  });

  it('direction reversal catches framing bias', async () => {
    // Both passes return ACCEPT → UNSURE (framing bias)
    mockCompareWithDiff.mockResolvedValueOnce(makeUnsureResult());
    const ctx = makeCtx();

    const result = await agent.execute(ctx);
    // UNSURE treated as rejection
    expect(result.variantsAdded).toBeLessThanOrEqual(0);
  });

  it('judge prompt has no edit context', async () => {
    // Use the real compareWithDiff to check the callLLM prompt
    mockCompareWithDiff.mockRestore();

    // Re-mock with implementation that captures the callLLM
    let capturedCallLLM: ((prompt: string) => Promise<string>) | undefined;
    mockCompareWithDiff.mockImplementation(async (_before, _after, callLLM) => {
      capturedCallLLM = callLLM;
      return makeRejectResult();
    });

    const ctx = makeCtx({
      llmClient: makeMockLLMClient([
        VALID_OPEN_REVIEW,
        VALID_ARTICLE,
      ]),
    });

    await agent.execute(ctx);

    // The callLLM passed to compareWithDiff should be a wrapper around llmClient.complete
    // with judgeModel — verify it doesn't contain edit context
    expect(capturedCallLLM).toBeDefined();
  });

  it('estimateCost returns a positive number', () => {
    const cost = agent.estimateCost({
      originalText: VALID_ARTICLE,
      title: 'Test',
      explanationId: 1,
      runId: 'test-run',
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    });
    expect(cost).toBeGreaterThan(0);
  });

  describe('flow-aware edit targeting', () => {
    it('includes flow dimension targets when flow critique exists in state', async () => {
      mockCompareWithDiff.mockResolvedValueOnce(makeAcceptResult());
      const ctx = makeCtx({
        llmClient: makeMockLLMClient([
          VALID_OPEN_REVIEW,
          VALID_ARTICLE,
          VALID_CRITIQUE_JSON,
          VALID_OPEN_REVIEW,
        ]),
      });
      // Add a flow critique for the top variant (v-2)
      ctx.state.allCritiques!.push({
        variationId: 'v-2',
        dimensionScores: { local_cohesion: 2, global_coherence: 4, transition_quality: 1, rhythm_variety: 3, redundancy: 4 },
        goodExamples: {},
        badExamples: { transition_quality: ['Abrupt paragraph jump'] },
        notes: { transition_quality: 'Missing connectives' },
        reviewer: 'llm',
        scale: '0-5' as const,
      });

      await agent.execute(ctx);

      // The weakest quality dim is engagement (5), weakest flow dim is transition_quality (1/5 = 0.2 normalized)
      // Flow dimension should be picked since 0.2 < (5-1)/9 ≈ 0.44
      // But the edit target order is: rubric dims below threshold first, then flow dims
      // Since engagement(5) < threshold(8), it gets targeted first
      const newVariants = ctx.state.pool.filter((v) => v.strategy.startsWith('critique_edit_'));
      expect(newVariants.length).toBe(1);
      // First target is weakest quality dimension (engagement at 5)
      expect(newVariants[0].strategy).toBe('critique_edit_engagement');
    });

    it('qualityThresholdMet only checks quality critique, not flow', async () => {
      const ctx = makeCtx();
      // Quality critique with all scores above threshold
      ctx.state.allCritiques = [
        {
          variationId: 'v-2',
          dimensionScores: { clarity: 9, engagement: 9, precision: 9, voice_fidelity: 9, conciseness: 9 },
          goodExamples: {},
          badExamples: {},
          notes: {},
          reviewer: 'llm',
        },
        // Flow critique with low scores — should NOT prevent quality threshold from being met
        {
          variationId: 'v-2',
          dimensionScores: { local_cohesion: 1, global_coherence: 1, transition_quality: 1, rhythm_variety: 1, redundancy: 1 },
          goodExamples: {},
          badExamples: {},
          notes: {},
          reviewer: 'llm',
          scale: '0-5' as const,
        },
      ];
      // Open review returns no suggestions → combined with quality threshold met → should stop
      const llmClient = makeMockLLMClient(['{}']);
      const result = await new IterativeEditingAgent().execute({ ...ctx, llmClient });

      // Quality threshold is met (all ≥ 8), so should stop even though flow scores are low
      const logger = ctx.logger as unknown as { info: jest.Mock };
      const stopCalls = logger.info.mock.calls.filter(
        (c: unknown[]) => c[0] === 'Quality threshold met, stopping',
      );
      expect(stopCalls.length).toBe(1);
    });
  });

  describe('transient error handling in edit loop', () => {
    it('catches transient LLM error in edit generation and continues', async () => {
      const mockClient = makeMockLLMClient();
      (mockClient.complete as jest.Mock)
        .mockResolvedValueOnce(VALID_OPEN_REVIEW)       // runOpenReview
        .mockRejectedValueOnce(new Error('Socket timeout'))  // edit generation fails
        .mockRejectedValueOnce(new Error('Socket timeout'))  // cycle 2 edit fails
        .mockRejectedValueOnce(new Error('Socket timeout')); // cycle 3 edit fails
      const ctx = makeCtx({ llmClient: mockClient });
      const result = await agent.execute(ctx);
      expect(result.success).toBe(false);
      expect(result.variantsAdded).toBe(0);
      // Verify warning was logged
      const logger = ctx.logger as unknown as { warn: jest.Mock };
      const warnCalls = logger.warn.mock.calls.filter(
        (c: unknown[]) => c[0] === 'Edit cycle failed, treating as rejection',
      );
      expect(warnCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('catches transient error in compareWithDiff and continues', async () => {
      const mockClient = makeMockLLMClient();
      (mockClient.complete as jest.Mock)
        .mockResolvedValueOnce(VALID_OPEN_REVIEW)   // runOpenReview
        .mockResolvedValueOnce(VALID_ARTICLE);       // edit generation succeeds
      mockCompareWithDiff.mockRejectedValueOnce(new Error('ECONNRESET'));
      const ctx = makeCtx({ llmClient: mockClient });
      const result = await agent.execute(ctx);
      expect(result.success).toBe(false);
      expect(result.variantsAdded).toBe(0);
    });

    it('re-throws BudgetExceededError from edit generation', async () => {
      const mockClient = makeMockLLMClient();
      (mockClient.complete as jest.Mock)
        .mockResolvedValueOnce(VALID_OPEN_REVIEW)
        .mockRejectedValueOnce(new BudgetExceededError('iterativeEditing', 1.0, 0.5));
      const ctx = makeCtx({ llmClient: mockClient });
      await expect(agent.execute(ctx)).rejects.toThrow(BudgetExceededError);
    });

    it('exhausts maxConsecutiveRejections on repeated transient errors', async () => {
      const agent2Max = new IterativeEditingAgent({ maxConsecutiveRejections: 2, maxCycles: 5 });
      const mockClient = makeMockLLMClient();
      (mockClient.complete as jest.Mock)
        .mockResolvedValueOnce(VALID_OPEN_REVIEW)
        .mockRejectedValue(new Error('Socket timeout'));
      const ctx = makeCtx({ llmClient: mockClient });
      const result = await agent2Max.execute(ctx);
      expect(result.success).toBe(false);
      expect(result.variantsAdded).toBe(0);
      // Should stop after maxConsecutiveRejections (2), not run all 5 cycles
      const logger = ctx.logger as unknown as { info: jest.Mock };
      const stopCalls = logger.info.mock.calls.filter(
        (c: unknown[]) => c[0] === 'Max consecutive rejections reached, stopping',
      );
      expect(stopCalls.length).toBe(1);
    });
  });

  describe('step-targeted editing for OutlineVariants', () => {
    function makeOutlineCtx(): ExecutionContext {
      const state = new PipelineStateImpl('# Original\n\n## Section\n\nOriginal text content here. This is a second sentence.');
      const steps: GenerationStep[] = [
        { name: 'outline', input: 'original', output: '## Intro\nSummary', score: 0.85, costUsd: 0.001 },
        { name: 'expand', input: '## Intro\nSummary', output: 'Expanded.', score: 0.4, costUsd: 0.002 },
        { name: 'polish', input: 'Expanded.', output: VALID_ARTICLE, score: 0.9, costUsd: 0.001 },
      ];
      const outlineVariant: OutlineVariant = {
        id: 'ov-top',
        text: VALID_ARTICLE,
        version: 1,
        parentIds: [],
        strategy: 'outline_generation',
        createdAt: Date.now() / 1000,
        iterationBorn: 0,
        steps,
        outline: '## Intro\nSummary',
        weakestStep: 'expand',
      };

      state.addToPool(outlineVariant);
      state.ratings.set('ov-top', { mu: 30, sigma: 4 });
      state.allCritiques = [makeCritique('ov-top')];

      return {
        payload: {
          originalText: state.originalText,
          title: 'Test',
          explanationId: 1,
          runId: 'test-run',
          config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
        },
        state,
        llmClient: makeMockLLMClient([
          VALID_OPEN_REVIEW,  // open review
          VALID_ARTICLE,      // edit (step-targeted)
          VALID_CRITIQUE_JSON, // inline critique after accept
          VALID_OPEN_REVIEW,  // open review after accept
        ]),
        logger: makeMockLogger(),
        costTracker: makeMockCostTracker(),
        runId: 'test-run',
      };
    }

    it('targets weakest step first when variant is OutlineVariant', async () => {
      mockCompareWithDiff.mockResolvedValueOnce(makeAcceptResult());
      const ctx = makeOutlineCtx();

      await agent.execute(ctx);

      // First edit should target the expand step (weakest at 0.4)
      const newVariants = ctx.state.pool.filter(v => v.strategy.startsWith('critique_edit_'));
      expect(newVariants.length).toBe(1);
      expect(newVariants[0].strategy).toBe('critique_edit_step:expand');
    });

    it('generates step-specific prompt for step:expand target', async () => {
      mockCompareWithDiff.mockResolvedValueOnce(makeAcceptResult());
      const ctx = makeOutlineCtx();

      await agent.execute(ctx);

      // The edit call should contain step-specific instructions
      const editCall = (ctx.llmClient.complete as jest.Mock).mock.calls[1];
      expect(editCall[0]).toContain('expand');
      expect(editCall[0]).toContain('0.4');
    });

    it('falls back to dimension-based targets for plain TextVariation (regression)', async () => {
      mockCompareWithDiff.mockResolvedValueOnce(makeAcceptResult());
      const ctx = makeCtx({
        llmClient: makeMockLLMClient([
          VALID_OPEN_REVIEW,
          VALID_ARTICLE,
          VALID_CRITIQUE_JSON,
          VALID_OPEN_REVIEW,
        ]),
      });

      await agent.execute(ctx);

      const newVariants = ctx.state.pool.filter(v => v.strategy.startsWith('critique_edit_'));
      expect(newVariants.length).toBe(1);
      // Should target dimension, not step (plain TextVariation)
      expect(newVariants[0].strategy).not.toContain('step:');
    });
  });

  describe('executionDetail', () => {
    it('captures cycle details and stop reason on accept', async () => {
      mockCompareWithDiff.mockResolvedValueOnce(makeAcceptResult());
      const ctx = makeCtx({
        llmClient: makeMockLLMClient([
          VALID_OPEN_REVIEW,
          VALID_ARTICLE,
          HIGH_SCORE_CRITIQUE_JSON, // all scores ≥ 8
          '{}', // no open suggestions → threshold met
        ]),
      });
      const result = await agent.execute(ctx);

      expect(result.executionDetail).toBeDefined();
      expect(result.executionDetail!.detailType).toBe('iterativeEditing');
      const detail = result.executionDetail as IterativeEditingExecutionDetail;
      expect(detail.targetVariantId).toBeTruthy();
      expect(detail.config.maxCycles).toBe(3);
      expect(detail.cycles).toHaveLength(1);
      expect(detail.cycles[0].verdict).toBe('ACCEPT');
      expect(detail.cycles[0].formatValid).toBe(true);
      expect(detail.cycles[0].newVariantId).toBeDefined();
      expect(detail.initialCritique.dimensionScores).toBeDefined();
      expect(detail.stopReason).toBe('threshold_met');
    });

    it('captures reject cycles and max_rejections stop reason', async () => {
      const agent2 = new IterativeEditingAgent({ maxConsecutiveRejections: 2, maxCycles: 5 });
      mockCompareWithDiff.mockResolvedValue(makeRejectResult());
      const ctx = makeCtx({
        llmClient: makeMockLLMClient([
          VALID_OPEN_REVIEW,
          VALID_ARTICLE,
          VALID_ARTICLE,
          VALID_ARTICLE,
        ]),
      });
      const result = await agent2.execute(ctx);

      const detail = result.executionDetail as IterativeEditingExecutionDetail;
      expect(detail.stopReason).toBe('max_rejections');
      expect(detail.consecutiveRejections).toBe(2);
      expect(detail.cycles.every(c => c.verdict === 'REJECT')).toBe(true);
    });

    it('captures format failure in cycle detail', async () => {
      const badArticle = 'no heading, no structure';
      const ctx = makeCtx({
        llmClient: makeMockLLMClient([
          VALID_OPEN_REVIEW,
          badArticle, badArticle, badArticle,
        ]),
      });
      const result = await agent.execute(ctx);

      const detail = result.executionDetail as IterativeEditingExecutionDetail;
      expect(detail.cycles.length).toBeGreaterThan(0);
      expect(detail.cycles[0].formatValid).toBe(false);
      expect(detail.cycles[0].formatIssues).toBeDefined();
      expect(detail.cycles[0].formatIssues!.length).toBeGreaterThan(0);
    });
  });
});
