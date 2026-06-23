// Sample-size preview: how many ratings are needed to infer K weights reliably.
// Upfront rule-of-thumb (pairs scale with K) + a live "remaining" helper. Monotonic in
// K and target precision; the reversal audit adds a (1 + replicationRate) overhead.

import type { RequiredRatings } from './types';

const DEFAULT_PAIRS_PER_CRITERION = 12;
const DEFAULT_MIN_PAIRS = 20;
const DEFAULT_REPLICATION_RATE = 0.15;

export interface RequiredRatingsOptions {
  /** Target distinct pairs per criterion (higher = tighter weights). Default 12. */
  pairsPerCriterion?: number;
  /** Floor on distinct pairs regardless of K. Default 20. */
  minPairs?: number;
  /** Reversal-audit replication fraction. Default 0.15. */
  replicationRate?: number;
}

/**
 * Estimate ratings needed for K criteria. `pairs` = distinct pairs to judge;
 * `comparisons` = pairs + reversal-audit replicas; `verdicts` = comparisons × (1 + K)
 * (one overall + K per-criterion verdicts per comparison).
 */
export function requiredRatings(K: number, opts: RequiredRatingsOptions = {}): RequiredRatings {
  const perCriterion = opts.pairsPerCriterion ?? DEFAULT_PAIRS_PER_CRITERION;
  const minPairs = opts.minPairs ?? DEFAULT_MIN_PAIRS;
  const replicationRate = opts.replicationRate ?? DEFAULT_REPLICATION_RATE;

  const k = Math.max(0, Math.floor(K));
  const pairs = k === 0 ? 0 : Math.max(minPairs, Math.ceil(perCriterion * k));
  const comparisons = Math.ceil(pairs * (1 + Math.max(0, replicationRate)));
  const verdicts = comparisons * (1 + k);

  return { pairs, comparisons, verdicts };
}

/** Live "≈N more pairs to go" — never negative. */
export function remainingPairs(currentPairs: number, targetPairs: number): number {
  return Math.max(0, targetPairs - Math.max(0, currentPairs));
}

/** Unordered pairs from M items: C(M,2) = M·(M−1)/2 (0 when M < 2). */
export function pairsFromPool(m: number): number {
  const k = Math.max(0, Math.floor(m));
  return k < 2 ? 0 : (k * (k - 1)) / 2;
}

/**
 * Matches that will actually be judged for a topic pool of `poolSize` articles and
 * `criteriaCount` criteria: `min(C(poolSize,2), requiredRatings(K).pairs)`. Also reports which
 * term binds — the pool (too few articles) or the recommendation — for the UI explainer.
 */
export function matchesFromPool(
  poolSize: number,
  criteriaCount: number,
  opts: RequiredRatingsOptions = {},
): { matches: number; cMax: number; recommended: number; bindingLimit: 'pool' | 'recommendation' } {
  const cMax = pairsFromPool(poolSize);
  const recommended = requiredRatings(criteriaCount, opts).pairs;
  return {
    matches: Math.min(cMax, recommended),
    cMax,
    recommended,
    bindingLimit: cMax <= recommended ? 'pool' : 'recommendation',
  };
}
