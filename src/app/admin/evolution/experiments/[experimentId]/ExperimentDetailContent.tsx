// Client component for experiment detail: EntityDetailHeader + EntityDetailTabs.
// Renders overview metrics, analysis, and runs tabs. Uses V2 experiment actions.

'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { EntityDetailHeader, MetricGrid, EntityDetailTabs, useTabState } from '@evolution/components/evolution';
import { StatusBadge } from '@evolution/components/evolution/StatusBadge';
import { cancelExperimentAction } from '@evolution/services/experimentActionsV2';
import { ExperimentAnalysisCard } from './ExperimentAnalysisCard';
import { RelatedRunsTab } from '@evolution/components/evolution/tabs/RelatedRunsTab';
import { LogsTab } from '@evolution/components/evolution/tabs/LogsTab';

const ACTIVE_STATES = new Set(['pending', 'running', 'analyzing']);

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'runs', label: 'Runs' },
  { id: 'logs', label: 'Logs' },
];

/** V2 experiment shape from getExperimentAction. */
export interface V2Experiment {
  id: string;
  name: string;
  status: string;
  prompt_id: string;
  created_at: string;
  updated_at: string;
  evolution_runs: Array<{
    id: string;
    status?: string;
    [key: string]: unknown;
  }>;
  metrics: {
    maxElo: number | null;
    totalCost: number;
    runs: Array<{
      runId: string;
      elo: number | null;
      cost: number;
      eloPerDollar: number | null;
    }>;
  };
  [key: string]: unknown;
}

interface Props {
  experiment: V2Experiment;
}

export function ExperimentDetailContent({ experiment }: Props): JSX.Element {
  const [activeTab, setActiveTab] = useTabState(TABS);
  const [cancelling, setCancelling] = useState(false);
  const isActive = ACTIVE_STATES.has(experiment.status);

  const handleCancel = async () => {
    setCancelling(true);
    const result = await cancelExperimentAction({ experimentId: experiment.id });
    if (result.success) toast.success('Experiment cancelled');
    else toast.error(result.error?.message ?? 'Failed to cancel');
    setCancelling(false);
  };

  const runs = experiment.evolution_runs ?? [];
  const completedRuns = runs.filter((r) => r.status === 'completed').length;
  const totalRuns = runs.length;

  return (
    <>
      <EntityDetailHeader
        title={experiment.name}
        entityId={experiment.id}
        links={[]}
        statusBadge={
          <StatusBadge variant="experiment-status" status={experiment.status} badgeStyle="outlined" pulse={ACTIVE_STATES.has(experiment.status)} />
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
                { label: 'Runs', value: `${completedRuns}/${totalRuns}` },
                { label: 'Max Elo', value: experiment.metrics.maxElo != null ? String(experiment.metrics.maxElo) : '--' },
                { label: 'Total Cost', value: `$${experiment.metrics.totalCost.toFixed(2)}` },
                { label: 'Created', value: new Date(experiment.created_at).toLocaleDateString() },
              ]}
            />
          </div>
        )}
        {activeTab === 'analysis' && <ExperimentAnalysisCard experiment={experiment} />}
        {activeTab === 'runs' && <RelatedRunsTab experimentId={experiment.id} />}
        {activeTab === 'logs' && <LogsTab entityType="experiment" entityId={experiment.id} />}
      </EntityDetailTabs>
    </>
  );
}
