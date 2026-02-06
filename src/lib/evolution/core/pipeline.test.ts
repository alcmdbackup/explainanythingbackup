// Unit tests for pipeline helpers and iterativeEditing integration.
// Tests baseline variant insertion, run summary, Zod validation, and agent execution order.

import { insertBaselineVariant, buildRunSummary, validateRunSummary, executeFullPipeline } from './pipeline';
import type { PipelineAgent, PipelineAgents } from './pipeline';
import { PipelineStateImpl } from './state';
import { BASELINE_STRATEGY, EvolutionRunSummarySchema } from '../types';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig } from '../types';
import { DEFAULT_EVOLUTION_CONFIG, resolveConfig } from '../config';
import { DEFAULT_EVOLUTION_FLAGS } from './featureFlags';
import { getOrdinal } from './rating';
import type { Rating } from './rating';

// ─── Mocks for executeFullPipeline integration tests ────────────

jest.mock('@/lib/utils/supabase/server', () => {
  // Thenable chain mock: supports from().update().eq() and from().upsert() patterns
  const chain: Record<string, jest.Mock> = {};
  chain.eq = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.update = jest.fn().mockReturnValue(chain);
  chain.upsert = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.from = jest.fn().mockReturnValue(chain);
  return { createSupabaseServiceClient: jest.fn().mockResolvedValue(chain) };
});

jest.mock('../../../../instrumentation', () => ({
  createAppSpan: jest.fn().mockReturnValue({
    end: jest.fn(),
    setAttributes: jest.fn(),
    recordException: jest.fn(),
    setStatus: jest.fn(),
  }),
}));

/** Helper: create a rating with known ordinal (mu - 3*sigma). sigma defaults to 3. */
function ratingWithOrdinal(ordinal: number, sigma = 3): Rating {
  return { mu: ordinal + 3 * sigma, sigma };
}

function makeMockLogger(): EvolutionLogger {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeMockCostTracker(): CostTracker {
  const agentCosts = new Map<string, number>();
  return {
    reserveBudget: jest.fn().mockResolvedValue(undefined),
    recordSpend: jest.fn((name: string, cost: number) => { agentCosts.set(name, (agentCosts.get(name) ?? 0) + cost); }),
    getAgentCost: jest.fn((name: string) => agentCosts.get(name) ?? 0),
    getTotalSpent: jest.fn().mockReturnValue(1.5),
    getAvailableBudget: jest.fn().mockReturnValue(3.5),
    getAllAgentCosts: jest.fn(() => Object.fromEntries(agentCosts)),
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

// ─── insertBaselineVariant tests ────────────────────────────────

describe('insertBaselineVariant', () => {
  it('adds exactly one variant with BASELINE_STRATEGY', () => {
    const state = new PipelineStateImpl('Original article text');
    insertBaselineVariant(state, 'run-1');

    expect(state.pool).toHaveLength(1);
    expect(state.pool[0].strategy).toBe(BASELINE_STRATEGY);
    expect(state.pool[0].id).toBe('baseline-run-1');
    expect(state.pool[0].text).toBe('Original article text');
    expect(state.pool[0].version).toBe(0);
    expect(state.pool[0].parentIds).toEqual([]);
  });

  it('is idempotent — calling twice does not duplicate', () => {
    const state = new PipelineStateImpl('Original text');
    insertBaselineVariant(state, 'run-1');
    insertBaselineVariant(state, 'run-1');

    expect(state.pool).toHaveLength(1);
    expect(state.poolIds.size).toBe(1);
  });

  it('uses state.originalText for the variant text', () => {
    const state = new PipelineStateImpl('My specific article content');
    insertBaselineVariant(state, 'run-2');

    expect(state.pool[0].text).toBe('My specific article content');
  });

  it('initializes rating to default', () => {
    const state = new PipelineStateImpl('text');
    insertBaselineVariant(state, 'run-3');

    const r = state.ratings.get('baseline-run-3');
    expect(r).toBeDefined();
    expect(r!.mu).toBeGreaterThan(0);
    expect(r!.sigma).toBeGreaterThan(0);
    expect(state.matchCounts.get('baseline-run-3')).toBe(0);
  });
});

// ─── buildRunSummary tests ──────────────────────────────────────

describe('buildRunSummary', () => {
  it('produces valid EvolutionRunSummarySchema shape', () => {
    const state = new PipelineStateImpl('Original');
    state.startNewIteration();
    insertBaselineVariant(state, 'run-1');
    state.addToPool({
      id: 'v1', text: 'Variant 1', version: 1, parentIds: [],
      strategy: 'structural_transform', createdAt: Date.now() / 1000, iterationBorn: 1,
    });
    state.ratings.set('v1', ratingWithOrdinal(21));
    state.matchHistory.push({
      variationA: 'baseline-run-1', variationB: 'v1', winner: 'v1',
      confidence: 0.8, turns: 1, dimensionScores: {},
    });

    const ctx = makeCtx(state, 'run-1');
    const summary = buildRunSummary(ctx, 'completed', 42.5);

    const parsed = EvolutionRunSummarySchema.safeParse(summary);
    expect(parsed.success).toBe(true);
    expect(summary.version).toBe(2);
    expect(summary.stopReason).toBe('completed');
    expect(summary.durationSeconds).toBe(42.5);
  });

  it('handles missing baseline gracefully', () => {
    const state = new PipelineStateImpl('Original');
    state.addToPool({
      id: 'v1', text: 'Variant 1', version: 1, parentIds: [],
      strategy: 'structural_transform', createdAt: Date.now() / 1000, iterationBorn: 0,
    });

    const ctx = makeCtx(state, 'run-no-baseline');
    const summary = buildRunSummary(ctx, 'completed', 10);

    expect(summary.baselineRank).toBeNull();
    expect(summary.baselineOrdinal).toBeNull();
    expect((ctx.logger.warn as jest.Mock)).toHaveBeenCalledWith(
      'Baseline variant not found in pool',
      expect.any(Object),
    );
  });

  it('handles empty matchHistory', () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state, 'run-empty');

    const ctx = makeCtx(state, 'run-empty');
    const summary = buildRunSummary(ctx, 'completed', 5);

    expect(summary.matchStats.totalMatches).toBe(0);
    expect(summary.matchStats.avgConfidence).toBe(0);
    expect(summary.matchStats.decisiveRate).toBe(0);
  });

  it('returns empty ordinalHistory/diversityHistory without supervisor', () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state, 'run-no-sup');

    const ctx = makeCtx(state, 'run-no-sup');
    const summary = buildRunSummary(ctx, 'completed', 5, undefined);

    expect(summary.ordinalHistory).toEqual([]);
    expect(summary.diversityHistory).toEqual([]);
    expect(summary.finalPhase).toBe('EXPANSION');
  });

  it('computes baselineRank correctly when baseline is top-ranked', () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state, 'run-top');
    state.addToPool({
      id: 'v1', text: 'V1', version: 1, parentIds: [],
      strategy: 'structural_transform', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    // Baseline gets high rating, v1 at default
    state.ratings.set('baseline-run-top', ratingWithOrdinal(30));

    const ctx = makeCtx(state, 'run-top');
    const summary = buildRunSummary(ctx, 'completed', 10);

    expect(summary.baselineRank).toBe(1);
  });

  it('computes baselineRank correctly when baseline is ranked low', () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state, 'run-low');
    for (let i = 0; i < 4; i++) {
      state.addToPool({
        id: `v${i}`, text: `V${i}`, version: 1, parentIds: [],
        strategy: 'structural_transform', createdAt: Date.now() / 1000, iterationBorn: 0,
      });
      state.ratings.set(`v${i}`, ratingWithOrdinal(10 + i * 5));
    }
    // Baseline stays at default rating (ordinal ≈ 0), all variants higher

    const ctx = makeCtx(state, 'run-low');
    const summary = buildRunSummary(ctx, 'completed', 10);

    expect(summary.baselineRank).toBe(5); // 4 variants + baseline at bottom
  });

  it('computes strategyEffectiveness correctly', () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state, 'run-strat');
    state.addToPool({
      id: 'v1', text: 'V1', version: 1, parentIds: [],
      strategy: 'structural_transform', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    state.addToPool({
      id: 'v2', text: 'V2', version: 1, parentIds: [],
      strategy: 'structural_transform', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    state.ratings.set('v1', ratingWithOrdinal(20));
    state.ratings.set('v2', ratingWithOrdinal(30));

    const ctx = makeCtx(state, 'run-strat');
    const summary = buildRunSummary(ctx, 'completed', 10);

    expect(summary.strategyEffectiveness['structural_transform'].count).toBe(2);
    expect(summary.strategyEffectiveness['structural_transform'].avgOrdinal).toBeCloseTo(25);
    expect(summary.strategyEffectiveness[BASELINE_STRATEGY].count).toBe(1);
  });

  it('computes decisiveRate correctly with mixed confidences', () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state, 'run-dec');
    state.addToPool({
      id: 'v1', text: 'V1', version: 1, parentIds: [],
      strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    state.matchHistory = [
      { variationA: 'baseline-run-dec', variationB: 'v1', winner: 'v1', confidence: 0.9, turns: 1, dimensionScores: {} },
      { variationA: 'baseline-run-dec', variationB: 'v1', winner: 'v1', confidence: 0.5, turns: 1, dimensionScores: {} },
      { variationA: 'baseline-run-dec', variationB: 'v1', winner: 'v1', confidence: 0.7, turns: 1, dimensionScores: {} },
    ];

    const ctx = makeCtx(state, 'run-dec');
    const summary = buildRunSummary(ctx, 'completed', 10);

    // 2 out of 3 have confidence >= 0.7
    expect(summary.matchStats.decisiveRate).toBeCloseTo(2 / 3);
    expect(summary.matchStats.avgConfidence).toBeCloseTo(0.7);
  });
});

// ─── validateRunSummary tests ───────────────────────────────────

describe('validateRunSummary', () => {
  it('returns data on valid summary', () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state, 'run-valid');
    const ctx = makeCtx(state, 'run-valid');
    const raw = buildRunSummary(ctx, 'completed', 10);
    const logger = makeMockLogger();

    const result = validateRunSummary(raw, logger, 'run-valid');
    expect(result).not.toBeNull();
    expect(result?.version).toBe(2);
  });

  it('returns null on invalid data and logs error', () => {
    const logger = makeMockLogger();
    // Create deliberately invalid summary
    const invalid = { version: 2, garbage: true } as never;

    const result = validateRunSummary(invalid, logger, 'run-invalid');
    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      'Run summary Zod validation failed — saving null',
      expect.objectContaining({ runId: 'run-invalid' }),
    );
  });
});

// ─── IterativeEditing pipeline integration tests ──────────────────

describe('executeFullPipeline — iterativeEditing integration', () => {
  function makeSpyAgent(name: string, executionOrder: string[]): PipelineAgent {
    return {
      name,
      canExecute: jest.fn().mockReturnValue(true),
      execute: jest.fn().mockImplementation(async () => {
        executionOrder.push(name);
        return { success: true, costUsd: 0, variantsAdded: 0, matchesPlayed: 0 };
      }),
    };
  }

  function makeIntegrationCtx(
    budgetCalls: number[],
    configOverrides: Partial<EvolutionRunConfig> = {},
  ): ExecutionContext {
    const config = resolveConfig({
      maxIterations: 5,
      expansion: { maxIterations: 1, minPool: 5, diversityThreshold: 0.25, minIterations: 3 },
      plateau: { window: 2, threshold: 0.02 },
      ...configOverrides,
    });
    const state = new PipelineStateImpl('Original article text for testing.');
    let budgetIdx = 0;
    const costTracker: CostTracker = {
      reserveBudget: jest.fn().mockResolvedValue(undefined),
      recordSpend: jest.fn(),
      getAgentCost: jest.fn().mockReturnValue(0),
      getTotalSpent: jest.fn().mockReturnValue(0),
      getAvailableBudget: jest.fn(() => budgetCalls[budgetIdx++] ?? 0.005),
      getAllAgentCosts: jest.fn().mockReturnValue({}),
    };
    return {
      payload: {
        originalText: state.originalText,
        title: 'Test Article',
        explanationId: 1,
        runId: 'int-test-run',
        config,
      },
      state,
      llmClient: { complete: jest.fn(), completeStructured: jest.fn() } as unknown as EvolutionLLMClient,
      logger: makeMockLogger(),
      costTracker,
      runId: 'int-test-run',
    };
  }

  function makeAllAgents(executionOrder: string[]): PipelineAgents {
    return {
      generation: makeSpyAgent('generation', executionOrder),
      calibration: makeSpyAgent('calibration', executionOrder),
      tournament: makeSpyAgent('tournament', executionOrder),
      evolution: makeSpyAgent('evolution', executionOrder),
      reflection: makeSpyAgent('reflection', executionOrder),
      iterativeEditing: makeSpyAgent('iterativeEditing', executionOrder),
      debate: makeSpyAgent('debate', executionOrder),
      proximity: makeSpyAgent('proximity', executionOrder),
      metaReview: makeSpyAgent('metaReview', executionOrder),
    };
  }

  it('runs iterativeEditing after reflection and before debate in COMPETITION', async () => {
    const executionOrder: string[] = [];
    const agents = makeAllAgents(executionOrder);
    // 3 budget values: createAppSpan consumes first, shouldStop gets second (run), third (stop)
    const ctx = makeIntegrationCtx([2.0, 2.0, 0.005]);

    await executeFullPipeline('int-test-run', agents, ctx, ctx.logger, {
      supervisorResume: { phase: 'COMPETITION', strategyRotationIndex: 0, ordinalHistory: [], diversityHistory: [] },
      featureFlags: { ...DEFAULT_EVOLUTION_FLAGS },
      startMs: Date.now(),
    });

    const reflectionIdx = executionOrder.indexOf('reflection');
    const ieIdx = executionOrder.indexOf('iterativeEditing');
    const debateIdx = executionOrder.indexOf('debate');
    expect(reflectionIdx).toBeGreaterThanOrEqual(0);
    expect(ieIdx).toBeGreaterThan(reflectionIdx);
    expect(debateIdx).toBeGreaterThan(ieIdx);
  });

  it('skips iterativeEditing when feature flag disabled', async () => {
    const executionOrder: string[] = [];
    const agents = makeAllAgents(executionOrder);
    const ctx = makeIntegrationCtx([2.0, 2.0, 0.005]);

    await executeFullPipeline('int-test-run', agents, ctx, ctx.logger, {
      supervisorResume: { phase: 'COMPETITION', strategyRotationIndex: 0, ordinalHistory: [], diversityHistory: [] },
      featureFlags: { ...DEFAULT_EVOLUTION_FLAGS, iterativeEditingEnabled: false },
      startMs: Date.now(),
    });

    expect(agents.iterativeEditing!.execute).not.toHaveBeenCalled();
    expect(executionOrder).not.toContain('iterativeEditing');
    expect(executionOrder).toContain('reflection');
    expect(executionOrder).toContain('debate');
  });

  it('handles missing iterativeEditing agent gracefully', async () => {
    const executionOrder: string[] = [];
    const agents: PipelineAgents = {
      generation: makeSpyAgent('generation', executionOrder),
      calibration: makeSpyAgent('calibration', executionOrder),
      tournament: makeSpyAgent('tournament', executionOrder),
      evolution: makeSpyAgent('evolution', executionOrder),
      reflection: makeSpyAgent('reflection', executionOrder),
      // iterativeEditing intentionally omitted
      debate: makeSpyAgent('debate', executionOrder),
      proximity: makeSpyAgent('proximity', executionOrder),
      metaReview: makeSpyAgent('metaReview', executionOrder),
    };
    const ctx = makeIntegrationCtx([2.0, 2.0, 0.005]);

    await executeFullPipeline('int-test-run', agents, ctx, ctx.logger, {
      supervisorResume: { phase: 'COMPETITION', strategyRotationIndex: 0, ordinalHistory: [], diversityHistory: [] },
      featureFlags: { ...DEFAULT_EVOLUTION_FLAGS },
      startMs: Date.now(),
    });

    expect(executionOrder).not.toContain('iterativeEditing');
    expect(executionOrder).toContain('reflection');
    expect(executionOrder).toContain('debate');
  });

  it('does not run iterativeEditing in EXPANSION phase', async () => {
    const executionOrder: string[] = [];
    const agents = makeAllAgents(executionOrder);
    // expansionMaxIterations=3 keeps first iteration in EXPANSION
    const ctx = makeIntegrationCtx([2.0, 2.0, 0.005], {
      expansion: { maxIterations: 3, minPool: 5, diversityThreshold: 0.25, minIterations: 3 },
      plateau: { window: 1, threshold: 0.02 },
    });

    await executeFullPipeline('int-test-run', agents, ctx, ctx.logger, {
      featureFlags: { ...DEFAULT_EVOLUTION_FLAGS },
      startMs: Date.now(),
    });

    expect(agents.iterativeEditing!.execute).not.toHaveBeenCalled();
    expect(executionOrder).not.toContain('iterativeEditing');
    expect(executionOrder).toContain('generation');
  });
});
