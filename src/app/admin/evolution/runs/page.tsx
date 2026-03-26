// Evolution runs list page using EntityListPage with renderTable for RunsTable.
// Standardizes on the shared list page pattern while preserving RunsTable's budget bars.
'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  EvolutionBreadcrumb,
  EntityListPage,
  RunsTable,
  getBaseColumns,
} from '@evolution/components/evolution';
import type { FilterDef } from '@evolution/components/evolution';
import {
  getEvolutionRunsAction,
  type EvolutionRun,
} from '@evolution/services/evolutionActions';
import { createRunsMetricColumns } from '@evolution/lib/metrics/metricColumns';
import type { MetricRow } from '@evolution/lib/metrics/types';
import { getListViewMetrics } from '@evolution/lib/metrics/registry';
import { getBatchMetricsAction } from '@evolution/services/metricsActions';

const filters: FilterDef[] = [
  {
    key: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { label: 'All statuses', value: '' },
      { label: 'Pending', value: 'pending' },
      { label: 'Claimed', value: 'claimed' },
      { label: 'Running', value: 'running' },
      { label: 'Completed', value: 'completed' },
      { label: 'Failed', value: 'failed' },
    ],
  },
  { key: 'includeArchived', label: 'Include archived', type: 'checkbox' },
  { key: 'filterTestContent', label: 'Hide test content', type: 'checkbox', defaultChecked: true },
];

const pageSize = 50;

export default function EvolutionRunsPage(): JSX.Element {
  const [runs, setRuns] = useState<(EvolutionRun & { metrics?: MetricRow[] })[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterValues, setFilterValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const f of filters) {
      if (f.type === 'checkbox' && f.defaultChecked) {
        defaults[f.key] = 'true';
      }
    }
    return defaults;
  });
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getEvolutionRunsAction({
      status: filterValues.status || undefined,
      includeArchived: filterValues.includeArchived === 'true',
      filterTestContent: filterValues.filterTestContent === 'true',
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    if (result.success && result.data) {
      const items = result.data.items;
      setTotal(result.data.total);

      // Batch-fetch list-view metrics
      const metricNames = getListViewMetrics('run').map(d => d.name);
      const metricsResult = await getBatchMetricsAction('run', items.map(r => r.id), metricNames);
      const metricsMap = metricsResult.success && metricsResult.data ? metricsResult.data : {};

      setRuns(items.map(r => ({ ...r, metrics: metricsMap[r.id] ?? [] })));
    }
    setLoading(false);
  }, [filterValues, page]);

  useEffect(() => {
    load();
  }, [load]);

  const handleFilterChange = (key: string, value: string): void => {
    setFilterValues((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Evolution', href: '/admin/evolution-dashboard' },
        { label: 'Runs' },
      ]} />

      <EntityListPage<EvolutionRun & { metrics?: MetricRow[] }>
        title="Evolution Runs"
        filters={filters}
        items={runs}
        loading={loading}
        totalCount={total}
        filterValues={filterValues}
        onFilterChange={handleFilterChange}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        emptyMessage="No runs found."
        renderTable={({ items: tableItems, loading: tableLoading }) => (
          <RunsTable
            runs={tableItems}
            columns={[...getBaseColumns(), ...createRunsMetricColumns()]}
            loading={tableLoading}
            testId="runs-list-table"
          />
        )}
      />
    </div>
  );
}
