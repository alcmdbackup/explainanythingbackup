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
      if (m != null) return METRIC_FORMATTERS[def.formatter as MetricFormatter](m.value);
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
