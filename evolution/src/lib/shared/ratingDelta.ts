// Delta-rating + bootstrap CI for (child, parent) pairs.
// Used by VariantParentBadge and computeInvocationEloDelta.
//
// The CI is computed via independent-Normal bootstrap sampling (n=1000 by default):
// for each iteration we draw child ~ Normal(child.elo, child.uncertainty) and
// parent ~ Normal(parent.elo, parent.uncertainty) and record the difference. The
// 2.5/97.5 percentiles of the resulting distribution form the 95% CI.
//
// Note: child and parent ELOs share a reference frame via pairwise matches, so their
// marginal σ's likely overstate the delta's true uncertainty (positive correlation →
// true SD is smaller). This is a conservative upper bound. The correct fix would
// require tracking the joint posterior, which the current rating system does not
// expose. We accept the conservative CI and document the caveat.

import type { Rating } from './computeRatings';

export interface DeltaCIResult {
  /** Point estimate: child.elo - parent.elo. */
  delta: number;
  /** 95% CI [lo, hi] from bootstrap. Null when either σ is 0 (degenerate — CI collapses to point). */
  ci: [number, number] | null;
}

/** Box-Muller: draw one sample from Normal(mean, sd). */
function sampleNormal(mean: number, sd: number, rng: () => number): number {
  if (sd <= 0) return mean;
  const u1 = Math.max(Number.EPSILON, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + sd * z;
}

/**
 * Compute the delta between a child rating and its parent, plus a bootstrap 95% CI.
 * @param child - child variant's Rating
 * @param parent - parent variant's Rating (seed or a prior-iteration pool variant)
 * @param iterations - bootstrap sample count (default 1000)
 * @param rng - random source (default Math.random; pass seeded for determinism)
 */
export function bootstrapDeltaCI(
  child: Rating,
  parent: Rating,
  iterations = 1000,
  rng: () => number = Math.random,
): DeltaCIResult {
  const delta = child.elo - parent.elo;

  // Degenerate case: both σ=0 → delta is deterministic.
  if ((child.uncertainty ?? 0) === 0 && (parent.uncertainty ?? 0) === 0) {
    return { delta, ci: [delta, delta] };
  }

  const samples: number[] = [];
  const childSd = child.uncertainty ?? 0;
  const parentSd = parent.uncertainty ?? 0;
  for (let i = 0; i < iterations; i++) {
    const c = sampleNormal(child.elo, childSd, rng);
    const p = sampleNormal(parent.elo, parentSd, rng);
    samples.push(c - p);
  }
  samples.sort((a, b) => a - b);
  const lo = samples[Math.floor(iterations * 0.025)] ?? delta;
  const hi = samples[Math.floor(iterations * 0.975)] ?? delta;
  return { delta, ci: [lo, hi] };
}
