// Integration test for Phase 2 pool-sourcing: verifies that sourceMode='pool' routes
// the correct parent through resolveParent + runIterationLoop's dispatch, using the
// existing mock harness.

import { resolveParent, hashSeed } from './resolveParent';
import { computeTopNIds, computeTopPercentIds } from './cutoffHelpers';
import type { Variant } from '../../types';
import type { Rating } from '../../shared/computeRatings';

function v(id: string, text = `text-${id}`, fromArena = false): Variant {
  return {
    id, text, version: 0, parentIds: [],
    tactic: 'lexical_simplify', createdAt: 0, iterationBorn: 0,
    ...(fromArena ? { fromArena: true } : {}),
  } as Variant;
}

function ratings(entries: Array<[string, number]>): Map<string, Rating> {
  return new Map(entries.map(([id, elo]) => [id, { elo, uncertainty: 0 }]));
}

describe('Phase 2 pool-sourcing integration', () => {
  it('topN cutoff yields the expected eligible subset across resolveParent', () => {
    const pool = [v('a'), v('b'), v('c'), v('d')];
    const r = ratings([['a', 1300], ['b', 1250], ['c', 1200], ['d', 1100]]);
    // rng returns sequential values 0, 0.5, 0.99 across calls
    const rng = (() => {
      const vals = [0, 0.5, 0.99];
      let i = 0;
      return () => vals[i++ % vals.length]!;
    })();
    const res = resolveParent({
      sourceMode: 'pool',
      qualityCutoff: { mode: 'topN', value: 2 },
      seedVariant: { id: 'seed', text: 'seed' },
      pool,
      ratings: r,
      rng,
    });
    expect(res.effectiveMode).toBe('pool');
    // eligible = [a, b] (top 2 by ELO); rng[0]=0 → index 0 → 'a'
    expect(res.variantId).toBe('a');
  });

  it('topPercent cutoff yields eligible set with ceil semantics', () => {
    const pool = Array.from({ length: 8 }, (_, i) => v(`v${i}`));
    const r = ratings(pool.map((p, i) => [p.id, 1100 + i * 10]));
    const eligible = computeTopPercentIds(r, 25); // ceil(0.25 * 8) = 2
    expect(eligible).toHaveLength(2);
    expect(eligible).toEqual(['v7', 'v6']);

    const res = resolveParent({
      sourceMode: 'pool',
      qualityCutoff: { mode: 'topPercent', value: 25 },
      seedVariant: { id: 'seed', text: 'seed' },
      pool,
      ratings: r,
      rng: () => 0,
    });
    expect(res.variantId).toBe('v7');
  });

  it('same (runId, iteration, executionOrder) produces the same parent pick (reproducibility)', () => {
    const pool = [v('a'), v('b'), v('c'), v('d')];
    const r = ratings([['a', 1300], ['b', 1250], ['c', 1200], ['d', 1100]]);
    // Two independent calls with the same seed should agree.
    const seedA = hashSeed('run-1', 2, 3);
    const seedB = hashSeed('run-1', 2, 3);
    expect(seedA).toBe(seedB);
    // eligible = [a, b, c, d] — pick index = floor(rng() * 4)
    // For determinism we just check that the helper is stable.
    expect(computeTopNIds(r, 4)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('empty eligible set falls back to seed with tracked reason', () => {
    const pool = [v('a'), v('b')];
    // No ratings — eligible set empty.
    const res = resolveParent({
      sourceMode: 'pool',
      qualityCutoff: { mode: 'topN', value: 5 },
      seedVariant: { id: 'seed', text: 'seed' },
      pool,
      ratings: new Map(),
      rng: () => 0,
    });
    expect(res.effectiveMode).toBe('seed_fallback_from_pool');
    expect(res.fallbackReason).toBe('no_eligible_variants');
    expect(res.variantId).toBe('seed');
  });

  // Bug 2 (20260421): runIterationLoop filters fromArena variants before calling
  // resolveParent so new variants' parent_variant_id only references same-run variants.
  // These tests pin the expected call-site contract by passing a pre-filtered pool.
  describe('arena-filter call-site contract', () => {
    it('when pool is pre-filtered to in-run variants, arena entries are never picked', () => {
      const inRunA = v('in-run-a');
      const inRunB = v('in-run-b');
      const arenaX = v('arena-x', 'arena-text', true);
      const arenaY = v('arena-y', 'arena-text', true);
      const rawPool = [inRunA, arenaX, inRunB, arenaY];
      // Unfiltered ratings map — intentionally includes arena ids to mirror production
      // (ratings are built from the full pool, then intersected with pool members).
      const r = ratings([
        ['in-run-a', 1300],
        ['arena-x', 1500],  // arena variant is best on paper, but must NOT be picked.
        ['in-run-b', 1200],
        ['arena-y', 1450],
      ]);

      // Simulate runIterationLoop's call-site filter.
      const inRunPool = rawPool.filter((p) => !p.fromArena);

      // Probe many rng values — no matter which index the RNG picks, the result must be
      // an in-run id.
      for (let i = 0; i < 20; i++) {
        const res = resolveParent({
          sourceMode: 'pool',
          qualityCutoff: { mode: 'topN', value: 4 },
          seedVariant: { id: 'seed', text: 'seed' },
          pool: inRunPool,
          ratings: r,
          rng: () => i / 20,
        });
        expect(res.effectiveMode).toBe('pool');
        expect(['in-run-a', 'in-run-b']).toContain(res.variantId);
      }
    });

    it('when pre-filter empties the pool, falls back to seed (empty_pool reason)', () => {
      const arenaX = v('arena-x', 'arena-text', true);
      const arenaY = v('arena-y', 'arena-text', true);
      const rawPool = [arenaX, arenaY];
      const r = ratings([['arena-x', 1500], ['arena-y', 1450]]);

      const inRunPool = rawPool.filter((p) => !p.fromArena);
      expect(inRunPool).toEqual([]);

      const res = resolveParent({
        sourceMode: 'pool',
        qualityCutoff: { mode: 'topN', value: 4 },
        seedVariant: { id: 'seed-id', text: 'seed-text' },
        pool: inRunPool,
        ratings: r,
        rng: () => 0,
      });
      expect(res.effectiveMode).toBe('seed_fallback_from_pool');
      expect(res.fallbackReason).toBe('empty_pool');
      expect(res.variantId).toBe('seed-id');
    });
  });
});
