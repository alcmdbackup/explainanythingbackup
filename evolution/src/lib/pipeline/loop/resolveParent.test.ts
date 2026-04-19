import { resolveParent, hashSeed } from './resolveParent';
import type { Variant } from '../../types';
import type { Rating } from '../../shared/computeRatings';

function v(id: string, text = `text-${id}`): Variant {
  return {
    id,
    text,
    version: 0,
    parentIds: [],
    tactic: 'lexical_simplify',
    createdAt: 0,
    iterationBorn: 0,
  } as Variant;
}

function makeRatings(entries: Array<[string, number]>): Map<string, Rating> {
  const m = new Map<string, Rating>();
  for (const [id, elo] of entries) m.set(id, { elo, uncertainty: 0 });
  return m;
}

const SEED = { id: 'seed', text: 'seed-text' };

describe('resolveParent', () => {
  it('returns seed when sourceMode=seed', () => {
    const result = resolveParent({
      sourceMode: 'seed',
      seedVariant: SEED,
      pool: [],
      ratings: new Map(),
      rng: () => 0,
    });
    expect(result).toEqual({ variantId: 'seed', text: 'seed-text', effectiveMode: 'seed' });
  });

  it('falls back to seed when pool is empty', () => {
    const result = resolveParent({
      sourceMode: 'pool',
      qualityCutoff: { mode: 'topN', value: 3 },
      seedVariant: SEED,
      pool: [],
      ratings: new Map(),
      rng: () => 0,
    });
    expect(result.effectiveMode).toBe('seed_fallback_from_pool');
    expect(result.variantId).toBe('seed');
    expect(result.fallbackReason).toBe('empty_pool');
  });

  it('falls back to seed when cutoff yields no eligible variants (variants unrated)', () => {
    const pool = [v('a'), v('b')];
    const result = resolveParent({
      sourceMode: 'pool',
      qualityCutoff: { mode: 'topN', value: 3 },
      seedVariant: SEED,
      pool,
      ratings: new Map(), // no ratings for any pool member
      rng: () => 0,
    });
    expect(result.effectiveMode).toBe('seed_fallback_from_pool');
    expect(result.fallbackReason).toBe('no_eligible_variants');
  });

  it('pool mode topN picks from eligible set using supplied rng', () => {
    const pool = [v('a'), v('b'), v('c'), v('d')];
    const ratings = makeRatings([['a', 1300], ['b', 1250], ['c', 1200], ['d', 1100]]);
    // Deterministic rng: always returns 0 → picks index 0 of eligible
    const result = resolveParent({
      sourceMode: 'pool',
      qualityCutoff: { mode: 'topN', value: 2 },
      seedVariant: SEED,
      pool,
      ratings,
      rng: () => 0,
    });
    expect(result.effectiveMode).toBe('pool');
    // eligible = ['a', 'b']; rng=0 picks index 0 → 'a'
    expect(result.variantId).toBe('a');
  });

  it('pool mode topPercent uses ceil', () => {
    const pool = [v('a'), v('b'), v('c'), v('d')];
    const ratings = makeRatings([['a', 1300], ['b', 1250], ['c', 1200], ['d', 1100]]);
    // 25% of 4 = 1 → eligible = ['a']
    const result = resolveParent({
      sourceMode: 'pool',
      qualityCutoff: { mode: 'topPercent', value: 25 },
      seedVariant: SEED,
      pool,
      ratings,
      rng: () => 0.999,
    });
    expect(result.variantId).toBe('a');
    expect(result.effectiveMode).toBe('pool');
  });
});

describe('hashSeed', () => {
  it('is deterministic for the same (runId, iteration, executionOrder)', () => {
    expect(hashSeed('run-1', 2, 3)).toBe(hashSeed('run-1', 2, 3));
  });

  it('differs when executionOrder differs', () => {
    expect(hashSeed('run-1', 2, 3)).not.toBe(hashSeed('run-1', 2, 4));
  });

  it('differs when iteration differs', () => {
    expect(hashSeed('run-1', 2, 3)).not.toBe(hashSeed('run-1', 3, 3));
  });

  it('returns an unsigned 32-bit integer', () => {
    const h = hashSeed('run-xyz', 7, 11);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
    expect(Number.isInteger(h)).toBe(true);
  });
});
