'use client';
// Admin page for viewing and managing evolution pipeline runs.

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import {
  getEvolutionRunsAction,
  killEvolutionRunAction,
  type EvolutionRun,
} from '@evolution/services/evolutionActions';
import { triggerEvolutionRun } from '@evolution/services/evolutionRunClient';
import type { EvolutionRunStatus } from '@evolution/lib/types';
import Link from 'next/link';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { RunsTable, getBaseColumns, type RunsColumnDef } from '@evolution/components/evolution/RunsTable';
import { buildExplanationUrl, buildRunUrl, buildExperimentUrl, buildStrategyUrl } from '@evolution/lib/utils/evolutionUrls';

type DateRange = '7d' | '30d' | '90d' | 'all';

const DATE_RANGE_DAYS: Record<DateRange, number | null> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: null,
};

function getStartDate(range: DateRange): string | undefined {
  const days = DATE_RANGE_DAYS[range];
  if (days === null) return undefined;
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function getEstimateAccuracyColor(run: EvolutionRun): string {
  if (run.status !== 'completed' || (run.total_cost_usd ?? 0) === 0) {
    return 'text-[var(--text-muted)]';
  }

  const estimated = run.estimated_cost_usd ?? 0;
  const deviationRatio = Math.abs((run.total_cost_usd ?? 0) - estimated) / Math.max(estimated, 0.001);

  if (deviationRatio <= 0.1) return 'text-[var(--status-success)]';
  if (deviationRatio <= 0.3) return 'text-[var(--accent-gold)]';
  return 'text-[var(--status-error)]';
}

const BASE_COLUMNS = getBaseColumns<EvolutionRun>();

const EVOLUTION_COLUMNS: RunsColumnDef<EvolutionRun>[] = [
  {
    key: 'runId',
    header: 'Run ID',
    render: (run) => (
      <Link
        href={buildRunUrl(run.id)}
        className="font-mono text-xs text-[var(--accent-gold)] hover:underline"
        title={run.id}
        onClick={(e) => e.stopPropagation()}
      >
        {run.id.substring(0, 8)}
      </Link>
    ),
  },
  {
    key: 'explanation',
    header: 'Explanation',
    render: (run) => run.explanation_id ? (
      <Link
        href={buildExplanationUrl(run.explanation_id)}
        className="font-mono text-xs text-[var(--accent-gold)] hover:underline"
        onClick={(e) => e.stopPropagation()}
        title={`View explanation #${run.explanation_id}`}
      >
        #{run.explanation_id}
      </Link>
    ) : (
      <span className="text-[var(--text-muted)]">&mdash;</span>
    ),
  },
  {
    key: 'experiment',
    header: 'Experiment',
    render: (run) => run.experiment_name && run.experiment_id ? (
      <Link
        href={buildExperimentUrl(run.experiment_id)}
        className="text-xs text-[var(--accent-gold)] hover:underline truncate max-w-[120px] block"
        onClick={(e) => e.stopPropagation()}
        title={run.experiment_name}
      >
        {run.experiment_name}
      </Link>
    ) : (
      <span className="text-[var(--text-muted)]">&mdash;</span>
    ),
  },
  {
    key: 'strategy',
    header: 'Strategy',
    render: (run) => run.strategy_name && run.strategy_config_id ? (
      <Link
        href={buildStrategyUrl(run.strategy_config_id)}
        className="text-xs text-[var(--accent-gold)] hover:underline truncate max-w-[120px] block"
        onClick={(e) => e.stopPropagation()}
        title={run.strategy_name}
      >
        {run.strategy_name}
      </Link>
    ) : (
      <span className="text-[var(--text-muted)]">&mdash;</span>
    ),
  },
  BASE_COLUMNS.find(c => c.key === 'status')!,
  BASE_COLUMNS.find(c => c.key === 'phase')!,
  { key: 'variants', header: 'Variants', align: 'right', render: (run) => <span>{run.total_variants}</span> },
  BASE_COLUMNS.find(c => c.key === 'cost')!,
  {
    key: 'estimate',
    header: 'Est.',
    align: 'right',
    render: (run) => run.estimated_cost_usd != null ? (
      <span className={`font-mono ${getEstimateAccuracyColor(run)}`}>
        ${run.estimated_cost_usd.toFixed(2)}
      </span>
    ) : (
      <span className="text-[var(--text-muted)]">&mdash;</span>
    ),
  },
  {
    key: 'budget',
    header: 'Budget',
    align: 'right',
    render: (run) => <span className="text-[var(--text-muted)]">${(run.budget_cap_usd ?? 0).toFixed(2)}</span>,
  },
  BASE_COLUMNS.find(c => c.key === 'duration')!,
  {
    key: 'created',
    header: 'Created',
    render: (run) => (
      <span className="text-[var(--text-muted)] text-xs">
        {new Date(run.created_at).toLocaleDateString()}{' '}
        <span className="opacity-70">
          {new Date(run.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </span>
    ),
  },
];

export default function EvolutionRunsPage(): JSX.Element {
  const [runs, setRuns] = useState<EvolutionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<EvolutionRunStatus | ''>('');
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [showArchived, setShowArchived] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await getEvolutionRunsAction({
      status: statusFilter || undefined,
      startDate: getStartDate(dateRange),
      includeArchived: showArchived,
    });

    if (result.success && result.data) {
      setRuns(result.data);
    } else {
      setError(result.error?.message || 'Failed to load runs');
    }
    setLoading(false);
  }, [statusFilter, dateRange, showArchived]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const handleTrigger = async (runId: string): Promise<void> => {
    setActionLoading(true);
    try {
      const result = await triggerEvolutionRun(runId);
      if (result.claimed) {
        toast.success('Evolution run triggered');
      } else {
        toast.info('Run was already claimed — cron will handle it');
      }
      loadRuns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to trigger run');
    }
    setActionLoading(false);
  };

  const handleKill = async (runId: string): Promise<void> => {
    setActionLoading(true);
    try {
      const result = await killEvolutionRunAction(runId);
      if (result.success) {
        toast.success('Run killed');
        loadRuns();
      } else {
        toast.error(result.error?.message || 'Failed to kill run');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to kill run');
    }
    setActionLoading(false);
  };

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Dashboard', href: '/admin/evolution-dashboard' },
        { label: 'Runs' },
      ]} />

      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
            Pipeline Runs
          </h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            View and manage evolution pipeline runs
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DateRange)}
            data-testid="evolution-date-filter"
            className="relative z-10 px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] text-[var(--text-primary)]"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as EvolutionRunStatus | '')}
            data-testid="evolution-status-filter"
            className="relative z-10 px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] text-[var(--text-primary)]"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="continuation_pending">Resuming</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="paused">Paused</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs font-ui text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="rounded"
            />
            Show archived
          </label>
          <button
            onClick={loadRuns}
            disabled={loading}
            className="px-4 py-2 font-ui text-sm border border-[var(--border-default)] rounded-page text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] disabled:opacity-50 transition-scholar"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)] rounded-page text-[var(--status-error)]">
          {error}
        </div>
      )}

      <RunsTable<EvolutionRun>
        runs={runs}
        columns={EVOLUTION_COLUMNS}
        loading={loading}
        renderActions={(run) => (
          <div className="flex gap-2">
            {run.status === 'pending' && (
              <button
                onClick={() => handleTrigger(run.id)}
                disabled={actionLoading}
                data-testid={`trigger-run-${run.id}`}
                className="text-[var(--accent-gold)] hover:underline text-xs disabled:opacity-50"
              >
                Trigger
              </button>
            )}
            {['pending', 'claimed', 'running', 'continuation_pending'].includes(run.status) && (
              <button
                onClick={() => handleKill(run.id)}
                disabled={actionLoading}
                data-testid={`kill-run-${run.id}`}
                className="text-[var(--status-error)] hover:underline text-xs disabled:opacity-50"
              >
                Kill
              </button>
            )}
            {run.error_message && (
              <span className="text-[var(--status-error)] text-xs truncate max-w-[150px]" title={run.error_message}>
                {run.error_message}
              </span>
            )}
          </div>
        )}
        testId="evolution-runs-table"
      />
    </div>
  );
}
