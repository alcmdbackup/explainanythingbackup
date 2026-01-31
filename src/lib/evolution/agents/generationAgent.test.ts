// Unit tests for GenerationAgent with mocked LLM client.
// Verifies 3-strategy generation, format validation, and state mutation.

import { GenerationAgent } from './generationAgent';
import { PipelineStateImpl } from '../core/state';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig } from '../types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';

const VALID_GENERATED = `# Restructured Article

## First Section

This is a well-formed paragraph with multiple sentences. It demonstrates the structural transformation strategy.

## Second Section

Here we have the second part of the article. The content has been reorganized for better flow.`;

function makeMockLLMClient(response: string = VALID_GENERATED): EvolutionLLMClient {
  return {
    complete: jest.fn().mockResolvedValue(response),
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
  return {
    reserveBudget: jest.fn().mockResolvedValue(undefined),
    recordSpend: jest.fn(),
    getAgentCost: jest.fn().mockReturnValue(0),
    getTotalSpent: jest.fn().mockReturnValue(0),
    getAvailableBudget: jest.fn().mockReturnValue(5),
  };
}

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  const state = new PipelineStateImpl('# Original Article\n\n## Intro\n\nOriginal text here. With some content.');
  return {
    payload: {
      originalText: state.originalText,
      title: 'Test Article',
      explanationId: 1,
      runId: 'test-run-1',
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    },
    state,
    llmClient: makeMockLLMClient(),
    logger: makeMockLogger(),
    costTracker: makeMockCostTracker(),
    runId: 'test-run-1',
    ...overrides,
  };
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
