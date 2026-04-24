// Experiments list page using EntityListPage with standard columns pattern.
// Matches the table-based layout used by runs, variants, and invocations pages.
'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { formatDate } from '@evolution/lib/utils/formatters';
import { toast } from 'sonner';
import {
  EvolutionBreadcrumb,
  EntityListPage,
} from '@evolution/components/evolution';
import type { FilterDef, ColumnDef } from '@evolution/components/evolution';
import { ConfirmDialog } from '@evolution/components/evolution';
import {
  listExperimentsAction,
  cancelExperimentAction,
  type ExperimentSummary,
} from '@evolution/services/experimentActions';
import { executeEntityAction } from '@evolution/services/entityActions';
import { buildExperimentUrl } from '@evolution/lib/utils/evolutionUrls';
import { createMetricColumns } from '@evolution/lib/metrics/metricColumns';

const STATE_COLORS: Record<string, string> = {
  draft: 'var(--text-muted)',
  pending: 'var(--text-muted)',
  running: 'var(--accent-gold)',
  stale: 'var(--status-warning)',
  completed: 'var(--status-success)',
  failed: 'var(--status-error)',
  cancelled: 'var(--text-muted)',
};

const FILTERS: FilterDef[] = [
  {
    key: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { label: 'All', value: 'all' },
      { label: 'Draft', value: 'draft' },
      { label: 'Running', value: 'running' },
      { label: 'Stale', value: 'stale' },
      { label: 'Completed', value: 'completed' },
      { label: 'Cancelled', value: 'cancelled' },
    ],
  },
  { key: 'filterTestContent', label: 'Hide test content', type: 'checkbox', defaultChecked: true },
  { key: 'name', label: 'Name', type: 'text', placeholder: 'Search...' },
];

function StatusDot({ status }: { status: string }): JSX.Element {
  const color = STATE_COLORS[status] ?? 'var(--text-muted)';
  return (
    <span
      className="inline-block w-2 h-2 rounded-full mr-1.5"
      style={{ backgroundColor: color }}
    />
  );
}

// U32 (use_playwright_find_bugs_ux_issues_20260422): keep the row anchor on the
// 'name' column only — other cells skipLink so screen readers don't announce
// "link" five times per row.
const COLUMNS: ColumnDef<ExperimentSummary>[] = [
  {
    key: 'id',
    header: 'ID',
    skipLink: true,
    render: (exp) => (
      <span className="font-mono text-xs text-[var(--accent-gold)]" title={exp.id}>
        {exp.id.substring(0, 8)}
      </span>
    ),
  },
  {
    key: 'name',
    header: 'Name',
    render: (exp) => exp.name,
  },
  {
    key: 'status',
    header: 'Status',
    skipLink: true,
    render: (exp) => {
      const isStale = exp.status === 'running' &&
        (Date.now() - new Date(exp.updated_at ?? exp.created_at).getTime()) > 60 * 60 * 1000;
      return (
        <span className="inline-flex items-center text-xs">
          <StatusDot status={isStale ? 'stale' : exp.status} />
          {isStale ? 'stale' : exp.status}
        </span>
      );
    },
  },
  {
    key: 'runCount',
    header: 'Runs',
    align: 'right',
    skipLink: true,
    render: (exp) => exp.runCount,
  },
  {
    key: 'created_at',
    header: 'Created',
    skipLink: true,
    render: (exp) => formatDate(exp.created_at),
  },
];

const EMPTY_MESSAGES: Record<string, string> = {
  draft: 'No draft experiments.',
  running: 'No experiments running.',
  stale: 'No stale experiments. All running experiments are healthy.',
  completed: 'No completed experiments.',
  cancelled: 'No cancelled experiments.',
};

function emptyMessageForFilter(status: string): string {
  return EMPTY_MESSAGES[status] ?? 'No experiments found.';
}

function emptySuggestionForFilter(status: string): string {
  return status === 'all' || status === 'draft'
    ? 'Start one from the experiment creation page.'
    : 'Try adjusting filters to see results.';
}

export default function ExperimentsListPage(): JSX.Element {
  useEffect(() => { document.title = 'Experiments | Evolution'; }, []);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<ExperimentSummary | null>(null);
  const [filterValues, setFilterValues] = useState<Record<string, string>>(() => {
    const urlStatus = searchParams.get('status');
    return {
      status: urlStatus && FILTERS[0]?.options?.some(o => o.value === urlStatus) ? urlStatus : 'all',
      filterTestContent: 'true',
    };
  });

  const load = useCallback(async () => {
    setLoading(true);
    const statusVal = filterValues.status;
    const isStaleFilter = statusVal === 'stale';
    const params: { status?: string; filterTestContent?: boolean; name?: string } = {
      filterTestContent: filterValues.filterTestContent === 'true',
      name: filterValues.name || undefined,
    };
    if (statusVal && statusVal !== 'all') {
      // 'stale' is computed client-side (running > 60min), not a DB status
      params.status = isStaleFilter ? 'running' : statusVal;
    }
    const result = await listExperimentsAction(params);
    if (result.success && result.data) {
      let items = result.data as ExperimentSummary[];
      if (isStaleFilter) {
        const staleThreshold = 60 * 60 * 1000; // 60 minutes
        items = items.filter(exp =>
          Date.now() - new Date(exp.updated_at ?? exp.created_at).getTime() > staleThreshold
        );
      }
      setExperiments(items);
    } else if (!result.success) {
      toast.error(result.error?.message ?? 'Failed to load experiments');
    }
    setLoading(false);
  }, [filterValues]);

  useEffect(() => {
    load();
  }, [load]);

  const handleFilterChange = (key: string, value: string): void => {
    setFilterValues((prev) => ({ ...prev, [key]: value }));
    // Sync status filter to URL for shareable/refreshable state
    if (key === 'status') {
      const params = new URLSearchParams(searchParams.toString());
      if (value === 'all') {
        params.delete('status');
      } else {
        params.set('status', value);
      }
      router.replace(`${pathname}?${params.toString()}`);
    }
  };

  const handleCancel = async (experiment: ExperimentSummary): Promise<void> => {
    const res = await cancelExperimentAction({ experimentId: experiment.id });
    if (res.success) {
      toast.success('Experiment cancelled');
      load();
    } else {
      toast.error(res.error?.message ?? 'Failed to cancel');
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    const res = await executeEntityAction({ entityType: 'experiment', entityId: deleteTarget.id, actionKey: 'delete' });
    if (res.success) { toast.success('Experiment deleted'); load(); } else { toast.error(res.error?.message ?? 'Delete failed'); }
  };

  // Drop the propagated `run_count` metric column since the page's COLUMNS already
  // includes a `runCount` column with header "Runs" sourced from the SQL join
  // (`evolution_runs(id)`), which counts ALL runs in any state. The propagated
  // `run_count` metric only counts runs that have written a `cost` row, so the two
  // disagree for pending/queued runs — and the join-based count is more useful
  // for the experiments list. The propagated metric still appears on the metrics tab.
  const metricColumns = createMetricColumns<ExperimentSummary>('experiment')
    .filter(col => col.key !== 'metric_run_count');

  const columnsWithActions: ColumnDef<ExperimentSummary>[] = [
    ...COLUMNS,
    ...metricColumns,
    {
      key: 'actions',
      header: '',
      align: 'right',
      skipLink: true,
      render: (exp) => (
        <div className="flex gap-2">
          {(exp.status === 'running' || exp.status === 'draft') && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCancel(exp); }}
              className="font-ui text-xs text-[var(--status-warning)] hover:text-[var(--status-error)]"
            >
              Cancel
            </button>
          )}
          {['completed', 'cancelled'].includes(exp.status) && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteTarget(exp); }}
              className="font-ui text-xs text-[var(--status-error)]"
            >
              Delete
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Evolution', href: '/admin/evolution-dashboard' },
        { label: 'Experiments' },
      ]} />

      <EntityListPage<ExperimentSummary>
        title="Experiments"
        filters={FILTERS}
        columns={columnsWithActions}
        items={experiments}
        loading={loading}
        totalCount={experiments.length}
        filterValues={filterValues}
        onFilterChange={handleFilterChange}
        getRowHref={(exp) => buildExperimentUrl(exp.id)}
        emptyMessage={emptyMessageForFilter(filterValues.status ?? 'all')}
        emptySuggestion={emptySuggestionForFilter(filterValues.status ?? 'all')}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Experiment"
        message={`Delete "${deleteTarget?.name}" and all its runs? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        danger
      />
    </div>
  );
}
