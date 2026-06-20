// Unit tests for the ratings-needed estimator: monotonic in K + precision, replication
// overhead, and non-negative remaining.

import { remainingPairs, requiredRatings } from './sampleSize';

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
