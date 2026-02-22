// Unit tests for pipelineUtilities: sliceLargeArrays, truncateDetail, captureBeforeState, computeDiffMetrics.

import { sliceLargeArrays, truncateDetail, MAX_DETAIL_BYTES, captureBeforeState, computeDiffMetrics } from './pipelineUtilities';
import { createRating, getOrdinal, ordinalToEloScale, updateRating } from './rating';
import type {
  GenerationExecutionDetail,
  TournamentExecutionDetail,
  CalibrationExecutionDetail,
  IterativeEditingExecutionDetail,
  PipelineState,
  TextVariation,
} from '../types';
import type { Rating } from './rating';
import { generationDetailFixture } from '@evolution/testing/executionDetailFixtures';

/** Minimal PipelineState mock for testing diff metrics. */
function mockPipelineState(overrides: Partial<PipelineState> = {}): PipelineState {
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
    allCritiques: null,
    similarityMatrix: null,
    diversityScore: null,
    metaFeedback: null,
    debateTranscripts: [],
    treeSearchResults: null,
    treeSearchStates: null,
    sectionState: null,
    addToPool: () => {},
    startNewIteration: () => {},
    getTopByRating: () => [],
    getPoolSize: () => 0,
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
      debateTranscripts: [],
      diversityScore: 0.75,
      metaFeedback: null,
    });

    const snapshot = captureBeforeState(state);
    expect(snapshot.poolIds).toEqual(['v1', 'v2']);
    expect(snapshot.matchHistoryLength).toBe(1);
    expect(snapshot.critiquesLength).toBe(1);
    expect(snapshot.debatesLength).toBe(0);
    expect(snapshot.diversityScore).toBe(0.75);
    expect(snapshot.metaFeedbackPresent).toBe(false);
    expect(Object.keys(snapshot.eloRatings)).toEqual(['v1', 'v2']);
    // Default rating should map to Elo ~1200
    expect(snapshot.eloRatings['v1']).toBeCloseTo(1200, -1);
  });
});

describe('computeDiffMetrics', () => {
  it('detects new variants added to the pool', () => {
    const before = captureBeforeState(mockPipelineState({
      pool: [makeVariant('v1')],
      ratings: new Map([['v1', createRating()]]),
    }));

    const after = mockPipelineState({
      pool: [makeVariant('v1'), makeVariant('v2'), makeVariant('v3')],
      ratings: new Map([['v1', createRating()], ['v2', createRating()], ['v3', createRating()]]),
    });

    const diff = computeDiffMetrics(before, after);
    expect(diff.variantsAdded).toBe(2);
    expect(diff.newVariantIds).toEqual(['v2', 'v3']);
  });

  it('computes match count delta', () => {
    const match = { variationA: 'v1', variationB: 'v2', winner: 'v1', confidence: 0.8, turns: 1, dimensionScores: {} };
    const before = captureBeforeState(mockPipelineState({
      matchHistory: [match],
    }));

    const after = mockPipelineState({
      matchHistory: [match, { ...match, winner: 'v2' }, { ...match, confidence: 0.9 }],
    });

    const diff = computeDiffMetrics(before, after);
    expect(diff.matchesPlayed).toBe(2);
  });

  it('computes Elo changes between before and after', () => {
    const r1 = createRating();
    const r2 = createRating();
    const [winnerRating, loserRating] = updateRating(r1, r2);

    const before = captureBeforeState(mockPipelineState({
      pool: [makeVariant('v1'), makeVariant('v2')],
      ratings: new Map([['v1', r1], ['v2', r2]]),
    }));

    const after = mockPipelineState({
      pool: [makeVariant('v1'), makeVariant('v2')],
      ratings: new Map([['v1', winnerRating], ['v2', loserRating]]),
    });

    const diff = computeDiffMetrics(before, after);
    expect(diff.eloChanges['v1']).toBeGreaterThan(0); // winner gains Elo
    // Winner gains more than loser (loser's ordinal may increase due to sigma reduction)
    expect(diff.eloChanges['v1']).toBeGreaterThan(diff.eloChanges['v2'] ?? 0);
  });

  it('detects critique additions', () => {
    const before = captureBeforeState(mockPipelineState({ allCritiques: [] }));
    const after = mockPipelineState({
      allCritiques: [
        { variationId: 'v1', dimensionScores: {}, goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'r' },
        { variationId: 'v2', dimensionScores: {}, goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'r' },
      ],
    });

    expect(computeDiffMetrics(before, after).critiquesAdded).toBe(2);
  });

  it('detects debate additions', () => {
    const before = captureBeforeState(mockPipelineState({ debateTranscripts: [] }));
    const after = mockPipelineState({
      debateTranscripts: [{ variantAId: 'v1', variantBId: 'v2', turns: [], synthesisVariantId: null, iteration: 1 }],
    });

    expect(computeDiffMetrics(before, after).debatesAdded).toBe(1);
  });

  it('detects diversity score change', () => {
    const before = captureBeforeState(mockPipelineState({ diversityScore: null }));
    const after = mockPipelineState({ diversityScore: 0.85 });

    expect(computeDiffMetrics(before, after).diversityScoreAfter).toBe(0.85);
  });

  it('detects metaFeedback population (null → non-null)', () => {
    const before = captureBeforeState(mockPipelineState({ metaFeedback: null }));
    const after = mockPipelineState({
      metaFeedback: {
        recurringWeaknesses: [], priorityImprovements: [],
        successfulStrategies: [], patternsToAvoid: [],
      },
    });

    expect(computeDiffMetrics(before, after).metaFeedbackPopulated).toBe(true);
  });

  it('metaFeedbackPopulated is false when already present before', () => {
    const existing = {
      recurringWeaknesses: [], priorityImprovements: [],
      successfulStrategies: [], patternsToAvoid: [],
    };
    const before = captureBeforeState(mockPipelineState({ metaFeedback: existing }));
    const after = mockPipelineState({ metaFeedback: existing });

    expect(computeDiffMetrics(before, after).metaFeedbackPopulated).toBe(false);
  });

  it('returns zero deltas when nothing changed', () => {
    const state = mockPipelineState({
      pool: [makeVariant('v1')],
      ratings: new Map([['v1', createRating()]]),
    });
    const before = captureBeforeState(state);
    const diff = computeDiffMetrics(before, state);

    expect(diff.variantsAdded).toBe(0);
    expect(diff.newVariantIds).toEqual([]);
    expect(diff.matchesPlayed).toBe(0);
    expect(diff.eloChanges).toEqual({});
    expect(diff.critiquesAdded).toBe(0);
    expect(diff.debatesAdded).toBe(0);
    expect(diff.metaFeedbackPopulated).toBe(false);
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
