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

const STATUS_OPTIONS = ['', 'pending', 'claimed', 'running', 'completed', 'failed'] as const;

export default function EvolutionRunsPage(): JSX.Element {
  const [runs, setRuns] = useState<EvolutionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getEvolutionRunsAction({
      status: statusFilter || undefined,
      includeArchived,
    });
    if (result.success && result.data) {
      setRuns(result.data);
    }
    setLoading(false);
  }, [statusFilter, includeArchived]);

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
        columns={getBaseColumns()}
        loading={loading}
        testId="runs-list-table"
      />
    </div>
  );
}
