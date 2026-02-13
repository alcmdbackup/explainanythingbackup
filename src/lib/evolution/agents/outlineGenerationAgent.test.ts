// Unit tests for OutlineGenerationAgent with queue-based LLM mocking.
// Verifies 6-call pipeline, step scoring, error handling, and canExecute/estimateCost.

import { OutlineGenerationAgent } from './outlineGenerationAgent';
import { PipelineStateImpl } from '../core/state';
import { isOutlineVariant } from '../types';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig, OutlineGenerationExecutionDetail } from '../types';
import { BudgetExceededError } from '../types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';

const VALID_OUTLINE = `## Introduction
This section introduces the topic and provides context for the reader.

## Main Concepts
This section covers the core ideas and principles discussed in the article.

## Applications
This section explores real-world applications and examples.`;

const VALID_EXPANDED = `# Understanding the Topic

## Introduction

This article introduces the topic and provides important context. The reader will gain a foundational understanding of the key concepts involved.

## Main Concepts

The core ideas center around several principles. These principles have been developed over decades of research and practice.

## Applications

Real-world applications of these concepts are numerous. They span industries from technology to healthcare.`;

const VALID_POLISHED = `# Understanding the Topic

## Introduction

This article introduces the topic and provides essential context for understanding the subject matter. The reader will develop a strong foundational grasp of the key concepts and their significance.

## Main Concepts

At the heart of this field lie several interconnected principles that form a cohesive framework. These principles have evolved through decades of rigorous research and practical application.

## Applications

The real-world applications of these concepts extend across numerous domains and industries. From cutting-edge technology to modern healthcare, practitioners leverage these ideas daily.`;

function makeMockLLMClient(responses: string[]): EvolutionLLMClient {
  let callIndex = 0;
  return {
    complete: jest.fn().mockImplementation(() => {
      const resp = responses[callIndex % responses.length];
      callIndex++;
      return Promise.resolve(resp);
    }),
    completeStructured: jest.fn(),
  };
}

function makeMockLogger(): EvolutionLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

function makeMockCostTracker(): CostTracker {
  const agentCosts = new Map<string, number>();
  return {
    reserveBudget: jest.fn().mockResolvedValue(undefined),
    recordSpend: jest.fn((name: string, cost: number) => { agentCosts.set(name, (agentCosts.get(name) ?? 0) + cost); }),
    getAgentCost: jest.fn((name: string) => agentCosts.get(name) ?? 0),
    getTotalSpent: jest.fn().mockReturnValue(0),
    getAvailableBudget: jest.fn().mockReturnValue(5),
    getAllAgentCosts: jest.fn(() => Object.fromEntries(agentCosts)),
  };
}

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  const state = new PipelineStateImpl('# Original Article\n\n## Intro\n\nOriginal text here. With some detailed content to transform.');
  return {
    payload: {
      originalText: state.originalText,
      title: 'Test Article',
      explanationId: 1,
      runId: 'test-run-1',
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    },
    state,
    llmClient: makeMockLLMClient([
      VALID_OUTLINE,   // step 1: outline
      '0.85',          // step 2: score outline
      VALID_EXPANDED,  // step 3: expand
      '0.7',           // step 4: score expand
      VALID_POLISHED,  // step 5: polish
      '0.9',           // step 6: score polish
    ]),
    logger: makeMockLogger(),
    costTracker: makeMockCostTracker(),
    runId: 'test-run-1',
    ...overrides,
  };
}

describe('OutlineGenerationAgent', () => {
  const agent = new OutlineGenerationAgent();

  it('has correct name', () => {
    expect(agent.name).toBe('outlineGeneration');
  });

  it('executes full 6-call pipeline and produces OutlineVariant', async () => {
    const ctx = makeCtx();
    const result = await agent.execute(ctx);

    expect(result.success).toBe(true);
    expect(result.variantsAdded).toBe(1);
    expect(result.agentType).toBe('outlineGeneration');
    expect((ctx.llmClient.complete as jest.Mock).mock.calls).toHaveLength(6);

    // Verify variant in pool
    expect(ctx.state.pool).toHaveLength(1);
    const variant = ctx.state.pool[0];
    expect(isOutlineVariant(variant)).toBe(true);

    if (isOutlineVariant(variant)) {
      expect(variant.strategy).toBe('outline_generation');
      expect(variant.steps).toHaveLength(4); // outline, expand, polish, verify
      expect(variant.steps[0].name).toBe('outline');
      expect(variant.steps[0].score).toBeCloseTo(0.85);
      expect(variant.steps[1].name).toBe('expand');
      expect(variant.steps[1].score).toBeCloseTo(0.7);
      expect(variant.steps[2].name).toBe('polish');
      expect(variant.steps[2].score).toBeCloseTo(0.9);
      expect(variant.steps[3].name).toBe('verify');
      expect(variant.outline).toBeTruthy();
      expect(variant.text).toBe(VALID_POLISHED); // .text = final polished text
      expect(variant.weakestStep).toBe('expand'); // 0.7 is lowest among outline/expand/polish
    }
  });

  it('makes 6 LLM calls in correct order', async () => {
    const ctx = makeCtx();
    await agent.execute(ctx);

    const calls = (ctx.llmClient.complete as jest.Mock).mock.calls;
    expect(calls).toHaveLength(6);

    // Outline prompt
    expect(calls[0][0]).toContain('outline');
    expect(calls[0][1]).toBe('outlineGeneration');

    // Score prompt references outline quality
    expect(calls[1][0]).toContain('0 to 1');
    expect(calls[1][1]).toBe('outlineGeneration');

    // Expand prompt references outline
    expect(calls[2][0]).toContain('Expand');
    expect(calls[2][1]).toBe('outlineGeneration');

    // Score expand
    expect(calls[3][0]).toContain('0 to 1');

    // Polish prompt
    expect(calls[4][0]).toContain('Polish');

    // Score polish
    expect(calls[5][0]).toContain('0 to 1');
  });

  it('uses generationModel for generation steps and judgeModel for scoring', async () => {
    const ctx = makeCtx();
    await agent.execute(ctx);

    const calls = (ctx.llmClient.complete as jest.Mock).mock.calls;
    // Generation calls (0, 2, 4) should use generationModel
    expect(calls[0][2]).toEqual({ model: DEFAULT_EVOLUTION_CONFIG.generationModel });
    expect(calls[2][2]).toEqual({ model: DEFAULT_EVOLUTION_CONFIG.generationModel });
    expect(calls[4][2]).toEqual({ model: DEFAULT_EVOLUTION_CONFIG.generationModel });

    // Scoring calls (1, 3, 5) should use judgeModel
    expect(calls[1][2]).toEqual({ model: DEFAULT_EVOLUTION_CONFIG.judgeModel });
    expect(calls[3][2]).toEqual({ model: DEFAULT_EVOLUTION_CONFIG.judgeModel });
    expect(calls[5][2]).toEqual({ model: DEFAULT_EVOLUTION_CONFIG.judgeModel });
  });

  it('handles non-numeric score output gracefully', async () => {
    const ctx = makeCtx({
      llmClient: makeMockLLMClient([
        VALID_OUTLINE,
        'This outline is excellent!', // non-numeric → 0.5
        VALID_EXPANDED,
        'great quality',              // non-numeric → 0.5
        VALID_POLISHED,
        '0.9',                        // valid score
      ]),
    });

    const result = await agent.execute(ctx);
    expect(result.success).toBe(true);

    const variant = ctx.state.pool[0];
    if (isOutlineVariant(variant)) {
      expect(variant.steps[0].score).toBe(0.5); // default for non-numeric
      expect(variant.steps[1].score).toBe(0.5); // default for non-numeric
      expect(variant.steps[2].score).toBeCloseTo(0.9);
    }
  });

  it('handles empty outline output', async () => {
    const ctx = makeCtx({
      llmClient: makeMockLLMClient([
        '',        // empty outline
        '0.5',
        VALID_EXPANDED,
        '0.7',
        VALID_POLISHED,
        '0.9',
      ]),
    });

    const result = await agent.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('empty');
    expect(ctx.state.pool).toHaveLength(0);
  });

  it('falls back to outline text when expand produces empty output', async () => {
    const ctx = makeCtx({
      llmClient: makeMockLLMClient([
        VALID_OUTLINE,
        '0.85',
        '',         // empty expansion
        '0.5',
        VALID_POLISHED,
        '0.9',
      ]),
    });

    const result = await agent.execute(ctx);
    expect(result.success).toBe(true);
    expect(ctx.state.pool).toHaveLength(1);
    // Variant should use the outline text as fallback
    const variant = ctx.state.pool[0];
    expect(variant.text).toBe(VALID_OUTLINE);
  });

  it('uses expanded text when polish produces empty output', async () => {
    const ctx = makeCtx({
      llmClient: makeMockLLMClient([
        VALID_OUTLINE,
        '0.85',
        VALID_EXPANDED,
        '0.7',
        '',         // empty polish → falls back to expanded
        '0.5',
      ]),
    });

    const result = await agent.execute(ctx);
    expect(result.success).toBe(true);
    expect(ctx.state.pool).toHaveLength(1);
    const variant = ctx.state.pool[0];
    expect(variant.text).toBe(VALID_EXPANDED);
  });

  it('re-throws BudgetExceededError', async () => {
    const mockClient = makeMockLLMClient([]);
    (mockClient.complete as jest.Mock).mockRejectedValue(
      new BudgetExceededError('outlineGeneration', 0.12, 0.10),
    );
    const ctx = makeCtx({ llmClient: mockClient });

    await expect(agent.execute(ctx)).rejects.toThrow(BudgetExceededError);
  });

  it('handles generic LLM error after partial steps', async () => {
    let callCount = 0;
    const mockClient: EvolutionLLMClient = {
      complete: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(VALID_OUTLINE);
        if (callCount === 2) return Promise.resolve('0.85');
        throw new Error('API connection lost');
      }),
      completeStructured: jest.fn(),
    };
    const ctx = makeCtx({ llmClient: mockClient });

    const result = await agent.execute(ctx);
    // Should create partial variant from outline step
    expect(result.success).toBe(true);
    expect(ctx.state.pool).toHaveLength(1);
  });

  it('fails when no originalText in state', async () => {
    const ctx = makeCtx();
    ctx.state = new PipelineStateImpl('');
    const result = await agent.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('originalText');
  });

  describe('canExecute', () => {
    it('returns true when originalText exists', () => {
      const state = new PipelineStateImpl('some text');
      expect(agent.canExecute(state)).toBe(true);
    });

    it('returns false when originalText is empty', () => {
      const state = new PipelineStateImpl('');
      expect(agent.canExecute(state)).toBe(false);
    });
  });

  it('attributes step costs correctly (no bleed between steps)', async () => {
    // Create a cost tracker that increments by 0.01 per LLM call
    let totalCost = 0;
    const costPerCall = 0.01;
    const costTracker: CostTracker = {
      reserveBudget: jest.fn().mockResolvedValue(undefined),
      recordSpend: jest.fn(),
      getAgentCost: jest.fn().mockImplementation(() => totalCost),
      getTotalSpent: jest.fn().mockReturnValue(0),
      getAvailableBudget: jest.fn().mockReturnValue(5),
      getAllAgentCosts: jest.fn(() => ({ outlineGeneration: totalCost })),
    };

    // LLM client that increments cost per call
    let callIndex = 0;
    const responses = [VALID_OUTLINE, '0.85', VALID_EXPANDED, '0.7', VALID_POLISHED, '0.9'];
    const llmClient: EvolutionLLMClient = {
      complete: jest.fn().mockImplementation(() => {
        totalCost += costPerCall;
        const resp = responses[callIndex % responses.length];
        callIndex++;
        return Promise.resolve(resp);
      }),
      completeStructured: jest.fn(),
    };

    const ctx = makeCtx({ llmClient, costTracker });
    await agent.execute(ctx);

    const variant = ctx.state.pool[0];
    expect(isOutlineVariant(variant)).toBe(true);
    if (isOutlineVariant(variant)) {
      // 6 calls × 0.01 = 0.06 total
      // outline step: 2 calls (gen + score) = 0.02
      // expand step: 2 calls (gen + score) = 0.02
      // polish step: 2 calls (gen + score) = 0.02
      // verify step: 0 calls = 0.00
      expect(variant.steps[0].costUsd).toBeCloseTo(0.02); // outline
      expect(variant.steps[1].costUsd).toBeCloseTo(0.02); // expand
      expect(variant.steps[2].costUsd).toBeCloseTo(0.02); // polish
      expect(variant.steps[3].costUsd).toBe(0);            // verify (no LLM call)

      // Step costs should sum to total variant cost
      const stepCostSum = variant.steps.reduce((sum, s) => sum + s.costUsd, 0);
      expect(stepCostSum).toBeCloseTo(variant.costUsd ?? 0);
    }
  });

  describe('estimateCost', () => {
    it('returns positive value proportional to text length', () => {
      const cost = agent.estimateCost({
        originalText: 'x'.repeat(4000),
        title: 'Test',
        explanationId: 1,
        runId: 'test',
        config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
      });
      expect(cost).toBeGreaterThan(0);
    });

    it('returns higher cost for longer text', () => {
      const shortCost = agent.estimateCost({
        originalText: 'x'.repeat(1000),
        title: 'Test',
        explanationId: 1,
        runId: 'test',
        config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
      });
      const longCost = agent.estimateCost({
        originalText: 'x'.repeat(10000),
        title: 'Test',
        explanationId: 1,
        runId: 'test',
        config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
      });
      expect(longCost).toBeGreaterThan(shortCost);
    });
  });
});

describe('OutlineGenerationAgent executionDetail', () => {
  const agent = new OutlineGenerationAgent();

  it('captures 4 steps with scores and lengths on success', async () => {
    const ctx = makeCtx();
    const result = await agent.execute(ctx);

    expect(result.executionDetail).toBeDefined();
    expect(result.executionDetail!.detailType).toBe('outlineGeneration');
    const detail = result.executionDetail as OutlineGenerationExecutionDetail;
    expect(detail.steps).toHaveLength(4);
    expect(detail.steps.map(s => s.name)).toEqual(['outline', 'expand', 'polish', 'verify']);
    expect(detail.weakestStep).toBe('expand'); // 0.7 is lowest
    expect(detail.variantId).toBeTruthy();
    for (const s of detail.steps) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
      expect(s.inputLength).toBeGreaterThan(0);
      expect(s.outputLength).toBeGreaterThan(0);
    }
  });

  it('captures detail on empty outline failure', async () => {
    const ctx = makeCtx({
      llmClient: makeMockLLMClient(['', '0.5', VALID_EXPANDED, '0.7', VALID_POLISHED, '0.9']),
    });
    const result = await agent.execute(ctx);

    expect(result.success).toBe(false);
    expect(result.executionDetail).toBeDefined();
    const detail = result.executionDetail as OutlineGenerationExecutionDetail;
    expect(detail.detailType).toBe('outlineGeneration');
    expect(detail.steps).toHaveLength(0);
    expect(detail.variantId).toBe('');
  });

  it('captures detail on expand fallback', async () => {
    const ctx = makeCtx({
      llmClient: makeMockLLMClient([VALID_OUTLINE, '0.85', '', '0.5', VALID_POLISHED, '0.9']),
    });
    const result = await agent.execute(ctx);

    expect(result.success).toBe(true);
    expect(result.executionDetail).toBeDefined();
    const detail = result.executionDetail as OutlineGenerationExecutionDetail;
    // Only outline step completed before fallback
    expect(detail.steps).toHaveLength(1);
    expect(detail.steps[0].name).toBe('outline');
    expect(detail.variantId).toBeTruthy();
  });
});
