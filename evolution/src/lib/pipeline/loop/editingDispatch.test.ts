// Unit tests for editingDispatch helpers — runtime + planner entries sharing
// the applyCutoffToCount inner function. Tests assert (a) the cutoff math
// per mode/edge case, (b) that runtime + planner agree for shared inputs
// (cross-mode equivalence, the actual drift risk closed by the SSOT split),
// (c) that arena variants are filtered + Elo sort is deterministic on the
// runtime side.

import {
  applyCutoffToCount,
  resolveEditingDispatchRuntime,
  resolveEditingDispatchPlanner,
  DEFAULT_EDITING_ELIGIBILITY_CUTOFF,
} from './editingDispatch';
import type { Variant } from '../../types';
import type { Rating } from '../../shared/computeRatings';

function variant(id: string, text = 'x'): Variant {
  return { id, text } as Variant;
}

function rating(elo: number): Rating {
  return { elo, uncertainty: 1 };
}

describe('applyCutoffToCount', () => {
  it('topN with pool larger than cutoff', () => {
    expect(applyCutoffToCount(20, { mode: 'topN', value: 5 })).toEqual({
      eligibleCount: 5,
      effectiveCap: 'eligibility',
    });
  });

  it('topN with pool smaller than cutoff', () => {
    expect(applyCutoffToCount(3, { mode: 'topN', value: 10 })).toEqual({
      eligibleCount: 3,
      effectiveCap: 'pool_size',
    });
  });

  it('topN equal to pool size → pool_size cap', () => {
    expect(applyCutoffToCount(5, { mode: 'topN', value: 5 })).toEqual({
      eligibleCount: 5,
      effectiveCap: 'pool_size',
    });
  });

  it('topPercent rounds up via ceil', () => {
    // 10 * 25/100 = 2.5 → ceil → 3
    expect(applyCutoffToCount(10, { mode: 'topPercent', value: 25 })).toEqual({
      eligibleCount: 3,
      effectiveCap: 'eligibility',
    });
  });

  it('topPercent at 100% selects entire pool', () => {
    expect(applyCutoffToCount(7, { mode: 'topPercent', value: 100 })).toEqual({
      eligibleCount: 7,
      effectiveCap: 'pool_size',
    });
  });

  it('empty pool returns 0 with pool_size cap', () => {
    expect(applyCutoffToCount(0, { mode: 'topN', value: 10 })).toEqual({
      eligibleCount: 0,
      effectiveCap: 'pool_size',
    });
  });

  it('undefined cutoff falls back to default (topN: 10)', () => {
    expect(applyCutoffToCount(20, undefined)).toEqual({
      eligibleCount: 10,
      effectiveCap: 'eligibility',
    });
    expect(DEFAULT_EDITING_ELIGIBILITY_CUTOFF).toEqual({ mode: 'topN', value: 10 });
  });

  it('topN floors non-integer values defensively', () => {
    expect(applyCutoffToCount(20, { mode: 'topN', value: 4.7 })).toEqual({
      eligibleCount: 4,
      effectiveCap: 'eligibility',
    });
  });
});

describe('resolveEditingDispatchRuntime', () => {
  it('filters arena entries before applying cutoff', () => {
    const pool = [variant('a'), variant('b'), variant('c'), variant('d')];
    const arenaVariantIds = new Set(['a', 'c']);
    const ratings = new Map<string, Rating>([
      ['a', rating(1500)],
      ['b', rating(1450)],
      ['c', rating(1400)],
      ['d', rating(1350)],
    ]);
    const result = resolveEditingDispatchRuntime({
      pool,
      arenaVariantIds,
      iterationStartRatings: ratings,
      cutoff: { mode: 'topN', value: 10 },
    });
    expect(result.eligibleParents.map((v) => v.id)).toEqual(['b', 'd']);
    expect(result.effectiveCap).toBe('pool_size');
  });

  it('sorts by Elo descending', () => {
    const pool = [variant('low'), variant('high'), variant('mid')];
    const ratings = new Map<string, Rating>([
      ['low', rating(1100)],
      ['mid', rating(1300)],
      ['high', rating(1500)],
    ]);
    const result = resolveEditingDispatchRuntime({
      pool,
      arenaVariantIds: new Set(),
      iterationStartRatings: ratings,
      cutoff: { mode: 'topN', value: 2 },
    });
    expect(result.eligibleParents.map((v) => v.id)).toEqual(['high', 'mid']);
  });

  it('treats missing rating as -infinity (sorted to bottom)', () => {
    const pool = [variant('rated'), variant('unrated')];
    const ratings = new Map<string, Rating>([['rated', rating(1200)]]);
    const result = resolveEditingDispatchRuntime({
      pool,
      arenaVariantIds: new Set(),
      iterationStartRatings: ratings,
      cutoff: { mode: 'topN', value: 1 },
    });
    expect(result.eligibleParents.map((v) => v.id)).toEqual(['rated']);
  });

  it('returns empty when all variants are arena entries', () => {
    const pool = [variant('a'), variant('b')];
    const result = resolveEditingDispatchRuntime({
      pool,
      arenaVariantIds: new Set(['a', 'b']),
      iterationStartRatings: new Map(),
      cutoff: undefined,
    });
    expect(result.eligibleParents).toEqual([]);
    expect(result.effectiveCap).toBe('pool_size');
  });
});

describe('runtime / planner cross-mode equivalence', () => {
  // Asserts the math agrees between resolveEditingDispatchRuntime and
  // resolveEditingDispatchPlanner for shared inputs. Catches drift if someone
  // ever modifies one entry without the other.

  function runtimeCount(poolSize: number, cutoff: Parameters<typeof applyCutoffToCount>[1]): number {
    const pool = Array.from({ length: poolSize }, (_, i) => variant(`v${i}`));
    const ratings = new Map(pool.map((v, i) => [v.id, rating(1500 - i)] as const));
    return resolveEditingDispatchRuntime({
      pool,
      arenaVariantIds: new Set(),
      iterationStartRatings: ratings,
      cutoff,
    }).eligibleParents.length;
  }

  it('topN: runtime and planner produce identical counts', () => {
    for (const poolSize of [0, 1, 5, 10, 20, 50]) {
      for (const cutoffValue of [1, 3, 10, 25, 100]) {
        const cutoff = { mode: 'topN' as const, value: cutoffValue };
        const planner = resolveEditingDispatchPlanner({ projectedPoolSize: poolSize, cutoff }).eligibleCount;
        expect(runtimeCount(poolSize, cutoff)).toBe(planner);
      }
    }
  });

  it('topPercent: runtime and planner produce identical counts', () => {
    for (const poolSize of [0, 5, 10, 17, 33, 50]) {
      for (const cutoffValue of [1, 10, 25, 50, 75, 100]) {
        const cutoff = { mode: 'topPercent' as const, value: cutoffValue };
        const planner = resolveEditingDispatchPlanner({ projectedPoolSize: poolSize, cutoff }).eligibleCount;
        expect(runtimeCount(poolSize, cutoff)).toBe(planner);
      }
    }
  });

  it('default cutoff (undefined): runtime and planner agree', () => {
    for (const poolSize of [0, 5, 10, 15, 20]) {
      const planner = resolveEditingDispatchPlanner({ projectedPoolSize: poolSize, cutoff: undefined }).eligibleCount;
      expect(runtimeCount(poolSize, undefined)).toBe(planner);
    }
  });
});
