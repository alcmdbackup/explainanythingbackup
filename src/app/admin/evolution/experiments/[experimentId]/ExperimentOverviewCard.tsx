// Overview card for experiment detail page: name, ID, status, metrics, and cancel button.
// Uses V2 cancelExperimentAction and V2 experiment shape.

'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cancelExperimentAction } from '@evolution/services/experimentActions';
import { StatusBadge } from '@evolution/components/evolution/StatusBadge';
import { MetricGrid } from '@evolution/components/evolution';
import type { V2Experiment } from './ExperimentDetailContent';

const ACTIVE_STATES = new Set(['pending', 'running', 'analyzing']);

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
            <StatusBadge variant="experiment-status" status={experiment.status} badgeStyle="outlined" pulse={ACTIVE_STATES.has(experiment.status)} />
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
        <MetricGrid
          columns={4}
          metrics={[
            { label: 'Runs', value: `${completedRuns}/${totalRuns}` },
            { label: 'Max Elo', value: experiment.metrics.maxElo != null ? String(experiment.metrics.maxElo) : '--' },
            { label: 'Total Cost', value: `$${experiment.metrics.totalCost.toFixed(2)}` },
            { label: 'Created', value: new Date(experiment.created_at).toLocaleDateString() },
          ]}
        />
      </CardContent>
    </Card>
  );
}
