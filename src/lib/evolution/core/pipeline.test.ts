// Unit tests for pipeline helpers: insertBaselineVariant, buildRunSummary, validateRunSummary.
// Tests the baseline variant insertion, run summary construction, and Zod validation.

import { insertBaselineVariant, buildRunSummary, validateRunSummary } from './pipeline';
import { PipelineStateImpl } from './state';
import { BASELINE_STRATEGY, EvolutionRunSummarySchema } from '../types';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig } from '../types';
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
    getTotalSpent: jest.fn().mockReturnValue(1.5),
    getAvailableBudget: jest.fn().mockReturnValue(3.5),
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

  it('initializes Elo to default (1200)', () => {
    const state = new PipelineStateImpl('text');
    insertBaselineVariant(state, 'run-3');

    expect(state.eloRatings.get('baseline-run-3')).toBe(1200);
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
    state.eloRatings.set('v1', 1300);
    state.matchHistory.push({
      variationA: 'baseline-run-1', variationB: 'v1', winner: 'v1',
      confidence: 0.8, turns: 1, dimensionScores: {},
    });

    const ctx = makeCtx(state, 'run-1');
    const summary = buildRunSummary(ctx, 'completed', 42.5);

    const parsed = EvolutionRunSummarySchema.safeParse(summary);
    expect(parsed.success).toBe(true);
    expect(summary.version).toBe(1);
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
    expect(summary.baselineElo).toBeNull();
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

  it('returns empty eloHistory/diversityHistory without supervisor', () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state, 'run-no-sup');

    const ctx = makeCtx(state, 'run-no-sup');
    const summary = buildRunSummary(ctx, 'completed', 5, undefined);

    expect(summary.eloHistory).toEqual([]);
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
    // Baseline at 1400, v1 at default 1200
    state.eloRatings.set('baseline-run-top', 1400);

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
      state.eloRatings.set(`v${i}`, 1300 + i * 50);
    }
    // Baseline stays at default 1200, all variants higher

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
    state.eloRatings.set('v1', 1300);
    state.eloRatings.set('v2', 1500);

    const ctx = makeCtx(state, 'run-strat');
    const summary = buildRunSummary(ctx, 'completed', 10);

    expect(summary.strategyEffectiveness['structural_transform'].count).toBe(2);
    expect(summary.strategyEffectiveness['structural_transform'].avgElo).toBe(1400);
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
    expect(result?.version).toBe(1);
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
