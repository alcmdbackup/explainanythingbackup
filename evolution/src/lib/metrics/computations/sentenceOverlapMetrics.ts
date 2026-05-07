// Run-level percentile metrics for the sentence-overlap quality signal. Read each variant's
// sentenceVerbatimRatio from the FinalizationContext.pool (in-memory) and compute median / p25
// / min. NULL ratios (legacy variants without the field, helper-failure cases) are EXCLUDED
// from the percentile computation per the plan.
//
// Also re-readable from `evolution_variants.sentence_verbatim_ratio` for stale-recompute paths
// (Phase 1.7 noted no stale cascade is needed since the metric is immutable per variant —
// included here defensively in case downstream code ever re-runs finalization).

import type { FinalizationContext, MetricValue } from '../types';

/** Extract non-null sentenceVerbatimRatio values from the pool. */
function nonNullRatios(ctx: FinalizationContext): number[] {
  const out: number[] = [];
  for (const v of ctx.pool) {
    const r = v.sentenceVerbatimRatio;
    if (r !== undefined && r !== null && Number.isFinite(r)) out.push(r);
  }
  return out;
}

function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  if (sortedAscending.length === 1) return sortedAscending[0]!;
  // Linear interpolation between closest ranks (R-7 / Excel-style).
  const idx = (sortedAscending.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAscending[lo]!;
  const frac = idx - lo;
  return sortedAscending[lo]! * (1 - frac) + sortedAscending[hi]! * frac;
}

function makeMetricValue(value: number, n: number): MetricValue {
  return { value, uncertainty: null, ci: null, n };
}

export function computeMedianSentenceVerbatimRatio(ctx: FinalizationContext): MetricValue | null {
  const ratios = nonNullRatios(ctx).sort((a, b) => a - b);
  if (ratios.length === 0) return null;
  return makeMetricValue(percentile(ratios, 0.5), ratios.length);
}

export function computeP25SentenceVerbatimRatio(ctx: FinalizationContext): MetricValue | null {
  const ratios = nonNullRatios(ctx).sort((a, b) => a - b);
  if (ratios.length === 0) return null;
  return makeMetricValue(percentile(ratios, 0.25), ratios.length);
}

export function computeMinSentenceVerbatimRatio(ctx: FinalizationContext): MetricValue | null {
  const ratios = nonNullRatios(ctx).sort((a, b) => a - b);
  if (ratios.length === 0) return null;
  return makeMetricValue(ratios[0]!, ratios.length);
}
