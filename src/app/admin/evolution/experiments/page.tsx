// Experiments list page using EntityListPage with standard columns pattern.
// Matches the table-based layout used by runs, variants, and invocations pages.
'use client';

import { useState, useCallback, useEffect } from 'react';
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
} from '@evolution/services/experimentActions';
import { executeEntityAction } from '@evolution/services/entityActions';
import { buildExperimentUrl } from '@evolution/lib/utils/evolutionUrls';

interface ExperimentSummary {
  id: string;
  name: string;
  status: string;
  created_at: string;
  runCount: number;
}

const STATE_COLORS: Record<string, string> = {
  draft: 'var(--text-muted)',
  pending: 'var(--text-muted)',
  running: 'var(--accent-gold)',
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
      { label: 'Completed', value: 'completed' },
      { label: 'Cancelled', value: 'cancelled' },
    ],
  },
  { key: 'filterTestContent', label: 'Hide test content', type: 'checkbox', defaultChecked: true },
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

const COLUMNS: ColumnDef<ExperimentSummary>[] = [
  {
    key: 'id',
    header: 'ID',
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
    render: (exp) => (
      <span className="inline-flex items-center text-xs">
        <StatusDot status={exp.status} />
        {exp.status}
      </span>
    ),
  },
  {
    key: 'runCount',
    header: 'Runs',
    align: 'right',
    render: (exp) => exp.runCount,
  },
  {
    key: 'created_at',
    header: 'Created',
    render: (exp) => new Date(exp.created_at).toLocaleDateString(),
  },
];

export default function ExperimentsListPage(): JSX.Element {
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<ExperimentSummary | null>(null);
  const [filterValues, setFilterValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = { status: 'all' };
    for (const f of FILTERS) {
      if (f.type === 'checkbox' && f.defaultChecked) {
        defaults[f.key] = 'true';
      }
    }
    return defaults;
  });

  const load = useCallback(async () => {
    setLoading(true);
    const statusVal = filterValues.status;
    const params: { status?: string; filterTestContent?: boolean } = {
      filterTestContent: filterValues.filterTestContent === 'true',
    };
    if (statusVal && statusVal !== 'all') {
      params.status = statusVal;
    }
    const result = await listExperimentsAction(params);
    if (result.success && result.data) {
      setExperiments(result.data as ExperimentSummary[]);
    }
    setLoading(false);
  }, [filterValues]);

  useEffect(() => {
    load();
  }, [load]);

  const handleFilterChange = (key: string, value: string): void => {
    setFilterValues((prev) => ({ ...prev, [key]: value }));
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

  const columnsWithActions: ColumnDef<ExperimentSummary>[] = [
    ...COLUMNS,
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
        emptyMessage="No experiments found."
        emptySuggestion="Use the experiment wizard to start one."
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
