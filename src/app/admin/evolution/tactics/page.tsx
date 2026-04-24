// Tactics list page — sortable leaderboard of all system-defined generation tactics.
// Identity columns (name, category, status) plus 5 metric columns (avg_elo, avg_elo_delta,
// win_rate, total_variants, run_count) sourced live from evolution_metrics.

'use client';

import { useState } from 'react';
import { EntityListPage } from '@evolution/components/evolution';
import type { ColumnDef, FilterDef } from '@evolution/components/evolution';
import { listTacticsAction, type TacticListRow } from '@evolution/services/tacticActions';
import { createMetricColumns } from '@evolution/lib/metrics/metricColumns';
import Link from 'next/link';

type SortDir = 'asc' | 'desc';

const identityColumns: ColumnDef<TacticListRow>[] = [
  {
    key: 'name',
    header: 'Name',
    sortable: true,
    render: (row) => (
      <Link
        href={`/admin/evolution/tactics/${row.id}`}
        className="text-[var(--accent-gold)] hover:underline font-mono text-xs"
      >
        {row.name}
      </Link>
    ),
  },
  { key: 'label', header: 'Label', render: (row) => row.label },
  { key: 'category', header: 'Category', render: (row) => row.category ?? '—' },
  {
    key: 'is_predefined',
    header: 'Type',
    render: (row) => (
      <span className={`text-xs px-1.5 py-0.5 rounded ${row.is_predefined ? 'bg-blue-900/30 text-blue-300' : 'bg-green-900/30 text-green-300'}`}>
        {row.is_predefined ? 'System' : 'Custom'}
      </span>
    ),
  },
  { key: 'status', header: 'Status', render: (row) => row.status },
];

// 5 metric columns from TacticEntity.metrics with listView: true.
// createMetricColumns reads from the entity registry so adding/removing listView flags
// in TacticEntity.ts automatically propagates here. We mark each metric column sortable
// so the leaderboard can rank by any metric — the generic helper leaves sort off by
// default for use cases that don't need it.
const metricColumns: ColumnDef<TacticListRow>[] = createMetricColumns<TacticListRow>('tactic')
  .map((c) => ({ ...c, sortable: true }));

const columns: ColumnDef<TacticListRow>[] = [...identityColumns, ...metricColumns];

// Column key → server sortKey. Identity columns pass through (name, label, etc.).
// Metric columns carry the `metric_` prefix to avoid identity-name collisions in the
// table renderer — strip it so the server sees the bare metric name.
function toServerSortKey(columnKey: string): string {
  return columnKey.startsWith('metric_') ? columnKey.slice('metric_'.length) : columnKey;
}

const filters: FilterDef[] = [
  {
    key: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { label: 'All', value: '' },
      { label: 'Active', value: 'active' },
      { label: 'Archived', value: 'archived' },
    ],
  },
  {
    key: 'agent_type',
    label: 'Agent Type',
    type: 'select',
    options: [
      { label: 'All', value: '' },
      { label: 'Generate', value: 'generate_from_previous_article' },
    ],
  },
  {
    key: 'search',
    label: 'Name search',
    type: 'text',
  },
];

export default function TacticsPage() {
  // Sort state holds the COLUMN key (e.g. `metric_avg_elo` or `name`) — matches what
  // EntityTable's SortIndicator compares against. toServerSortKey strips the `metric_`
  // prefix before passing to the server action. Default: `metric_avg_elo` desc so
  // populated tactics land on top and unproven rows sort last.
  const [sortKey, setSortKey] = useState<string>('metric_avg_elo');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const loadData = async (filterValues: Record<string, string>, page: number, pageSize: number) => {
    const result = await listTacticsAction({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      status: filterValues.status || undefined,
      agentType: filterValues.agent_type || undefined,
      search: filterValues.search || undefined,
      sortKey: toServerSortKey(sortKey),
      sortDir,
    });
    if (!result.success) throw new Error(result.error?.message ?? 'Load failed');
    return { items: result.data!.items, total: result.data!.total };
  };

  return (
    <EntityListPage
      title="Tactics"
      columns={columns}
      filters={filters}
      loadData={loadData}
      pageSize={50}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={(key) => {
        if (key === sortKey) {
          // Same column: toggle direction.
          setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
          // New column: default to descending (researchers scan top-of-leaderboard first —
          // best Elo, highest win rate, most variants).
          setSortKey(key);
          setSortDir('desc');
        }
      }}
    />
  );
}
