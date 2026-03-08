// Client component for strategy detail: EntityDetailHeader + EntityDetailTabs.
// Renders overview metrics, config, aggregate metrics, and related runs tabs.

'use client';

import { EntityDetailHeader, MetricGrid, EntityDetailTabs, useTabState } from '@evolution/components/evolution';
import { StrategyConfigDisplay } from '../../analysis/_components/StrategyConfigDisplay';
import { StrategyMetricsSection } from './StrategyMetricsSection';
import { RelatedRunsTab } from '@evolution/components/evolution/tabs/RelatedRunsTab';
import type { StrategyConfigRow } from '@evolution/lib/core/strategyConfig';
import type { StrategyRunEntry } from '@evolution/services/eloBudgetActions';

const STATUS_COLORS: Record<string, string> = {
  active: 'var(--status-success)',
  archived: 'var(--text-muted)',
};

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'config', label: 'Config' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'runs', label: 'Runs' },
];

interface Props {
  strategy: StrategyConfigRow;
  runs: StrategyRunEntry[];
  strategyId: string;
}

export function StrategyDetailContent({ strategy, runs, strategyId }: Props): JSX.Element {
  const [activeTab, setActiveTab] = useTabState(TABS);

  const statusColor = STATUS_COLORS[strategy.status] ?? 'var(--text-muted)';
  const runsWithElo = runs.filter(r => r.finalElo != null);
  const avgElo = runsWithElo.length > 0
    ? runsWithElo.reduce((s, r) => s + (r.finalElo ?? 0), 0) / runsWithElo.length
    : 0;
  const totalCost = runs.reduce((s, r) => s + r.totalCostUsd, 0);
  const avgCost = runs.length > 0 ? totalCost / runs.length : 0;

  return (
    <>
      <EntityDetailHeader
        title={strategy.name ?? strategy.label}
        entityId={strategyId}
        statusBadge={
          <span
            className="inline-flex items-center px-2 py-0.5 text-xs font-ui font-medium rounded-full border"
            style={{ color: statusColor, borderColor: statusColor }}
            data-testid="status-badge"
          >
            {strategy.status}
          </span>
        }
      />
      <EntityDetailTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <MetricGrid
              columns={5}
              metrics={[
                { label: 'Runs', value: String(strategy.run_count ?? runs.length) },
                { label: 'Avg Elo', value: runsWithElo.length > 0 ? avgElo.toFixed(0) : '—' },
                { label: 'Total Cost', value: `$${totalCost.toFixed(2)}` },
                { label: 'Avg $/Run', value: `$${avgCost.toFixed(3)}` },
                { label: 'Created By', value: strategy.created_by ?? 'system' },
              ]}
            />
            {strategy.description && (
              <p className="text-sm font-body text-[var(--text-secondary)]">{strategy.description}</p>
            )}
          </div>
        )}
        {activeTab === 'config' && (
          <div className="bg-[var(--surface-secondary)] paper-texture rounded-book p-6">
            <StrategyConfigDisplay config={strategy.config} />
          </div>
        )}
        {activeTab === 'metrics' && (
          <div className="bg-[var(--surface-secondary)] paper-texture rounded-book p-6">
            <StrategyMetricsSection strategyConfigId={strategyId} />
          </div>
        )}
        {activeTab === 'runs' && <RelatedRunsTab strategyId={strategyId} />}
      </EntityDetailTabs>
    </>
  );
}
