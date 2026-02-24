'use client';
/**
 * Status card for an active or completed experiment.
 * Shows state badge, round progress, budget usage, and cancel button.
 */

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getExperimentStatusAction,
  cancelExperimentAction,
} from '@evolution/services/experimentActions';
import type { ExperimentStatus } from '@evolution/services/experimentActions';

const STATE_BADGES: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'var(--text-muted)' },
  round_running: { label: 'Running', color: 'var(--accent-gold)' },
  round_analyzing: { label: 'Analyzing', color: 'var(--accent-gold)' },
  pending_next_round: { label: 'Next Round', color: 'var(--accent-gold)' },
  converged: { label: 'Converged', color: 'var(--status-success)' },
  budget_exhausted: { label: 'Budget Exhausted', color: 'var(--accent-gold)' },
  max_rounds: { label: 'Max Rounds', color: 'var(--accent-gold)' },
  failed: { label: 'Failed', color: 'var(--status-error)' },
  cancelled: { label: 'Cancelled', color: 'var(--text-muted)' },
};

const ACTIVE_STATES = new Set(['pending', 'round_running', 'round_analyzing', 'pending_next_round']);

function StatusBadge({ status }: { status: string }) {
  const badge = STATE_BADGES[status] ?? { label: status, color: 'var(--text-muted)' };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-xs font-ui font-medium rounded-full border"
      style={{ color: badge.color, borderColor: badge.color }}
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

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="w-full h-2 bg-[var(--surface-primary)] rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

interface ExperimentStatusCardProps {
  experimentId: string;
  onCancelled?: () => void;
}

export function ExperimentStatusCard({ experimentId, onCancelled }: ExperimentStatusCardProps) {
  const [status, setStatus] = useState<ExperimentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  const loadStatus = useCallback(async () => {
    const result = await getExperimentStatusAction({ experimentId });
    if (result.success && result.data) {
      setStatus(result.data);
    }
    setLoading(false);
  }, [experimentId]);

  // Initial load
  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Auto-refresh for active experiments (15s interval)
  const statusValue = status?.status;
  useEffect(() => {
    if (!statusValue || !ACTIVE_STATES.has(statusValue)) return;
    const interval = setInterval(loadStatus, 15000);
    return () => clearInterval(interval);
  }, [statusValue, loadStatus]);

  const handleCancel = async () => {
    if (!status) return;
    setCancelling(true);
    const result = await cancelExperimentAction({ experimentId });
    if (result.success) {
      toast.success('Experiment cancelled');
      onCancelled?.();
      loadStatus();
    } else {
      toast.error(result.error?.message ?? 'Failed to cancel');
    }
    setCancelling(false);
  };

  if (loading) {
    return (
      <Card className="bg-[var(--surface-secondary)] paper-texture">
        <CardContent className="p-8">
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <div className="w-4 h-4 border-2 border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
            <span className="font-ui">Loading experiment...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!status) return null;

  const currentRound = status.rounds.find(r => r.status === 'running') ?? status.rounds[status.rounds.length - 1];
  const isActive = ACTIVE_STATES.has(status.status);

  return (
    <Card className="bg-[var(--surface-secondary)] paper-texture">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-xl font-display text-[var(--text-primary)]">
            {status.name}
          </CardTitle>
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge status={status.status} />
            <span className="text-xs font-ui text-[var(--text-muted)]">
              Round {status.currentRound} / {status.maxRounds}
            </span>
          </div>
        </div>
        {isActive && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="px-3 py-1.5 text-sm font-ui border border-[var(--status-error)] text-[var(--status-error)] rounded-page hover:bg-[var(--status-error)]/10 disabled:opacity-50 transition-colors"
          >
            {cancelling ? 'Cancelling...' : 'Cancel'}
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Budget progress */}
        <div>
          <div className="flex justify-between text-xs font-ui text-[var(--text-muted)] mb-1">
            <span>Budget</span>
            <span>${status.spentUsd.toFixed(2)} / ${status.totalBudgetUsd.toFixed(2)}</span>
          </div>
          <ProgressBar
            value={status.spentUsd}
            max={status.totalBudgetUsd}
            color="var(--accent-gold)"
          />
        </div>

        {/* Current round progress */}
        {currentRound && (
          <div>
            <div className="flex justify-between text-xs font-ui text-[var(--text-muted)] mb-1">
              <span>Current Round Runs</span>
              <span>
                {currentRound.runCounts.completed} / {currentRound.runCounts.total}
                {currentRound.runCounts.failed > 0 && (
                  <span className="text-[var(--status-error)]"> ({currentRound.runCounts.failed} failed)</span>
                )}
              </span>
            </div>
            <ProgressBar
              value={currentRound.runCounts.completed}
              max={currentRound.runCounts.total}
              color="var(--status-success)"
            />
          </div>
        )}

        {/* Rounds summary */}
        <div>
          <h4 className="text-lg font-display font-medium text-[var(--text-secondary)] mb-2">Rounds</h4>
          <div className="space-y-1">
            {status.rounds.map((round) => (
              <div
                key={round.roundNumber}
                className="flex items-center justify-between text-xs font-ui p-2 rounded bg-[var(--surface-primary)]"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[var(--text-primary)]">
                    Round {round.roundNumber}
                  </span>
                  <span className="text-[var(--text-muted)]">
                    {round.type} ({round.design})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[var(--text-secondary)]">
                    {round.runCounts.completed}/{round.runCounts.total}
                  </span>
                  <StatusBadge status={round.status} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Results summary */}
        {status.resultsSummary && (
          <div>
            <h4 className="text-lg font-display font-medium text-[var(--text-secondary)] mb-2">Results</h4>
            <div className="p-3 rounded bg-[var(--surface-primary)] text-xs font-mono text-[var(--text-secondary)]">
              <pre className="overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(status.resultsSummary, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {/* Error message */}
        {status.errorMessage && (
          <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)] rounded-page text-[var(--status-error)] text-xs font-body">
            {status.errorMessage}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
