// Experiment history list with expandable run counts and results.
// Fetches experiments via listExperimentsAction and renders as collapsible cards.

'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  listExperimentsAction,
  getExperimentStatusAction,
  archiveExperimentAction,
  unarchiveExperimentAction,
} from '@evolution/services/experimentActions';
import type { ExperimentSummary, ExperimentStatus } from '@evolution/services/experimentActions';
import { buildExperimentUrl } from '@evolution/lib/utils/evolutionUrls';
import { toast } from 'sonner';

type ExperimentFilter = 'non-archived' | 'archived' | 'all';

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

const STATE_COLORS: Record<string, string> = {
  pending: 'var(--text-muted)',
  running: 'var(--accent-gold)',
  analyzing: 'var(--accent-gold)',
  completed: 'var(--status-success)',
  failed: 'var(--status-error)',
  cancelled: 'var(--text-muted)',
  archived: 'var(--text-muted)',
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

function ExperimentRow({ experiment, onRefresh }: { experiment: ExperimentSummary; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ExperimentStatus | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const loadDetail = useCallback(async () => {
    setDetailLoading(true);
    const result = await getExperimentStatusAction({ experimentId: experiment.id });
    if (result.success && result.data) {
      setDetail(result.data);
    }
    setDetailLoading(false);
  }, [experiment.id]);

  useEffect(() => {
    if (expanded && !detail) loadDetail();
  }, [expanded, detail, loadDetail]);

  return (
    <div className="border border-[var(--border-default)] rounded-page overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-[var(--surface-elevated)] transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <StatusDot status={experiment.status} />
          <div className="flex flex-col">
            <Link
              href={buildExperimentUrl(experiment.id)}
              className="font-ui font-medium text-sm text-[var(--text-primary)] hover:text-[var(--accent-gold)] transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {experiment.name}
            </Link>
            <span className="text-xs font-mono text-[var(--text-muted)]">
              {experiment.id.slice(0, 8)}&hellip;
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono text-[var(--text-secondary)]">
          <span>${experiment.spentUsd.toFixed(2)} / ${experiment.totalBudgetUsd.toFixed(2)}</span>
          <span className="text-[var(--text-muted)]">
            {new Date(experiment.createdAt).toLocaleDateString()}
          </span>
          {TERMINAL_STATUSES.includes(experiment.status) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setActionLoading(true);
                archiveExperimentAction({ experimentId: experiment.id }).then((res) => {
                  if (res.success) { toast.success('Experiment archived'); onRefresh(); }
                  else toast.error(res.error?.message || 'Failed to archive');
                  setActionLoading(false);
                });
              }}
              disabled={actionLoading}
              className="font-ui text-[var(--status-warning)] hover:text-[var(--status-error)] disabled:opacity-50"
              title="Archive"
            >
              Archive
            </button>
          )}
          {experiment.status === 'archived' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setActionLoading(true);
                unarchiveExperimentAction({ experimentId: experiment.id }).then((res) => {
                  if (res.success) { toast.success('Experiment restored'); onRefresh(); }
                  else toast.error(res.error?.message || 'Failed to unarchive');
                  setActionLoading(false);
                });
              }}
              disabled={actionLoading}
              className="font-ui text-[var(--status-success)] hover:text-[var(--text-primary)] disabled:opacity-50"
              title="Unarchive"
            >
              Unarchive
            </button>
          )}
          <span className="text-[var(--text-muted)]">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border-default)] p-3 bg-[var(--surface-elevated)]">
          {detailLoading ? (
            <div className="flex items-center gap-2 text-[var(--text-muted)] text-xs">
              <div className="w-3 h-3 border border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
              Loading details...
            </div>
          ) : detail ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-ui p-2 rounded bg-[var(--surface-primary)]">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[var(--text-primary)]">Runs</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[var(--text-secondary)]">
                    {detail.runCounts.completed}/{detail.runCounts.total} completed
                  </span>
                  {detail.runCounts.failed > 0 && (
                    <span className="text-[var(--status-error)]">
                      {detail.runCounts.failed} failed
                    </span>
                  )}
                  {detail.runCounts.pending > 0 && (
                    <span className="text-[var(--text-muted)]">
                      {detail.runCounts.pending} pending
                    </span>
                  )}
                </div>
              </div>
              {detail.resultsSummary && (
                <div className="mt-2 p-2 rounded bg-[var(--surface-primary)] text-xs font-mono text-[var(--text-secondary)]">
                  <pre className="overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(detail.resultsSummary, null, 2)}
                  </pre>
                </div>
              )}
              {detail.errorMessage && (
                <div className="text-xs text-[var(--status-error)] font-body mt-1">
                  {detail.errorMessage}
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-[var(--text-muted)]">Failed to load details</div>
          )}
        </div>
      )}
    </div>
  );
}

export function ExperimentHistory() {
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ExperimentFilter>('non-archived');

  const load = useCallback(async () => {
    setLoading(true);
    const params = filter === 'archived'
      ? { status: 'archived' }
      : filter === 'all'
        ? { includeArchived: true }
        : undefined;
    const result = await listExperimentsAction(params);
    if (result.success && result.data) {
      setExperiments(result.data);
    }
    setLoading(false);
  }, [filter]);

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
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as ExperimentFilter)}
            className="px-2 py-1 text-xs font-ui border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] text-[var(--text-primary)]"
          >
            <option value="non-archived">Active</option>
            <option value="archived">Archived</option>
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
