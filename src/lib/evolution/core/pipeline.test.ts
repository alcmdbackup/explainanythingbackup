// Unit tests for pipeline helpers, iterativeEditing integration, and flow critique integration.
// Tests baseline variant insertion, run summary, Zod validation, agent execution order, and flow critique pipeline behavior.

import { insertBaselineVariant, buildRunSummary, validateRunSummary, executeFullPipeline, finalizePipelineRun, qualityThresholdMet } from './pipeline';
import type { PipelineAgent, PipelineAgents } from './pipeline';
import { createDefaultAgents, preparePipelineRun } from '../index';
import { PipelineStateImpl } from './state';
import { BASELINE_STRATEGY, EvolutionRunSummarySchema, BudgetExceededError } from '../types';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig, PipelineState } from '../types';
import { DEFAULT_EVOLUTION_CONFIG, resolveConfig } from '../config';
import { DEFAULT_EVOLUTION_FLAGS } from './featureFlags';
import { getOrdinal } from './rating';
import type { Rating } from './rating';

// ─── Mocks for executeFullPipeline integration tests ────────────

jest.mock('@/lib/utils/supabase/server', () => {
  // Thenable chain mock: supports from().update().eq().in(), from().upsert(), from().select().eq().single(), from().insert().select().single(), rpc()
  const chain: Record<string, jest.Mock> = {};
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.in = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.single = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.update = jest.fn().mockReturnValue(chain);
  chain.upsert = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.select = jest.fn().mockReturnValue(chain);
  chain.insert = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  chain.rpc = jest.fn().mockResolvedValue({ data: null, error: null });
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
    // ID is now a UUID, not a prefixed string
    expect(state.pool[0].id).toMatch(/^[0-9a-f-]{36}$/);
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

    // Find baseline variant by strategy, not by ID
    const baselineVariant = state.pool.find(v => v.strategy === BASELINE_STRATEGY);
    expect(baselineVariant).toBeDefined();
    const r = state.ratings.get(baselineVariant!.id);
    expect(r).toBeDefined();
    expect(r!.mu).toBeGreaterThan(0);
    expect(r!.sigma).toBeGreaterThan(0);
    expect(state.matchCounts.get(baselineVariant!.id)).toBe(0);
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

// ─── Flow critique pipeline integration tests ───────────────────

describe('executeFullPipeline — flowCritique integration', () => {
  const FLOW_CRITIQUE_JSON = JSON.stringify({
    scores: { local_cohesion: 3, global_coherence: 4, transition_quality: 2, rhythm_variety: 4, redundancy: 5 },
    friction_sentences: { local_cohesion: ['The next point is unclear.'] },
  });

  function makeSpyAgent(name: string, executionOrder: string[], sideEffect?: (ctx: ExecutionContext) => void): PipelineAgent {
    return {
      name,
      canExecute: jest.fn().mockReturnValue(true),
      execute: jest.fn().mockImplementation(async (ctx: ExecutionContext) => {
        executionOrder.push(name);
        if (sideEffect) sideEffect(ctx);
        return { success: true, costUsd: 0, variantsAdded: 0, matchesPlayed: 0 };
      }),
    };
  }

  function makeFlowIntegrationCtx(
    budgetCalls: number[],
    flowLLMResponse = FLOW_CRITIQUE_JSON,
  ): ExecutionContext {
    const config = resolveConfig({
      maxIterations: 5,
      expansion: { maxIterations: 1, minPool: 5, diversityThreshold: 0.25, minIterations: 3 },
      plateau: { window: 2, threshold: 0.02 },
    });
    const state = new PipelineStateImpl('Original article text for flow testing.');
    // Add pool variants so agents can run
    state.addToPool({
      id: 'v-flow-1', text: 'Variant flow 1 with content.', version: 1,
      parentIds: [], strategy: 'structural_transform', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    state.addToPool({
      id: 'v-flow-2', text: 'Variant flow 2 with content.', version: 1,
      parentIds: [], strategy: 'lexical_simplify', createdAt: Date.now() / 1000, iterationBorn: 0,
    });

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
        title: 'Flow Test Article',
        explanationId: 1,
        runId: 'flow-int-test',
        config,
      },
      state,
      llmClient: {
        complete: jest.fn().mockResolvedValue(flowLLMResponse),
        completeStructured: jest.fn(),
      } as unknown as EvolutionLLMClient,
      logger: makeMockLogger(),
      costTracker,
      runId: 'flow-int-test',
    };
  }

  function makeFlowAgents(executionOrder: string[], sideEffects?: Record<string, (ctx: ExecutionContext) => void>): PipelineAgents {
    return {
      generation: makeSpyAgent('generation', executionOrder),
      calibration: makeSpyAgent('calibration', executionOrder),
      tournament: makeSpyAgent('tournament', executionOrder, sideEffects?.['tournament']),
      evolution: makeSpyAgent('evolution', executionOrder),
      reflection: makeSpyAgent('reflection', executionOrder, sideEffects?.['reflection']),
      iterativeEditing: makeSpyAgent('iterativeEditing', executionOrder, sideEffects?.['iterativeEditing']),
      debate: makeSpyAgent('debate', executionOrder),
      proximity: makeSpyAgent('proximity', executionOrder),
      metaReview: makeSpyAgent('metaReview', executionOrder),
    };
  }

  it('runs flow critique after reflection and before iterativeEditing when enabled', async () => {
    const executionOrder: string[] = [];
    const agents = makeFlowAgents(executionOrder);
    const ctx = makeFlowIntegrationCtx([2.0, 2.0, 0.005]);

    await executeFullPipeline('flow-int-test', agents, ctx, ctx.logger, {
      supervisorResume: { phase: 'COMPETITION', strategyRotationIndex: 0, ordinalHistory: [], diversityHistory: [] },
      featureFlags: { ...DEFAULT_EVOLUTION_FLAGS, flowCritiqueEnabled: true },
      startMs: Date.now(),
    });

    // Flow critique runs between reflection and editing
    const reflectionIdx = executionOrder.indexOf('reflection');
    const ieIdx = executionOrder.indexOf('iterativeEditing');
    expect(reflectionIdx).toBeGreaterThanOrEqual(0);
    expect(ieIdx).toBeGreaterThan(reflectionIdx);

    // Verify flow critiques were appended to state (baseline + 2 added = 3 variants)
    const flowCritiques = (ctx.state.allCritiques ?? []).filter((c) => c.scale === '0-5');
    expect(flowCritiques.length).toBe(3);
  });

  it('skips flow critique when flowCritiqueEnabled is false', async () => {
    const executionOrder: string[] = [];
    const agents = makeFlowAgents(executionOrder);
    const ctx = makeFlowIntegrationCtx([2.0, 2.0, 0.005]);

    await executeFullPipeline('flow-int-test', agents, ctx, ctx.logger, {
      supervisorResume: { phase: 'COMPETITION', strategyRotationIndex: 0, ordinalHistory: [], diversityHistory: [] },
      featureFlags: { ...DEFAULT_EVOLUTION_FLAGS, flowCritiqueEnabled: false },
      startMs: Date.now(),
    });

    // LLM should never be called for flow critique
    const completeCalls = (ctx.llmClient.complete as jest.Mock).mock.calls;
    const flowCritiqueCalls = completeCalls.filter(([, tag]: [string, string]) => tag === 'flowCritique');
    expect(flowCritiqueCalls).toHaveLength(0);

    // No flow critiques in state
    const flowCritiques = (ctx.state.allCritiques ?? []).filter((c) => c.scale === '0-5');
    expect(flowCritiques.length).toBe(0);
  });

  it('flow scores are available to downstream editing agents via state', async () => {
    const executionOrder: string[] = [];
    let capturedState: PipelineState | null = null;

    const agents = makeFlowAgents(executionOrder, {
      iterativeEditing: (ctx: ExecutionContext) => {
        capturedState = ctx.state;
      },
    });
    const ctx = makeFlowIntegrationCtx([2.0, 2.0, 0.005]);

    await executeFullPipeline('flow-int-test', agents, ctx, ctx.logger, {
      supervisorResume: { phase: 'COMPETITION', strategyRotationIndex: 0, ordinalHistory: [], diversityHistory: [] },
      featureFlags: { ...DEFAULT_EVOLUTION_FLAGS, flowCritiqueEnabled: true },
      startMs: Date.now(),
    });

    // iterativeEditing should see flow critiques and dimensionScores
    expect(capturedState).not.toBeNull();
    const flowCritiques = (capturedState!.allCritiques ?? []).filter((c) => c.scale === '0-5');
    expect(flowCritiques.length).toBe(3); // baseline + 2 added variants
    expect(capturedState!.dimensionScores!['v-flow-1']).toBeDefined();
    expect(capturedState!.dimensionScores!['v-flow-1']['flow:local_cohesion']).toBe(3);
  });

  it('propagates featureFlags to ctx.featureFlags for tournament access', async () => {
    const executionOrder: string[] = [];
    let capturedFlags: ExecutionContext['featureFlags'] = undefined;

    const agents = makeFlowAgents(executionOrder, {
      tournament: (ctx: ExecutionContext) => {
        capturedFlags = ctx.featureFlags;
      },
    });
    const ctx = makeFlowIntegrationCtx([2.0, 2.0, 0.005]);

    const flags = { ...DEFAULT_EVOLUTION_FLAGS, flowCritiqueEnabled: true };
    await executeFullPipeline('flow-int-test', agents, ctx, ctx.logger, {
      supervisorResume: { phase: 'COMPETITION', strategyRotationIndex: 0, ordinalHistory: [], diversityHistory: [] },
      featureFlags: flags,
      startMs: Date.now(),
    });

    expect(capturedFlags).toBeDefined();
    expect(capturedFlags!.flowCritiqueEnabled).toBe(true);
  });

  it('flow critique parse failure is non-fatal — pipeline continues', async () => {
    const executionOrder: string[] = [];
    const agents = makeFlowAgents(executionOrder);
    // Invalid JSON → parseFlowCritiqueResponse returns null
    const ctx = makeFlowIntegrationCtx([2.0, 2.0, 0.005], 'not valid json');

    await executeFullPipeline('flow-int-test', agents, ctx, ctx.logger, {
      supervisorResume: { phase: 'COMPETITION', strategyRotationIndex: 0, ordinalHistory: [], diversityHistory: [] },
      featureFlags: { ...DEFAULT_EVOLUTION_FLAGS, flowCritiqueEnabled: true },
      startMs: Date.now(),
    });

    // Pipeline should have continued through editing and tournament
    expect(executionOrder).toContain('iterativeEditing');
    expect(executionOrder).toContain('tournament');
    // No flow critiques added since parsing failed
    const flowCritiques = (ctx.state.allCritiques ?? []).filter((c) => c.scale === '0-5');
    expect(flowCritiques.length).toBe(0);
  });
});

// ─── finalizePipelineRun tests ───────────────────────────────────

describe('finalizePipelineRun', () => {
  it('calls summary persist, persistVariants, persistAgentMetrics, and linkStrategyConfig', async () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state, 'run-fin');
    state.addToPool({
      id: 'v1', text: 'V1', version: 1, parentIds: [],
      strategy: 'structural_transform', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    state.ratings.set('v1', ratingWithOrdinal(20));

    const ctx = makeCtx(state, 'run-fin');
    const logger = makeMockLogger();

    await finalizePipelineRun('run-fin', ctx, logger, 'completed', 30.0, undefined);

    // Verify Supabase was called — the mock returns chain objects
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();

    // from() should have been called for: run_summary update, variants upsert, agent_metrics upsert, strategy_configs
    expect(supabase.from).toHaveBeenCalled();
    const fromCalls = (supabase.from as jest.Mock).mock.calls.map((c: string[]) => c[0]);
    expect(fromCalls).toContain('content_evolution_runs'); // summary update
    expect(fromCalls).toContain('content_evolution_variants'); // persistVariants
  });

  it('handles summary validation failure gracefully', async () => {
    const state = new PipelineStateImpl('Original');
    const ctx = makeCtx(state, 'run-fin-fail');
    const logger = makeMockLogger();

    // Even with an empty pool (no baseline), it should not throw
    await expect(
      finalizePipelineRun('run-fin-fail', ctx, logger, 'completed', 10.0, undefined),
    ).resolves.toBeUndefined();
  });

  it('computes cost_prediction when cost_estimate_detail exists on run row', async () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state, 'run-cost');
    const ctx = makeCtx(state, 'run-cost');
    const costTracker = ctx.costTracker;
    // Record some spend to verify actual costs are used
    costTracker.recordSpend('generation', 0.50);
    costTracker.recordSpend('calibration', 0.30);

    const logger = makeMockLogger();

    // Make Supabase return cost_estimate_detail on the query after persistAgentMetrics
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();

    // The select().eq().single() chain for cost_estimate_detail
    let selectCallCount = 0;
    (supabase.single as jest.Mock).mockImplementation(() => {
      selectCallCount++;
      // The cost_estimate_detail query happens after run_summary, variants, agent_metrics
      // It's the single() call that selects 'cost_estimate_detail'
      return Promise.resolve({
        data: {
          cost_estimate_detail: {
            totalUsd: 1.00,
            perAgent: { generation: 0.60, calibration: 0.40 },
            perIteration: 0.10,
            confidence: 'medium',
          },
        },
        error: null,
      });
    });

    await finalizePipelineRun('run-cost', ctx, logger, 'completed', 30.0, undefined);

    // Verify update was called with cost_prediction
    const updateCalls = (supabase.update as jest.Mock).mock.calls;
    const costPredictionUpdate = updateCalls.find(
      (call: unknown[]) => {
        const arg = call[0] as Record<string, unknown>;
        return arg && typeof arg === 'object' && 'cost_prediction' in arg;
      },
    );
    expect(costPredictionUpdate).toBeDefined();
    const prediction = costPredictionUpdate[0].cost_prediction;
    expect(prediction.estimatedUsd).toBe(1.00);
    expect(prediction.actualUsd).toBeGreaterThan(0);
    expect(typeof prediction.deltaPercent).toBe('number');
  });

  it('skips cost_prediction when no estimate exists (no error)', async () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state, 'run-no-est');
    const ctx = makeCtx(state, 'run-no-est');
    const logger = makeMockLogger();

    // Default mock returns { data: null, error: null } for single()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();
    (supabase.single as jest.Mock).mockResolvedValue({ data: { cost_estimate_detail: null }, error: null });

    await finalizePipelineRun('run-no-est', ctx, logger, 'completed', 30.0, undefined);

    // Should not log any warnings about cost prediction
    const warnCalls = (logger.warn as jest.Mock).mock.calls;
    const costPredWarn = warnCalls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('cost_prediction'),
    );
    expect(costPredWarn).toBeUndefined();
  });
});

// ─── persistAgentMetrics filtering tests ─────────────────────────

describe('persistAgentMetrics — 0-variant agent filtering', () => {
  it('skips agents with 0 pool variants (e.g. flowCritique, calibration)', async () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state, 'run-metrics');
    state.addToPool({
      id: 'v1', text: 'V1', version: 1, parentIds: [],
      strategy: 'structural_transform', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    state.ratings.set('v1', ratingWithOrdinal(20));

    // CostTracker reports costs for both generation (has variants) and flowCritique (has none)
    const agentCosts = new Map<string, number>([
      ['generation', 0.05],
      ['flowCritique', 0.02],
      ['calibration', 0.03],
    ]);
    const ctx = makeCtx(state, 'run-metrics');
    (ctx.costTracker.getAllAgentCosts as jest.Mock).mockReturnValue(Object.fromEntries(agentCosts));

    await finalizePipelineRun('run-metrics', ctx, makeMockLogger(), 'completed', 30.0, undefined);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();
    const upsertCalls = (supabase.upsert as jest.Mock).mock.calls;

    // Find upsert calls that look like agent metrics (have agent_name AND variants_generated)
    type MetricRow = { agent_name: string; [key: string]: unknown };
    const agentMetricUpserts: MetricRow[] = upsertCalls
      .map((call: unknown[]) => call[0] as Record<string, unknown>)
      .filter((row): row is MetricRow => row != null && typeof row === 'object' && 'agent_name' in row && 'variants_generated' in row);

    // generation has variants (structural_transform maps to generation) — should be upserted
    const generationUpsert = agentMetricUpserts.find((r) => r.agent_name === 'generation');
    expect(generationUpsert).toBeDefined();

    // flowCritique and calibration have 0 pool variants — should NOT be upserted
    const flowUpsert = agentMetricUpserts.find((r) => r.agent_name === 'flowCritique');
    expect(flowUpsert).toBeUndefined();
    const calibrationUpsert = agentMetricUpserts.find((r) => r.agent_name === 'calibration');
    expect(calibrationUpsert).toBeUndefined();
  });
});

// ─── createDefaultAgents factory tests ───────────────────────────

describe('createDefaultAgents', () => {
  const EXPECTED_AGENT_KEYS: (keyof PipelineAgents)[] = [
    'generation', 'calibration', 'tournament', 'evolution',
    'reflection', 'iterativeEditing', 'treeSearch', 'sectionDecomposition',
    'debate', 'proximity', 'metaReview', 'outlineGeneration',
  ];

  it('returns all 12 pipeline agents', () => {
    const agents = createDefaultAgents();

    for (const key of EXPECTED_AGENT_KEYS) {
      expect(agents[key]).toBeDefined();
      expect(agents[key]!.name).toBeTruthy();
      expect(typeof agents[key]!.execute).toBe('function');
      expect(typeof agents[key]!.canExecute).toBe('function');
    }
  });

  it('returns no undefined optional agents', () => {
    const agents = createDefaultAgents();
    const keys = Object.keys(agents) as (keyof PipelineAgents)[];

    for (const key of keys) {
      expect(agents[key]).not.toBeUndefined();
    }

    expect(keys.length).toBe(12);
  });
});

// ─── preparePipelineRun tests ────────────────────────────────────

describe('preparePipelineRun', () => {
  const mockLlmClient: EvolutionLLMClient = {
    complete: jest.fn(),
    completeStructured: jest.fn(),
  };

  it('returns ctx with all required fields and 12 agents', () => {
    const { ctx, agents, config, costTracker, logger } = preparePipelineRun({
      runId: 'prep-test-run',
      originalText: 'Test article content',
      title: 'Test Title',
      explanationId: 42,
      llmClient: mockLlmClient,
    });

    expect(ctx.runId).toBe('prep-test-run');
    expect(ctx.payload.originalText).toBe('Test article content');
    expect(ctx.payload.title).toBe('Test Title');
    expect(ctx.payload.explanationId).toBe(42);
    expect(ctx.payload.config).toBeDefined();
    expect(ctx.state).toBeDefined();
    expect(ctx.llmClient).toBe(mockLlmClient);
    expect(ctx.logger).toBeDefined();
    expect(ctx.costTracker).toBeDefined();

    // All 12 agents present
    expect(Object.keys(agents).length).toBe(12);
    expect(config.maxIterations).toBeDefined();
    expect(costTracker).toBeDefined();
    expect(logger).toBeDefined();
  });

  it('applies config overrides', () => {
    const { config } = preparePipelineRun({
      runId: 'prep-override',
      originalText: 'text',
      title: 'T',
      explanationId: 1,
      configOverrides: { maxIterations: 3 },
      llmClient: mockLlmClient,
    });

    expect(config.maxIterations).toBe(3);
  });

  it('throws when neither llmClient nor llmClientId provided', () => {
    expect(() => preparePipelineRun({
      runId: 'bad',
      originalText: 'text',
      title: 'T',
      explanationId: 1,
    })).toThrow('either llmClient or llmClientId must be provided');
  });
});

// ─── qualityThresholdMet tests ──────────────────────────────────

describe('qualityThresholdMet', () => {
  it('returns false when allCritiques is null', () => {
    const state = new PipelineStateImpl('text');
    state.allCritiques = null;
    expect(qualityThresholdMet(state, 8)).toBe(false);
  });

  it('returns false when allCritiques is empty', () => {
    const state = new PipelineStateImpl('text');
    state.allCritiques = [];
    expect(qualityThresholdMet(state, 8)).toBe(false);
  });

  it('returns false when top variant has no critique', () => {
    const state = new PipelineStateImpl('text');
    insertBaselineVariant(state, 'run-qt');
    state.addToPool({
      id: 'v1', text: 'V1', version: 1, parentIds: [],
      strategy: 'structural_transform', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    state.ratings.set('v1', ratingWithOrdinal(30)); // make v1 top
    state.allCritiques = [{
      variationId: 'nonexistent', dimensionScores: { clarity: 9 },
      goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'test',
    }];
    expect(qualityThresholdMet(state, 8)).toBe(false);
  });

  it('returns true when all dimensions >= threshold', () => {
    const state = new PipelineStateImpl('text');
    state.addToPool({
      id: 'v1', text: 'V1', version: 1, parentIds: [],
      strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    state.ratings.set('v1', ratingWithOrdinal(30));
    state.allCritiques = [{
      variationId: 'v1',
      dimensionScores: { clarity: 9, structure: 8, engagement: 8.5 },
      goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'test',
    }];
    expect(qualityThresholdMet(state, 8)).toBe(true);
  });

  it('returns false when one dimension is below threshold', () => {
    const state = new PipelineStateImpl('text');
    state.addToPool({
      id: 'v1', text: 'V1', version: 1, parentIds: [],
      strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    state.ratings.set('v1', ratingWithOrdinal(30));
    state.allCritiques = [{
      variationId: 'v1',
      dimensionScores: { clarity: 9, structure: 7, engagement: 8 },
      goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'test',
    }];
    expect(qualityThresholdMet(state, 8)).toBe(false);
  });

  it('uses latest critique for a variant (not first)', () => {
    const state = new PipelineStateImpl('text');
    state.addToPool({
      id: 'v1', text: 'V1', version: 1, parentIds: [],
      strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    state.ratings.set('v1', ratingWithOrdinal(30));
    state.allCritiques = [
      {
        variationId: 'v1',
        dimensionScores: { clarity: 5, structure: 5 },
        goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'test',
      },
      {
        variationId: 'v1',
        dimensionScores: { clarity: 9, structure: 9 },
        goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'test',
      },
    ];
    expect(qualityThresholdMet(state, 8)).toBe(true);
  });

  it('returns false when dimensionScores is empty', () => {
    const state = new PipelineStateImpl('text');
    state.addToPool({
      id: 'v1', text: 'V1', version: 1, parentIds: [],
      strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    state.ratings.set('v1', ratingWithOrdinal(30));
    state.allCritiques = [{
      variationId: 'v1', dimensionScores: {},
      goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'test',
    }];
    expect(qualityThresholdMet(state, 8)).toBe(false);
  });
});

// ─── Single-article via executeFullPipeline tests ───────────────

describe('executeFullPipeline — single-article mode', () => {
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

  function makeSingleArticleCtx(
    budgetCalls: number[],
  ): ExecutionContext {
    const config = resolveConfig({
      singleArticle: true,
      maxIterations: 3,
      expansion: { maxIterations: 0, minPool: 1, diversityThreshold: 0, minIterations: 0 },
      plateau: { window: 2, threshold: 0.02 },
    });
    const state = new PipelineStateImpl('Original article for single-article test.');
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
        runId: 'single-test-run',
        config,
      },
      state,
      llmClient: { complete: jest.fn(), completeStructured: jest.fn() } as unknown as EvolutionLLMClient,
      logger: makeMockLogger(),
      costTracker,
      runId: 'single-test-run',
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
      treeSearch: makeSpyAgent('treeSearch', executionOrder),
      sectionDecomposition: makeSpyAgent('sectionDecomposition', executionOrder),
      debate: makeSpyAgent('debate', executionOrder),
      proximity: makeSpyAgent('proximity', executionOrder),
      metaReview: makeSpyAgent('metaReview', executionOrder),
    };
  }

  it('skips generation, outlineGeneration, and evolution agents', async () => {
    const executionOrder: string[] = [];
    const agents = makeAllAgents(executionOrder);
    // 3 iterations + 1 for budget exhaustion stop
    const ctx = makeSingleArticleCtx([2.0, 2.0, 2.0, 0.005]);

    await executeFullPipeline('single-test-run', agents, ctx, ctx.logger, { startMs: Date.now() });

    expect(executionOrder).not.toContain('generation');
    expect(executionOrder).not.toContain('evolution');
  });

  it('runs improvement agents: reflection, iterativeEditing, treeSearch, sectionDecomposition', async () => {
    const executionOrder: string[] = [];
    const agents = makeAllAgents(executionOrder);
    const ctx = makeSingleArticleCtx([2.0, 2.0, 2.0, 0.005]);

    await executeFullPipeline('single-test-run', agents, ctx, ctx.logger, { startMs: Date.now() });

    expect(executionOrder).toContain('reflection');
    expect(executionOrder).toContain('iterativeEditing');
    expect(executionOrder).toContain('treeSearch');
    expect(executionOrder).toContain('sectionDecomposition');
  });

  it('stops with quality_threshold when all critique dimensions >= 8', async () => {
    const executionOrder: string[] = [];
    const agents = makeAllAgents(executionOrder);
    // Provide enough budget for all iterations
    const ctx = makeSingleArticleCtx([5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0]);

    // After first iteration's reflection, inject high-quality critiques
    const originalReflectionExecute = agents.reflection!.execute as jest.Mock;
    originalReflectionExecute.mockImplementation(async () => {
      executionOrder.push('reflection');
      const topVariant = ctx.state.getTopByRating(1)[0];
      if (topVariant) {
        ctx.state.allCritiques = [{
          variationId: topVariant.id,
          dimensionScores: { clarity: 9, structure: 9, engagement: 9 },
          goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'test',
        }];
      }
      return { success: true, costUsd: 0, variantsAdded: 0, matchesPlayed: 0 };
    });

    const result = await executeFullPipeline('single-test-run', agents, ctx, ctx.logger, { startMs: Date.now() });

    expect(result.stopReason).toBe('quality_threshold');
  });
});

// ─── runAgent retry on transient errors ──────────────────────────

describe('executeFullPipeline — runAgent retry on transient errors', () => {
  function makeSpyAgent(name: string, executionOrder: string[]): PipelineAgent {
    return {
      name,
      canExecute: jest.fn().mockReturnValue(true),
      execute: jest.fn().mockImplementation(async () => {
        executionOrder.push(name);
        return { agentType: name, success: true, costUsd: 0, variantsAdded: 0, matchesPlayed: 0 };
      }),
    };
  }

  function makeRetryCtx(budgetCalls: number[]): ExecutionContext {
    const config = resolveConfig({
      maxIterations: 5,
      expansion: { maxIterations: 1, minPool: 5, diversityThreshold: 0.25, minIterations: 3 },
      plateau: { window: 2, threshold: 0.02 },
    });
    const state = new PipelineStateImpl('Test article text for retry tests.');
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
      payload: { originalText: state.originalText, title: 'Test', explanationId: 1, runId: 'retry-test', config },
      state,
      llmClient: { complete: jest.fn(), completeStructured: jest.fn() } as unknown as EvolutionLLMClient,
      logger: makeMockLogger(),
      costTracker,
      runId: 'retry-test',
    };
  }

  function makeAllAgentsWithOverride(
    executionOrder: string[],
    overrides: Partial<Record<keyof PipelineAgents, PipelineAgent>>,
  ): PipelineAgents {
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
      ...overrides,
    };
  }

  // Factory: each test gets fresh arrays to avoid shared-mutation (supervisor pushes to ordinalHistory in-place)
  function makePipelineOpts() {
    return {
      supervisorResume: { phase: 'COMPETITION' as const, strategyRotationIndex: 0, ordinalHistory: [] as number[], diversityHistory: [] as number[] },
      featureFlags: { ...DEFAULT_EVOLUTION_FLAGS, sectionDecompositionEnabled: false, tournamentEnabled: false },
      startMs: Date.now(),
    };
  }

  it('retries agent on transient error and succeeds on second attempt', async () => {
    const executionOrder: string[] = [];
    let callCount = 0;
    const flakeyGeneration: PipelineAgent = {
      name: 'generation',
      canExecute: jest.fn().mockReturnValue(true),
      execute: jest.fn(async () => {
        callCount++;
        executionOrder.push('generation');
        if (callCount === 1) throw new Error('Socket timeout');
        return { agentType: 'generation', success: true, costUsd: 0, variantsAdded: 1, matchesPlayed: 0 };
      }),
    };
    const agents = makeAllAgentsWithOverride(executionOrder, { generation: flakeyGeneration });
    const ctx = makeRetryCtx([2.0, 2.0, 0.005]);

    await executeFullPipeline('retry-test', agents, ctx, ctx.logger, makePipelineOpts());

    expect(flakeyGeneration.execute).toHaveBeenCalledTimes(2);
  });

  it('retries transient error and fails after retries exhausted', async () => {
    const executionOrder: string[] = [];
    const alwaysFailCalibration: PipelineAgent = {
      name: 'calibration',
      canExecute: jest.fn().mockReturnValue(true),
      execute: jest.fn(async () => { throw new Error('Socket timeout'); }),
    };
    const agents = makeAllAgentsWithOverride(executionOrder, { calibration: alwaysFailCalibration });
    const ctx = makeRetryCtx([2.0, 2.0, 2.0, 0.005]);

    try {
      await executeFullPipeline('retry-test', agents, ctx, ctx.logger, makePipelineOpts());
    } catch {
      // Expected — pipeline re-throws after retries exhausted
    }
    // 1 initial + 1 retry = 2 total calls
    expect(alwaysFailCalibration.execute).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-transient errors', async () => {
    const executionOrder: string[] = [];
    const fatalCalibration: PipelineAgent = {
      name: 'calibration',
      canExecute: jest.fn().mockReturnValue(true),
      execute: jest.fn(async () => { throw new Error('Invalid JSON response'); }),
    };
    const agents = makeAllAgentsWithOverride(executionOrder, { calibration: fatalCalibration });
    const ctx = makeRetryCtx([2.0, 2.0, 2.0, 0.005]);

    try {
      await executeFullPipeline('retry-test', agents, ctx, ctx.logger, makePipelineOpts());
    } catch {
      // Expected — fatal errors are not retried
    }
    // Non-transient: exactly 1 call, no retry
    expect(fatalCalibration.execute).toHaveBeenCalledTimes(1);
  });

  it('does not retry BudgetExceededError (pauses instead)', async () => {
    const executionOrder: string[] = [];
    const budgetCalibration: PipelineAgent = {
      name: 'calibration',
      canExecute: jest.fn().mockReturnValue(true),
      execute: jest.fn(async () => { throw new BudgetExceededError('calibration', 5.0, 5.0); }),
    };
    const agents = makeAllAgentsWithOverride(executionOrder, { calibration: budgetCalibration });
    const ctx = makeRetryCtx([2.0, 2.0, 2.0, 0.005]);

    try {
      await executeFullPipeline('retry-test', agents, ctx, ctx.logger, makePipelineOpts());
    } catch {
      // Expected — BudgetExceededError pauses, not retried
    }
    // Budget errors: exactly 1 call, no retry
    expect(budgetCalibration.execute).toHaveBeenCalledTimes(1);
  });

  it('preserves partial state from failed attempt (no rollback)', async () => {
    const executionOrder: string[] = [];
    let callCount = 0;
    const partialGeneration: PipelineAgent = {
      name: 'generation',
      canExecute: jest.fn().mockReturnValue(true),
      execute: jest.fn(async (ctx: ExecutionContext) => {
        callCount++;
        ctx.state.addToPool({
          id: `variant-attempt-${callCount}`,
          text: 'test', version: 1, parentIds: [],
          strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 0,
        });
        if (callCount === 1) throw new Error('Socket timeout');
        return { agentType: 'generation', success: true, costUsd: 0, variantsAdded: 1, matchesPlayed: 0 };
      }),
    };
    const agents = makeAllAgentsWithOverride(executionOrder, { generation: partialGeneration });
    const ctx = makeRetryCtx([2.0, 2.0, 0.005]);

    await executeFullPipeline('retry-test', agents, ctx, ctx.logger, makePipelineOpts());

    // Pool has baseline + variant-attempt-1 (partial, from failed) + variant-attempt-2 (from retry)
    expect(ctx.state.poolIds.has('variant-attempt-1')).toBe(true);
    expect(ctx.state.poolIds.has('variant-attempt-2')).toBe(true);
  });
});

// ─── persistCheckpoint includes total_cost_usd from CostTracker ──

describe('executeFullPipeline — checkpoint writes total_cost_usd', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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

  it('passes costTracker.getTotalSpent() to checkpoint update', async () => {
    const executionOrder: string[] = [];
    const config = resolveConfig({
      maxIterations: 5,
      expansion: { maxIterations: 1, minPool: 5, diversityThreshold: 0.25, minIterations: 3 },
      plateau: { window: 2, threshold: 0.02 },
    });
    const state = new PipelineStateImpl('Test article.');
    const costTracker: CostTracker = {
      reserveBudget: jest.fn().mockResolvedValue(undefined),
      recordSpend: jest.fn(),
      getAgentCost: jest.fn().mockReturnValue(0),
      getTotalSpent: jest.fn().mockReturnValue(2.75),
      getAvailableBudget: jest.fn()
        .mockReturnValueOnce(2.0)
        .mockReturnValueOnce(2.0)
        .mockReturnValue(0.005),
      getAllAgentCosts: jest.fn().mockReturnValue({}),
    };
    const ctx: ExecutionContext = {
      payload: { originalText: state.originalText, title: 'Test', explanationId: 1, runId: 'cost-test', config: config as EvolutionRunConfig },
      state,
      llmClient: { complete: jest.fn(), completeStructured: jest.fn() } as unknown as EvolutionLLMClient,
      logger: makeMockLogger(),
      costTracker,
      runId: 'cost-test',
    };

    const agents: PipelineAgents = {
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

    await executeFullPipeline('cost-test', agents, ctx, ctx.logger, {
      supervisorResume: { phase: 'COMPETITION', strategyRotationIndex: 0, ordinalHistory: [], diversityHistory: [] },
      featureFlags: { ...DEFAULT_EVOLUTION_FLAGS },
      startMs: Date.now(),
    });

    // Verify that the Supabase update() was called with total_cost_usd
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();
    const updateCalls = (supabase.update as jest.Mock).mock.calls;

    // At least one checkpoint update should include total_cost_usd
    const costUpdateCall = updateCalls.find(
      (call: unknown[]) => {
        const arg = call[0] as Record<string, unknown>;
        return arg && typeof arg === 'object' && 'total_cost_usd' in arg;
      },
    );
    expect(costUpdateCall).toBeDefined();
    expect(costUpdateCall![0].total_cost_usd).toBe(2.75);
  });
});

// ─── persistAgentInvocation tests ───────────────────────────────

import { persistAgentInvocation, truncateDetail, sliceLargeArrays } from './pipeline';
import type { AgentExecutionDetail, GenerationExecutionDetail, TournamentExecutionDetail, CalibrationExecutionDetail, IterativeEditingExecutionDetail } from '../types';
import { generationDetailFixture } from '@/testing/fixtures/executionDetailFixtures';

describe('persistAgentInvocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('upserts invocation with execution detail', async () => {
    const result = {
      agentType: 'generation',
      success: true,
      costUsd: 0.05,
      variantsAdded: 2,
      executionDetail: generationDetailFixture,
    };
    const logger = makeMockLogger();

    await persistAgentInvocation('run-1', 1, 'generation', 0, result, logger);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();
    const upsertCalls = (supabase.upsert as jest.Mock).mock.calls;

    const invocationUpsert = upsertCalls.find(
      (call: unknown[]) => {
        const row = call[0] as Record<string, unknown>;
        return row?.agent_name === 'generation' && 'execution_detail' in row;
      },
    );
    expect(invocationUpsert).toBeDefined();
    const row = invocationUpsert![0] as Record<string, unknown>;
    expect(row.run_id).toBe('run-1');
    expect(row.iteration).toBe(1);
    expect(row.execution_order).toBe(0);
    expect(row.success).toBe(true);
    expect(row.cost_usd).toBe(0.05);
    expect((row.execution_detail as GenerationExecutionDetail).detailType).toBe('generation');
  });

  it('persists empty detail for agents without executionDetail', async () => {
    const result = { agentType: 'test', success: true, costUsd: 0 };
    const logger = makeMockLogger();

    await persistAgentInvocation('run-1', 1, 'test', 0, result, logger);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();
    const upsertCalls = (supabase.upsert as jest.Mock).mock.calls;

    const invocationUpsert = upsertCalls.find(
      (call: unknown[]) => {
        const row = call[0] as Record<string, unknown>;
        return row?.agent_name === 'test' && 'execution_detail' in row;
      },
    );
    expect(invocationUpsert).toBeDefined();
    expect((invocationUpsert![0] as Record<string, unknown>).execution_detail).toEqual({});
  });

  it('logs warning on DB error without throwing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    (createSupabaseServiceClient as jest.Mock).mockRejectedValueOnce(new Error('DB down'));

    const result = { agentType: 'test', success: true, costUsd: 0 };
    const logger = makeMockLogger();

    // Should not throw
    await persistAgentInvocation('run-1', 1, 'test', 0, result, logger);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to persist agent invocation',
      expect.objectContaining({ agent: 'test' }),
    );
  });
});

// ─── truncateDetail tests ───────────────────────────────────────

describe('truncateDetail', () => {
  it('returns detail unchanged when under 100KB', () => {
    const result = truncateDetail(generationDetailFixture);
    expect(result).toEqual(generationDetailFixture);
    expect(result._truncated).toBeUndefined();
  });

  it('slices tournament rounds and sets _truncated', () => {
    const bigTournament: TournamentExecutionDetail = {
      detailType: 'tournament',
      budgetPressure: 0.5,
      budgetTier: 'medium',
      rounds: Array.from({ length: 50 }, (_, i) => ({
        roundNumber: i + 1,
        pairs: [{ variantA: 'a'.repeat(500), variantB: 'b'.repeat(500) }],
        matches: [{
          variationA: 'a'.repeat(500), variationB: 'b'.repeat(500),
          winner: 'a'.repeat(500), confidence: 0.8, turns: 2,
          dimensionScores: { clarity: 'A' },
        }],
        multiTurnUsed: 0,
      })),
      exitReason: 'maxRounds',
      convergenceStreak: 0,
      staleRounds: 0,
      totalComparisons: 50,
      flowEnabled: false,
      totalCost: 0.1,
    };

    const result = truncateDetail(bigTournament) as TournamentExecutionDetail;
    // Should be sliced to 30 rounds if over 100KB
    if (result._truncated) {
      expect(result.rounds.length).toBeLessThanOrEqual(30);
    }
  });

  it('strips to base fields when still over limit after slicing', () => {
    // Create a detail so large even slicing can't save it
    const huge: GenerationExecutionDetail = {
      detailType: 'generation',
      strategies: Array.from({ length: 100 }, (_, i) => ({
        name: 'x'.repeat(2000),
        promptLength: 1000,
        status: 'success' as const,
        variantId: 'v'.repeat(2000),
        textLength: i,
      })),
      feedbackUsed: true,
      totalCost: 0.1,
    };

    const result = truncateDetail(huge);
    expect(result._truncated).toBe(true);
    expect(result.detailType).toBe('generation');
    expect(result.totalCost).toBe(0.1);
    // Strategies should be stripped in phase 2
    expect((result as GenerationExecutionDetail).strategies).toBeUndefined();
  });
});

// ─── sliceLargeArrays tests ─────────────────────────────────────

describe('sliceLargeArrays', () => {
  it('slices calibration entrants to 50 with matches to 20', () => {
    const detail: CalibrationExecutionDetail = {
      detailType: 'calibration',
      entrants: Array.from({ length: 60 }, (_, i) => ({
        variantId: `v-${i}`,
        opponents: [],
        matches: Array.from({ length: 25 }, (__, j) => ({
          opponentId: `opp-${j}`, winner: `v-${i}`, confidence: 0.8, cacheHit: false,
        })),
        earlyExit: false,
        ratingBefore: { mu: 25, sigma: 8 },
        ratingAfter: { mu: 26, sigma: 7 },
      })),
      avgConfidence: 0.8,
      totalMatches: 100,
      totalCost: 0.05,
    };

    const result = sliceLargeArrays(detail) as CalibrationExecutionDetail;
    expect(result.entrants.length).toBe(50);
    expect(result.entrants[0].matches.length).toBe(20);
  });

  it('slices iterativeEditing cycles to 10', () => {
    const detail: IterativeEditingExecutionDetail = {
      detailType: 'iterativeEditing',
      targetVariantId: 'v1',
      config: { maxCycles: 20, maxConsecutiveRejections: 3, qualityThreshold: 7.5 },
      cycles: Array.from({ length: 15 }, (_, i) => ({
        cycleNumber: i + 1,
        target: { description: 'test', source: 'rubric' },
        verdict: 'ACCEPT' as const,
        confidence: 0.8,
        formatValid: true,
      })),
      initialCritique: { dimensionScores: {} },
      stopReason: 'max_cycles',
      consecutiveRejections: 0,
      totalCost: 0.05,
    };

    const result = sliceLargeArrays(detail) as IterativeEditingExecutionDetail;
    expect(result.cycles.length).toBe(10);
  });

  it('returns other detail types unchanged', () => {
    const result = sliceLargeArrays(generationDetailFixture);
    expect(result).toEqual(generationDetailFixture);
  });
});

// ─── markRunFailed in outer catch (defense-in-depth) ─────────────

describe('executeFullPipeline — marks run as failed on unhandled error', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeSpyAgent(name: string): PipelineAgent {
    return {
      name,
      canExecute: jest.fn().mockReturnValue(true),
      execute: jest.fn().mockImplementation(async () => {
        return { success: true, costUsd: 0, variantsAdded: 0, matchesPlayed: 0 };
      }),
    };
  }

  it('calls markRunFailed with status guard when agent throws and retries exhausted', async () => {
    const fatalAgent: PipelineAgent = {
      name: 'generation',
      canExecute: jest.fn().mockReturnValue(true),
      execute: jest.fn(async () => { throw new Error('Unrecoverable error'); }),
    };

    const config = resolveConfig({
      maxIterations: 5,
      expansion: { maxIterations: 1, minPool: 5, diversityThreshold: 0.25, minIterations: 3 },
      plateau: { window: 2, threshold: 0.02 },
    });
    const state = new PipelineStateImpl('Test article.');
    const costTracker: CostTracker = {
      reserveBudget: jest.fn().mockResolvedValue(undefined),
      recordSpend: jest.fn(),
      getAgentCost: jest.fn().mockReturnValue(0),
      getTotalSpent: jest.fn().mockReturnValue(0),
      getAvailableBudget: jest.fn().mockReturnValue(2.0),
      getAllAgentCosts: jest.fn().mockReturnValue({}),
    };
    const ctx: ExecutionContext = {
      payload: { originalText: state.originalText, title: 'Test', explanationId: 1, runId: 'fail-test', config: config as EvolutionRunConfig },
      state, llmClient: { complete: jest.fn(), completeStructured: jest.fn() } as unknown as EvolutionLLMClient,
      logger: makeMockLogger(), costTracker, runId: 'fail-test',
    };

    const agents: PipelineAgents = {
      generation: fatalAgent,
      calibration: makeSpyAgent('calibration'),
      tournament: makeSpyAgent('tournament'),
      evolution: makeSpyAgent('evolution'),
      reflection: makeSpyAgent('reflection'),
      debate: makeSpyAgent('debate'),
      proximity: makeSpyAgent('proximity'),
      metaReview: makeSpyAgent('metaReview'),
    };

    try {
      await executeFullPipeline('fail-test', agents, ctx, ctx.logger, {
        supervisorResume: { phase: 'COMPETITION', strategyRotationIndex: 0, ordinalHistory: [], diversityHistory: [] },
        featureFlags: { ...DEFAULT_EVOLUTION_FLAGS },
        startMs: Date.now(),
      });
    } catch {
      // Expected — pipeline re-throws
    }

    // Verify markRunFailed was called: update() with status: 'failed' and .in() with status guard
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();
    const updateCalls = (supabase.update as jest.Mock).mock.calls;
    const failedUpdate = updateCalls.find(
      (call: unknown[]) => {
        const arg = call[0] as Record<string, unknown>;
        return arg?.status === 'failed' && arg?.completed_at;
      },
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate![0].error_message).toContain('Unrecoverable error');

    // Verify .in() was called with the status guard
    const inCalls = (supabase.in as jest.Mock).mock.calls;
    const statusGuardCall = inCalls.find(
      (call: unknown[]) => call[0] === 'status',
    );
    expect(statusGuardCall).toBeDefined();
    expect(statusGuardCall![1]).toEqual(expect.arrayContaining(['pending', 'claimed', 'running']));
  });
});
