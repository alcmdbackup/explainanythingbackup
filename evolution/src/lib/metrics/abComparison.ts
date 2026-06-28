// Between-arm statistical comparison for the agent-comparison experiment
// (design_elo_improvement_experiment_20260626 Decision H). Two analyses over
// per-arm arrays of per-run max-lift values:
//   1. pBestAnalysis — bootstrap P(best) + P(within-threshold-of-best) per arm
//      (the primary "which arm is best / top tier" readout; no multiple-comparison
//      correction needed — one joint resampling).
//   2. vsBaselineHolm — one-sided bootstrap diff-of-medians of each arm vs the
//      baseline, Holm-corrected across arms (the "is the complexity worth it vs
//      generate" secondary).
// Seeded + deterministic via createSeededRng so the analysis is reproducible.

import { createSeededRng } from './experimentMetrics';

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** 2.5/97.5-style percentile (nearest-rank) of a sorted-or-unsorted array. */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx]!;
}

function resample(xs: readonly number[], rng: () => number): number[] {
  const out: number[] = new Array(xs.length);
  for (let i = 0; i < xs.length; i++) out[i] = xs[Math.floor(rng() * xs.length)]!;
  return out;
}

export interface PBestResult {
  /** Probability each arm has the single highest median (ties split equally). Sums to 1. */
  pBest: Record<string, number>;
  /** Probability each arm is within `threshold` Elo of the best (top-tier membership). */
  pWithinThreshold: Record<string, number>;
  /** Observed (point) median per arm. */
  medians: Record<string, number>;
}

/**
 * Bootstrap P(best) and top-tier membership across arms.
 * @param arms label → per-run max-lift values
 * @param opts.threshold Elo gap for "practically tied with the best" (Decision #4, ~40)
 */
export function pBestAnalysis(
  arms: Record<string, readonly number[]>,
  opts: { iterations?: number; threshold?: number; seed?: number } = {},
): PBestResult {
  const { iterations = 2000, threshold = 40, seed = 12345 } = opts;
  const labels = Object.keys(arms);
  const rng = createSeededRng(seed);
  const pBest: Record<string, number> = {};
  const pWithin: Record<string, number> = {};
  const medians: Record<string, number> = {};
  for (const l of labels) { pBest[l] = 0; pWithin[l] = 0; medians[l] = median(arms[l] ?? []); }

  for (let it = 0; it < iterations; it++) {
    const m: Record<string, number> = {};
    let best = -Infinity;
    for (const l of labels) {
      const v = median(resample(arms[l] ?? [], rng));
      m[l] = v;
      if (v > best) best = v;
    }
    const winners = labels.filter((l) => m[l] === best);
    for (const l of winners) pBest[l] = (pBest[l] ?? 0) + 1 / winners.length;
    for (const l of labels) if ((m[l] ?? -Infinity) >= best - threshold) pWithin[l] = (pWithin[l] ?? 0) + 1;
  }
  for (const l of labels) { pBest[l] = (pBest[l] ?? 0) / iterations; pWithin[l] = (pWithin[l] ?? 0) / iterations; }
  return { pBest, pWithinThreshold: pWithin, medians };
}

export interface VsBaselineResult {
  effect: number;        // observed median(arm) - median(baseline)
  ci: [number, number];  // bootstrap 95% CI on the difference
  pRaw: number;          // one-sided bootstrap p (H1: arm > baseline)
  pHolm: number;         // Holm-adjusted p across the family
  significant: boolean;  // pHolm < alpha
}

/** Holm-Bonferroni step-down adjusted p-values, keyed like the input. */
export function holmCorrect(pValues: Record<string, number>): Record<string, number> {
  const entries = Object.entries(pValues).sort((a, b) => a[1] - b[1]);
  const k = entries.length;
  const adj: Record<string, number> = {};
  let running = 0;
  entries.forEach(([key, p], i) => {
    running = Math.max(running, Math.min(1, (k - i) * p));
    adj[key] = running;
  });
  return adj;
}

/**
 * One-sided (arm > baseline) bootstrap diff-of-medians per non-baseline arm,
 * Holm-corrected across the family.
 */
export function vsBaselineHolm(
  arms: Record<string, readonly number[]>,
  baselineLabel: string,
  opts: { iterations?: number; alpha?: number; seed?: number } = {},
): Record<string, VsBaselineResult> {
  const { iterations = 2000, alpha = 0.05, seed = 67890 } = opts;
  const base = arms[baselineLabel];
  if (!base) throw new Error(`vsBaselineHolm: baseline "${baselineLabel}" not in arms`);
  const rng = createSeededRng(seed);
  const others = Object.keys(arms).filter((l) => l !== baselineLabel);
  const baseMedian = median(base);

  const partial: Record<string, { effect: number; ci: [number, number]; pRaw: number }> = {};
  const pRawByArm: Record<string, number> = {};
  for (const l of others) {
    const diffs: number[] = new Array(iterations);
    let nonPositive = 0;
    for (let it = 0; it < iterations; it++) {
      const d = median(resample(arms[l]!, rng)) - median(resample(base, rng));
      diffs[it] = d;
      if (d <= 0) nonPositive++;
    }
    const pRaw = nonPositive / iterations; // one-sided: H1 arm > baseline
    partial[l] = {
      effect: median(arms[l]!) - baseMedian,
      ci: [percentile(diffs, 2.5), percentile(diffs, 97.5)],
      pRaw,
    };
    pRawByArm[l] = pRaw;
  }

  const holm = holmCorrect(pRawByArm);
  const result: Record<string, VsBaselineResult> = {};
  for (const l of others) {
    result[l] = { ...partial[l]!, pHolm: holm[l]!, significant: holm[l]! < alpha };
  }
  return result;
}
