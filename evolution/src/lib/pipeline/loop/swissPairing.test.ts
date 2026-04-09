// Tests for swissPairing: candidate generation, score ordering, overlap-allowed,
// completedPairs filtering, MAX_PAIRS_PER_ROUND cap.

import { swissPairing, pairKey, MAX_PAIRS_PER_ROUND } from './swissPairing';
import type { Rating } from '../../shared/computeRatings';

describe('pairKey', () => {
  it('is order-invariant', () => {
    expect(pairKey('a', 'b')).toBe(pairKey('b', 'a'));
  });

  it('uses lexicographic sort', () => {
    expect(pairKey('z', 'a')).toBe('a|z');
  });
});

describe('swissPairing', () => {
  const r = (mu: number, sigma: number): Rating => ({ mu, sigma });

  it('returns empty when fewer than 2 eligible variants', () => {
    expect(swissPairing(['a'], new Map(), new Set())).toEqual([]);
    expect(swissPairing([], new Map(), new Set())).toEqual([]);
  });

  it('returns the only pair for two eligible variants', () => {
    const ratings = new Map<string, Rating>([['a', r(25, 5)], ['b', r(25, 5)]]);
    const pairs = swissPairing(['a', 'b'], ratings, new Set());
    expect(pairs.length).toBe(1);
    expect([pairs[0]![0], pairs[0]![1]].sort()).toEqual(['a', 'b']);
  });

  it('returns N*(N-1)/2 pairs for small eligible sets (overlap allowed)', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const ratings = new Map<string, Rating>(ids.map((id) => [id, r(25, 5)]));
    const pairs = swissPairing(ids, ratings, new Set());
    expect(pairs.length).toBe(6); // 4*3/2
  });

  it('excludes already-completed pairs', () => {
    const ids = ['a', 'b', 'c'];
    const ratings = new Map<string, Rating>(ids.map((id) => [id, r(25, 5)]));
    const completed = new Set<string>(['a|b']);
    const pairs = swissPairing(ids, ratings, completed);
    // 3 total - 1 done = 2 remaining
    expect(pairs.length).toBe(2);
  });

  it('respects MAX_PAIRS_PER_ROUND cap (default 20)', () => {
    // 7 variants → 21 pairs total. Should cap at 20.
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const ratings = new Map<string, Rating>(ids.map((id) => [id, r(25, 5)]));
    const pairs = swissPairing(ids, ratings, new Set());
    expect(pairs.length).toBe(20);
  });

  it('ALLOWS overlapping variants in the same round (no greedy filter)', () => {
    // For 4 variants with all-equal ratings, all 6 pairs are returned.
    // Each variant 'a' should appear in 3 pairs.
    const ids = ['a', 'b', 'c', 'd'];
    const ratings = new Map<string, Rating>(ids.map((id) => [id, r(25, 5)]));
    const pairs = swissPairing(ids, ratings, new Set());
    const aCount = pairs.filter((p) => p[0] === 'a' || p[1] === 'a').length;
    expect(aCount).toBe(3);
  });

  it('orders pairs by descending score (close + uncertain first)', () => {
    // Two close+noisy + two distant+precise.
    const ratings = new Map<string, Rating>([
      ['a', r(25, 8)],
      ['b', r(25, 8)],
      ['c', r(80, 1)],
      ['d', r(-30, 1)],
    ]);
    const pairs = swissPairing(['a', 'b', 'c', 'd'], ratings, new Set());
    // The first pair should be (a, b) — close in mu, high sigma → highest score.
    const first = pairs[0]!;
    expect([first[0], first[1]].sort()).toEqual(['a', 'b']);
  });

  it('uses default rating for unrated variants', () => {
    const pairs = swissPairing(['a', 'b'], new Map(), new Set());
    expect(pairs.length).toBe(1);
  });

  it('respects custom maxPairs argument', () => {
    const ids = ['a', 'b', 'c'];
    const ratings = new Map<string, Rating>(ids.map((id) => [id, r(25, 5)]));
    const pairs = swissPairing(ids, ratings, new Set(), 2);
    expect(pairs.length).toBe(2);
  });
});

describe('MAX_PAIRS_PER_ROUND constant', () => {
  it('is 20', () => {
    expect(MAX_PAIRS_PER_ROUND).toBe(20);
  });
});
