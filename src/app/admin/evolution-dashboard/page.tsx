// Evolution dashboard page showing aggregate metrics and recent runs with auto-refresh.
// Fetches dashboard data from the V2 visualization actions and renders MetricGrid + RunsTable.
'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  MetricGrid,
  AutoRefreshProvider,
  useAutoRefresh,
  RunsTable,
  getBaseColumns,
  EvolutionBreadcrumb,
  type MetricItem,
  type BaseRun,
} from '@evolution/components/evolution';
import {
  getEvolutionDashboardDataAction,
  type DashboardData,
} from '@evolution/services/evolutionVisualizationActions';
import { formatCost } from '@evolution/lib/utils/formatters';

function DashboardContent(): JSX.Element {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterTestContent, setFilterTestContent] = useState(true);
  const { refreshKey, reportRefresh, reportError } = useAutoRefresh();

  const load = useCallback(async () => {
    const result = await getEvolutionDashboardDataAction({ filterTestContent });
    if (result.success && result.data) {
      setData(result.data);
      reportRefresh();
    } else {
      const msg = result.error?.message ?? 'Failed to load dashboard';
      setError(msg);
      reportError(msg);
    }
    setLoading(false);
  }, [filterTestContent, reportRefresh, reportError]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        {[1, 2].map((i) => (
          <div key={i} className="h-32 bg-[var(--surface-elevated)] rounded-book animate-pulse" />
        ))}
      </div>
    );
  }

  if (error && !data) {
    return <div className="text-[var(--status-error)] text-sm p-4">{error}</div>;
  }

  if (!data) return <div className="p-8 text-center text-[var(--text-muted)]">No data available</div>;

  const metrics: MetricItem[] = [
    { label: 'Active Runs', value: data.activeRuns },
    { label: 'Queue Depth', value: data.queueDepth },
    { label: 'Completed Runs', value: data.completedRuns },
    { label: 'Failed Runs', value: data.failedRuns },
    { label: 'Total Cost', value: formatCost(data.totalCostUsd) },
    { label: 'Avg Cost', value: formatCost(data.avgCostPerRun) },
  ];

  const recentRuns: BaseRun[] = data.recentRuns.map((r) => ({
    id: r.id,
    explanation_id: r.explanation_id ?? null,
    status: r.status,
    // Map the visualization action's `total_cost_usd` (sourced from the evolution_run_costs view)
    // into a synthetic `cost` metric row so RunsTable's metrics-array-based cost column renders.
    metrics: [
      {
        id: `${r.id}-cost`, entity_type: 'run' as const, entity_id: r.id, metric_name: 'cost',
        value: r.total_cost_usd ?? 0, sigma: null, ci_lower: null, ci_upper: null, n: 1,
        origin_entity_type: null, origin_entity_id: null, aggregation_method: null,
        source: 'view', stale: false,
        created_at: r.created_at, updated_at: r.created_at,
      },
    ],
    budget_cap_usd: r.budget_cap_usd ?? 0,
    error_message: r.error_message ?? null,
    completed_at: r.completed_at,
    created_at: r.created_at,
    strategy_name: r.strategy_name,
  }));

  return (
    <div className="space-y-6" data-testid="dashboard-content">
      <div className="flex flex-wrap gap-2" data-testid="filter-bar">
        <label className="flex items-center gap-2 text-sm font-ui text-[var(--text-secondary)]" data-testid="filter-filterTestContent">
          <input
            type="checkbox"
            checked={filterTestContent}
            onChange={(e) => setFilterTestContent(e.target.checked)}
            className="rounded"
          />
          Hide test content
        </label>
      </div>
      <MetricGrid metrics={metrics} columns={3} variant="card" testId="dashboard-metrics" />
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">Recent Runs</h2>
            <p className="text-xs font-ui text-[var(--text-muted)]">
              Showing {Math.min(recentRuns.length, 10)} most recent of {data.totalRuns ?? (data.activeRuns + data.queueDepth + data.completedRuns + data.failedRuns)} total
            </p>
          </div>
          <Link href="/admin/evolution/runs" className="text-sm text-[var(--accent-gold)] hover:underline">View all runs →</Link>
        </div>
        <RunsTable runs={recentRuns} columns={getBaseColumns()} compact maxRows={10} testId="dashboard-runs-table" />
      </div>
    </div>
  );
}

export default function EvolutionDashboardPage(): JSX.Element {
  useEffect(() => { document.title = 'Dashboard | Evolution'; }, []);
  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[{ label: 'Evolution Dashboard' }]} />
      <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">Evolution Dashboard</h1>
      <AutoRefreshProvider isActive intervalMs={15000}>
        <DashboardContent />
      </AutoRefreshProvider>
    </div>
  );
}
