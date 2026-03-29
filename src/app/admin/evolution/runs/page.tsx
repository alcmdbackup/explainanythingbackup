// Evolution runs list page using EntityListPage with renderTable for RunsTable.
// Standardizes on the shared list page pattern while preserving RunsTable's budget bars.
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  EvolutionBreadcrumb,
  EntityListPage,
  RunsTable,
  getBaseColumns,
} from '@evolution/components/evolution';
import type { FilterDef } from '@evolution/components/evolution';
import { ConfirmDialog } from '@evolution/components/evolution';
import {
  getEvolutionRunsAction,
  killEvolutionRunAction,
  type EvolutionRun,
} from '@evolution/services/evolutionActions';
import { executeEntityAction } from '@evolution/services/entityActions';
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
  { key: 'filterTestContent', label: 'Hide test content', type: 'checkbox', defaultChecked: true },
];

const pageSize = 50;

type RunAction = { kind: 'none' } | { kind: 'kill'; run: EvolutionRun } | { kind: 'delete'; run: EvolutionRun };

export default function EvolutionRunsPage(): JSX.Element {
  const [runs, setRuns] = useState<(EvolutionRun & { metrics?: MetricRow[] })[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<RunAction>({ kind: 'none' });
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
    } else if (!result.success) {
      toast.error(result.error?.message ?? 'Failed to load runs');
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

  const handleKill = async (): Promise<void> => {
    if (pendingAction.kind !== 'kill') return;
    const result = await killEvolutionRunAction(pendingAction.run.id);
    if (result.success) { toast.success('Run killed'); load(); } else { toast.error(result.error?.message ?? 'Kill failed'); }
  };

  const handleDelete = async (): Promise<void> => {
    if (pendingAction.kind !== 'delete') return;
    const result = await executeEntityAction({ entityType: 'run', entityId: pendingAction.run.id, actionKey: 'delete' });
    if (result.success) { toast.success('Run deleted'); load(); } else { toast.error(result.error?.message ?? 'Delete failed'); }
  };

  const renderActions = (run: EvolutionRun & { metrics?: MetricRow[] }): React.ReactNode => (
    <div className="flex gap-2">
      {['pending', 'claimed', 'running'].includes(run.status) && (
        <button onClick={() => setPendingAction({ kind: 'kill', run })} className="font-ui text-xs text-[var(--status-error)]">Kill</button>
      )}
      {['completed', 'failed', 'cancelled'].includes(run.status) && (
        <button onClick={() => setPendingAction({ kind: 'delete', run })} className="font-ui text-xs text-[var(--status-error)]">Delete</button>
      )}
    </div>
  );

  const confirmOpen = pendingAction.kind === 'kill' || pendingAction.kind === 'delete';
  const confirmProps = pendingAction.kind === 'kill'
    ? { title: 'Kill Run', message: `Kill run ${pendingAction.run.id.substring(0, 8)}?`, confirmLabel: 'Kill', onConfirm: handleKill, danger: true }
    : pendingAction.kind === 'delete'
      ? { title: 'Delete Run', message: `Delete run ${pendingAction.run.id.substring(0, 8)} and all its variants/invocations?`, confirmLabel: 'Delete', onConfirm: handleDelete, danger: true }
      : { title: '', message: '', onConfirm: async () => {}, danger: false };

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
            renderActions={renderActions}
            testId="runs-list-table"
          />
        )}
      />

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setPendingAction({ kind: 'none' })}
        {...confirmProps}
      />
    </div>
  );
}
