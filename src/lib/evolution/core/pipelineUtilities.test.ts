// Unit tests for pipelineUtilities: sliceLargeArrays and truncateDetail.

import { sliceLargeArrays, truncateDetail, MAX_DETAIL_BYTES } from './pipelineUtilities';
import type {
  GenerationExecutionDetail,
  TournamentExecutionDetail,
  CalibrationExecutionDetail,
  IterativeEditingExecutionDetail,
} from '../types';
import { generationDetailFixture } from '@/testing/fixtures/executionDetailFixtures';

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
