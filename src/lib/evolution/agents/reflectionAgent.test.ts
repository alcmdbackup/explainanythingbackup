// Unit tests for ReflectionAgent — dimensional critique with mocked LLM.

import {
  ReflectionAgent,
  CRITIQUE_DIMENSIONS,
  getCritiqueForVariant,
  getWeakestDimension,
  getImprovementSuggestions,
} from './reflectionAgent';
import { PipelineStateImpl } from '../core/state';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig, Critique } from '../types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';

const VALID_CRITIQUE_JSON = JSON.stringify({
  scores: { clarity: 8, structure: 7, engagement: 6, precision: 9, coherence: 7 },
  good_examples: { clarity: 'The opening paragraph clearly states the thesis' },
  bad_examples: { engagement: 'The middle section lacks compelling examples' },
  notes: { precision: 'Technical terms used accurately throughout' },
});

function makeMockLLMClient(response: string = VALID_CRITIQUE_JSON): EvolutionLLMClient {
  return {
    complete: jest.fn().mockResolvedValue(response),
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
  };
}

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  const state = new PipelineStateImpl('# Original\n\n## Section\n\nOriginal text content here.');
  // Seed with 3 variants
  for (let i = 0; i < 3; i++) {
    state.addToPool({
      id: `v-${i}`,
      text: `# Variant ${i}\n\n## Section\n\nVariant ${i} text content.`,
      version: 1,
      parentIds: [],
      strategy: 'structural_transform',
      createdAt: Date.now() / 1000,
      iterationBorn: 0,
    });
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

describe('ReflectionAgent', () => {
  const agent = new ReflectionAgent();

  it('has correct name', () => {
    expect(agent.name).toBe('reflection');
  });

  it('generates critiques for top variants', async () => {
    const ctx = makeCtx();
    const result = await agent.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.agentType).toBe('reflection');
    expect(ctx.state.allCritiques).not.toBeNull();
    expect(ctx.state.allCritiques!.length).toBe(3);
  });

  it('updates dimensionScores in state', async () => {
    const ctx = makeCtx();
    await agent.execute(ctx);
    expect(ctx.state.dimensionScores).not.toBeNull();
    expect(Object.keys(ctx.state.dimensionScores!)).toHaveLength(3);
    for (const scores of Object.values(ctx.state.dimensionScores!)) {
      expect(scores.clarity).toBe(8);
    }
  });

  it('calls LLM once per variant', async () => {
    const ctx = makeCtx();
    await agent.execute(ctx);
    expect((ctx.llmClient.complete as jest.Mock).mock.calls).toHaveLength(3);
  });

  it('handles malformed JSON gracefully', async () => {
    const ctx = makeCtx({ llmClient: makeMockLLMClient('not json at all') });
    const result = await agent.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('All critiques failed');
  });

  it('handles JSON wrapped in markdown fences', async () => {
    const wrappedJson = '```json\n' + VALID_CRITIQUE_JSON + '\n```';
    const ctx = makeCtx({ llmClient: makeMockLLMClient(wrappedJson) });
    const result = await agent.execute(ctx);
    expect(result.success).toBe(true);
    expect(ctx.state.allCritiques!.length).toBe(3);
  });

  it('continues after LLM error on one variant', async () => {
    const mockClient = makeMockLLMClient();
    let callCount = 0;
    (mockClient.complete as jest.Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error('API error');
      return Promise.resolve(VALID_CRITIQUE_JSON);
    });
    const ctx = makeCtx({ llmClient: mockClient });
    const result = await agent.execute(ctx);
    expect(result.success).toBe(true);
    expect(ctx.state.allCritiques!.length).toBe(2);
  });

  it('returns failure when pool is empty', async () => {
    const ctx = makeCtx();
    ctx.state = new PipelineStateImpl('original');
    const result = await agent.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No variants');
  });

  it('canExecute returns true with variants', () => {
    const state = new PipelineStateImpl('text');
    state.addToPool({
      id: 'v1', text: '# V\n\n## S\n\nText', version: 1,
      parentIds: [], strategy: 'test', createdAt: 0, iterationBorn: 0,
    });
    expect(agent.canExecute(state)).toBe(true);
  });

  it('canExecute returns false for empty pool', () => {
    const state = new PipelineStateImpl('text');
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

  it('exports CRITIQUE_DIMENSIONS', () => {
    expect(CRITIQUE_DIMENSIONS).toContain('clarity');
    expect(CRITIQUE_DIMENSIONS).toContain('structure');
    expect(CRITIQUE_DIMENSIONS).toContain('engagement');
    expect(CRITIQUE_DIMENSIONS).toContain('precision');
    expect(CRITIQUE_DIMENSIONS).toContain('coherence');
    expect(CRITIQUE_DIMENSIONS).toHaveLength(5);
  });
});

describe('getCritiqueForVariant', () => {
  it('finds existing critique', () => {
    const state = new PipelineStateImpl('text');
    const critique: Critique = {
      variationId: 'v1',
      dimensionScores: { clarity: 8 },
      goodExamples: {},
      badExamples: {},
      notes: {},
      reviewer: 'llm',
    };
    state.allCritiques = [critique];
    expect(getCritiqueForVariant('v1', state)).toBe(critique);
  });

  it('returns null for missing critique', () => {
    const state = new PipelineStateImpl('text');
    state.allCritiques = [];
    expect(getCritiqueForVariant('missing', state)).toBeNull();
  });

  it('returns null when allCritiques is null', () => {
    const state = new PipelineStateImpl('text');
    expect(getCritiqueForVariant('v1', state)).toBeNull();
  });
});

describe('getWeakestDimension', () => {
  it('finds lowest-scoring dimension', () => {
    const critique: Critique = {
      variationId: 'v1',
      dimensionScores: { clarity: 8, structure: 5, engagement: 7 },
      goodExamples: {},
      badExamples: {},
      notes: {},
      reviewer: 'llm',
    };
    expect(getWeakestDimension(critique)).toBe('structure');
  });

  it('returns null for empty scores', () => {
    const critique: Critique = {
      variationId: 'v1',
      dimensionScores: {},
      goodExamples: {},
      badExamples: {},
      notes: {},
      reviewer: 'llm',
    };
    expect(getWeakestDimension(critique)).toBeNull();
  });
});

describe('getImprovementSuggestions', () => {
  it('extracts suggestions for low-scoring dimensions', () => {
    const critique: Critique = {
      variationId: 'v1',
      dimensionScores: { clarity: 8, structure: 5, engagement: 4 },
      goodExamples: {},
      badExamples: { structure: ['Run-on paragraph'], engagement: ['Boring intro'] },
      notes: {},
      reviewer: 'llm',
    };
    const suggestions = getImprovementSuggestions(critique);
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toContain('Improve structure');
    expect(suggestions[1]).toContain('Improve engagement');
  });

  it('falls back to notes when no bad examples', () => {
    const critique: Critique = {
      variationId: 'v1',
      dimensionScores: { clarity: 5 },
      goodExamples: {},
      badExamples: {},
      notes: { clarity: 'Too many passive constructions' },
      reviewer: 'llm',
    };
    const suggestions = getImprovementSuggestions(critique);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toContain('passive constructions');
  });

  it('returns empty for high-scoring critique', () => {
    const critique: Critique = {
      variationId: 'v1',
      dimensionScores: { clarity: 8, structure: 9 },
      goodExamples: {},
      badExamples: {},
      notes: {},
      reviewer: 'llm',
    };
    expect(getImprovementSuggestions(critique)).toHaveLength(0);
  });
});
