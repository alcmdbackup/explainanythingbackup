// Variants list page. Displays all evolution variants with filtering by agent and winner status.
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { EvolutionBreadcrumb, EntityListPage } from '@evolution/components/evolution';
import { listVariantsAction, type VariantListEntry } from '@evolution/services/evolutionActions';
import type { ColumnDef, FilterDef } from '@evolution/components/evolution';
import { toast } from 'sonner';
import { formatEloWithUncertainty, formatEloCIRange } from '@evolution/lib/utils/formatters';
import { dbToRating } from '@evolution/lib/shared/computeRatings';
import { bootstrapDeltaCI } from '@evolution/lib/shared/ratingDelta';
import { VariantParentBadge } from '@evolution/components/evolution/variant/VariantParentBadge';

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
  {
    key: 'agent_name',
    header: 'Agent',
    // Phase 3 Gap 5 freebie: link to tactic detail when tactic_id resolves; fall back to
    // plain text when unknown (legacy names / seeds / manual entries).
    render: (v) => {
      if (!v.agent_name) return <span className="text-[var(--text-muted)]">—</span>;
      if (v.tactic_id) {
        return (
          <Link href={`/admin/evolution/tactics/${v.tactic_id}`} className="text-[var(--accent-gold)] hover:underline font-mono text-xs">
            {v.agent_name}
          </Link>
        );
      }
      return <span className="font-mono text-xs">{v.agent_name}</span>;
    },
  },
  {
    key: 'elo_score',
    header: 'Rating',
    align: 'right',
    sortable: true,
    render: (v) => {
      const u = v.mu != null && v.sigma != null ? dbToRating(v.mu, v.sigma).uncertainty : null;
      const label = u != null ? formatEloWithUncertainty(v.elo_score, u) : null;
      return <span className="font-semibold">{label ?? Math.round(v.elo_score)}</span>;
    },
  },
  {
    key: 'ci_95',
    header: '95% CI',
    align: 'right',
    render: (v) => {
      const u = v.mu != null && v.sigma != null ? dbToRating(v.mu, v.sigma).uncertainty : null;
      const ci = u != null ? formatEloCIRange(v.elo_score, u) : null;
      return <span className="text-xs text-[var(--text-muted)]">{ci ?? '—'}</span>;
    },
  },
  { key: 'match_count', header: 'Matches', align: 'right', render: (v) => v.match_count },
  { key: 'generation', header: 'Generation', align: 'right', render: (v) => v.generation },
  {
    key: 'parent_variant_id',
    header: 'Parent · Δ',
    render: (v) => {
      if (!v.parent_variant_id) {
        return (
          <VariantParentBadge
            parentId={null}
            parentElo={null}
            parentUncertainty={null}
            delta={null}
            deltaCi={null}
          />
        );
      }
      const childRating = v.mu != null && v.sigma != null
        ? dbToRating(v.mu, v.sigma)
        : { elo: v.elo_score, uncertainty: 0 };
      const parentElo = v.parent_elo ?? null;
      const parentUncertainty = v.parent_uncertainty ?? null;
      const { delta, ci } = parentElo != null
        ? bootstrapDeltaCI(childRating,
            { elo: parentElo, uncertainty: parentUncertainty ?? 0 })
        : { delta: null, ci: null };
      return (
        <VariantParentBadge
          parentId={v.parent_variant_id}
          parentElo={parentElo}
          parentUncertainty={parentUncertainty}
          delta={delta}
          deltaCi={ci}
          crossRun={!!v.parent_run_id && v.parent_run_id !== v.run_id}
          parentRunId={v.parent_run_id ?? null}
        />
      );
    },
  },
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
  useEffect(() => { document.title = 'Variants | Evolution'; }, []);
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
