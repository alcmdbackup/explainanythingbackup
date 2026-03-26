// Invocations list page. Shows all evolution agent invocations with pagination.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { EvolutionBreadcrumb, EntityListPage } from '@evolution/components/evolution';
import { listInvocationsAction, type InvocationListEntry } from '@evolution/services/invocationActions';
import type { ColumnDef, FilterDef } from '@evolution/components/evolution';
import { formatCostDetailed } from '@evolution/lib/utils/formatters';

const PAGE_SIZE = 20;

const FILTERS: FilterDef[] = [
  { key: 'filterTestContent', label: 'Hide test content', type: 'checkbox', defaultChecked: true },
];

const COLUMNS: ColumnDef<InvocationListEntry>[] = [
  {
    key: 'id',
    header: 'ID',
    render: (inv) => (
      <span className="font-mono text-xs text-[var(--accent-gold)]" title={inv.id}>
        {inv.id.substring(0, 8)}
      </span>
    ),
  },
  {
    key: 'run_id',
    header: 'Run ID',
    render: (inv) => (
      <span className="font-mono text-xs text-[var(--text-muted)]" title={inv.run_id}>
        {inv.run_id.substring(0, 8)}
      </span>
    ),
  },
  { key: 'agent_name', header: 'Agent', render: (inv) => inv.agent_name },
  { key: 'iteration', header: 'Iteration', align: 'right', render: (inv) => inv.iteration ?? '—' },
  {
    key: 'success',
    header: 'Success',
    align: 'center',
    render: (inv) =>
      inv.success ? (
        <span className="text-[var(--status-success)]">✓</span>
      ) : (
        <span className="text-[var(--status-error)]">✗</span>
      ),
  },
  {
    key: 'cost_usd',
    header: 'Cost',
    align: 'right',
    render: (inv) => formatCostDetailed(inv.cost_usd),
  },
  {
    key: 'duration_ms',
    header: 'Duration',
    align: 'right',
    render: (inv) => (inv.duration_ms != null ? `${(inv.duration_ms / 1000).toFixed(1)}s` : '—'),
  },
  {
    key: 'created_at',
    header: 'Created',
    render: (inv) => new Date(inv.created_at).toLocaleString(),
  },
];

export default function InvocationsListPage(): JSX.Element {
  const [items, setItems] = useState<InvocationListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({ filterTestContent: 'true' });

  const fetchData = useCallback(async (currentPage: number, filters: Record<string, string>) => {
    setLoading(true);
    const result = await listInvocationsAction({
      filterTestContent: filters.filterTestContent === 'true',
      limit: PAGE_SIZE,
      offset: (currentPage - 1) * PAGE_SIZE,
    });
    if (result.success && result.data) {
      setItems(result.data.items);
      setTotalCount(result.data.total);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData(page, filterValues);
  }, [page, filterValues, fetchData]);

  const handleFilterChange = (key: string, value: string) => {
    setFilterValues((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb
        items={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
          { label: 'Invocations' },
        ]}
      />
      <EntityListPage
        title="Invocations"
        filters={FILTERS}
        columns={COLUMNS}
        items={items}
        loading={loading}
        totalCount={totalCount}
        filterValues={filterValues}
        onFilterChange={handleFilterChange}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        getRowHref={(inv) => `/admin/evolution/invocations/${inv.id}`}
        emptyMessage="No invocations found"
        emptySuggestion="Run an evolution experiment to generate agent invocations."
      />
    </div>
  );
}
