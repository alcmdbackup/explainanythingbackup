// Arena topics list page. Shows all arena topics with status filter and entry counts.
// Uses EntityListPage for consistent list layout with the V2 evolution UI pattern.
'use client';

import { useEffect, useState, useCallback } from 'react';
import { EntityListPage, EvolutionBreadcrumb, type ColumnDef, type FilterDef } from '@evolution/components/evolution';
import { getArenaTopicsAction, type ArenaTopic } from '@evolution/services/arenaActions';
import { toast } from 'sonner';
import { formatDate } from '@evolution/lib/utils/formatters';

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

const HIDE_EMPTY_FILTER: FilterDef = {
  key: 'hideEmpty',
  label: 'Hide empty topics',
  type: 'checkbox',
  // U16 (use_playwright_find_bugs_ux_issues_20260422): default-on. Empty topics
  // are rarely actionable; user can still uncheck to see them.
  defaultChecked: true,
};

// U32 (use_playwright_find_bugs_ux_issues_20260422): only the Name cell carries
// the row-level Link. Other cells are marked skipLink so the rendered DOM has
// one <a> per row instead of five sibling anchors pointing to the same URL
// (reduces screen-reader noise; sort/copy behavior unchanged).
const COLUMNS: ColumnDef<ArenaTopic>[] = [
  { key: 'name', header: 'Name', render: (t) => t.name || <span className="text-[var(--text-muted)] italic">Untitled</span> },
  {
    key: 'prompt',
    header: 'Prompt',
    skipLink: true,
    render: (t) => (
      <span title={t.prompt}>
        {t.prompt.length > 80 ? `${t.prompt.substring(0, 80)}…` : t.prompt}
      </span>
    ),
  },
  { key: 'entry_count', header: 'Entries', skipLink: true, render: (t) => t.entry_count ?? 0 },
  { key: 'status', header: 'Status', skipLink: true, render: (t) => t.status },
  {
    key: 'created_at',
    header: 'Created',
    skipLink: true,
    render: (t) => formatDate(t.created_at),
  },
];

export default function ArenaListPage(): JSX.Element {
  useEffect(() => { document.title = 'Arena | Evolution'; }, []);
  const [topics, setTopics] = useState<ArenaTopic[]>([]);
  const [loading, setLoading] = useState(true);
  // B098: initialize `hideEmpty` so the "Hide empty topics" checkbox actually filters.
  // Previously the state lacked this key and the filter read `filterValues.hideEmpty`
  // as `undefined`, so toggling the checkbox never had any effect.
  const [filterValues, setFilterValues] = useState<Record<string, string>>({
    status: '',
    filterTestContent: 'true',
    hideEmpty: 'false',
  });

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
        filters={[STATUS_FILTER, HIDE_EMPTY_FILTER, { key: 'filterTestContent', label: 'Hide test content', type: 'checkbox', defaultChecked: true }]}
        columns={COLUMNS}
        items={filterValues.hideEmpty === 'true' ? topics.filter(t => (t.entry_count ?? 0) > 0) : topics}
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
