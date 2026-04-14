// Reusable aggregation functions for propagated metrics (child → parent entity).

import type { MetricRow } from '../types';
import type { MetricValue } from '../experimentMetrics';
import { bootstrapMeanCI } from '../experimentMetrics';
import { toMetricValue } from '../types';

export function aggregateSum(rows: MetricRow[]): MetricValue {
  return { value: rows.reduce((s, r) => s + r.value, 0), uncertainty: null, ci: null, n: rows.length };
}

export function aggregateAvg(rows: MetricRow[]): MetricValue {
  if (rows.length === 0) return { value: 0, uncertainty: null, ci: null, n: 0 };
  const sum = rows.reduce((s, r) => s + r.value, 0);
  const mean = sum / rows.length;
  // Standard error CI when n >= 2
  if (rows.length >= 2) {
    const variance = rows.reduce((s, r) => s + (r.value - mean) ** 2, 0) / (rows.length - 1);
    const se = Math.sqrt(variance / rows.length);
    return { value: mean, uncertainty: se, ci: [mean - 1.96 * se, mean + 1.96 * se], n: rows.length };
  }
  return { value: mean, uncertainty: null, ci: null, n: rows.length };
}

export function aggregateMax(rows: MetricRow[]): MetricValue {
  if (rows.length === 0) return { value: 0, uncertainty: null, ci: null, n: 0 };
  let maxVal = -Infinity;
  let maxUncertainty: number | null = null;
  for (const r of rows) {
    if (r.value > maxVal) {
      maxVal = r.value;
      maxUncertainty = r.uncertainty;
    }
  }
  return {
    value: maxVal,
    uncertainty: maxUncertainty,
    ci: maxUncertainty != null ? [maxVal - 1.96 * maxUncertainty, maxVal + 1.96 * maxUncertainty] : null,
    n: rows.length,
  };
}

export function aggregateMin(rows: MetricRow[]): MetricValue {
  if (rows.length === 0) return { value: 0, uncertainty: null, ci: null, n: 0 };
  let minVal = Infinity;
  let minUncertainty: number | null = null;
  for (const r of rows) {
    if (r.value < minVal) {
      minVal = r.value;
      minUncertainty = r.uncertainty;
    }
  }
  return {
    value: minVal,
    uncertainty: minUncertainty,
    ci: minUncertainty != null ? [minVal - 1.96 * minUncertainty, minVal + 1.96 * minUncertainty] : null,
    n: rows.length,
  };
}

export function aggregateCount(rows: MetricRow[]): MetricValue {
  return { value: rows.length, uncertainty: null, ci: null, n: rows.length };
}

export function aggregateBootstrapMean(rows: MetricRow[]): MetricValue {
  return bootstrapMeanCI(rows.map(toMetricValue));
}
