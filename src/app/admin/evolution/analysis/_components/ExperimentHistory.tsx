'use client';
// Experiment history list with links to experiment detail pages and archive controls.

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  listExperimentsAction,
  archiveExperimentAction,
  unarchiveExperimentAction,
  renameExperimentAction,
} from '@evolution/services/experimentActions';
import type { ExperimentSummary } from '@evolution/services/experimentActions';
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

interface ExperimentRowProps {
  experiment: ExperimentSummary;
  onRefresh: () => void;
}

function ExperimentRow({ experiment, onRefresh }: ExperimentRowProps): JSX.Element {
  const [actionLoading, setActionLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(experiment.name);

  const handleRename = async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === experiment.name) {
      setEditing(false);
      return;
    }
    setActionLoading(true);
    const res = await renameExperimentAction({ experimentId: experiment.id, name: trimmed });
    if (res.success) {
      toast.success('Experiment renamed');
      setEditing(false);
      onRefresh();
    } else {
      toast.error(res.error?.message || 'Failed to rename');
    }
    setActionLoading(false);
  };

  const handleArchive = async () => {
    setActionLoading(true);
    const res = await archiveExperimentAction({ experimentId: experiment.id });
    if (res.success) {
      toast.success('Experiment archived');
      onRefresh();
    } else {
      toast.error(res.error?.message || 'Failed to archive');
    }
    setActionLoading(false);
  };

  const handleUnarchive = async () => {
    setActionLoading(true);
    const res = await unarchiveExperimentAction({ experimentId: experiment.id });
    if (res.success) {
      toast.success('Experiment restored');
      onRefresh();
    } else {
      toast.error(res.error?.message || 'Failed to unarchive');
    }
    setActionLoading(false);
  };

  return (
    <div className="border border-[var(--border-default)] rounded-page overflow-hidden" data-testid={`experiment-row-${experiment.id}`}>
      <div className="flex items-center justify-between p-3 hover:bg-[var(--surface-elevated)] transition-colors">
        <div className="flex items-center gap-3">
          <StatusDot status={experiment.status} />
          <div className="flex flex-col">
            {editing ? (
              <form
                onSubmit={(e) => { e.preventDefault(); handleRename(); }}
                className="flex items-center gap-1"
                data-testid={`rename-form-${experiment.id}`}
              >
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setEditing(false); setEditValue(experiment.name); } }}
                  className="px-1.5 py-0.5 text-sm font-ui border border-[var(--border-default)] rounded bg-[var(--surface-input)] text-[var(--text-primary)]"
                  autoFocus
                  disabled={actionLoading}
                  data-testid={`rename-input-${experiment.id}`}
                />
                <button type="submit" disabled={actionLoading} className="text-xs text-[var(--status-success)]" data-testid={`rename-save-${experiment.id}`}>Save</button>
                <button type="button" onClick={() => { setEditing(false); setEditValue(experiment.name); }} className="text-xs text-[var(--text-muted)]" data-testid={`rename-cancel-${experiment.id}`}>Cancel</button>
              </form>
            ) : (
              <span className="flex items-center gap-1">
                <Link
                  href={buildExperimentUrl(experiment.id)}
                  className="font-ui font-medium text-sm text-[var(--text-primary)] hover:text-[var(--accent-gold)] transition-colors"
                  data-testid={`experiment-link-${experiment.id}`}
                >
                  {experiment.name}
                </Link>
                <button
                  onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs"
                  title="Rename"
                  data-testid={`rename-pencil-${experiment.id}`}
                >
                  ✏️
                </button>
              </span>
            )}
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
              onClick={handleArchive}
              disabled={actionLoading}
              className="font-ui text-[var(--status-warning)] hover:text-[var(--status-error)] disabled:opacity-50"
              title="Archive"
            >
              Archive
            </button>
          )}
          {experiment.status === 'archived' && (
            <button
              onClick={handleUnarchive}
              disabled={actionLoading}
              className="font-ui text-[var(--status-success)] hover:text-[var(--text-primary)] disabled:opacity-50"
              title="Unarchive"
            >
              Unarchive
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

  const load = useCallback(async () => {
    setLoading(true);
    let params: { status?: string; includeArchived?: boolean } | undefined;
    if (filter === 'archived') {
      params = { status: 'archived' };
    } else if (filter === 'all') {
      params = { includeArchived: true };
    }
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
