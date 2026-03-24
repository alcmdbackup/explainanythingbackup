// Experiments list page using EntityListPage with renderTable for custom rows.
// Standardizes on shared list page pattern while preserving cancel controls.
'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  EvolutionBreadcrumb,
  EntityListPage,
} from '@evolution/components/evolution';
import type { FilterDef } from '@evolution/components/evolution';
import {
  listExperimentsAction,
  cancelExperimentAction,
} from '@evolution/services/experimentActions';
import { buildExperimentUrl } from '@evolution/lib/utils/evolutionUrls';

interface ExperimentSummary {
  id: string;
  name: string;
  status: string;
  created_at: string;
  runCount: number;
}

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

const STATE_COLORS: Record<string, string> = {
  pending: 'var(--text-muted)',
  running: 'var(--accent-gold)',
  completed: 'var(--status-success)',
  failed: 'var(--status-error)',
  cancelled: 'var(--text-muted)',
};

function StatusDot({ status }: { status: string }): JSX.Element {
  const color = STATE_COLORS[status] ?? 'var(--text-muted)';
  return (
    <span
      className="inline-block w-2 h-2 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

const filters: FilterDef[] = [
  {
    key: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { label: 'Active', value: '' },
      { label: 'Cancelled', value: 'cancelled' },
      { label: 'All', value: 'all' },
    ],
  },
  { key: 'filterTestContent', label: 'Hide test content', type: 'checkbox', defaultChecked: true },
];

export default function ExperimentsListPage(): JSX.Element {
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterValues, setFilterValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const f of filters) {
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
      toast.error(res.error?.message || 'Failed to cancel');
    }
  };

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Dashboard', href: '/admin/evolution-dashboard' },
        { label: 'Experiments' },
      ]} />

      <EntityListPage<ExperimentSummary>
        title="Experiments"
        filters={filters}
        items={experiments}
        loading={loading}
        totalCount={experiments.length}
        filterValues={filterValues}
        onFilterChange={handleFilterChange}
        emptyMessage="No experiments found."
        emptySuggestion="Use the experiment wizard to start one."
        renderTable={({ items: tableItems, loading: tableLoading }) => {
          if (tableLoading && tableItems.length === 0) {
            return (
              <div className="flex items-center gap-2 text-[var(--text-muted)] py-4">
                <div className="w-4 h-4 border-2 border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
                <span className="font-ui text-sm">Loading experiments...</span>
              </div>
            );
          }
          if (tableItems.length === 0) {
            return (
              <p className="text-sm font-body text-[var(--text-muted)] py-4">
                No experiments found. Use the experiment wizard to start one.
              </p>
            );
          }
          return (
            <div className="space-y-2" data-testid="experiments-list">
              {tableItems.map((exp) => (
                <div key={exp.id} className="border border-[var(--border-default)] rounded-page overflow-hidden" data-testid={`experiment-row-${exp.id}`}>
                  <div className="flex items-center justify-between p-3 hover:bg-[var(--surface-elevated)] transition-colors">
                    <div className="flex items-center gap-3">
                      <StatusDot status={exp.status} />
                      <div className="flex flex-col">
                        <Link
                          href={buildExperimentUrl(exp.id)}
                          className="font-ui font-medium text-sm text-[var(--text-primary)] hover:text-[var(--accent-gold)] transition-colors"
                          data-testid={`experiment-link-${exp.id}`}
                        >
                          {exp.name}
                        </Link>
                        <span className="text-xs font-mono text-[var(--text-muted)]">
                          {exp.id.slice(0, 8)}&hellip;
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-mono text-[var(--text-secondary)]">
                      <span>{exp.runCount} run{exp.runCount !== 1 ? 's' : ''}</span>
                      <span className="text-[var(--text-muted)]">
                        {new Date(exp.created_at).toLocaleDateString()}
                      </span>
                      {TERMINAL_STATUSES.includes(exp.status) && exp.status !== 'cancelled' && (
                        <button
                          onClick={() => handleCancel(exp)}
                          className="font-ui text-[var(--status-warning)] hover:text-[var(--status-error)]"
                          title="Cancel"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        }}
      />
    </div>
  );
}
