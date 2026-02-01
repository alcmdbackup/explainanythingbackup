// Unit tests for ProximityAgent — sparse similarity matrix, diversity score, test mode embeddings.

import { ProximityAgent, cosineSimilarity } from './proximityAgent';
import { PipelineStateImpl } from '../core/state';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig, TextVariation } from '../types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';

function makeMockLogger(): EvolutionLogger {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeMockCostTracker(): CostTracker {
  const agentCosts = new Map<string, number>();
  return {
    reserveBudget: jest.fn().mockResolvedValue(undefined),
    recordSpend: jest.fn((name: string, cost: number) => { agentCosts.set(name, (agentCosts.get(name) ?? 0) + cost); }),
    getAgentCost: jest.fn((name: string) => agentCosts.get(name) ?? 0),
    getTotalSpent: jest.fn().mockReturnValue(0),
    getAvailableBudget: jest.fn().mockReturnValue(5),
  };
}

function makeMockLLMClient(): EvolutionLLMClient {
  return { complete: jest.fn(), completeStructured: jest.fn() };
}

function makeVariation(id: string, text: string, overrides?: Partial<TextVariation>): TextVariation {
  return {
    id,
    text,
    version: 1,
    parentIds: [],
    strategy: 'structural_transform',
    createdAt: Date.now() / 1000,
    iterationBorn: 0,
    ...overrides,
  };
}

function makeCtx(state: PipelineStateImpl): ExecutionContext {
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
  };
}

describe('ProximityAgent', () => {
  it('has correct name', () => {
    const agent = new ProximityAgent({ testMode: true });
    expect(agent.name).toBe('proximity');
  });

  it('computes similarity for new entrants vs existing', async () => {
    const agent = new ProximityAgent({ testMode: true });
    const state = new PipelineStateImpl('original');

    // Add "existing" variants (simulate previous iteration)
    state.addToPool(makeVariation('existing-1', 'The cat sat on the mat'));
    state.addToPool(makeVariation('existing-2', 'A dog ran through the park'));

    // Start new iteration so existing are no longer "new"
    state.startNewIteration();

    // Add new entrants
    state.addToPool(makeVariation('new-1', 'The bird flew over the tree'));

    const ctx = makeCtx(state);
    const result = await agent.execute(ctx);

    expect(result.success).toBe(true);
    expect(state.similarityMatrix).not.toBeNull();
    // new-1 should have similarity with existing-1 and existing-2
    expect(state.similarityMatrix!['new-1']).toBeDefined();
    expect(state.similarityMatrix!['new-1']['existing-1']).toBeDefined();
    expect(state.similarityMatrix!['new-1']['existing-2']).toBeDefined();
    // Symmetry check
    expect(state.similarityMatrix!['existing-1']['new-1']).toBe(state.similarityMatrix!['new-1']['existing-1']);
  });

  it('computes diversity score', async () => {
    const agent = new ProximityAgent({ testMode: true });
    const state = new PipelineStateImpl('original');

    state.addToPool(makeVariation('v1', 'Completely different text about quantum physics'));
    state.addToPool(makeVariation('v2', 'Another very different text about marine biology'));
    state.startNewIteration();
    state.addToPool(makeVariation('v3', 'Yet another text about medieval history'));

    const ctx = makeCtx(state);
    await agent.execute(ctx);

    expect(state.diversityScore).not.toBeNull();
    expect(state.diversityScore).toBeGreaterThanOrEqual(0);
    expect(state.diversityScore).toBeLessThanOrEqual(1);
  });

  it('returns success with empty new entrants', async () => {
    const agent = new ProximityAgent({ testMode: true });
    const state = new PipelineStateImpl('original');
    state.addToPool(makeVariation('v1', 'text 1'));
    state.addToPool(makeVariation('v2', 'text 2'));
    state.startNewIteration();
    // No new entrants this iteration

    const ctx = makeCtx(state);
    const result = await agent.execute(ctx);

    expect(result.success).toBe(true);
    expect(result.costUsd).toBe(0);
  });

  it('canExecute requires >= 2 variants', () => {
    const agent = new ProximityAgent({ testMode: true });
    const state1 = new PipelineStateImpl('text');
    expect(agent.canExecute(state1)).toBe(false);

    state1.addToPool(makeVariation('v1', 'text 1'));
    expect(agent.canExecute(state1)).toBe(false);

    state1.addToPool(makeVariation('v2', 'text 2'));
    expect(agent.canExecute(state1)).toBe(true);
  });

  it('estimateCost returns 0 in test mode', () => {
    const agent = new ProximityAgent({ testMode: true });
    expect(agent.estimateCost({
      originalText: 'test',
      title: 'Test',
      explanationId: 1,
      runId: 'test',
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    })).toBe(0);
  });

  it('estimateCost returns positive in production mode', () => {
    const agent = new ProximityAgent({ testMode: false });
    expect(agent.estimateCost({
      originalText: 'test',
      title: 'Test',
      explanationId: 1,
      runId: 'test',
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    })).toBeGreaterThan(0);
  });

  it('test mode embeddings are deterministic', () => {
    const agent = new ProximityAgent({ testMode: true });
    const embed1 = agent._embed('hello world');
    const embed2 = agent._embed('hello world');
    expect(embed1).toEqual(embed2);
    expect(embed1.length).toBe(16); // MD5 = 32 hex chars / 2
  });

  it('different texts produce different embeddings', () => {
    const agent = new ProximityAgent({ testMode: true });
    const embed1 = agent._embed('hello world');
    const embed2 = agent._embed('goodbye world');
    expect(embed1).not.toEqual(embed2);
  });

  it('initializes similarity matrix if null', async () => {
    const agent = new ProximityAgent({ testMode: true });
    const state = new PipelineStateImpl('original');
    state.addToPool(makeVariation('v1', 'text 1'));
    state.addToPool(makeVariation('v2', 'text 2'));
    state.startNewIteration();
    state.addToPool(makeVariation('v3', 'text 3'));

    expect(state.similarityMatrix).toBeNull();
    const ctx = makeCtx(state);
    await agent.execute(ctx);
    expect(state.similarityMatrix).not.toBeNull();
  });

  it('clearCache empties the embedding cache', async () => {
    const agent = new ProximityAgent({ testMode: true });
    const state = new PipelineStateImpl('original');
    state.addToPool(makeVariation('v1', 'text 1'));
    state.addToPool(makeVariation('v2', 'text 2'));
    state.startNewIteration();
    state.addToPool(makeVariation('v3', 'text 3'));

    const ctx = makeCtx(state);
    await agent.execute(ctx);
    agent.clearCache();
    // No error — just verifying it doesn't crash
  });

  it('diversity returns 1.0 for pool < 2 variants', () => {
    const agent = new ProximityAgent({ testMode: true });
    const state = new PipelineStateImpl('original');
    state.addToPool(makeVariation('v1', 'text 1'));
    state.similarityMatrix = {};
    expect(agent._computePoolDiversity(state)).toBe(1.0);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it('returns 0 for zero vector', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });

  it('handles single-element vectors', () => {
    expect(cosineSimilarity([3], [4])).toBeCloseTo(1.0);
  });
});
