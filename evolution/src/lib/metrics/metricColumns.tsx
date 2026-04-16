// Helper to generate list-view metric columns from the registry.
// Works with EntityTable ColumnDef and RunsTable RunsColumnDef.

import React from 'react';
import { getEntityListViewMetrics, getEntity } from '../core/entityRegistry';
import { METRIC_FORMATTERS } from '../core/metricCatalog';
import type { MetricFormatter, CatalogMetricDef } from '../core/types';
import type { EntityType, MetricRow } from './types';
import type { ColumnDef } from '@evolution/components/evolution';
import type { RunsColumnDef, BaseRun } from '@evolution/components/evolution';

function findMetric(item: unknown, metricName: string): MetricRow | undefined {
  const obj = item as Record<string, unknown>;
  const metrics = obj.metrics as MetricRow[] | undefined;
  return metrics?.find(r => r.metric_name === metricName);
}

/** Phase 4d: look up the propagation aggregationMethod for a metric so we can render CI
 *  only for metrics whose source aggregation produces one (bootstrap_mean/percentile/avg).
 *  Returns null for non-propagated metrics (direct run-level values). */
function getPropagationAggregationMethod(entityType: EntityType, metricName: string): string | null {
  const m = getEntity(entityType as import('../core/types').EntityType).metrics.atPropagation
    .find(d => d.name === metricName);
  return m?.aggregationMethod ?? null;
}

/** Phase 4d: format a metric's CI suffix when the row carries ci_lower/ci_upper and the metric's
 *  aggregation method produces a CI. Returns empty string for non-CI metrics / missing CI data. */
function formatCiSuffix(def: CatalogMetricDef, entityType: EntityType, row: MetricRow): string {
  const lo = row.ci_lower;
  const hi = row.ci_upper;
  if (lo == null || hi == null || !Number.isFinite(lo) || !Number.isFinite(hi)) return '';
  const aggMethod = getPropagationAggregationMethod(entityType, def.name);
  if (aggMethod !== 'bootstrap_mean' && aggMethod !== 'bootstrap_percentile' && aggMethod !== 'avg') {
    return '';
  }
  // Elo-like metrics get the bracket range form "[lo, hi]"; currency and percent get the "± half"
  // form since the magnitudes are familiar. Integer + score metrics follow the bracket form.
  const fmt = METRIC_FORMATTERS[def.formatter as MetricFormatter];
  if (def.formatter === 'cost' || def.formatter === 'costDetailed' || def.formatter === 'percent') {
    const half = (hi - lo) / 2;
    return ` ± ${fmt(half)}`;
  }
  return ` [${fmt(lo)}, ${fmt(hi)}]`;
}

export function createMetricColumns<T>(
  entityType: EntityType,
): ColumnDef<T>[] {
  return getEntityListViewMetrics(entityType as import('../core/types').EntityType).map(def => ({
    key: `metric_${def.name}`,
    header: def.label,
    align: 'right' as const,
    sortable: false,
    render: (item: T) => {
      const m = findMetric(item, def.name);
      if (m != null) {
        const base = METRIC_FORMATTERS[def.formatter as MetricFormatter](m.value);
        return `${base}${formatCiSuffix(def, entityType, m)}`;
      }
      // Cost metrics default to $0.00 when no row exists, others show dash
      if (def.formatter === 'cost' || def.formatter === 'costDetailed') return METRIC_FORMATTERS[def.formatter as MetricFormatter](0);
      return '—';
    },
  }));
}

export function createRunsMetricColumns<T extends BaseRun>(): RunsColumnDef<T>[] {
  return getEntityListViewMetrics('run').map(def => ({
    key: `metric_${def.name}`,
    header: def.label,
    align: 'right' as const,
    render: (item: T) => {
      const m = findMetric(item, def.name);
      const text = m != null
        ? `${METRIC_FORMATTERS[def.formatter as MetricFormatter](m.value)}${formatCiSuffix(def, 'run', m)}`
        : (def.formatter === 'cost' || def.formatter === 'costDetailed')
          ? METRIC_FORMATTERS[def.formatter as MetricFormatter](0)
          : '—';
      return <span className="font-mono text-xs">{text}</span>;
    },
  }));
}
