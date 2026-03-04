// Overview card for experiment detail page: name, ID, status, budget, factors, run counts.
// Reuses StatusBadge and ProgressBar patterns from ExperimentStatusCard.

'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { cancelExperimentAction } from '@evolution/services/experimentActions';
import type { ExperimentStatus } from '@evolution/services/experimentActions';
import { buildArenaTopicUrl } from '@evolution/lib/utils/evolutionUrls';

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

function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs font-ui text-[var(--text-muted)] mb-1">
        <span>{label}</span>
        <span>${value.toFixed(2)} / ${max.toFixed(2)}</span>
      </div>
      <div className="w-full h-2 bg-[var(--surface-primary)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: 'var(--accent-gold)' }}
        />
      </div>
    </div>
  );
}

interface ExperimentOverviewCardProps {
  status: ExperimentStatus;
}

export function ExperimentOverviewCard({ status }: ExperimentOverviewCardProps) {
  const [cancelling, setCancelling] = useState(false);
  const isActive = ACTIVE_STATES.has(status.status);

  const handleCancel = async () => {
    setCancelling(true);
    const result = await cancelExperimentAction({ experimentId: status.id });
    if (result.success) {
      toast.success('Experiment cancelled');
    } else {
      toast.error(result.error?.message ?? 'Failed to cancel');
    }
    setCancelling(false);
  };

  const handleCopyId = async () => {
    await navigator.clipboard.writeText(status.id);
    toast.success('Copied experiment ID');
  };

  const factorEntries = Object.entries(status.factorDefinitions ?? {});

  return (
    <Card className="bg-[var(--surface-secondary)] paper-texture">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-xl font-display text-[var(--text-primary)]">
            {status.name}
          </CardTitle>
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge status={status.status} />
            <button
              onClick={handleCopyId}
              className="text-xs font-mono text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors cursor-pointer"
              title="Copy experiment ID"
              data-testid="experiment-id"
            >
              {status.id.slice(0, 8)}&hellip;
            </button>
            <Link
              href={buildArenaTopicUrl(status.promptId)}
              className="text-xs font-ui text-[var(--accent-gold)] hover:underline"
              data-testid="prompt-link"
            >
              {status.promptTitle.length > 60 ? status.promptTitle.slice(0, 60) + '...' : status.promptTitle}
            </Link>
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
        <ProgressBar value={status.spentUsd} max={status.totalBudgetUsd} label="Budget" />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <span className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide">Runs</span>
            <p className="text-sm font-mono text-[var(--text-primary)]">
              {status.runCounts.completed}/{status.runCounts.total}
            </p>
          </div>
          <div>
            <span className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide">Target</span>
            <p className="text-sm font-mono text-[var(--text-primary)]">{status.optimizationTarget}</p>
          </div>
          <div>
            <span className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide">Convergence</span>
            <p className="text-sm font-mono text-[var(--text-primary)]">{status.convergenceThreshold}</p>
          </div>
          <div>
            <span className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide">Created</span>
            <p className="text-sm font-mono text-[var(--text-primary)]">
              {new Date(status.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        {factorEntries.length > 0 && (
          <div>
            <h4 className="text-lg font-display font-medium text-[var(--text-secondary)] mb-2">Factors</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-ui" data-testid="factor-table">
                <thead>
                  <tr className="text-[var(--text-muted)] border-b border-[var(--border-default)]">
                    <th className="text-left py-1 pr-4">Factor</th>
                    <th className="text-left py-1 pr-4">Low</th>
                    <th className="text-left py-1">High</th>
                  </tr>
                </thead>
                <tbody>
                  {factorEntries.map(([key, def]) => (
                    <tr key={key} className="border-b border-[var(--border-default)] last:border-0">
                      <td className="py-1.5 pr-4 font-medium text-[var(--text-primary)]">{key}</td>
                      <td className="py-1.5 pr-4 font-mono text-[var(--text-secondary)]">{String(def.low)}</td>
                      <td className="py-1.5 font-mono text-[var(--text-secondary)]">{String(def.high)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {status.errorMessage && (
          <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)] rounded-page text-[var(--status-error)] text-xs font-body">
            {status.errorMessage}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
