// Client component for experiment detail: EntityDetailHeader + EntityDetailTabs.
// Renders overview metrics, analysis, runs, report tabs.

'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { EntityDetailHeader, MetricGrid, EntityDetailTabs, useTabState } from '@evolution/components/evolution';
import { buildArenaTopicUrl } from '@evolution/lib/utils/evolutionUrls';
import { cancelExperimentAction, renameExperimentAction, type ExperimentStatus } from '@evolution/services/experimentActions';
import { ExperimentAnalysisCard } from './ExperimentAnalysisCard';
import { RelatedRunsTab } from '@evolution/components/evolution/tabs/RelatedRunsTab';
import { ReportTab } from './ReportTab';
import type { EntityLink } from '@evolution/components/evolution/EntityDetailHeader';

const ACTIVE_STATES = new Set(['pending', 'running', 'analyzing']);

const STATE_BADGES: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'var(--text-muted)' },
  running: { label: 'Running', color: 'var(--accent-gold)' },
  analyzing: { label: 'Analyzing', color: 'var(--accent-gold)' },
  completed: { label: 'Completed', color: 'var(--status-success)' },
  failed: { label: 'Failed', color: 'var(--status-error)' },
  cancelled: { label: 'Cancelled', color: 'var(--text-muted)' },
};

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'runs', label: 'Runs' },
  { id: 'report', label: 'Report' },
];

interface Props {
  status: ExperimentStatus;
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

export function ExperimentDetailContent({ status }: Props): JSX.Element {
  const [activeTab, setActiveTab] = useTabState(TABS);
  const [cancelling, setCancelling] = useState(false);
  const [displayName, setDisplayName] = useState(status.name);
  const isActive = ACTIVE_STATES.has(status.status);

  const handleCancel = async () => {
    setCancelling(true);
    const result = await cancelExperimentAction({ experimentId: status.id });
    if (result.success) toast.success('Experiment cancelled');
    else toast.error(result.error?.message ?? 'Failed to cancel');
    setCancelling(false);
  };

  const handleRename = async (newName: string) => {
    const result = await renameExperimentAction({ experimentId: status.id, name: newName });
    if (result.success && result.data) {
      setDisplayName(result.data.name);
      toast.success('Experiment renamed');
    } else {
      toast.error(result.error?.message ?? 'Failed to rename');
      throw new Error(result.error?.message ?? 'Failed to rename');
    }
  };

  const badge = STATE_BADGES[status.status] ?? { label: status.status, color: 'var(--text-muted)' };

  const links: EntityLink[] = [
    { prefix: 'Prompt', label: status.promptTitle.length > 40 ? status.promptTitle.slice(0, 40) + '...' : status.promptTitle, href: buildArenaTopicUrl(status.promptId) },
  ];

  const factorEntries = Object.entries(status.factorDefinitions ?? {});

  return (
    <>
      <EntityDetailHeader
        title={displayName}
        entityId={status.id}
        links={links}
        onRename={handleRename}
        statusBadge={
          <span
            className="inline-flex items-center px-2 py-0.5 text-xs font-ui font-medium rounded-full border"
            style={{ color: badge.color, borderColor: badge.color }}
            data-testid="status-badge"
          >
            {ACTIVE_STATES.has(status.status) && (
              <span className="w-1.5 h-1.5 rounded-full mr-1.5 animate-pulse" style={{ backgroundColor: badge.color }} />
            )}
            {badge.label}
          </span>
        }
        actions={
          isActive ? (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="px-3 py-1.5 text-sm font-ui border border-[var(--status-error)] text-[var(--status-error)] rounded-page hover:bg-[var(--status-error)]/10 disabled:opacity-50 transition-colors"
              data-testid="cancel-button"
            >
              {cancelling ? 'Cancelling...' : 'Cancel'}
            </button>
          ) : undefined
        }
      />
      <EntityDetailTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <MetricGrid
              columns={4}
              metrics={[
                { label: 'Runs', value: `${status.runCounts.completed}/${status.runCounts.total}` },
                { label: 'Budget', value: `$${status.totalBudgetUsd.toFixed(2)}` },
                { label: 'Convergence', value: status.convergenceThreshold },
                { label: 'Created', value: new Date(status.createdAt).toLocaleDateString() },
              ]}
            />
            <ProgressBar value={status.spentUsd} max={status.totalBudgetUsd} label="Budget" />
            {status.design !== 'manual' && factorEntries.length > 0 && (
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
                      {factorEntries.map(([key, def]) => {
                        const d = def as Record<string, unknown>;
                        return (
                          <tr key={key} className="border-b border-[var(--border-default)] last:border-0">
                            <td className="py-1.5 pr-4 font-medium text-[var(--text-primary)]">{key}</td>
                            <td className="py-1.5 pr-4 font-mono text-[var(--text-secondary)]">{String(d.low)}</td>
                            <td className="py-1.5 font-mono text-[var(--text-secondary)]">{String(d.high)}</td>
                          </tr>
                        );
                      })}
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
          </div>
        )}
        {activeTab === 'analysis' && <ExperimentAnalysisCard experiment={status} />}
        {activeTab === 'runs' && <RelatedRunsTab experimentId={status.id} />}
        {activeTab === 'report' && (
          <ReportTab
            experimentId={status.id}
            status={status.status}
            resultsSummary={status.resultsSummary}
          />
        )}
      </EntityDetailTabs>
    </>
  );
}
