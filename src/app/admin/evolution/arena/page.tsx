// Arena topics list page. Shows all arena topics with status filter and entry counts.
// Uses EntityListPage for consistent list layout with the V2 evolution UI pattern.
'use client';

import { useEffect, useState, useCallback } from 'react';
import { EntityListPage, EvolutionBreadcrumb, type ColumnDef, type FilterDef } from '@evolution/components/evolution';
import { getArenaTopicsAction, type ArenaTopic } from '@evolution/services/arenaActions';
import { toast } from 'sonner';

const STATUS_FILTER: FilterDef = {
  key: 'status',
  label: 'Status',
  type: 'select',
  options: [
    { value: '', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'archived', label: 'Archived' },
  ],
};

const COLUMNS: ColumnDef<ArenaTopic>[] = [
  { key: 'name', header: 'Name', render: (t) => t.name },
  {
    key: 'prompt',
    header: 'Prompt',
    render: (t) => (
      <span title={t.prompt}>
        {t.prompt.length > 80 ? `${t.prompt.substring(0, 80)}…` : t.prompt}
      </span>
    ),
  },
  { key: 'entry_count', header: 'Entries', render: (t) => t.entry_count ?? 0 },
  { key: 'status', header: 'Status', render: (t) => t.status },
  {
    key: 'created_at',
    header: 'Created',
    render: (t) => new Date(t.created_at).toLocaleDateString(),
  },
];

export default function ArenaListPage(): JSX.Element {
  const [topics, setTopics] = useState<ArenaTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({ status: '', filterTestContent: 'true' });

  const fetchTopics = useCallback(async () => {
    setLoading(true);
    const result = await getArenaTopicsAction({
      status: filterValues.status || undefined,
      filterTestContent: filterValues.filterTestContent === 'true',
    });
    if (result.success && result.data) {
      setTopics(result.data);
    } else if (!result.success) {
      toast.error(result.error?.message ?? 'Failed to load arena topics');
    }
    setLoading(false);
  }, [filterValues.status, filterValues.filterTestContent]);

  useEffect(() => {
    fetchTopics();
  }, [fetchTopics]);

  const handleFilterChange = (key: string, value: string) => {
    setFilterValues((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb
        items={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
          { label: 'Arena' },
        ]}
      />

      <EntityListPage
        title="Arena Topics"
        filters={[STATUS_FILTER, { key: 'filterTestContent', label: 'Hide test content', type: 'checkbox', defaultChecked: true }]}
        columns={COLUMNS}
        items={topics}
        loading={loading}
        totalCount={loading ? undefined : topics.length}
        filterValues={filterValues}
        onFilterChange={handleFilterChange}
        getRowHref={(topic) => `/admin/evolution/arena/${topic.id}`}
        emptyMessage="No arena topics found"
        emptySuggestion="Create a topic to start comparing content variants."
      />
    </div>
  );
}
