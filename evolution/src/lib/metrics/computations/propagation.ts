// Reusable aggregation functions for propagated metrics (child → parent entity).

import type { MetricRow } from '../types';
import type { MetricValue } from '../experimentMetrics';
import { bootstrapMeanCI } from '../experimentMetrics';
import { toMetricValue } from '../types';

// B008-S4: aggregations must skip stale=true source rows; otherwise mid-recompute child
// values bleed into parent aggregates. All aggregator functions now filter at the entry.
function freshOnly(rows: MetricRow[]): MetricRow[] {
  return rows.filter((r) => r.stale !== true);
}

// B022-S4: aggregateAvg's normal-approx CI is unreliable for very small n. Original code
// had no min-n guard at all (rendered ±X for n=2). Bumping to a conservative min: keep
// CI for n>=3 (3 sample minimum is a common floor for any spread estimator), drop CI for
// n=2 where the 1.96-z-score is dramatically off the t-distribution.
const MIN_N_FOR_AVG_CI = 3;

export function aggregateSum(rows: MetricRow[]): MetricValue {
  const fresh = freshOnly(rows);
  return { value: fresh.reduce((s, r) => s + r.value, 0), uncertainty: null, ci: null, n: fresh.length };
}

export function aggregateAvg(rows: MetricRow[]): MetricValue {
  const fresh = freshOnly(rows);
  if (fresh.length === 0) return { value: 0, uncertainty: null, ci: null, n: 0 };
  const sum = fresh.reduce((s, r) => s + r.value, 0);
  const mean = sum / fresh.length;
  // B022-S4: Standard error CI only when n >= MIN_N_FOR_AVG_CI; for smaller samples,
  // the normal-approx 1.96 factor dramatically under-covers the true mean.
  if (fresh.length >= MIN_N_FOR_AVG_CI) {
    const variance = fresh.reduce((s, r) => s + (r.value - mean) ** 2, 0) / (fresh.length - 1);
    const se = Math.sqrt(variance / fresh.length);
    return { value: mean, uncertainty: se, ci: [mean - 1.96 * se, mean + 1.96 * se], n: fresh.length };
  }
  // Compute SE for inspection but return null CI for small samples.
  if (fresh.length >= 2) {
    const variance = fresh.reduce((s, r) => s + (r.value - mean) ** 2, 0) / (fresh.length - 1);
    const se = Math.sqrt(variance / fresh.length);
    return { value: mean, uncertainty: se, ci: null, n: fresh.length };
  }
  return { value: mean, uncertainty: null, ci: null, n: fresh.length };
}

export function aggregateMax(rows: MetricRow[]): MetricValue {
  const fresh = freshOnly(rows);
  if (fresh.length === 0) return { value: 0, uncertainty: null, ci: null, n: 0 };
  let maxVal = -Infinity;
  let maxUncertainty: number | null = null;
  for (const r of fresh) {
    if (r.value > maxVal) {
      maxVal = r.value;
      maxUncertainty = r.uncertainty;
    }
  }
  return {
    value: maxVal,
    uncertainty: maxUncertainty,
    ci: maxUncertainty != null ? [maxVal - 1.96 * maxUncertainty, maxVal + 1.96 * maxUncertainty] : null,
    n: fresh.length,
  };
}

export function aggregateMin(rows: MetricRow[]): MetricValue {
  const fresh = freshOnly(rows);
  if (fresh.length === 0) return { value: 0, uncertainty: null, ci: null, n: 0 };
  let minVal = Infinity;
  let minUncertainty: number | null = null;
  for (const r of fresh) {
    if (r.value < minVal) {
      minVal = r.value;
      minUncertainty = r.uncertainty;
    }
  }
  return {
    value: minVal,
    uncertainty: minUncertainty,
    ci: minUncertainty != null ? [minVal - 1.96 * minUncertainty, minVal + 1.96 * minUncertainty] : null,
    n: fresh.length,
  };
}

export function aggregateCount(rows: MetricRow[]): MetricValue {
  const fresh = freshOnly(rows);
  return { value: fresh.length, uncertainty: null, ci: null, n: fresh.length };
}

export function aggregateBootstrapMean(rows: MetricRow[]): MetricValue {
  return bootstrapMeanCI(freshOnly(rows).map(toMetricValue));
}
