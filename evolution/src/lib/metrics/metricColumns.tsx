// Helper to generate list-view metric columns from the registry.
// Works with EntityTable ColumnDef and RunsTable RunsColumnDef.

import React from 'react';
import { getListViewMetrics, FORMATTERS } from './registry';
import type { EntityType, MetricRow } from './types';
import type { ColumnDef } from '@evolution/components/evolution/EntityTable';
import type { RunsColumnDef, BaseRun } from '@evolution/components/evolution/RunsTable';

function findMetric(item: unknown, metricName: string): MetricRow | undefined {
  const obj = item as Record<string, unknown>;
  const metrics = obj.metrics as MetricRow[] | undefined;
  return metrics?.find(r => r.metric_name === metricName);
}

export function createMetricColumns<T>(
  entityType: EntityType,
): ColumnDef<T>[] {
  return getListViewMetrics(entityType).map(def => ({
    key: `metric_${def.name}`,
    header: def.label,
    align: 'right' as const,
    sortable: false,
    render: (item: T) => {
      const m = findMetric(item, def.name);
      return m != null ? FORMATTERS[def.formatter](m.value) : '—';
    },
  }));
}

export function createRunsMetricColumns<T extends BaseRun>(): RunsColumnDef<T>[] {
  return getListViewMetrics('run').map(def => ({
    key: `metric_${def.name}`,
    header: def.label,
    align: 'right' as const,
    render: (item: T) => {
      const m = findMetric(item, def.name);
      return <span className="font-mono text-xs">{m != null ? FORMATTERS[def.formatter](m.value) : '—'}</span>;
    },
  }));
}
