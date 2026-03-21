// Unit tests for ComparisonCache: key generation, hit/miss, sorted-pair symmetry, and error rejection.
// Verifies that cache operates correctly at the bias-mitigated result level.

import { ComparisonCache, MAX_CACHE_SIZE } from './computeRatings';
import type { CachedMatch } from './computeRatings';

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

  // ─── Phase 11: LRU eviction ───────────────────────────────────

  describe('LRU eviction', () => {
    it('evicts oldest entries when size exceeds maxSize', () => {
      const smallCache = new ComparisonCache(3);
      const makeResult = (id: string): CachedMatch => ({
        winnerId: id, loserId: 'l', confidence: 1.0, isDraw: false,
      });

      smallCache.set('a1', 'b1', false, makeResult('w1'));
      smallCache.set('a2', 'b2', false, makeResult('w2'));
      smallCache.set('a3', 'b3', false, makeResult('w3'));
      expect(smallCache.size).toBe(3);

      // Adding a 4th entry should evict the first
      smallCache.set('a4', 'b4', false, makeResult('w4'));
      expect(smallCache.size).toBe(3);

      // First entry should be evicted
      expect(smallCache.get('a1', 'b1', false)).toBeUndefined();
      // Remaining entries should be present
      expect(smallCache.get('a2', 'b2', false)?.winnerId).toBe('w2');
      expect(smallCache.get('a3', 'b3', false)?.winnerId).toBe('w3');
      expect(smallCache.get('a4', 'b4', false)?.winnerId).toBe('w4');
    });

    it('evicts multiple entries when needed', () => {
      const smallCache = new ComparisonCache(2);
      const makeResult = (id: string): CachedMatch => ({
        winnerId: id, loserId: 'l', confidence: 1.0, isDraw: false,
      });

      smallCache.set('a1', 'b1', false, makeResult('w1'));
      smallCache.set('a2', 'b2', false, makeResult('w2'));
      expect(smallCache.size).toBe(2);

      // Adding entry with maxSize=2 evicts first
      smallCache.set('a3', 'b3', false, makeResult('w3'));
      expect(smallCache.size).toBe(2);
      expect(smallCache.get('a1', 'b1', false)).toBeUndefined();
    });

    it('does not evict when at maxSize (boundary)', () => {
      const smallCache = new ComparisonCache(3);
      const makeResult = (id: string): CachedMatch => ({
        winnerId: id, loserId: 'l', confidence: 1.0, isDraw: false,
      });

      smallCache.set('a1', 'b1', false, makeResult('w1'));
      smallCache.set('a2', 'b2', false, makeResult('w2'));
      smallCache.set('a3', 'b3', false, makeResult('w3'));
      expect(smallCache.size).toBe(3);

      // All entries should be present
      expect(smallCache.get('a1', 'b1', false)).toBeDefined();
      expect(smallCache.get('a2', 'b2', false)).toBeDefined();
      expect(smallCache.get('a3', 'b3', false)).toBeDefined();
    });

    it('uses default MAX_CACHE_SIZE', () => {
      expect(MAX_CACHE_SIZE).toBe(500);
      // Default constructor uses MAX_CACHE_SIZE
      const defaultCache = new ComparisonCache();
      // Just verify it doesn't throw
      expect(defaultCache.size).toBe(0);
    });

    it('fromEntries respects maxSize and keeps last N entries', () => {
      const entries: Array<[string, CachedMatch]> = Array.from({ length: 10 }, (_, i) => [
        `key-${i}`,
        { winnerId: `w${i}`, loserId: `l${i}`, confidence: 1.0, isDraw: false },
      ]);

      const restored = ComparisonCache.fromEntries(entries, 5);
      expect(restored.size).toBe(5);
      // Should keep the last 5 entries (key-5 through key-9)
      const restoredEntries = restored.entries();
      const keys = restoredEntries.map(([k]) => k);
      expect(keys).toEqual(['key-5', 'key-6', 'key-7', 'key-8', 'key-9']);
    });
  });
});
