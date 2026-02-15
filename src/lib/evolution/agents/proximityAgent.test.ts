// Unit tests for ProximityAgent — sparse similarity matrix, diversity score, test mode embeddings.

import { ProximityAgent, cosineSimilarity } from './proximityAgent';
import { PipelineStateImpl } from '../core/state';
import type { EvolutionRunConfig, TextVariation } from '../types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';
import { createMockExecutionContext, createMockEvolutionLLMClient } from '@/testing/utils/evolution-test-helpers';

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

function makeCtx(state: PipelineStateImpl) {
  return createMockExecutionContext({
    state,
    llmClient: createMockEvolutionLLMClient({ complete: jest.fn(), completeStructured: jest.fn() }),
  });
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

describe('ProximityAgent executionDetail', () => {
  it('captures detail with pairs and diversity score', async () => {
    const agent = new ProximityAgent({ testMode: true });
    const state = new PipelineStateImpl('Original');
    const v1 = makeVariation('v1', 'First variant about science');
    const v2 = makeVariation('v2', 'Second variant about math');
    state.addToPool(v1);
    state.addToPool(v2);
    state.startNewIteration();
    const v3 = makeVariation('v3', 'Third variant about history');
    state.addToPool(v3);

    const ctx = makeCtx(state);
    const result = await agent.execute(ctx);

    expect(result.executionDetail).toBeDefined();
    expect(result.executionDetail!.detailType).toBe('proximity');
    const detail = result.executionDetail as import('../types').ProximityExecutionDetail;
    expect(detail.newEntrants).toBe(1);
    expect(detail.existingVariants).toBe(2);
    expect(detail.totalPairsComputed).toBe(2);
    expect(detail.diversityScore).toBeGreaterThanOrEqual(0);
    expect(detail.diversityScore).toBeLessThanOrEqual(1);
  });

  it('returns detail with zero pairs when no new entrants', async () => {
    const agent = new ProximityAgent({ testMode: true });
    const state = new PipelineStateImpl('Original');
    state.addToPool(makeVariation('v1', 'Text A'));
    state.addToPool(makeVariation('v2', 'Text B'));
    state.startNewIteration(); // Clears newEntrantsThisIteration, no new variants added after
    const ctx = makeCtx(state);
    const result = await agent.execute(ctx);

    expect(result.executionDetail).toBeDefined();
    const detail = result.executionDetail as import('../types').ProximityExecutionDetail;
    expect(detail.newEntrants).toBe(0);
    expect(detail.totalPairsComputed).toBe(0);
  });
});
