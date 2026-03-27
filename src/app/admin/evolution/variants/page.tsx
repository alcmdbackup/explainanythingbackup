// Variants list page. Displays all evolution variants with filtering by agent and winner status.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { EvolutionBreadcrumb, EntityListPage } from '@evolution/components/evolution';
import { listVariantsAction, type VariantListEntry } from '@evolution/services/evolutionActions';
import type { ColumnDef, FilterDef } from '@evolution/components/evolution';
import { toast } from 'sonner';

const PAGE_SIZE = 20;

const FILTERS: FilterDef[] = [
  { key: 'agentName', label: 'Agent Name', type: 'text', placeholder: 'Filter by agent...' },
  {
    key: 'isWinner',
    label: 'Winner',
    type: 'select',
    options: [
      { value: '', label: 'All' },
      { value: 'yes', label: 'Winners' },
      { value: 'no', label: 'Non-winners' },
    ],
  },
  { key: 'filterTestContent', label: 'Hide test content', type: 'checkbox', defaultChecked: true },
];

const COLUMNS: ColumnDef<VariantListEntry>[] = [
  {
    key: 'id',
    header: 'ID',
    render: (v) => (
      <span className="font-mono text-xs text-[var(--accent-gold)]" title={v.id}>
        {v.id.substring(0, 8)}
      </span>
    ),
  },
  {
    key: 'run_id',
    header: 'Run',
    render: (v) => (
      <span className="font-mono text-xs text-[var(--text-muted)]" title={v.run_id}>
        {v.run_id.substring(0, 8)}
      </span>
    ),
  },
  { key: 'agent_name', header: 'Agent', render: (v) => v.agent_name || <span className="text-[var(--text-muted)]">—</span> },
  {
    key: 'elo_score',
    header: 'Rating',
    align: 'right',
    sortable: true,
    render: (v) => <span className="font-semibold">{Math.round(v.elo_score)}</span>,
  },
  { key: 'match_count', header: 'Matches', align: 'right', render: (v) => v.match_count },
  { key: 'generation', header: 'Generation', align: 'right', render: (v) => v.generation },
  {
    key: 'is_winner',
    header: 'Winner',
    align: 'center',
    render: (v) =>
      v.is_winner ? (
        <span className="text-[var(--status-success)]" title="Winner">★</span>
      ) : <span className="text-[var(--text-muted)]">—</span>,
  },
];

export default function VariantsListPage(): JSX.Element {
  const [items, setItems] = useState<VariantListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({ filterTestContent: 'true' });

  const fetchData = useCallback(async (currentPage: number, filters: Record<string, string>) => {
    setLoading(true);
    const isWinnerRaw = filters.isWinner;
    const isWinner = isWinnerRaw === 'yes' ? true : isWinnerRaw === 'no' ? false : undefined;
    const result = await listVariantsAction({
      agentName: filters.agentName || undefined,
      isWinner,
      filterTestContent: filters.filterTestContent === 'true',
      limit: PAGE_SIZE,
      offset: (currentPage - 1) * PAGE_SIZE,
    });
    if (result.success && result.data) {
      setItems(result.data.items);
      setTotalCount(result.data.total);
    } else if (!result.success) {
      toast.error(result.error?.message ?? 'Failed to load variants');
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
          { label: 'Variants' },
        ]}
      />
      <EntityListPage
        title="Variants"
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
        getRowHref={(v) => `/admin/evolution/variants/${v.id}`}
        emptyMessage="No variants found"
        emptySuggestion="Run an evolution experiment to generate variants."
      />
    </div>
  );
}
