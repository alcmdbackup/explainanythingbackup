import { computeTopNIds, computeTopPercentIds } from './cutoffHelpers';
import type { Rating } from '../../shared/computeRatings';

function makeRatings(entries: Array<[string, number]>): Map<string, Rating> {
  const m = new Map<string, Rating>();
  for (const [id, elo] of entries) m.set(id, { elo, uncertainty: 0 });
  return m;
}

describe('computeTopNIds', () => {
  it('returns empty for empty map', () => {
    expect(computeTopNIds(new Map(), 5)).toEqual([]);
  });

  it('returns empty for n<=0', () => {
    expect(computeTopNIds(makeRatings([['a', 1]]), 0)).toEqual([]);
    expect(computeTopNIds(makeRatings([['a', 1]]), -1)).toEqual([]);
  });

  it('returns top N by ELO descending', () => {
    const r = makeRatings([['a', 1200], ['b', 1300], ['c', 1100], ['d', 1250]]);
    expect(computeTopNIds(r, 2)).toEqual(['b', 'd']);
  });

  it('breaks ELO ties lexicographically (deterministic)', () => {
    const r = makeRatings([['b', 1200], ['a', 1200], ['c', 1200]]);
    expect(computeTopNIds(r, 2)).toEqual(['a', 'b']);
  });

  it('returns all IDs when n >= size', () => {
    const r = makeRatings([['a', 1200], ['b', 1100]]);
    expect(computeTopNIds(r, 10)).toEqual(['a', 'b']);
  });
});

describe('computeTopPercentIds', () => {
  it('returns empty for empty map', () => {
    expect(computeTopPercentIds(new Map(), 20)).toEqual([]);
  });

  it('returns empty for pct<=0', () => {
    expect(computeTopPercentIds(makeRatings([['a', 1]]), 0)).toEqual([]);
  });

  it('ceils up so at least 1 variant is eligible in non-empty pool', () => {
    // 1% of 10 = 0.1 → ceil to 1
    const r = makeRatings(Array.from({ length: 10 }, (_, i) => [`v${i}`, i * 100] as [string, number]));
    expect(computeTopPercentIds(r, 1).length).toBe(1);
  });

  it('top 50% of 4 = 2', () => {
    const r = makeRatings([['a', 1400], ['b', 1300], ['c', 1200], ['d', 1100]]);
    expect(computeTopPercentIds(r, 50)).toEqual(['a', 'b']);
  });

  it('top 100% returns all', () => {
    const r = makeRatings([['a', 1400], ['b', 1300]]);
    expect(computeTopPercentIds(r, 100)).toEqual(['a', 'b']);
  });
});
