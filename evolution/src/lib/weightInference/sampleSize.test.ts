// Unit tests for the ratings-needed estimator: monotonic in K + precision, replication
// overhead, and non-negative remaining.

import { matchesFromPool, pairsFromPool, remainingPairs, requiredRatings } from './sampleSize';

describe('pairsFromPool', () => {
  it('is C(M,2) = M·(M−1)/2, and 0 below 2', () => {
    expect(pairsFromPool(0)).toBe(0);
    expect(pairsFromPool(1)).toBe(0);
    expect(pairsFromPool(2)).toBe(1);
    expect(pairsFromPool(8)).toBe(28);
    expect(pairsFromPool(30)).toBe(435);
  });
});

describe('matchesFromPool (Q1: min(C(M,2), requiredRatings(K).pairs))', () => {
  it('pool binds when C(M,2) < recommended', () => {
    // 8 articles, 3 criteria → C(8,2)=28 < max(20,36)=36 → 28, pool-bound
    const r = matchesFromPool(8, 3);
    expect(r.cMax).toBe(28);
    expect(r.recommended).toBe(36);
    expect(r.matches).toBe(28);
    expect(r.bindingLimit).toBe('pool');
  });

  it('recommendation binds when C(M,2) >= recommended', () => {
    // 8 articles, 2 criteria → C(8,2)=28 >= max(20,24)=24 → 24, recommendation-bound
    const r = matchesFromPool(8, 2);
    expect(r.recommended).toBe(24);
    expect(r.matches).toBe(24);
    expect(r.bindingLimit).toBe('recommendation');
  });

  it('a tiny pool caps matches at C(M,2)', () => {
    expect(matchesFromPool(5, 4).matches).toBe(10); // C(5,2)=10 < 48
    expect(matchesFromPool(5, 4).bindingLimit).toBe('pool');
  });
});

describe('requiredRatings', () => {
  it('is monotonic non-decreasing in K (pairs + verdicts)', () => {
    let prevPairs = -1;
    let prevVerdicts = -1;
    for (let k = 1; k <= 8; k++) {
      const r = requiredRatings(k);
      expect(r.pairs).toBeGreaterThanOrEqual(prevPairs);
      expect(r.verdicts).toBeGreaterThanOrEqual(prevVerdicts);
      prevPairs = r.pairs;
      prevVerdicts = r.verdicts;
    }
  });

  it('increases comparisons with the replication rate', () => {
    const none = requiredRatings(5, { replicationRate: 0 });
    const some = requiredRatings(5, { replicationRate: 0.3 });
    expect(some.comparisons).toBeGreaterThan(none.comparisons);
    expect(none.comparisons).toBe(none.pairs);
  });

  it('tightens (more pairs) with a higher pairs-per-criterion target', () => {
    const loose = requiredRatings(4, { pairsPerCriterion: 10 });
    const tight = requiredRatings(4, { pairsPerCriterion: 20 });
    expect(tight.pairs).toBeGreaterThan(loose.pairs);
  });

  it('counts verdicts as comparisons × (1 + K)', () => {
    const r = requiredRatings(3, { replicationRate: 0 });
    expect(r.verdicts).toBe(r.comparisons * (1 + 3));
  });

  it('returns zero for K = 0', () => {
    expect(requiredRatings(0)).toEqual({ pairs: 0, comparisons: 0, verdicts: 0 });
  });
});

describe('remainingPairs', () => {
  it('never goes negative', () => {
    expect(remainingPairs(50, 40)).toBe(0);
    expect(remainingPairs(10, 40)).toBe(30);
    expect(remainingPairs(-5, 40)).toBe(40);
  });
});
