// Unit tests for metricsWriter: computeFinalElo, getAgentForStrategy, and persistCostPrediction.

import { computeFinalElo, getAgentForStrategy, STRATEGY_TO_AGENT, persistCostPrediction } from './metricsWriter';
import { computeCostPrediction, RunCostEstimateSchema, CostPredictionSchema } from './costEstimator';
import { PipelineStateImpl } from './state';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig } from '../types';
import type { Rating } from './rating';

// Mock Supabase client (needed by metricsWriter internals)
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

// Mock the dynamic import('../index') that persistCostPrediction uses
jest.mock('../index', () => ({
  computeCostPrediction: jest.requireActual('./costEstimator').computeCostPrediction,
  refreshAgentCostBaselines: jest.fn().mockResolvedValue({ updated: 0, errors: [] }),
  RunCostEstimateSchema: jest.requireActual('./costEstimator').RunCostEstimateSchema,
  CostPredictionSchema: jest.requireActual('./costEstimator').CostPredictionSchema,
}));

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
    getInvocationCost: jest.fn().mockReturnValue(0),
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

describe('persistCostPrediction', () => {
  /** Build a chainable Supabase mock with configurable query results. */
  function makeMockSupabase(invocationRows: Array<{ agent_name: string; cost_usd: number }> | null, invErr: { message: string } | null = null) {
    const updateEqFn = jest.fn().mockResolvedValue({ error: null });
    const updateFn = jest.fn().mockReturnValue({ eq: updateEqFn });

    const selectEqFn = jest.fn().mockResolvedValue({ data: invocationRows, error: invErr });
    const selectFn = jest.fn().mockReturnValue({ eq: selectEqFn });

    return {
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'evolution_agent_invocations') {
          return { select: selectFn };
        }
        if (table === 'evolution_runs') {
          return { update: updateFn };
        }
        return { select: selectFn, update: updateFn };
      }),
      _updateEqFn: updateEqFn,
      _updateFn: updateFn,
    };
  }

  const validEstimate = {
    totalUsd: 1.00,
    perAgent: { generation: 0.40, calibration: 0.30, tournament: 0.30 },
    perIteration: 0.10,
    confidence: 'medium' as const,
  };

  it('queries invocations table for actual costs and calls computeCostPrediction correctly', async () => {
    const invocationRows = [
      { agent_name: 'generation', cost_usd: 0.50 },
      { agent_name: 'generation', cost_usd: 0.10 },
      { agent_name: 'calibration', cost_usd: 0.25 },
      { agent_name: 'tournament', cost_usd: 0.35 },
    ];

    const mockSb = makeMockSupabase(invocationRows);
    const logger = makeMockLogger();
    const state = new PipelineStateImpl('text');
    const ctx = makeCtx(state, 'run-abc');

    await persistCostPrediction(mockSb as any, 'run-abc', validEstimate, ctx, logger);

    // Verify it queried the right table with correct run_id
    expect(mockSb.from).toHaveBeenCalledWith('evolution_agent_invocations');

    // Verify prediction was persisted to evolution_runs
    expect(mockSb.from).toHaveBeenCalledWith('evolution_runs');
    expect(mockSb._updateFn).toHaveBeenCalledTimes(1);
    const persistedPrediction = mockSb._updateFn.mock.calls[0][0].cost_prediction;

    // actualTotalUsd should be 0.50 + 0.10 + 0.25 + 0.35 = 1.20
    expect(persistedPrediction.actualUsd).toBeCloseTo(1.20, 6);
    expect(persistedPrediction.estimatedUsd).toBe(1.00);

    // Per-agent costs should be aggregated: generation = 0.60, calibration = 0.25, tournament = 0.35
    expect(persistedPrediction.perAgent.generation.actual).toBeCloseTo(0.60, 6);
    expect(persistedPrediction.perAgent.calibration.actual).toBeCloseTo(0.25, 6);
    expect(persistedPrediction.perAgent.tournament.actual).toBeCloseTo(0.35, 6);
  });

  it('handles empty invocations gracefully (actualUsd = 0)', async () => {
    const mockSb = makeMockSupabase([]);
    const logger = makeMockLogger();
    const state = new PipelineStateImpl('text');
    const ctx = makeCtx(state, 'run-empty');

    await persistCostPrediction(mockSb as any, 'run-empty', validEstimate, ctx, logger);

    // Should still persist a prediction with 0 actual cost
    expect(mockSb._updateFn).toHaveBeenCalledTimes(1);
    const persistedPrediction = mockSb._updateFn.mock.calls[0][0].cost_prediction;

    expect(persistedPrediction.actualUsd).toBe(0);
    expect(persistedPrediction.deltaUsd).toBeCloseTo(-1.00, 6);
    // All per-agent actuals should be 0
    expect(persistedPrediction.perAgent.generation.actual).toBe(0);
    expect(persistedPrediction.perAgent.calibration.actual).toBe(0);
    expect(persistedPrediction.perAgent.tournament.actual).toBe(0);

    // No warnings logged
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
