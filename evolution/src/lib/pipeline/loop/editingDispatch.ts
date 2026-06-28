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

/**
 * Phase 1b (design_elo_improvement_experiment_20260626): size the budget-fill for a
 * seed-sourced editing iteration. Editing has no within-iteration top-up loop, so a
 * single seed parent would yield ONE variant and massively under-spend; instead we
 * dispatch N independent editing invocations off the seed. N = how many the remaining
 * iteration budget affords (floor), clamped to [1, cap]. Over-estimation is safe — the
 * IterationBudgetTracker reserves before each call, so excess invocations no-op rather
 * than overspend. Pure for unit-testing.
 */
export function resolveSeedEditingDispatchCount(args: {
  remainingBudgetUsd: number;
  perInvocationEstUsd: number;
  cap: number;
}): number {
  const { remainingBudgetUsd, perInvocationEstUsd, cap } = args;
  if (perInvocationEstUsd <= 0) return Math.max(1, Math.min(1, cap));
  const affordable = Math.floor(Math.max(0, remainingBudgetUsd) / perInvocationEstUsd);
  return Math.max(1, Math.min(affordable, Math.max(1, cap)));
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
    if (eb !== ea) return eb - ea;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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

/** Resolve the EDITING_RANK_ENABLED env flag. Default: true. Mirrors
 *  resolveReflectionEnabled's pattern (default-true via env-check). Used by
 *  both the runtime gate (runIterationLoop.ts editing branch — when false,
 *  the dispatch omits ranking-context fields from IterativeEditInput so the
 *  agent's input-presence gate skips ranking) AND the planner gate
 *  (strategyPreviewActions.ts — passes opts.editingRankEnabled into
 *  projectDispatchPlan so the editing iteration's editingRank cost projects
 *  to 0 when disabled).
 *  add_ranking_iterative_editing_agent_evolution_20260502 Phase 1.6 / D4. */
export function resolveEditingRankEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EDITING_RANK_ENABLED !== 'false';
}
