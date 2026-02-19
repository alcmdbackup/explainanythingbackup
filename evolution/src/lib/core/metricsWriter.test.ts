// Unit tests for metricsWriter: computeFinalElo and getAgentForStrategy.

import { computeFinalElo, getAgentForStrategy, STRATEGY_TO_AGENT } from './metricsWriter';
import { PipelineStateImpl } from './state';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig } from '../types';
import type { Rating } from './rating';

/** Helper: create a rating with known ordinal (mu - 3*sigma). sigma defaults to 3. */
function ratingWithOrdinal(ordinal: number, sigma = 3): Rating {
  return { mu: ordinal + 3 * sigma, sigma };
}

function makeMockLogger(): EvolutionLogger {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeMockCostTracker(): CostTracker {
  return {
    reserveBudget: jest.fn().mockResolvedValue(undefined),
    recordSpend: jest.fn(),
    getAgentCost: jest.fn().mockReturnValue(0),
    getTotalSpent: jest.fn().mockReturnValue(1.5),
    getAvailableBudget: jest.fn().mockReturnValue(3.5),
    getAllAgentCosts: jest.fn().mockReturnValue({}),
    getTotalReserved: jest.fn().mockReturnValue(0),
  };
}

function makeCtx(state: PipelineStateImpl, runId = 'test-run'): ExecutionContext {
  return {
    payload: {
      originalText: state.originalText,
      title: 'Test Article',
      explanationId: 1,
      runId,
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    },
    state,
    llmClient: { complete: jest.fn(), completeStructured: jest.fn() } as unknown as EvolutionLLMClient,
    logger: makeMockLogger(),
    costTracker: makeMockCostTracker(),
    runId,
  };
}

describe('computeFinalElo', () => {
  it('returns null when pool is empty', () => {
    const state = new PipelineStateImpl('text');
    const ctx = makeCtx(state);
    expect(computeFinalElo(ctx)).toBeNull();
  });

  it('returns Elo number when pool has variants', () => {
    const state = new PipelineStateImpl('text');
    state.addToPool({
      id: 'v1', text: 'V1', version: 1, parentIds: [],
      strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    state.ratings.set('v1', ratingWithOrdinal(20));

    const ctx = makeCtx(state);
    const elo = computeFinalElo(ctx);
    expect(elo).not.toBeNull();
    expect(typeof elo).toBe('number');
    expect(elo!).toBeGreaterThan(0);
  });

  it('uses top-rated variant for Elo computation', () => {
    const state = new PipelineStateImpl('text');
    state.addToPool({
      id: 'v1', text: 'V1', version: 1, parentIds: [],
      strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    state.addToPool({
      id: 'v2', text: 'V2', version: 1, parentIds: [],
      strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    state.ratings.set('v1', ratingWithOrdinal(10));
    state.ratings.set('v2', ratingWithOrdinal(30));

    const ctx = makeCtx(state);
    const elo = computeFinalElo(ctx);
    // Top-rated variant is v2 (ordinal 30), so Elo should reflect that
    expect(elo).not.toBeNull();
    expect(elo!).toBeGreaterThan(0);
  });
});

describe('getAgentForStrategy', () => {
  it('returns "generation" for structural_transform', () => {
    expect(getAgentForStrategy('structural_transform')).toBe('generation');
  });

  it('returns "generation" for lexical_simplify', () => {
    expect(getAgentForStrategy('lexical_simplify')).toBe('generation');
  });

  it('returns "evolution" for mutate_clarity', () => {
    expect(getAgentForStrategy('mutate_clarity')).toBe('evolution');
  });

  it('returns "debate" for debate_synthesis', () => {
    expect(getAgentForStrategy('debate_synthesis')).toBe('debate');
  });

  it('returns "outlineGeneration" for outline_generation', () => {
    expect(getAgentForStrategy('outline_generation')).toBe('outlineGeneration');
  });

  it('returns "iterativeEditing" for critique_edit_ prefixed strategies', () => {
    expect(getAgentForStrategy('critique_edit_clarity')).toBe('iterativeEditing');
    expect(getAgentForStrategy('critique_edit_structure')).toBe('iterativeEditing');
  });

  it('returns "sectionDecomposition" for section_decomposition_ prefixed strategies', () => {
    expect(getAgentForStrategy('section_decomposition_intro')).toBe('sectionDecomposition');
  });

  it('returns null for unknown strategies', () => {
    expect(getAgentForStrategy('unknown_strategy')).toBeNull();
    expect(getAgentForStrategy('')).toBeNull();
  });

  it('covers all entries in STRATEGY_TO_AGENT', () => {
    for (const [strategy, agent] of Object.entries(STRATEGY_TO_AGENT)) {
      expect(getAgentForStrategy(strategy)).toBe(agent);
    }
  });
});
