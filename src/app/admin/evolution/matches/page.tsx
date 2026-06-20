// Match Viewer list page. Browses recent judge matches (evolution_arena_comparisons),
// filterable by run id / winner / confidence, with variant-content previews. Each row links
// to the match detail + re-judge sandbox.
// (match_viewer_with_experimentation_procedures_20260605)
'use client';

import { useEffect, useState, useCallback } from 'react';
import { EntityListPage, EvolutionBreadcrumb, type ColumnDef, type FilterDef } from '@evolution/components/evolution';
import { getRecentMatchesAction, type MatchListItem, type MatchKind } from '@evolution/services/arenaActions';
import { toast } from 'sonner';
import { formatDate } from '@evolution/lib/utils/formatters';

const PAGE_SIZE = 50;

function WinnerBadge({ winner }: { winner: 'a' | 'b' | 'draw' }): JSX.Element {
  const label = winner === 'draw' ? 'DRAW' : winner.toUpperCase();
  const color =
    winner === 'a' ? 'var(--status-success)' : winner === 'b' ? 'var(--accent-gold)' : 'var(--text-muted)';
  return <span className="text-xs font-semibold" style={{ color }}>{label}</span>;
}

function KindBadge({ kind }: { kind: MatchKind | null }): JSX.Element {
  if (!kind) return <span className="text-[var(--text-muted)]">—</span>;
  const isPara = kind === 'paragraph';
  return (
    <span
      className="text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
      style={{
        color: isPara ? 'var(--accent-gold)' : 'var(--text-secondary)',
        border: '1px solid var(--border-default)',
      }}
    >
      {isPara ? 'Paragraph' : 'Article'}
    </span>
  );
}

const FILTERS: FilterDef[] = [
  { key: 'runId', label: 'Run ID', type: 'text', placeholder: 'Filter by run UUID' },
  {
    key: 'kind', label: 'Type', type: 'select',
    options: [
      { value: '', label: 'All types' },
      { value: 'article', label: 'Article' },
      { value: 'paragraph', label: 'Paragraph' },
    ],
  },
  {
    key: 'winner', label: 'Winner', type: 'select',
    options: [
      { value: '', label: 'Any' },
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'draw', label: 'Draw' },
    ],
  },
  { key: 'minConfidence', label: 'Min confidence', type: 'text', placeholder: '0.0–1.0' },
  { key: 'filterTestContent', label: 'Hide test content', type: 'checkbox', defaultChecked: true },
];

const COLUMNS: ColumnDef<MatchListItem>[] = [
  // Match ID is the clickable link (clearer than the date); full UUID on hover.
  { key: 'id', header: 'Match ID', render: (m) => <span className="font-mono text-xs" title={m.id}>{m.id.substring(0, 8)}</span> },
  { key: 'kind', header: 'Type', skipLink: true, render: (m) => <KindBadge kind={m.kind} /> },
  {
    key: 'has_rubric', header: 'Rubric', skipLink: true,
    render: (m) => m.has_rubric
      ? <span className="text-xs px-1.5 py-0.5 rounded-page bg-[var(--accent-gold)] text-[var(--text-on-primary)]">yes</span>
      : <span className="text-xs text-[var(--text-muted)]">—</span>,
  },
  {
    key: 'is_escalation', header: 'Chain', skipLink: true,
    render: (m) => m.is_escalation
      ? <span data-testid="escalation-badge" className="text-xs px-1.5 py-0.5 rounded-page bg-[var(--status-warning)] text-[var(--text-on-primary)]" title={`Ensemble chain depth ${m.chain_depth ?? '?'}`}>chain{m.chain_depth ? ` ×${m.chain_depth}` : ''}</span>
      : <span className="text-xs text-[var(--text-muted)]">—</span>,
  },
  { key: 'created_at', header: 'Created', skipLink: true, render: (m) => formatDate(m.created_at) },
  {
    key: 'run_id', header: 'Run', skipLink: true,
    render: (m) => m.run_id
      ? <span className="font-mono text-xs" title={m.run_id}>{m.run_id.substring(0, 8)}</span>
      : <span className="text-[var(--text-muted)]">—</span>,
  },
  {
    key: 'entry_a', header: 'Text A', skipLink: true,
    render: (m) => <span className="text-xs" title={m.entry_a_preview ?? ''}>{m.entry_a_preview ?? '—'}</span>,
  },
  {
    key: 'entry_b', header: 'Text B', skipLink: true,
    render: (m) => <span className="text-xs" title={m.entry_b_preview ?? ''}>{m.entry_b_preview ?? '—'}</span>,
  },
  { key: 'winner', header: 'Winner', skipLink: true, render: (m) => <WinnerBadge winner={m.winner} /> },
  { key: 'confidence', header: 'Conf.', align: 'right', skipLink: true, render: (m) => `${(m.confidence * 100).toFixed(0)}%` },
];

export default function MatchesListPage(): JSX.Element {
  useEffect(() => { document.title = 'Match Viewer | Evolution'; }, []);
  const [items, setItems] = useState<MatchListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({
    runId: '',
    kind: '',
    winner: '',
    minConfidence: '',
    filterTestContent: 'true',
  });

  const fetchMatches = useCallback(async () => {
    setLoading(true);
    const minConf = parseFloat(filterValues.minConfidence ?? '');
    const result = await getRecentMatchesAction({
      runId: filterValues.runId?.trim() || undefined,
      kind: (filterValues.kind as MatchKind) || undefined,
      winner: (filterValues.winner as 'a' | 'b' | 'draw') || undefined,
      minConfidence: Number.isFinite(minConf) ? minConf : undefined,
      filterTestContent: filterValues.filterTestContent === 'true',
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });
    if (result.success && result.data) {
      setItems(result.data.items);
      setTotal(result.data.total);
    } else if (!result.success) {
      toast.error(result.error?.message ?? 'Failed to load matches');
    }
    setLoading(false);
  }, [filterValues.runId, filterValues.kind, filterValues.winner, filterValues.minConfidence, filterValues.filterTestContent, page]);

  useEffect(() => { fetchMatches(); }, [fetchMatches]);

  const handleFilterChange = (key: string, value: string) => {
    setPage(1);
    setFilterValues((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb
        items={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
          { label: 'Match Viewer' },
        ]}
      />
      <p className="text-sm text-[var(--text-muted)] font-ui">
        Inspect recent judge matches and re-run judging in realtime with different models and prompts.
      </p>
      <EntityListPage
        title="Match Viewer"
        filters={FILTERS}
        columns={COLUMNS}
        items={items}
        loading={loading}
        totalCount={loading ? undefined : total}
        filterValues={filterValues}
        onFilterChange={handleFilterChange}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        getRowHref={(m) => `/admin/evolution/matches/${m.id}`}
        emptyMessage="No matches found"
        emptySuggestion="Try clearing the run-id filter or unchecking “Hide test content”."
      />
    </div>
  );
}
