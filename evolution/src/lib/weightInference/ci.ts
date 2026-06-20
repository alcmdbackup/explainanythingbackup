// Bootstrap confidence intervals for inferred weights. NOT a reuse of
// experimentMetrics.bootstrapMeanCI (which resamples flat scalars and never refits) —
// this resamples labelled pairs with replacement and RE-RUNS the full fitWeights each
// iteration, then takes per-criterion 2.5/97.5 percentiles. Reuses only createSeededRng
// for determinism. Degenerate resamples fall back to the point estimate (never NaN).

import { createSeededRng } from '../metrics/experimentMetrics';
import { fitWeights } from './fit';
import type { PairObservation, WeightCI } from './types';

const DEFAULT_ITERATIONS = 300;
const DEFAULT_SEED = 1;

export interface WeightCIOptions {
  iterations?: number;
  seed?: number;
  lambda?: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx]!;
}

/**
 * Per-criterion weight + bootstrap 95% CI. Deterministic given `seed`.
 * `value` is the point-estimate weight; `ciLow`/`ciHigh` are the 2.5/97.5 percentiles
 * of the bootstrap weight distribution. Guaranteed finite (degenerate resamples reuse
 * the point estimate rather than emitting NaN).
 */
export function weightCIs(
  observations: PairObservation[],
  criteriaIds: string[],
  opts: WeightCIOptions = {},
): WeightCI[] {
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const seed = opts.seed ?? DEFAULT_SEED;
  const point = fitWeights(observations, criteriaIds, {
    skipCrossVal: true,
    lambda: opts.lambda,
  });
  const pointWeight = new Map(point.weights.map((w) => [w.criteriaId, w.weight]));

  if (observations.length === 0) {
    return criteriaIds.map((criteriaId) => ({
      criteriaId,
      value: pointWeight.get(criteriaId) ?? 0,
      ciLow: 0,
      ciHigh: 0,
      n: 0,
    }));
  }

  const rng = createSeededRng(seed);
  const samples = new Map<string, number[]>(criteriaIds.map((id) => [id, []]));
  const n = observations.length;

  for (let it = 0; it < iterations; it++) {
    const resample: PairObservation[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const idx = Math.min(n - 1, Math.floor(rng() * n));
      resample[i] = observations[idx]!;
    }
    const fit = fitWeights(resample, criteriaIds, { skipCrossVal: true, lambda: opts.lambda });
    const wMap = new Map(fit.weights.map((w) => [w.criteriaId, w.weight]));
    for (const id of criteriaIds) {
      const v = wMap.get(id);
      // finite-CI guard: degenerate resample -> reuse the point estimate
      samples.get(id)!.push(Number.isFinite(v) && v !== undefined ? (v as number) : (pointWeight.get(id) ?? 0));
    }
  }

  return criteriaIds.map((criteriaId) => {
    const sorted = [...samples.get(criteriaId)!].sort((a, b) => a - b);
    return {
      criteriaId,
      value: pointWeight.get(criteriaId) ?? 0,
      ciLow: percentile(sorted, 0.025),
      ciHigh: percentile(sorted, 0.975),
      n: point.nPairs,
    };
  });
}
