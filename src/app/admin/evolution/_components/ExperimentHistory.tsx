'use client';
// Experiment history list with links to experiment detail pages and cancel controls.

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  listExperimentsAction,
  cancelExperimentAction,
} from '@evolution/services/experimentActionsV2';
import { buildExperimentUrl } from '@evolution/lib/utils/evolutionUrls';
import { toast } from 'sonner';

/** Summary shape returned by listExperimentsAction V2. */
interface ExperimentSummary {
  id: string;
  name: string;
  status: string;
  created_at: string;
  runCount: number;
}

type ExperimentFilter = 'non-archived' | 'archived' | 'all';

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

const STATE_COLORS: Record<string, string> = {
  pending: 'var(--text-muted)',
  running: 'var(--accent-gold)',
  completed: 'var(--status-success)',
  failed: 'var(--status-error)',
  cancelled: 'var(--text-muted)',
};

function StatusDot({ status }: { status: string }) {
  const color = STATE_COLORS[status] ?? 'var(--text-muted)';
  return (
    <span
      className="inline-block w-2 h-2 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

interface ExperimentRowProps {
  experiment: ExperimentSummary;
  onRefresh: () => void;
}

function ExperimentRow({ experiment, onRefresh }: ExperimentRowProps): JSX.Element {
  const [actionLoading, setActionLoading] = useState(false);

  const handleCancel = async () => {
    setActionLoading(true);
    const res = await cancelExperimentAction({ experimentId: experiment.id });
    if (res.success) {
      toast.success('Experiment cancelled');
      onRefresh();
    } else {
      toast.error(res.error?.message || 'Failed to cancel');
    }
    setActionLoading(false);
  };

  return (
    <div className="border border-[var(--border-default)] rounded-page overflow-hidden" data-testid={`experiment-row-${experiment.id}`}>
      <div className="flex items-center justify-between p-3 hover:bg-[var(--surface-elevated)] transition-colors">
        <div className="flex items-center gap-3">
          <StatusDot status={experiment.status} />
          <div className="flex flex-col">
            <Link
              href={buildExperimentUrl(experiment.id)}
              className="font-ui font-medium text-sm text-[var(--text-primary)] hover:text-[var(--accent-gold)] transition-colors"
              data-testid={`experiment-link-${experiment.id}`}
            >
              {experiment.name}
            </Link>
            <span className="text-xs font-mono text-[var(--text-muted)]">
              {experiment.id.slice(0, 8)}&hellip;
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono text-[var(--text-secondary)]">
          <span>{experiment.runCount} run{experiment.runCount !== 1 ? 's' : ''}</span>
          <span className="text-[var(--text-muted)]">
            {new Date(experiment.created_at).toLocaleDateString()}
          </span>
          {TERMINAL_STATUSES.includes(experiment.status) && experiment.status !== 'cancelled' && (
            <button
              onClick={handleCancel}
              disabled={actionLoading}
              className="font-ui text-[var(--status-warning)] hover:text-[var(--status-error)] disabled:opacity-50"
              title="Cancel"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ExperimentHistory(): JSX.Element {
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ExperimentFilter>('non-archived');
  const [filterTestContent, setFilterTestContent] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let params: { status?: string; filterTestContent?: boolean } | undefined;
    if (filter === 'archived') {
      params = { status: 'cancelled', filterTestContent };
    } else {
      params = filterTestContent ? { filterTestContent } : undefined;
    }
    // 'non-archived' → no status filter (V2 default excludes cancelled)
    // 'all' → no status filter (shows everything)
    const result = await listExperimentsAction(params);
    if (result.success && result.data) {
      setExperiments(result.data as ExperimentSummary[]);
    }
    setLoading(false);
  }, [filter, filterTestContent]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card className="bg-[var(--surface-secondary)] paper-texture">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-xl font-display text-[var(--text-primary)]">
          Experiment History
        </CardTitle>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={filterTestContent}
              onChange={(e) => setFilterTestContent(e.target.checked)}
              className="rounded"
            />
            Hide test content
          </label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as ExperimentFilter)}
            className="px-2 py-1 text-xs font-ui border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] text-[var(--text-primary)]"
          >
            <option value="non-archived">Active</option>
            <option value="archived">Cancelled</option>
            <option value="all">All</option>
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1 text-xs font-ui border border-[var(--border-default)] rounded-page text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] disabled:opacity-50 transition-colors"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && experiments.length === 0 ? (
          <div className="flex items-center gap-2 text-[var(--text-muted)] py-4">
            <div className="w-4 h-4 border-2 border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
            <span className="font-ui text-sm">Loading experiments...</span>
          </div>
        ) : experiments.length === 0 ? (
          <p className="text-sm font-body text-[var(--text-muted)] py-4">
            No experiments yet. Use the form above to start one.
          </p>
        ) : (
          <div className="space-y-2">
            {experiments.map((exp) => (
              <ExperimentRow key={exp.id} experiment={exp} onRefresh={load} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
