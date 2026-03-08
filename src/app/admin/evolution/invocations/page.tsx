// Invocations list page: filterable table of agent invocations with click-through to detail.
// Uses EntityListPage for consistent layout with filters and pagination.

'use client';

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { EvolutionBreadcrumb, EntityListPage } from '@evolution/components/evolution';
import type { ColumnDef, FilterDef } from '@evolution/components/evolution';
import {
  listInvocationsAction,
  type InvocationListEntry,
} from '@evolution/services/evolutionVisualizationActions';
import { buildInvocationUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatCostDetailed } from '@evolution/lib/utils/formatters';

function getStatusBadge(skipped: boolean, success: boolean): JSX.Element {
  if (skipped) return <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--text-muted)]/10 text-[var(--text-muted)]">skipped</span>;
  if (success) return <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--status-success)]/10 text-[var(--status-success)]">success</span>;
  return <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--status-error)]/10 text-[var(--status-error)]">failed</span>;
}

const COLUMNS: ColumnDef<InvocationListEntry>[] = [
  { key: 'agent', header: 'Agent', render: (inv) => <span className="font-mono text-xs">{inv.agent_name}</span> },
  { key: 'run', header: 'Run', render: (inv) => <span className="font-mono text-xs">{inv.run_id.substring(0, 8)}…</span> },
  { key: 'iteration', header: 'Iter', align: 'right', render: (inv) => inv.iteration },
  { key: 'status', header: 'Status', align: 'center', render: (inv) => getStatusBadge(inv.skipped, inv.success) },
  { key: 'cost', header: 'Cost', align: 'right', sortable: true, render: (inv) => formatCostDetailed(inv.cost_usd) },
  {
    key: 'created', header: 'Created', align: 'right', sortable: true,
    render: (inv) => new Date(inv.created_at).toLocaleDateString(),
  },
];

const FILTERS: FilterDef[] = [
  { key: 'runId', label: 'Run ID', type: 'text', placeholder: 'Filter by run ID...' },
  { key: 'agent', label: 'Agent', type: 'text', placeholder: 'Filter by agent...' },
  {
    key: 'status', label: 'Status', type: 'select',
    options: [
      { value: '', label: 'All' },
      { value: 'true', label: 'Success' },
      { value: 'false', label: 'Failed' },
    ],
  },
];

export default function InvocationsListPage(): JSX.Element {
  const [invocations, setInvocations] = useState<InvocationListEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listInvocationsAction({
        runId: filterValues.runId || undefined,
        agentName: filterValues.agent || undefined,
        success: filterValues.status ? filterValues.status === 'true' : undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      if (result.success && result.data) {
        setInvocations(result.data.items);
        setTotal(result.data.total);
      } else {
        toast.error(result.error?.message || 'Failed to load invocations');
      }
    } catch {
      toast.error('Failed to load invocations');
    }
    setLoading(false);
  }, [filterValues, page]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleFilterChange = (key: string, value: string) => {
    setFilterValues(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Dashboard', href: '/admin/evolution-dashboard' },
        { label: 'Invocations' },
      ]} />
      <EntityListPage
        title="Invocations"
        filters={FILTERS}
        columns={COLUMNS}
        items={invocations}
        loading={loading}
        totalCount={total}
        filterValues={filterValues}
        onFilterChange={handleFilterChange}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        getRowHref={(inv) => buildInvocationUrl(inv.id)}
        emptyMessage="No invocations found."
      />
    </div>
  );
}
