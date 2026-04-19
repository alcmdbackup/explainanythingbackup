// Tactics list page — displays all system-defined generation tactics.
// Tactics are code-defined; this page reads from the evolution_tactics DB table (synced from code).

'use client';

import { EntityListPage } from '@evolution/components/evolution';
import type { ColumnDef, FilterDef } from '@evolution/components/evolution';
import { listTacticsAction } from '@evolution/services/tacticActions';
import type { EvolutionTacticRow } from '@evolution/lib/core/entities/TacticEntity';
import Link from 'next/link';

const loadData = async (filters: Record<string, string>, page: number, pageSize: number) => {
  const result = await listTacticsAction({
    limit: pageSize,
    offset: (page - 1) * pageSize,
    status: filters.status || undefined,
    agentType: filters.agent_type || undefined,
  });
  if (!result.success) throw new Error(result.error?.message ?? 'Load failed');
  return { items: result.data!.items, total: result.data!.total };
};

const columns: ColumnDef<EvolutionTacticRow>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (row) => (
      <Link href={`/admin/evolution/tactics/${row.id}`} className="text-[var(--accent-gold)] hover:underline font-mono text-xs">
        {row.name}
      </Link>
    ),
  },
  { key: 'label', header: 'Label', render: (row) => row.label },
  { key: 'agent_type', header: 'Agent Type', render: (row) => <span className="font-mono text-xs">{row.agent_type}</span> },
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
];

export default function TacticsPage() {
  return (
    <EntityListPage
      title="Tactics"
      columns={columns}
      filters={filters}
      loadData={loadData}
      pageSize={50}
    />
  );
}
