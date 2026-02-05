// Unit tests for MetaReviewAgent — pure analysis of pool strategies, weaknesses, failures, priorities.

import { MetaReviewAgent } from './metaReviewAgent';
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

function makeVariation(overrides: Partial<TextVariation> = {}): TextVariation {
  const id = overrides.id ?? `v-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    text: `# V\n\n## S\n\nText for ${id}`,
    version: 1,
    parentIds: [],
    strategy: 'structural_transform',
    createdAt: Date.now() / 1000,
    iterationBorn: 0,
    ...overrides,
  };
}

function makeCtx(variants: TextVariation[], ratingOverrides?: Record<string, { mu: number; sigma: number }>): ExecutionContext {
  const state = new PipelineStateImpl('original');
  for (const v of variants) {
    state.addToPool(v);
  }
  if (ratingOverrides) {
    for (const [id, r] of Object.entries(ratingOverrides)) {
      state.ratings.set(id, r);
    }
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
  };
}

describe('MetaReviewAgent', () => {
  const agent = new MetaReviewAgent();

  it('has correct name', () => {
    expect(agent.name).toBe('meta_review');
  });

  it('returns failure for empty pool', async () => {
    const ctx = makeCtx([]);
    const result = await agent.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.costUsd).toBe(0);
  });

  it('returns failure when no ratings', async () => {
    const ctx = makeCtx([makeVariation({ id: 'v1' })]);
    ctx.state.ratings.clear();
    const result = await agent.execute(ctx);
    expect(result.success).toBe(false);
  });

  it('produces meta-feedback with all fields', async () => {
    const variants = [
      makeVariation({ id: 'v1', strategy: 'A' }),
      makeVariation({ id: 'v2', strategy: 'B' }),
      makeVariation({ id: 'v3', strategy: 'C' }),
    ];
    const ctx = makeCtx(variants, { v1: { mu: 31.25, sigma: 4 }, v2: { mu: 18.75, sigma: 4 }, v3: { mu: 25, sigma: 4 } });
    const result = await agent.execute(ctx);

    expect(result.success).toBe(true);
    expect(result.costUsd).toBe(0);
    expect(ctx.state.metaFeedback).not.toBeNull();
    expect(ctx.state.metaFeedback!.successfulStrategies).toBeDefined();
    expect(ctx.state.metaFeedback!.recurringWeaknesses).toBeDefined();
    expect(ctx.state.metaFeedback!.patternsToAvoid).toBeDefined();
    expect(ctx.state.metaFeedback!.priorityImprovements).toBeDefined();
  });

  it('identifies successful strategies (above-average ordinal)', async () => {
    const variants = [
      makeVariation({ id: 'v1', strategy: 'good' }),
      makeVariation({ id: 'v2', strategy: 'good' }),
      makeVariation({ id: 'v3', strategy: 'bad' }),
      makeVariation({ id: 'v4', strategy: 'bad' }),
    ];
    const ctx = makeCtx(variants, { v1: { mu: 37.5, sigma: 4 }, v2: { mu: 34.375, sigma: 4 }, v3: { mu: 15.625, sigma: 4 }, v4: { mu: 12.5, sigma: 4 } });
    await agent.execute(ctx);

    expect(ctx.state.metaFeedback!.successfulStrategies).toContain('good');
    expect(ctx.state.metaFeedback!.successfulStrategies).not.toContain('bad');
  });

  it('identifies weaknesses in bottom quartile', async () => {
    const variants = Array.from({ length: 8 }, (_, i) =>
      makeVariation({ id: `v-${i}`, strategy: i < 2 ? 'bad_strat' : 'ok_strat' }),
    );
    const ratingMap: Record<string, { mu: number; sigma: number }> = {};
    // bad_strat variants are in bottom quartile
    variants.forEach((v, i) => { ratingMap[v.id] = i < 2 ? { mu: 6.25, sigma: 4 } : { mu: 31.25, sigma: 4 }; });
    const ctx = makeCtx(variants, ratingMap);
    await agent.execute(ctx);

    expect(ctx.state.metaFeedback!.recurringWeaknesses.some((w) => w.includes('bad_strat'))).toBe(true);
  });

  it('identifies failing strategies with negative delta', async () => {
    const parent = makeVariation({ id: 'parent', strategy: 'original' });
    const child1 = makeVariation({ id: 'child1', parentIds: ['parent'], strategy: 'bad_evolve' });
    const child2 = makeVariation({ id: 'child2', parentIds: ['parent'], strategy: 'bad_evolve' });
    const ctx = makeCtx([parent, child1, child2], {
      parent: { mu: 31.25, sigma: 4 },  // ordinal ≈ 19.25
      child1: { mu: 18.75, sigma: 4 },  // ordinal ≈ 6.75, delta ≈ -12.5
      child2: { mu: 21.875, sigma: 4 }, // ordinal ≈ 9.875, delta ≈ -9.375
    });
    await agent.execute(ctx);

    expect(ctx.state.metaFeedback!.patternsToAvoid.some((p) => p.includes('bad_evolve'))).toBe(true);
  });

  it('recommends diversity increase when score < 0.3', async () => {
    const variants = [
      makeVariation({ id: 'v1', strategy: 'A' }),
      makeVariation({ id: 'v2', strategy: 'B' }),
      makeVariation({ id: 'v3', strategy: 'C' }),
    ];
    const ctx = makeCtx(variants, { v1: { mu: 25, sigma: 4 }, v2: { mu: 25, sigma: 4 }, v3: { mu: 25, sigma: 4 } });
    ctx.state.diversityScore = 0.2;
    await agent.execute(ctx);

    expect(ctx.state.metaFeedback!.priorityImprovements).toContain('Increase diversity - pool is homogenizing');
  });

  it('recommends bolder transformations for tight rating range', async () => {
    const variants = [
      makeVariation({ id: 'v1', strategy: 'A' }),
      makeVariation({ id: 'v2', strategy: 'B' }),
      makeVariation({ id: 'v3', strategy: 'C' }),
    ];
    const ctx = makeCtx(variants, { v1: { mu: 25.625, sigma: 4 }, v2: { mu: 25, sigma: 4 }, v3: { mu: 24.375, sigma: 4 } });
    await agent.execute(ctx);

    expect(ctx.state.metaFeedback!.priorityImprovements).toContain('Variants too similar - try bolder transformations');
  });

  it('detects stale top performers', async () => {
    const variants = [
      makeVariation({ id: 'v1', strategy: 'A', iterationBorn: 0 }),
      makeVariation({ id: 'v2', strategy: 'B', iterationBorn: 0 }),
      makeVariation({ id: 'v3', strategy: 'C', iterationBorn: 0 }),
    ];
    const ctx = makeCtx(variants, { v1: { mu: 31.25, sigma: 4 }, v2: { mu: 25, sigma: 4 }, v3: { mu: 18.75, sigma: 4 } });
    ctx.state.iteration = 5; // well past iterationBorn=0
    // Manually advance state for iteration tracking
    await agent.execute(ctx);

    expect(ctx.state.metaFeedback!.priorityImprovements).toContain('Top performers are stale - need fresh approaches');
  });

  it('estimateCost returns 0', () => {
    expect(agent.estimateCost({
      originalText: 'test',
      title: 'Test',
      explanationId: 1,
      runId: 'test',
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    })).toBe(0);
  });

  it('canExecute requires pool and ratings', () => {
    const emptyState = new PipelineStateImpl('text');
    expect(agent.canExecute(emptyState)).toBe(false);

    const stateWithPool = new PipelineStateImpl('text');
    stateWithPool.addToPool(makeVariation({ id: 'v1' }));
    expect(agent.canExecute(stateWithPool)).toBe(true);
  });

  it('does not call LLM', async () => {
    const variants = [makeVariation({ id: 'v1' })];
    const ctx = makeCtx(variants, { v1: { mu: 25, sigma: 4 } });
    await agent.execute(ctx);
    expect(ctx.llmClient.complete).not.toHaveBeenCalled();
    expect(ctx.llmClient.completeStructured).not.toHaveBeenCalled();
  });
});
