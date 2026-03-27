// Reusable aggregation functions for propagated metrics (child → parent entity).

import type { MetricRow } from '../types';
import type { MetricValue } from '../experimentMetrics';
import { bootstrapMeanCI } from '../experimentMetrics';
import { toMetricValue } from '../types';

export function aggregateSum(rows: MetricRow[]): MetricValue {
  return { value: rows.reduce((s, r) => s + r.value, 0), sigma: null, ci: null, n: rows.length };
}

export function aggregateAvg(rows: MetricRow[]): MetricValue {
  const sum = rows.reduce((s, r) => s + r.value, 0);
  return { value: rows.length > 0 ? sum / rows.length : 0, sigma: null, ci: null, n: rows.length };
}

export function aggregateMax(rows: MetricRow[]): MetricValue {
  return { value: rows.reduce((m, r) => Math.max(m, r.value), -Infinity), sigma: null, ci: null, n: rows.length };
}

export function aggregateMin(rows: MetricRow[]): MetricValue {
  return { value: rows.reduce((m, r) => Math.min(m, r.value), Infinity), sigma: null, ci: null, n: rows.length };
}

export function aggregateCount(rows: MetricRow[]): MetricValue {
  return { value: rows.length, sigma: null, ci: null, n: rows.length };
}

export function aggregateBootstrapMean(rows: MetricRow[]): MetricValue {
  return bootstrapMeanCI(rows.map(toMetricValue));
}
