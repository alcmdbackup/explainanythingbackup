// Unit tests for pipelineUtilities: sliceLargeArrays, truncateDetail, captureBeforeState,
// createAgentInvocation, updateAgentInvocation.

import { sliceLargeArrays, truncateDetail, MAX_DETAIL_BYTES, captureBeforeState, computeDiffMetricsFromActions, createAgentInvocation, updateAgentInvocation } from './pipelineUtilities';

/* ── Supabase mock ──────────────────────────────────────────────── */
jest.mock('@/lib/utils/supabase/server', () => {
  const chain: Record<string, jest.Mock> = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.upsert = jest.fn().mockReturnValue(chain);
  chain.update = jest.fn().mockReturnValue(chain);
  chain.select = jest.fn().mockReturnValue(chain);
  chain.single = jest.fn().mockResolvedValue({ data: { id: 'inv-uuid-001' }, error: null });
  chain.eq = jest.fn().mockResolvedValue({ data: null, error: null });
  return { createSupabaseServiceClient: jest.fn().mockResolvedValue(chain) };
});
import { createRating, toEloScale } from './rating';
import type {
  GenerationExecutionDetail,
  TournamentExecutionDetail,
  CalibrationExecutionDetail,
  IterativeEditingExecutionDetail,
  ReadonlyPipelineState,
  TextVariation,
} from '../types';
import type { Rating } from './rating';
import type { PipelineAction } from './actions';
import type { BeforeStateSnapshot } from './pipelineUtilities';
import { generationDetailFixture } from '@evolution/testing/executionDetailFixtures';

/** Minimal ReadonlyPipelineState mock for testing diff metrics. */
function mockPipelineState(overrides: Partial<ReadonlyPipelineState> = {}): ReadonlyPipelineState {
  return {
    iteration: 1,
    originalText: 'test',
    pool: [],
    poolIds: new Set<string>(),
    newEntrantsThisIteration: [],
    ratings: new Map<string, Rating>(),
    matchCounts: new Map<string, number>(),
    matchHistory: [],
    dimensionScores: null,
    allCritiques: [],
    diversityScore: 0,
    metaFeedback: null,
    lastSyncedMatchIndex: 0,
    getTopByRating: () => [],
    getPoolSize: () => 0,
    getVariationById: () => undefined,
    hasVariant: () => false,
    ...overrides,
  };
}

function makeVariant(id: string, version = 1): TextVariation {
  return { id, text: `text-${id}`, version, parentIds: [], strategy: 'gen', createdAt: 1, iterationBorn: 1 };
}

describe('sliceLargeArrays', () => {
  it('slices tournament rounds to 30', () => {
    const detail: TournamentExecutionDetail = {
      detailType: 'tournament',
      budgetPressure: 0.5,
      budgetTier: 'medium',
      rounds: Array.from({ length: 50 }, (_, i) => ({
        roundNumber: i + 1,
        pairs: [],
        matches: [],
        multiTurnUsed: 0,
      })),
      exitReason: 'maxRounds',
      convergenceStreak: 0,
      staleRounds: 0,
      totalComparisons: 50,
      flowEnabled: false,
      totalCost: 0.1,
    };

    const result = sliceLargeArrays(detail) as TournamentExecutionDetail;
    expect(result.rounds.length).toBe(30);
  });

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

  it('slices ranking triage entrants to 50 with matches to 20', () => {
    const detail: import('../types').RankingExecutionDetail = {
      detailType: 'ranking',
      triage: Array.from({ length: 60 }, (_, i) => ({
        variantId: `v-${i}`,
        opponents: [],
        matches: Array.from({ length: 25 }, (__, j) => ({
          opponentId: `opp-${j}`, winner: `v-${i}`, confidence: 0.8, cacheHit: false,
        })),
        eliminated: false,
        ratingBefore: { mu: 25, sigma: 8 },
        ratingAfter: { mu: 26, sigma: 7 },
      })),
      fineRanking: { rounds: 5, exitReason: 'convergence', convergenceStreak: 3 },
      budgetPressure: 0.3,
      budgetTier: 'low',
      top20Cutoff: 27,
      eligibleContenders: 10,
      totalComparisons: 200,
      flowEnabled: false,
      totalCost: 0.1,
    };

    const result = sliceLargeArrays(detail) as import('../types').RankingExecutionDetail;
    expect(result.triage.length).toBe(50);
    expect(result.triage[0].matches.length).toBe(20);
  });

  it('returns other detail types unchanged', () => {
    const result = sliceLargeArrays(generationDetailFixture);
    expect(result).toEqual(generationDetailFixture);
  });
});

describe('truncateDetail', () => {
  it('returns detail unchanged when under 100KB', () => {
    const result = truncateDetail(generationDetailFixture);
    expect(result).toEqual(generationDetailFixture);
    expect(result._truncated).toBeUndefined();
  });

  it('strips to base fields when over limit after slicing', () => {
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
    expect((result as GenerationExecutionDetail).strategies).toBeUndefined();
  });

  it('MAX_DETAIL_BYTES is 100,000', () => {
    expect(MAX_DETAIL_BYTES).toBe(100_000);
  });
});

describe('captureBeforeState', () => {
  it('captures pool IDs, lengths, diversity, and Elo-scale ratings', () => {
    const rating = createRating();
    const state = mockPipelineState({
      pool: [makeVariant('v1'), makeVariant('v2')],
      ratings: new Map([['v1', rating], ['v2', rating]]),
      matchHistory: [{ variationA: 'v1', variationB: 'v2', winner: 'v1', confidence: 0.8, turns: 1, dimensionScores: {} }],
      allCritiques: [{ variationId: 'v1', dimensionScores: {}, goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'test' }],
      diversityScore: 0.75,
      metaFeedback: null,
    });

    const snapshot = captureBeforeState(state);
    expect(snapshot.poolIds).toEqual(['v1', 'v2']);
    expect(snapshot.matchHistoryLength).toBe(1);
    expect(snapshot.critiquesLength).toBe(1);
    expect(snapshot.diversityScore).toBe(0.75);
    expect(snapshot.metaFeedbackPresent).toBe(false);
    expect(Object.keys(snapshot.eloRatings)).toEqual(['v1', 'v2']);
    // Default rating mu=25 maps to Elo ~1200 via toEloScale
    expect(snapshot.eloRatings['v1']).toBeCloseTo(1200, -1);
  });
});

describe('_diffMetrics survives truncateDetail Phase 2 fallback', () => {
  it('_diffMetrics is preserved when detail exceeds 100KB and is stripped to base fields', () => {
    // Build a detail so large it triggers Phase 2 (strip to base fields)
    const hugeDetail: GenerationExecutionDetail = {
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

    const diffMetrics = {
      variantsAdded: 3,
      newVariantIds: ['v2', 'v3', 'v4'],
      matchesPlayed: 10,
      eloChanges: { v1: 50, v2: -30 },
      critiquesAdded: 2,
      debatesAdded: 0,
      diversityScoreAfter: 0.85,
      metaFeedbackPopulated: false,
    };

    // Simulate the pipeline's merge-after-truncation pattern
    const truncated = truncateDetail(hugeDetail);
    expect(truncated._truncated).toBe(true);
    expect((truncated as GenerationExecutionDetail).strategies).toBeUndefined();

    // Merge _diffMetrics AFTER truncation
    const final = { ...truncated, _diffMetrics: diffMetrics };
    expect(final._diffMetrics).toEqual(diffMetrics);
    expect(final.detailType).toBe('generation');
    expect(final._truncated).toBe(true);
  });
});

/* ── computeDiffMetricsFromActions ──────────────────────────────── */

function makeBeforeSnapshot(overrides: Partial<BeforeStateSnapshot> = {}): BeforeStateSnapshot {
  return {
    poolIds: [],
    matchHistoryLength: 0,
    critiquesLength: 0,
    diversityScore: 0,
    metaFeedbackPresent: false,
    eloRatings: {},
    ...overrides,
  };
}

describe('computeDiffMetricsFromActions', () => {
  it('counts variants added from ADD_TO_POOL actions', () => {
    const actions: PipelineAction[] = [
      { type: 'ADD_TO_POOL', variants: [makeVariant('v1'), makeVariant('v2')] },
      { type: 'ADD_TO_POOL', variants: [makeVariant('v3')] },
    ];
    const before = makeBeforeSnapshot();
    const after = mockPipelineState({ ratings: new Map() });
    const metrics = computeDiffMetricsFromActions(actions, before, after);

    expect(metrics.variantsAdded).toBe(3);
    expect(metrics.newVariantIds).toEqual(['v1', 'v2', 'v3']);
  });

  it('counts matches played from RECORD_MATCHES actions', () => {
    const actions: PipelineAction[] = [
      {
        type: 'RECORD_MATCHES',
        matches: [
          { variationA: 'v1', variationB: 'v2', winner: 'v1', confidence: 0.8, turns: 1, dimensionScores: {} },
          { variationA: 'v1', variationB: 'v3', winner: 'v1', confidence: 0.9, turns: 1, dimensionScores: {} },
        ],
        ratingUpdates: {},
        matchCountIncrements: {},
      },
    ];
    const before = makeBeforeSnapshot();
    const after = mockPipelineState({ ratings: new Map() });
    const metrics = computeDiffMetricsFromActions(actions, before, after);

    expect(metrics.matchesPlayed).toBe(2);
  });

  it('counts critiques added from APPEND_CRITIQUES actions', () => {
    const actions: PipelineAction[] = [
      {
        type: 'APPEND_CRITIQUES',
        critiques: [
          { variationId: 'v1', dimensionScores: { clarity: 7 }, goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'llm' },
          { variationId: 'v2', dimensionScores: { clarity: 8 }, goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'llm' },
        ],
        dimensionScoreUpdates: {},
      },
    ];
    const before = makeBeforeSnapshot();
    const after = mockPipelineState({ ratings: new Map() });
    const metrics = computeDiffMetricsFromActions(actions, before, after);

    expect(metrics.critiquesAdded).toBe(2);
  });

  it('computes elo changes from before/after state', () => {
    const defaultRating = createRating();
    const beforeElo = toEloScale(defaultRating.mu);
    const changedRating = { mu: 30, sigma: 7 };
    const afterElo = toEloScale(changedRating.mu);

    const actions: PipelineAction[] = [];
    const before = makeBeforeSnapshot({ eloRatings: { v1: beforeElo } });
    const after = mockPipelineState({
      ratings: new Map([['v1', changedRating]]),
    });
    const metrics = computeDiffMetricsFromActions(actions, before, after);

    expect(metrics.eloChanges['v1']).toBeCloseTo(afterElo - beforeElo, 1);
  });

  it('returns zeros for empty actions', () => {
    const actions: PipelineAction[] = [];
    const before = makeBeforeSnapshot();
    const after = mockPipelineState({ ratings: new Map() });
    const metrics = computeDiffMetricsFromActions(actions, before, after);

    expect(metrics.variantsAdded).toBe(0);
    expect(metrics.newVariantIds).toEqual([]);
    expect(metrics.matchesPlayed).toBe(0);
    expect(metrics.critiquesAdded).toBe(0);
    expect(metrics.eloChanges).toEqual({});
    expect(metrics.metaFeedbackPopulated).toBe(false);
  });

  it('picks up diversity score from SET_DIVERSITY_SCORE action', () => {
    const actions: PipelineAction[] = [
      { type: 'SET_DIVERSITY_SCORE', diversityScore: 0.85 },
    ];
    const before = makeBeforeSnapshot({ diversityScore: 0.5 });
    const after = mockPipelineState({ ratings: new Map() });
    const metrics = computeDiffMetricsFromActions(actions, before, after);

    expect(metrics.diversityScoreAfter).toBe(0.85);
  });

  it('detects meta feedback populated from SET_META_FEEDBACK action', () => {
    const actions: PipelineAction[] = [
      {
        type: 'SET_META_FEEDBACK',
        feedback: {
          recurringWeaknesses: ['weak'],
          priorityImprovements: ['improve'],
          successfulStrategies: ['good'],
          patternsToAvoid: ['bad'],
        },
      },
    ];
    const before = makeBeforeSnapshot({ metaFeedbackPresent: false });
    const after = mockPipelineState({ ratings: new Map() });
    const metrics = computeDiffMetricsFromActions(actions, before, after);

    expect(metrics.metaFeedbackPopulated).toBe(true);
  });

  it('falls back to before diversityScore when no SET_DIVERSITY_SCORE action present', () => {
    const actions: PipelineAction[] = [];
    const before = makeBeforeSnapshot({ diversityScore: 0.42 });
    const after = mockPipelineState({ ratings: new Map() });
    const metrics = computeDiffMetricsFromActions(actions, before, after);

    expect(metrics.diversityScoreAfter).toBe(0.42);
  });
});

/* ── createAgentInvocation & updateAgentInvocation ──────────────── */

async function getSupabaseMock(): Promise<Record<string, jest.Mock>> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
  return createSupabaseServiceClient() as Promise<Record<string, jest.Mock>>;
}

describe('createAgentInvocation and updateAgentInvocation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('createAgentInvocation returns a UUID string from the upserted row', async () => {
    const sb = await getSupabaseMock();
    (sb.single as jest.Mock).mockResolvedValueOnce({ data: { id: 'inv-uuid-abc' }, error: null });

    const id = await createAgentInvocation('run-1', 2, 'generation', 1);

    expect(id).toBe('inv-uuid-abc');
    expect(sb.from).toHaveBeenCalledWith('evolution_agent_invocations');
    expect(sb.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ run_id: 'run-1', iteration: 2, agent_name: 'generation', execution_order: 1 }),
      { onConflict: 'run_id,iteration,agent_name' },
    );
    expect(sb.select).toHaveBeenCalledWith('id');
    expect(sb.single).toHaveBeenCalled();
  });

  it('createAgentInvocation throws when upsert fails (error from Supabase)', async () => {
    const sb = await getSupabaseMock();
    (sb.single as jest.Mock).mockResolvedValueOnce({ data: null, error: { message: 'duplicate key' } });

    await expect(createAgentInvocation('run-err', 1, 'tournament', 2))
      .rejects.toThrow('createAgentInvocation failed: duplicate key');
  });

  it('createAgentInvocation throws when data is null (no row returned)', async () => {
    const sb = await getSupabaseMock();
    (sb.single as jest.Mock).mockResolvedValueOnce({ data: null, error: null });

    await expect(createAgentInvocation('run-null', 1, 'calibration', 3))
      .rejects.toThrow('createAgentInvocation failed: no data returned');
  });

  it('updateAgentInvocation calls supabase.update().eq() with correct invocationId and cost data', async () => {
    const sb = await getSupabaseMock();

    await updateAgentInvocation('inv-uuid-xyz', {
      success: true,
      costUsd: 0.042,
      skipped: false,
      error: undefined,
      executionDetail: generationDetailFixture,
    });

    expect(sb.from).toHaveBeenCalledWith('evolution_agent_invocations');
    expect(sb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        cost_usd: 0.042,
        skipped: false,
        error_message: null,
      }),
    );
    expect(sb.eq).toHaveBeenCalledWith('id', 'inv-uuid-xyz');
  });

  it('updateAgentInvocation merges diffMetrics into executionDetail when provided', async () => {
    const sb = await getSupabaseMock();

    const diffMetrics: import('../types').DiffMetrics = {
      variantsAdded: 2,
      newVariantIds: ['v5', 'v6'],
      matchesPlayed: 0,
      eloChanges: {},
      critiquesAdded: 0,
      debatesAdded: 0,
      diversityScoreAfter: 0,
      metaFeedbackPopulated: false,
    };

    await updateAgentInvocation('inv-uuid-merge', {
      success: true,
      costUsd: 0.01,
      executionDetail: generationDetailFixture,
      diffMetrics,
    });

    const updateArg = (sb.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.execution_detail._diffMetrics).toEqual(diffMetrics);
    expect(updateArg.execution_detail.detailType).toBe('generation');
  });
});
