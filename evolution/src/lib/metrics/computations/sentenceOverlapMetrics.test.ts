// Tests for run-level sentence-overlap percentile metrics. Validates that
// median/p25/min compute over only the non-null sentenceVerbatimRatio entries
// in the pool, and that NULL ratios from legacy variants are excluded rather
// than treated as 0.

import {
  computeMedianSentenceVerbatimRatio,
  computeP25SentenceVerbatimRatio,
  computeMinSentenceVerbatimRatio,
} from './sentenceOverlapMetrics';
import type { FinalizationContext } from '../types';
import type { TextVariation } from '../../types';

function ctxWithRatios(ratios: Array<number | null | undefined>): FinalizationContext {
  const pool: TextVariation[] = ratios.map((r, i) => ({
    id: `v${i}`,
    runId: 'r1',
    iteration: 0,
    text: 't',
    title: 't',
    eloScore: 1500,
    parentVariantId: null,
    agentName: 'generate_from_previous_article',
    sentenceVerbatimRatio: r,
  } as unknown as TextVariation));
  return { pool } as unknown as FinalizationContext;
}

describe('computeMedianSentenceVerbatimRatio', () => {
  it('returns null when pool has no ratios', () => {
    expect(computeMedianSentenceVerbatimRatio(ctxWithRatios([]))).toBeNull();
  });

  it('returns null when all ratios are NULL (legacy-only pool)', () => {
    expect(computeMedianSentenceVerbatimRatio(ctxWithRatios([null, undefined]))).toBeNull();
  });

  it('computes median across 5 ratios', () => {
    const r = computeMedianSentenceVerbatimRatio(ctxWithRatios([0.1, 0.3, 0.5, 0.7, 0.9]));
    expect(r?.value).toBe(0.5);
    expect(r?.n).toBe(5);
  });

  it('excludes NULL ratios from the percentile (3 valid of 5 entries)', () => {
    const r = computeMedianSentenceVerbatimRatio(ctxWithRatios([0.2, null, 0.5, undefined, 0.9]));
    // Sorted non-null: [0.2, 0.5, 0.9] → median = 0.5
    expect(r?.value).toBe(0.5);
    expect(r?.n).toBe(3);
  });

  it('returns the value itself for a single-entry pool', () => {
    const r = computeMedianSentenceVerbatimRatio(ctxWithRatios([0.42]));
    expect(r?.value).toBe(0.42);
    expect(r?.n).toBe(1);
  });
});

describe('computeP25SentenceVerbatimRatio', () => {
  it('returns 25th percentile (rewrite-disaster signal)', () => {
    // Sorted: [0.1, 0.2, 0.5, 0.8, 0.9] → idx 1.0 → linear interp → 0.2
    const r = computeP25SentenceVerbatimRatio(ctxWithRatios([0.1, 0.2, 0.5, 0.8, 0.9]));
    expect(r?.value).toBe(0.2);
  });

  it('returns null on empty', () => {
    expect(computeP25SentenceVerbatimRatio(ctxWithRatios([]))).toBeNull();
  });
});

describe('computeMinSentenceVerbatimRatio', () => {
  it('returns the smallest non-null ratio', () => {
    const r = computeMinSentenceVerbatimRatio(ctxWithRatios([0.5, 0.05, 0.9, 0.3]));
    expect(r?.value).toBe(0.05);
    expect(r?.n).toBe(4);
  });

  it('ignores NULL when finding min', () => {
    const r = computeMinSentenceVerbatimRatio(ctxWithRatios([null, 0.4, 0.9]));
    expect(r?.value).toBe(0.4);
    expect(r?.n).toBe(2);
  });
});
