// Reusable aggregation functions for propagated metrics (child → parent entity).

import type { MetricRow } from '../types';
import type { MetricValue } from '../experimentMetrics';
import { bootstrapMeanCI } from '../experimentMetrics';
import { toMetricValue } from '../types';

export function aggregateSum(rows: MetricRow[]): MetricValue {
  return { value: rows.reduce((s, r) => s + r.value, 0), sigma: null, ci: null, n: rows.length };
}

export function aggregateAvg(rows: MetricRow[]): MetricValue {
  if (rows.length === 0) return { value: 0, sigma: null, ci: null, n: 0 };
  const sum = rows.reduce((s, r) => s + r.value, 0);
  const mean = sum / rows.length;
  // Standard error CI when n >= 2
  if (rows.length >= 2) {
    const variance = rows.reduce((s, r) => s + (r.value - mean) ** 2, 0) / (rows.length - 1);
    const se = Math.sqrt(variance / rows.length);
    return { value: mean, sigma: se, ci: [mean - 1.96 * se, mean + 1.96 * se], n: rows.length };
  }
  return { value: mean, sigma: null, ci: null, n: rows.length };
}

export function aggregateMax(rows: MetricRow[]): MetricValue {
  if (rows.length === 0) return { value: 0, sigma: null, ci: null, n: 0 };
  let maxVal = -Infinity;
  let maxSigma: number | null = null;
  for (const r of rows) {
    if (r.value > maxVal) {
      maxVal = r.value;
      maxSigma = r.sigma;
    }
  }
  return {
    value: maxVal,
    sigma: maxSigma,
    ci: maxSigma != null ? [maxVal - 1.96 * maxSigma, maxVal + 1.96 * maxSigma] : null,
    n: rows.length,
  };
}

export function aggregateMin(rows: MetricRow[]): MetricValue {
  if (rows.length === 0) return { value: 0, sigma: null, ci: null, n: 0 };
  let minVal = Infinity;
  let minSigma: number | null = null;
  for (const r of rows) {
    if (r.value < minVal) {
      minVal = r.value;
      minSigma = r.sigma;
    }
  }
  return {
    value: minVal,
    sigma: minSigma,
    ci: minSigma != null ? [minVal - 1.96 * minSigma, minVal + 1.96 * minSigma] : null,
    n: rows.length,
  };
}

export function aggregateCount(rows: MetricRow[]): MetricValue {
  return { value: rows.length, sigma: null, ci: null, n: rows.length };
}

export function aggregateBootstrapMean(rows: MetricRow[]): MetricValue {
  return bootstrapMeanCI(rows.map(toMetricValue));
}
