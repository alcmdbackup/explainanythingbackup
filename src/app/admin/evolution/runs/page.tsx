// Evolution runs list page with status filtering and archived toggle.
// Uses V2 RunsTable component with getBaseColumns for consistent column rendering.
'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  EvolutionBreadcrumb,
  RunsTable,
  getBaseColumns,
} from '@evolution/components/evolution';
import {
  getEvolutionRunsAction,
  type EvolutionRun,
} from '@evolution/services/evolutionActions';
import { createRunsMetricColumns } from '@evolution/lib/metrics/metricColumns';
import type { MetricRow } from '@evolution/lib/metrics/types';
import { getListViewMetrics } from '@evolution/lib/metrics/registry';
import { getBatchMetricsAction } from '@evolution/services/metricsActions';

const STATUS_OPTIONS = ['', 'pending', 'claimed', 'running', 'completed', 'failed'] as const;

export default function EvolutionRunsPage(): JSX.Element {
  const [runs, setRuns] = useState<(EvolutionRun & { metrics?: MetricRow[] })[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getEvolutionRunsAction({
      status: statusFilter || undefined,
      includeArchived,
      limit: pageSize,
      offset: page * pageSize,
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
  }, [statusFilter, includeArchived, page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Dashboard', href: '/admin/evolution-dashboard' },
        { label: 'Runs' },
      ]} />

      <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">Evolution Runs</h1>

      <div className="flex items-center gap-4" data-testid="runs-filters">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 text-sm font-ui bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)]"
          data-testid="status-filter"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm font-ui text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            data-testid="archived-toggle"
          />
          Include archived
        </label>
      </div>

      <RunsTable
        runs={runs}
        columns={[...getBaseColumns(), ...createRunsMetricColumns()]}
        loading={loading}
        testId="runs-list-table"
      />

      {total > pageSize && (
        <div className="flex items-center justify-between" data-testid="runs-pagination">
          <span className="text-sm font-ui text-[var(--text-muted)]">
            Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-sm font-ui border border-[var(--border-default)] rounded-page text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] disabled:opacity-50 transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={(page + 1) * pageSize >= total}
              className="px-3 py-1.5 text-sm font-ui border border-[var(--border-default)] rounded-page text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] disabled:opacity-50 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
