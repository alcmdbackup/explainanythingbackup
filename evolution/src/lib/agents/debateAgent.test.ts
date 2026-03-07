// Unit tests for DebateAgent — structured 3-turn debate with mocked LLM.

import { DebateAgent } from './debateAgent';
import { PipelineStateImpl } from '../core/state';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig, Critique, DebateExecutionDetail } from '../types';
import { BudgetExceededError } from '../types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';

const VALID_ARTICLE = `# Test Article

## Introduction

This is a well-formed article with proper structure. It has multiple sentences per paragraph and follows the expected format rules.

## Main Content

The main content section provides detailed information about the topic. Each paragraph contains at least two complete sentences to satisfy format validation.`;

const ADVOCATE_A_RESPONSE = 'Variant A is superior because it has clearer structure and better engagement. The opening paragraph clearly states the thesis.';
const ADVOCATE_B_RESPONSE = 'Variant B is actually better because it uses more precise language. The evidence shows stronger coherence throughout.';

const VALID_JUDGE_JSON = JSON.stringify({
  winner: 'A',
  reasoning: 'Variant A has better structure overall',
  strengths_from_a: ['Clear thesis statement', 'Good paragraph flow'],
  strengths_from_b: ['Precise language', 'Strong evidence use'],
  improvements: ['Combine structural clarity with precise language', 'Add more transitions'],
});

function makeMockLLMClient(responses?: string[]): EvolutionLLMClient {
  const defaultResponses = [ADVOCATE_A_RESPONSE, ADVOCATE_B_RESPONSE, VALID_JUDGE_JSON, VALID_ARTICLE];
  const queue = [...(responses ?? defaultResponses)];
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
    getTotalReserved: jest.fn().mockReturnValue(0),
    getInvocationCost: jest.fn().mockReturnValue(0),
    releaseReservation: jest.fn(),
    setEventLogger: jest.fn(),
  };
}

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  const state = new PipelineStateImpl('# Original\n\n## Section\n\nOriginal text content here. This is a second sentence.');
  // Seed with 3 non-baseline variants
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
    // Give them ratings so getTopByRating works
    state.ratings.set(`v-${i}`, { mu: 25 + i * (25 / 400) * 50, sigma: 4 });
  }
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

describe('DebateAgent', () => {
  const agent = new DebateAgent();

  it('has correct name', () => {
    expect(agent.name).toBe('debate');
  });

  it('successful debate creates variant', async () => {
    const ctx = makeCtx();
    const poolSizeBefore = ctx.state.getPoolSize();
    const result = await agent.execute(ctx);

    expect(result.success).toBe(true);
    expect(result.agentType).toBe('debate');
    expect(result.variantsAdded).toBe(1);
    expect(ctx.state.getPoolSize()).toBe(poolSizeBefore + 1);

    // Transcript stored
    expect(ctx.state.debateTranscripts).toHaveLength(1);
    const transcript = ctx.state.debateTranscripts[0];
    expect(transcript.turns).toHaveLength(3);
    expect(transcript.turns[0].role).toBe('advocate_a');
    expect(transcript.turns[1].role).toBe('advocate_b');
    expect(transcript.turns[2].role).toBe('judge');
    expect(transcript.synthesisVariantId).not.toBeNull();
  });

  it('makes exactly 4 LLM calls', async () => {
    const ctx = makeCtx();
    await agent.execute(ctx);
    expect((ctx.llmClient.complete as jest.Mock).mock.calls).toHaveLength(4);
  });

  it('canExecute requires 2+ rated non-baseline variants', () => {
    const emptyState = new PipelineStateImpl('text');
    expect(agent.canExecute(emptyState)).toBe(false);

    // 1 variant with rating — still not enough
    emptyState.addToPool({
      id: 'v1', text: 'text', version: 1,
      parentIds: [], strategy: 'test', createdAt: 0, iterationBorn: 0,
    });
    emptyState.ratings.set('v1', { mu: 25, sigma: 8.333 });
    expect(agent.canExecute(emptyState)).toBe(false);

    // 2 variants with ratings — now sufficient
    emptyState.addToPool({
      id: 'v2', text: 'text2', version: 1,
      parentIds: [], strategy: 'test', createdAt: 0, iterationBorn: 0,
    });
    emptyState.ratings.set('v2', { mu: 25, sigma: 8.333 });
    expect(agent.canExecute(emptyState)).toBe(true);
  });

  it('canExecute returns false when only baselines have ratings', () => {
    const state = new PipelineStateImpl('text');
    state.addToPool({
      id: 'b1', text: 'text', version: 0,
      parentIds: [], strategy: 'original_baseline', createdAt: 0, iterationBorn: 0,
    });
    state.addToPool({
      id: 'b2', text: 'text2', version: 0,
      parentIds: [], strategy: 'original_baseline', createdAt: 0, iterationBorn: 0,
    });
    state.ratings.set('b1', { mu: 25, sigma: 8.333 });
    state.ratings.set('b2', { mu: 25, sigma: 8.333 });
    expect(agent.canExecute(state)).toBe(false);
  });

  it('estimateCost returns positive value', () => {
    const cost = agent.estimateCost({
      originalText: 'x'.repeat(2000),
      title: 'Test',
      explanationId: 1,
      runId: 'test',
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    });
    expect(cost).toBeGreaterThan(0);
  });

  it('handles judge parse failure', async () => {
    const ctx = makeCtx({
      llmClient: makeMockLLMClient([
        ADVOCATE_A_RESPONSE,
        ADVOCATE_B_RESPONSE,
        'not valid json at all',
        VALID_ARTICLE,
      ]),
    });
    const result = await agent.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('parse failed');

    // Partial transcript stored (3 turns but no synthesis)
    expect(ctx.state.debateTranscripts).toHaveLength(1);
    expect(ctx.state.debateTranscripts[0].turns).toHaveLength(3);
    expect(ctx.state.debateTranscripts[0].synthesisVariantId).toBeNull();
  });

  it('handles format-invalid synthesis', async () => {
    const ctx = makeCtx({
      llmClient: makeMockLLMClient([
        ADVOCATE_A_RESPONSE,
        ADVOCATE_B_RESPONSE,
        VALID_JUDGE_JSON,
        'just plain text with no headings',
      ]),
    });
    const result = await agent.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Format invalid');

    // Full transcript but null synthesisVariantId
    expect(ctx.state.debateTranscripts).toHaveLength(1);
    expect(ctx.state.debateTranscripts[0].turns).toHaveLength(3);
    expect(ctx.state.debateTranscripts[0].synthesisVariantId).toBeNull();
  });

  it('BudgetExceededError propagates without corrupting state', async () => {
    const mockClient = makeMockLLMClient();
    (mockClient.complete as jest.Mock).mockRejectedValueOnce(
      new BudgetExceededError('debate', 1.0, 0, 0.5),
    );
    const ctx = makeCtx({ llmClient: mockClient });
    await expect(agent.execute(ctx)).rejects.toThrow(BudgetExceededError);

    // BudgetExceededError should NOT push partial transcript to state (prevents checkpoint corruption)
    expect(ctx.state.debateTranscripts).toHaveLength(0);
  });

  it('stores partial transcript on advocate B failure', async () => {
    const mockClient = makeMockLLMClient();
    let callNum = 0;
    (mockClient.complete as jest.Mock).mockImplementation(() => {
      callNum++;
      if (callNum === 1) return Promise.resolve(ADVOCATE_A_RESPONSE);
      if (callNum === 2) return Promise.reject(new Error('API timeout'));
      return Promise.resolve('');
    });

    const ctx = makeCtx({ llmClient: mockClient });
    const result = await agent.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Advocate B failed');

    // Partial transcript with only advocate A turn
    expect(ctx.state.debateTranscripts).toHaveLength(1);
    expect(ctx.state.debateTranscripts[0].turns).toHaveLength(1);
    expect(ctx.state.debateTranscripts[0].turns[0].role).toBe('advocate_a');
  });

  it('consumes existing critiques', async () => {
    const ctx = makeCtx();
    // Seed critiques for the top variants
    const critique: Critique = {
      variationId: 'v-2', // highest Elo
      dimensionScores: { clarity: 5, structure: 4 },
      goodExamples: {},
      badExamples: { clarity: ['Vague opening'] },
      notes: { structure: 'Needs better transitions' },
      reviewer: 'llm',
    };
    ctx.state.allCritiques = [critique];

    await agent.execute(ctx);

    // The first LLM call (advocate A) prompt should contain critique context
    const firstCallArgs = (ctx.llmClient.complete as jest.Mock).mock.calls[0];
    expect(firstCallArgs[0]).toContain('Known Issues');
  });

  it('works without critiques', async () => {
    const ctx = makeCtx();
    ctx.state.allCritiques = null;

    const result = await agent.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.variantsAdded).toBe(1);
  });

  it('new variant has correct parentIds and strategy', async () => {
    const ctx = makeCtx();
    await agent.execute(ctx);

    // Find the new variant (the one that wasn't in original pool)
    const newVariant = ctx.state.pool.find((v) => v.strategy === 'debate_synthesis');
    expect(newVariant).toBeDefined();
    expect(newVariant!.parentIds).toHaveLength(2);
    expect(newVariant!.strategy).toBe('debate_synthesis');
    expect(newVariant!.version).toBeGreaterThan(1);
  });

  describe('executionDetail', () => {
    it('captures full debate detail on success', async () => {
      const ctx = makeCtx();
      const result = await agent.execute(ctx);

      expect(result.executionDetail).toBeDefined();
      const detail = result.executionDetail as DebateExecutionDetail;
      expect(detail.detailType).toBe('debate');
      expect(detail.variantA.id).toBe('v-2'); // highest rated
      expect(detail.variantB.id).toBe('v-1');
      expect(detail.variantA.ordinal).toBeGreaterThan(0);
      expect(detail.transcript).toHaveLength(3);
      expect(detail.judgeVerdict).toBeDefined();
      expect(detail.judgeVerdict!.winner).toBe('A');
      expect(detail.judgeVerdict!.strengthsFromA).toHaveLength(2);
      expect(detail.synthesisVariantId).toBeDefined();
      expect(detail.synthesisTextLength).toBeGreaterThan(0);
      expect(detail.formatValid).toBe(true);
      expect(detail.failurePoint).toBeUndefined();
    });

    it('records failurePoint on judge parse failure', async () => {
      const ctx = makeCtx({
        llmClient: makeMockLLMClient([ADVOCATE_A_RESPONSE, ADVOCATE_B_RESPONSE, 'not json', VALID_ARTICLE]),
      });
      const result = await agent.execute(ctx);

      const detail = result.executionDetail as DebateExecutionDetail;
      expect(detail.failurePoint).toBe('parse');
      expect(detail.transcript).toHaveLength(3);
      expect(detail.judgeVerdict).toBeUndefined();
    });

    it('records failurePoint on format rejection', async () => {
      const ctx = makeCtx({
        llmClient: makeMockLLMClient([ADVOCATE_A_RESPONSE, ADVOCATE_B_RESPONSE, VALID_JUDGE_JSON, 'plain text no headings']),
      });
      const result = await agent.execute(ctx);

      const detail = result.executionDetail as DebateExecutionDetail;
      expect(detail.failurePoint).toBe('format');
      expect(detail.formatValid).toBe(false);
      expect(detail.formatIssues).toBeDefined();
      expect(detail.judgeVerdict).toBeDefined();
    });

    it('records failurePoint on advocate B error', async () => {
      const mockClient = makeMockLLMClient();
      let callNum = 0;
      (mockClient.complete as jest.Mock).mockImplementation(() => {
        callNum++;
        if (callNum === 1) return Promise.resolve(ADVOCATE_A_RESPONSE);
        if (callNum === 2) return Promise.reject(new Error('timeout'));
        return Promise.resolve('');
      });
      const ctx = makeCtx({ llmClient: mockClient });
      const result = await agent.execute(ctx);

      const detail = result.executionDetail as DebateExecutionDetail;
      expect(detail.failurePoint).toBe('advocate_b');
      expect(detail.transcript).toHaveLength(1); // only advocate A
    });
  });

  it('includes all 4 meta-feedback types in synthesis prompt', async () => {
    const ctx = makeCtx();
    ctx.state.metaFeedback = {
      priorityImprovements: ['add examples'],
      recurringWeaknesses: ['too abstract'],
      successfulStrategies: ['good structure'],
      patternsToAvoid: ['wall of text'],
    };
    await agent.execute(ctx);

    // 4th call is the synthesis prompt where meta-feedback is injected
    const calls = (ctx.llmClient.complete as jest.Mock).mock.calls;
    const synthesisPrompt = calls[3][0];
    expect(synthesisPrompt).toContain('add examples');
    expect(synthesisPrompt).toContain('too abstract');
    expect(synthesisPrompt).toContain('good structure');
    expect(synthesisPrompt).toContain('wall of text');
  });

  it('skips baseline variant', async () => {
    const ctx = makeCtx();
    // Add a baseline with highest rating
    ctx.state.addToPool({
      id: 'baseline-test',
      text: VALID_ARTICLE,
      version: 0,
      parentIds: [],
      strategy: 'original_baseline',
      createdAt: Date.now() / 1000,
      iterationBorn: 0,
    });
    ctx.state.ratings.set('baseline-test', { mu: 99, sigma: 1 });

    const result = await agent.execute(ctx);
    expect(result.success).toBe(true);

    // The debate should NOT have used the baseline
    const transcript = ctx.state.debateTranscripts[0];
    expect(transcript.variantAId).not.toBe('baseline-test');
    expect(transcript.variantBId).not.toBe('baseline-test');
  });
});
