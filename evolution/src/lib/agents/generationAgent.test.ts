// Unit tests for GenerationAgent with mocked LLM client.
// Verifies 3-strategy generation, format validation, and state mutation.

import { GenerationAgent } from './generationAgent';
import { PipelineStateImpl } from '../core/state';
import type { EvolutionLLMClient, EvolutionRunConfig, GenerationExecutionDetail } from '../types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';
import { createMockExecutionContext, createMockEvolutionLLMClient } from '@evolution/testing/evolution-test-helpers';

const VALID_GENERATED = `# Restructured Article

## First Section

This is a well-formed paragraph with multiple sentences. It demonstrates the structural transformation strategy.

## Second Section

Here we have the second part of the article. The content has been reorganized for better flow.`;

function makeMockLLMClient(response: string = VALID_GENERATED): EvolutionLLMClient {
  return createMockEvolutionLLMClient({
    complete: jest.fn().mockResolvedValue(response),
    completeStructured: jest.fn(),
  });
}

function makeCtx(overrides: Partial<import('../types').ExecutionContext> = {}) {
  return createMockExecutionContext({ llmClient: makeMockLLMClient(), ...overrides });
}

describe('GenerationAgent', () => {
  const agent = new GenerationAgent();

  it('has correct name', () => {
    expect(agent.name).toBe('generation');
  });

  it('generates 3 variants using all strategies', async () => {
    const ctx = makeCtx();
    const result = await agent.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.variantsAdded).toBe(3);
    expect(ctx.state.pool).toHaveLength(3);
    expect((ctx.llmClient.complete as jest.Mock).mock.calls).toHaveLength(3);
  });

  it('adds variants to pool with correct metadata', async () => {
    const ctx = makeCtx();
    await agent.execute(ctx);
    const strategies = ctx.state.pool.map((v) => v.strategy);
    expect(strategies).toContain('structural_transform');
    expect(strategies).toContain('lexical_simplify');
    expect(strategies).toContain('grounding_enhance');
    for (const v of ctx.state.pool) {
      expect(v.parentIds).toEqual([]);
      expect(v.iterationBorn).toBe(0);
    }
  });

  it('skips variants that fail format validation', async () => {
    const badResponse = 'No H1 title, no headings, just plain text';
    const ctx = makeCtx({ llmClient: makeMockLLMClient(badResponse) });
    const result = await agent.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('All strategies failed');
    expect(ctx.state.pool).toHaveLength(0);
  });

  it('continues after LLM error on one strategy', async () => {
    const mockClient = makeMockLLMClient();
    let callCount = 0;
    (mockClient.complete as jest.Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error('API error');
      return Promise.resolve(VALID_GENERATED);
    });
    const ctx = makeCtx({ llmClient: mockClient });
    const result = await agent.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.variantsAdded).toBe(2); // 1 failed, 2 succeeded
  });

  it('fails when no originalText in state', async () => {
    const ctx = makeCtx();
    ctx.state = new PipelineStateImpl('');
    const result = await agent.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('originalText');
  });

  it('canExecute returns true when originalText exists', () => {
    const state = new PipelineStateImpl('some text');
    expect(agent.canExecute(state)).toBe(true);
  });

  it('canExecute returns false when originalText is empty', () => {
    const state = new PipelineStateImpl('');
    expect(agent.canExecute(state)).toBe(false);
  });

  it('estimateCost returns positive value', () => {
    const cost = agent.estimateCost({
      originalText: 'x'.repeat(4000),
      title: 'Test',
      explanationId: 1,
      runId: 'test',
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    });
    expect(cost).toBeGreaterThan(0);
  });
});

describe('GenerationAgent executionDetail', () => {
  const agent = new GenerationAgent();

  it('captures per-strategy detail on success', async () => {
    const ctx = makeCtx();
    const result = await agent.execute(ctx);

    expect(result.executionDetail).toBeDefined();
    expect(result.executionDetail!.detailType).toBe('generation');
    const detail = result.executionDetail as GenerationExecutionDetail;
    expect(detail.strategies).toHaveLength(3);
    expect(detail.feedbackUsed).toBe(false);
    for (const s of detail.strategies) {
      expect(s.status).toBe('success');
      expect(s.promptLength).toBeGreaterThan(0);
      expect(s.variantId).toBeDefined();
      expect(s.textLength).toBeGreaterThan(0);
    }
    const names = detail.strategies.map(s => s.name);
    expect(names).toContain('structural_transform');
    expect(names).toContain('lexical_simplify');
    expect(names).toContain('grounding_enhance');
  });

  it('captures format_rejected status', async () => {
    const badResponse = 'No H1 title, no headings, just plain text';
    const ctx = makeCtx({ llmClient: makeMockLLMClient(badResponse) });
    const result = await agent.execute(ctx);

    expect(result.executionDetail).toBeDefined();
    const detail = result.executionDetail as GenerationExecutionDetail;
    expect(detail.strategies.every(s => s.status === 'format_rejected')).toBe(true);
    expect(detail.strategies[0].formatIssues).toBeDefined();
    expect(detail.strategies[0].formatIssues!.length).toBeGreaterThan(0);
  });

  it('captures error status for rejected promises', async () => {
    const mockClient = makeMockLLMClient();
    let callCount = 0;
    (mockClient.complete as jest.Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error('API error');
      return Promise.resolve(VALID_GENERATED);
    });
    const ctx = makeCtx({ llmClient: mockClient });
    const result = await agent.execute(ctx);

    const detail = result.executionDetail as GenerationExecutionDetail;
    const errorStrategies = detail.strategies.filter(s => s.status === 'error');
    expect(errorStrategies.length).toBe(1);
    expect(errorStrategies[0].error).toContain('API error');
    const successStrategies = detail.strategies.filter(s => s.status === 'success');
    expect(successStrategies.length).toBe(2);
  });

  it('sets feedbackUsed to true when metaFeedback exists', async () => {
    const ctx = makeCtx();
    ctx.state.metaFeedback = {
      successfulStrategies: [],
      recurringWeaknesses: [],
      patternsToAvoid: [],
      priorityImprovements: ['improve clarity'],
    };
    const result = await agent.execute(ctx);

    const detail = result.executionDetail as GenerationExecutionDetail;
    expect(detail.feedbackUsed).toBe(true);
  });
});
