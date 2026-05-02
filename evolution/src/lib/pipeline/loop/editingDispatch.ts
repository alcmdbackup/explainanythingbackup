// Pure dispatch-resolution helpers for IterativeEditingAgent. Two thin entry
// points share a common cutoff-arithmetic core, since the planner and runtime
// have different data shapes:
//
//   - resolveEditingDispatchRuntime: takes the actual pool + ratings; used by
//     the runIterationLoop branch.
//   - resolveEditingDispatchPlanner:  takes a projected pool size only; used
//     by projectDispatchPlan at strategy-creation/preview time.
//
// Splitting at the type-shape boundary while sharing the cutoff math
// (applyCutoffToCount) gives SSOT for the math (the actual drift risk)
// without forcing the planner to materialize Variant[].
//
// Mirrors the resolveReflectionEnabled pattern from reflectionDispatch.ts.

import type { Variant } from '../../types';
import type { Rating } from '../../shared/computeRatings';
import type { QualityCutoff } from '../../schemas';

/** Default eligibility cutoff applied when the iteration config doesn't set one.
 *  Per Decisions §12: generous so most strategies are budget-bound first. */
export const DEFAULT_EDITING_ELIGIBILITY_CUTOFF: QualityCutoff = {
  mode: 'topN',
  value: 10,
};

export type EditingDispatchEffectiveCap = 'eligibility' | 'pool_size' | 'unbounded';

/**
 * Pure cutoff arithmetic — single source of truth for cutoff semantics.
 *
 * @param poolSize Number of candidate variants (already filtered for arena entries
 *                 and any other exclusions; this function does no further filtering).
 * @param cutoff   Eligibility cutoff (mode + value). Pass undefined to use the default.
 */
export function applyCutoffToCount(
  poolSize: number,
  cutoff: QualityCutoff | undefined,
): { eligibleCount: number; effectiveCap: EditingDispatchEffectiveCap } {
  const c = cutoff ?? DEFAULT_EDITING_ELIGIBILITY_CUTOFF;
  if (poolSize <= 0) return { eligibleCount: 0, effectiveCap: 'pool_size' };

  let cutoffCount: number;
  if (c.mode === 'topN') {
    cutoffCount = Math.max(0, Math.floor(c.value));
  } else {
    cutoffCount = Math.max(0, Math.ceil((poolSize * c.value) / 100));
  }

  if (cutoffCount === 0) return { eligibleCount: 0, effectiveCap: 'eligibility' };
  if (cutoffCount >= poolSize) return { eligibleCount: poolSize, effectiveCap: 'pool_size' };
  return { eligibleCount: cutoffCount, effectiveCap: 'eligibility' };
}

/** Runtime entry: takes the actual pool + ratings; returns the eligible Variants. */
export function resolveEditingDispatchRuntime(args: {
  pool: ReadonlyArray<Variant>;
  arenaVariantIds: ReadonlySet<string>;
  iterationStartRatings: ReadonlyMap<string, Rating>;
  cutoff: QualityCutoff | undefined;
}): { eligibleParents: Variant[]; effectiveCap: EditingDispatchEffectiveCap } {
  const { pool, arenaVariantIds, iterationStartRatings, cutoff } = args;
  const filtered = pool.filter((v) => !arenaVariantIds.has(v.id));
  const sorted = [...filtered].sort((a, b) => {
    const ea = iterationStartRatings.get(a.id)?.elo ?? Number.NEGATIVE_INFINITY;
    const eb = iterationStartRatings.get(b.id)?.elo ?? Number.NEGATIVE_INFINITY;
    return eb - ea;
  });
  const { eligibleCount, effectiveCap } = applyCutoffToCount(sorted.length, cutoff);
  return { eligibleParents: sorted.slice(0, eligibleCount), effectiveCap };
}

/** Planner entry: takes a projected pool size; returns just the eligible count.
 *  Used by projectDispatchPlan at strategy-creation/preview time when the
 *  actual variant identities + Elo ratings don't exist yet. */
export function resolveEditingDispatchPlanner(args: {
  projectedPoolSize: number;
  cutoff: QualityCutoff | undefined;
}): { eligibleCount: number; effectiveCap: EditingDispatchEffectiveCap } {
  return applyCutoffToCount(args.projectedPoolSize, args.cutoff);
}
