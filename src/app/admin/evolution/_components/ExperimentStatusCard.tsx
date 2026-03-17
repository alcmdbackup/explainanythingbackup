'use client';
/**
 * Status card for an active or completed experiment.
 * Shows state badge, run progress, and cancel button. Uses V2 experiment actions.
 */

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getExperimentAction,
  cancelExperimentAction,
} from '@evolution/services/experimentActionsV2';

interface ExperimentStatus {
  id: string;
  name: string;
  status: string;
  runCounts: { total: number; completed: number; failed: number };
  totalCost: number;
  maxElo: number | null;
}

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
    const result = await getExperimentAction({ experimentId });
    if (result.success && result.data) {
      const exp = result.data;
      const runs = Array.isArray(exp.evolution_runs) ? exp.evolution_runs : [];
      setStatus({
        id: exp.id,
        name: exp.name,
        status: exp.status,
        runCounts: {
          total: runs.length,
          completed: runs.filter((r: Record<string, unknown>) => r.status === 'completed').length,
          failed: runs.filter((r: Record<string, unknown>) => r.status === 'failed').length,
        },
        totalCost: exp.metrics?.totalCost ?? 0,
        maxElo: exp.metrics?.maxElo ?? null,
      });
    }
    setLoading(false);
  }, [experimentId]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

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
              {status.runCounts.completed}/{status.runCounts.total} runs
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
        {/* Run progress */}
        <div>
          <div className="flex justify-between text-xs font-ui text-[var(--text-muted)] mb-1">
            <span>Runs</span>
            <span>
              {status.runCounts.completed} / {status.runCounts.total}
              {status.runCounts.failed > 0 && (
                <span className="text-[var(--status-error)]"> ({status.runCounts.failed} failed)</span>
              )}
            </span>
          </div>
          <ProgressBar
            value={status.runCounts.completed}
            max={status.runCounts.total}
            color="var(--status-success)"
          />
        </div>

        {/* Summary metrics */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide">Total Cost</span>
            <p className="text-sm font-mono text-[var(--text-primary)]">${status.totalCost.toFixed(2)}</p>
          </div>
          <div>
            <span className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide">Max Elo</span>
            <p className="text-sm font-mono text-[var(--text-primary)]">
              {status.maxElo != null ? String(status.maxElo) : '--'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
