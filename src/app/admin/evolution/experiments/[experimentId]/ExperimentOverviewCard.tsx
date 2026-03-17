// Overview card for experiment detail page: name, ID, status, metrics, and cancel button.
// Uses V2 cancelExperimentAction and V2 experiment shape.

'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cancelExperimentAction } from '@evolution/services/experimentActionsV2';
import type { V2Experiment } from './ExperimentDetailContent';

const STATE_BADGES: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'var(--text-muted)' },
  running: { label: 'Running', color: 'var(--accent-gold)' },
  analyzing: { label: 'Analyzing', color: 'var(--accent-gold)' },
  completed: { label: 'Completed', color: 'var(--status-success)' },
  failed: { label: 'Failed', color: 'var(--status-error)' },
  cancelled: { label: 'Cancelled', color: 'var(--text-muted)' },
};

const ACTIVE_STATES = new Set(['pending', 'running', 'analyzing']);

function StatusBadge({ status }: { status: string }) {
  const badge = STATE_BADGES[status] ?? { label: status, color: 'var(--text-muted)' };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-xs font-ui font-medium rounded-full border"
      style={{ color: badge.color, borderColor: badge.color }}
      data-testid="status-badge"
    >
      {ACTIVE_STATES.has(status) && (
        <span
          className="w-1.5 h-1.5 rounded-full mr-1.5 animate-pulse"
          style={{ backgroundColor: badge.color }}
        />
      )}
      {badge.label}
    </span>
  );
}

interface ExperimentOverviewCardProps {
  experiment: V2Experiment;
}

export function ExperimentOverviewCard({ experiment }: ExperimentOverviewCardProps) {
  const [cancelling, setCancelling] = useState(false);
  const isActive = ACTIVE_STATES.has(experiment.status);

  const runs = experiment.evolution_runs ?? [];
  const completedRuns = runs.filter((r) => r.status === 'completed').length;
  const totalRuns = runs.length;

  const handleCancel = async () => {
    setCancelling(true);
    const result = await cancelExperimentAction({ experimentId: experiment.id });
    if (result.success) {
      toast.success('Experiment cancelled');
    } else {
      toast.error(result.error?.message ?? 'Failed to cancel');
    }
    setCancelling(false);
  };

  const handleCopyId = async () => {
    await navigator.clipboard.writeText(experiment.id);
    toast.success('Copied experiment ID');
  };

  return (
    <Card className="bg-[var(--surface-secondary)] paper-texture">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-xl font-display text-[var(--text-primary)]">
            {experiment.name}
          </CardTitle>
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge status={experiment.status} />
            <button
              onClick={handleCopyId}
              className="text-xs font-mono text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors cursor-pointer"
              title="Copy experiment ID"
              data-testid="experiment-id"
            >
              {experiment.id.slice(0, 8)}&hellip;
            </button>
          </div>
        </div>
        {isActive && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="px-3 py-1.5 text-sm font-ui border border-[var(--status-error)] text-[var(--status-error)] rounded-page hover:bg-[var(--status-error)]/10 disabled:opacity-50 transition-colors"
            data-testid="cancel-button"
          >
            {cancelling ? 'Cancelling...' : 'Cancel'}
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <span className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide">Runs</span>
            <p className="text-sm font-mono text-[var(--text-primary)]">
              {completedRuns}/{totalRuns}
            </p>
          </div>
          <div>
            <span className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide">Max Elo</span>
            <p className="text-sm font-mono text-[var(--text-primary)]">
              {experiment.metrics.maxElo != null ? String(experiment.metrics.maxElo) : '--'}
            </p>
          </div>
          <div>
            <span className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide">Total Cost</span>
            <p className="text-sm font-mono text-[var(--text-primary)]">
              ${experiment.metrics.totalCost.toFixed(2)}
            </p>
          </div>
          <div>
            <span className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide">Created</span>
            <p className="text-sm font-mono text-[var(--text-primary)]">
              {new Date(experiment.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
