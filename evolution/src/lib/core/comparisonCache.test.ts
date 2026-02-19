// Unit tests for ComparisonCache: key generation, hit/miss, sorted-pair symmetry, and error rejection.
// Verifies that cache operates correctly at the bias-mitigated result level.

import { ComparisonCache } from './comparisonCache';
import type { CachedMatch } from './comparisonCache';

describe('ComparisonCache', () => {
  let cache: ComparisonCache;

  beforeEach(() => {
    cache = new ComparisonCache();
  });

  it('returns undefined on cache miss', () => {
    expect(cache.get('text A', 'text B', false)).toBeUndefined();
  });

  it('stores and retrieves valid results', () => {
    const result: CachedMatch = { winnerId: 'id1', loserId: 'id2', confidence: 1.0, isDraw: false };
    cache.set('text A', 'text B', false, result);
    expect(cache.get('text A', 'text B', false)).toEqual(result);
  });

  it('uses order-invariant keys (A,B == B,A)', () => {
    const result: CachedMatch = { winnerId: 'id1', loserId: 'id2', confidence: 1.0, isDraw: false };
    cache.set('text A', 'text B', false, result);
    // Reversed order should hit the same cache entry
    expect(cache.get('text B', 'text A', false)).toEqual(result);
  });

  it('distinguishes structured vs non-structured', () => {
    const result: CachedMatch = { winnerId: 'id1', loserId: 'id2', confidence: 1.0, isDraw: false };
    cache.set('text A', 'text B', false, result);
    // Same texts but structured=true should miss
    expect(cache.get('text A', 'text B', true)).toBeUndefined();
  });

  it('does NOT cache results with null winnerId and isDraw=false', () => {
    const errResult: CachedMatch = { winnerId: null, loserId: null, confidence: 0.0, isDraw: false };
    cache.set('text A', 'text B', false, errResult);
    expect(cache.get('text A', 'text B', false)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('caches draw results (isDraw=true even with null winnerId)', () => {
    const drawResult: CachedMatch = { winnerId: null, loserId: null, confidence: 0.5, isDraw: true };
    cache.set('text A', 'text B', false, drawResult);
    expect(cache.get('text A', 'text B', false)).toEqual(drawResult);
    expect(cache.size).toBe(1);
  });

  it('tracks size correctly', () => {
    expect(cache.size).toBe(0);
    cache.set('a', 'b', false, { winnerId: 'w', loserId: 'l', confidence: 1.0, isDraw: false });
    expect(cache.size).toBe(1);
    cache.set('c', 'd', false, { winnerId: 'w', loserId: 'l', confidence: 1.0, isDraw: false });
    expect(cache.size).toBe(2);
  });

  it('clear removes all entries', () => {
    cache.set('a', 'b', false, { winnerId: 'w', loserId: 'l', confidence: 1.0, isDraw: false });
    cache.set('c', 'd', false, { winnerId: 'w', loserId: 'l', confidence: 1.0, isDraw: false });
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a', 'b', false)).toBeUndefined();
  });

  it('overwrites existing entry for same key', () => {
    cache.set('a', 'b', false, { winnerId: 'old', loserId: 'l', confidence: 0.5, isDraw: false });
    cache.set('a', 'b', false, { winnerId: 'new', loserId: 'l', confidence: 1.0, isDraw: false });
    expect(cache.size).toBe(1);
    expect(cache.get('a', 'b', false)?.winnerId).toBe('new');
  });

  // ─── ERR-3: entries() / fromEntries() serialization round-trip ───

  it('entries() returns all cached entries as key-value pairs', () => {
    cache.set('a', 'b', false, { winnerId: 'w1', loserId: 'l1', confidence: 1.0, isDraw: false });
    cache.set('c', 'd', false, { winnerId: 'w2', loserId: 'l2', confidence: 0.9, isDraw: false });
    const entries = cache.entries();
    expect(entries).toHaveLength(2);
    expect(entries[0][1].winnerId).toBeDefined();
  });

  it('fromEntries() restores cache with identical lookup behavior', () => {
    const result: CachedMatch = { winnerId: 'w', loserId: 'l', confidence: 0.95, isDraw: false };
    cache.set('text A', 'text B', false, result);
    cache.set('x', 'y', true, { winnerId: null, loserId: null, confidence: 0.5, isDraw: true });

    // Round-trip: serialize then restore
    const restored = ComparisonCache.fromEntries(cache.entries());
    expect(restored.size).toBe(2);
    // Key-based lookup should work — same hash maps to same entry
    expect(restored.get('text A', 'text B', false)).toEqual(result);
    // Order-invariant lookup on restored cache
    expect(restored.get('text B', 'text A', false)).toEqual(result);
  });

  it('fromEntries() returns empty cache from empty array', () => {
    const restored = ComparisonCache.fromEntries([]);
    expect(restored.size).toBe(0);
  });
});
