// Variants list page: filterable table of evolution variants with click-through to detail.
// Uses EntityListPage for consistent layout with filters and pagination.

'use client';

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { EvolutionBreadcrumb, EntityListPage } from '@evolution/components/evolution';
import type { ColumnDef, FilterDef } from '@evolution/components/evolution';
import {
  listVariantsAction,
  type VariantListEntry,
} from '@evolution/services/evolutionActions';
import { buildVariantDetailUrl, buildRunUrl } from '@evolution/lib/utils/evolutionUrls';

const COLUMNS: ColumnDef<VariantListEntry>[] = [
  {
    key: 'id', header: 'ID',
    render: (v) => <span className="font-mono text-xs">{v.id.substring(0, 8)}</span>,
  },
  {
    key: 'run', header: 'Run',
    render: (v) => (
      <a href={buildRunUrl(v.run_id)} className="font-mono text-xs text-[var(--accent-gold)] hover:underline" onClick={(e) => e.stopPropagation()}>
        {v.run_id.substring(0, 8)}
      </a>
    ),
  },
  { key: 'agent', header: 'Agent', render: (v) => <span className="font-mono text-xs">{v.agent_name}</span> },
  { key: 'rating', header: 'Rating', align: 'right', sortable: true, render: (v) => <span className="font-semibold">{Math.round(v.elo_score)}</span> },
  { key: 'matches', header: 'Matches', align: 'right', render: (v) => v.match_count },
  { key: 'gen', header: 'Gen', align: 'right', render: (v) => v.generation },
  {
    key: 'winner', header: 'Winner', align: 'center',
    render: (v) => v.is_winner
      ? <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--status-success)]/10 text-[var(--status-success)]">winner</span>
      : null,
  },
  {
    key: 'created', header: 'Created', align: 'right', sortable: true,
    render: (v) => (
      <>
        {new Date(v.created_at).toLocaleDateString()}{' '}
        <span className="opacity-70">
          {new Date(v.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </>
    ),
  },
];

const FILTERS: FilterDef[] = [
  { key: 'runId', label: 'Run ID', type: 'text', placeholder: 'Filter by run ID...' },
  { key: 'agent', label: 'Agent', type: 'text', placeholder: 'Filter by agent...' },
  {
    key: 'winner', label: 'Winner', type: 'select',
    options: [
      { value: '', label: 'All' },
      { value: 'true', label: 'Winners' },
      { value: 'false', label: 'Non-winners' },
    ],
  },
];

export default function VariantsListPage(): JSX.Element {
  const [variants, setVariants] = useState<VariantListEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listVariantsAction({
        runId: filterValues.runId || undefined,
        agentName: filterValues.agent || undefined,
        isWinner: filterValues.winner === '' || !filterValues.winner ? undefined : filterValues.winner === 'true',
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      if (result.success && result.data) {
        setVariants(result.data.items);
        setTotal(result.data.total);
      } else {
        toast.error(result.error?.message || 'Failed to load variants');
      }
    } catch {
      toast.error('Failed to load variants');
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
        { label: 'Variants' },
      ]} />
      <EntityListPage
        title="Variants"
        filters={FILTERS}
        columns={COLUMNS}
        items={variants}
        loading={loading}
        totalCount={total}
        filterValues={filterValues}
        onFilterChange={handleFilterChange}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        getRowHref={(v) => buildVariantDetailUrl(v.id)}
        emptyMessage="No variants found."
      />
    </div>
  );
}
