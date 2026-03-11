// Client component for strategy detail: EntityDetailHeader + EntityDetailTabs.
// Renders overview metrics, config, aggregate metrics, and related runs tabs.

'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { EntityDetailHeader, MetricGrid, EntityDetailTabs, useTabState } from '@evolution/components/evolution';
import { StrategyConfigDisplay } from '../../analysis/_components/StrategyConfigDisplay';
import { StrategyMetricsSection } from './StrategyMetricsSection';
import { RelatedRunsTab } from '@evolution/components/evolution/tabs/RelatedRunsTab';
import { updateStrategyAction } from '@evolution/services/strategyRegistryActions';
import type { StrategyConfigRow } from '@evolution/lib/core/strategyConfig';
import type { StrategyRunEntry } from '@evolution/services/eloBudgetActions';
import type { StrategyAccuracyStats } from '@evolution/services/costAnalyticsActions';

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

function accuracyColor(avgDeltaPercent: number): string {
  const abs = Math.abs(avgDeltaPercent);
  if (abs <= 10) return 'text-[var(--status-success)]';
  if (abs <= 30) return 'text-[var(--accent-gold)]';
  return 'text-[var(--status-error)]';
}

function StatCard({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-page p-2">
      <div className="text-xs text-[var(--text-muted)] font-ui">{label}</div>
      <div className="text-sm font-semibold text-[var(--text-primary)] font-mono">{value}</div>
    </div>
  );
}

interface Props {
  strategy: StrategyConfigRow;
  runs: StrategyRunEntry[];
  strategyId: string;
  accuracy?: StrategyAccuracyStats;
}

export function StrategyDetailContent({ strategy, runs, strategyId, accuracy }: Props): JSX.Element {
  const [activeTab, setActiveTab] = useTabState(TABS);
  const [displayName, setDisplayName] = useState(strategy.name ?? strategy.label);

  const handleRename = async (newName: string) => {
    const res = await updateStrategyAction({ id: strategyId, name: newName });
    if (res.success) {
      setDisplayName(newName);
      toast.success('Strategy renamed');
    } else {
      toast.error(res.error?.message || 'Failed to rename');
      throw new Error('Rename failed');
    }
  };

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
        title={displayName}
        entityId={strategyId}
        onRename={handleRename}
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

            {/* Performance Stats */}
            <div>
              <h3 className="text-sm font-ui font-semibold text-[var(--text-primary)] mb-2">Performance</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <StatCard label="Avg Rating" value={strategy.avg_final_elo?.toFixed(0) ?? '--'} />
                <StatCard label="Best Rating" value={strategy.best_final_elo?.toFixed(0) ?? '--'} />
                <StatCard label="Worst Rating" value={strategy.worst_final_elo?.toFixed(0) ?? '--'} />
                <StatCard label="StdDev" value={strategy.stddev_final_elo?.toFixed(1) ?? '--'} />
                <StatCard label="Rating/$" value={strategy.avg_elo_per_dollar?.toFixed(1) ?? '--'} />
                <StatCard label="Total Cost" value={`$${strategy.total_cost_usd.toFixed(4)}`} />
              </div>
            </div>

            {/* Accuracy */}
            {accuracy ? (
              <div className="text-xs text-[var(--text-muted)] font-ui" data-testid="accuracy-stats">
                Avg estimation error:{' '}
                <span className={`font-mono font-semibold ${accuracyColor(accuracy.avgDeltaPercent)}`}>
                  {accuracy.avgDeltaPercent >= 0 ? '+' : ''}{accuracy.avgDeltaPercent}%
                </span>
                {' '}(±{accuracy.stdDevPercent}%) across {accuracy.runCount} run{accuracy.runCount !== 1 ? 's' : ''}
              </div>
            ) : (
              <div className="text-xs text-[var(--text-muted)] font-ui">No estimate data yet</div>
            )}

            {/* Dates & Hash */}
            <div className="text-xs text-[var(--text-muted)] font-ui space-y-0.5">
              <div>
                Created {new Date(strategy.created_at).toLocaleDateString()}
                {strategy.last_used_at && ` | Last used ${new Date(strategy.last_used_at).toLocaleDateString()}`}
              </div>
              <div>Hash: <span className="font-mono">{strategy.config_hash}</span></div>
            </div>
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
