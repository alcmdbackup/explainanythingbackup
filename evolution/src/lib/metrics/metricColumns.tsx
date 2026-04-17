// Helper to generate list-view metric columns from the registry.
// Works with EntityTable ColumnDef and RunsTable RunsColumnDef.

import React from 'react';
import { getEntityListViewMetrics } from '../core/entityRegistry';
import { METRIC_FORMATTERS } from '../core/metricCatalog';
import type { MetricFormatter } from '../core/types';
import type { EntityType, MetricRow } from './types';
import type { ColumnDef } from '@evolution/components/evolution';
import type { RunsColumnDef, BaseRun } from '@evolution/components/evolution';

function findMetric(item: unknown, metricName: string): MetricRow | undefined {
  const obj = item as Record<string, unknown>;
  const metrics = obj.metrics as MetricRow[] | undefined;
  return metrics?.find(r => r.metric_name === metricName);
}

/** Format CI suffix for a metric row based on its aggregation method. */
function formatCISuffix(m: MetricRow): string {
  if (m.ci_lower == null || m.ci_upper == null) return '';
  if (m.aggregation_method === 'max' || m.aggregation_method === 'min') return '';
  if (m.aggregation_method === 'bootstrap_mean' || m.aggregation_method === 'bootstrap_percentile') {
    return ` [${Math.round(m.ci_lower)}, ${Math.round(m.ci_upper)}]`;
  }
  if (m.aggregation_method === 'avg') {
    const halfWidth = (m.ci_upper - m.ci_lower) / 2;
    return ` ±${halfWidth.toFixed(1)}`;
  }
  return '';
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
        return `${base}${formatCISuffix(m)}`;
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
        ? METRIC_FORMATTERS[def.formatter as MetricFormatter](m.value)
        : (def.formatter === 'cost' || def.formatter === 'costDetailed')
          ? METRIC_FORMATTERS[def.formatter as MetricFormatter](0)
          : '—';
      return <span className="font-mono text-xs">{text}</span>;
    },
  }));
}
