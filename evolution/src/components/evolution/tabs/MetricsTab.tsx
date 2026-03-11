'use client';
// Metrics tab for run detail page: shows key performance metrics and agent cost breakdown.
// Uses MetricGrid for the summary cards and a simple table for per-agent costs.

import { useEffect, useState, useCallback } from 'react';
import { MetricGrid, type MetricItem } from '@evolution/components/evolution/MetricGrid';
import { useAutoRefresh } from '@evolution/components/evolution/AutoRefreshProvider';
import { getRunMetricsAction, type RunMetricsResult } from '@evolution/services/experimentActions';
import { formatCost } from '@evolution/lib/utils/formatters';

interface MetricsTabProps {
  runId: string;
}

export function MetricsTab({ runId }: MetricsTabProps): JSX.Element {
  const [data, setData] = useState<RunMetricsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { refreshKey, reportRefresh, reportError } = useAutoRefresh();

  const load = useCallback(async () => {
    const result = await getRunMetricsAction(runId);
    if (result.success && result.data) {
      setData(result.data);
      setError(null);
      reportRefresh();
    } else {
      setError(result.error?.message ?? 'Failed to load metrics');
      reportError(result.error?.message ?? 'Failed to load metrics');
    }
  }, [runId, reportRefresh, reportError]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (refreshKey === 0) return;
    load();
  }, [refreshKey, load]);

  if (loading) {
    return (
      <div
        className="h-[400px] bg-[var(--surface-elevated)] rounded-book animate-pulse"
        data-testid="metrics-loading"
      />
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-12 text-[var(--text-muted)]" data-testid="metrics-error">
        {error ?? 'No metrics available'}
      </div>
    );
  }

  const { metrics, agentBreakdown } = data;

  const metricItems: MetricItem[] = [];

  if (metrics.totalVariants) {
    metricItems.push({ label: 'Total Variants', value: metrics.totalVariants.value });
  }
  if (metrics.medianElo) {
    metricItems.push({
      label: 'Median Elo',
      value: Math.round(metrics.medianElo.value),
      ci: metrics.medianElo.ci ?? undefined,
    });
  }
  if (metrics.p90Elo) {
    metricItems.push({
      label: 'P90 Elo',
      value: Math.round(metrics.p90Elo.value),
      ci: metrics.p90Elo.ci ?? undefined,
    });
  }
  if (metrics.maxElo) {
    metricItems.push({
      label: 'Max Elo',
      value: Math.round(metrics.maxElo.value),
      ci: metrics.maxElo.ci ?? undefined,
    });
  }
  if (metrics.cost) {
    metricItems.push({ label: 'Total Cost', value: formatCost(metrics.cost.value), prefix: '$' });
  }
  if (metrics['eloPer$']) {
    metricItems.push({ label: 'Elo/$', value: Math.round(metrics['eloPer$'].value) });
  }

  return (
    <div className="space-y-6" data-testid="metrics-tab">
      {metricItems.length > 0 && (
        <MetricGrid metrics={metricItems} columns={4} testId="run-metrics" />
      )}

      {agentBreakdown.length > 0 && (
        <div>
          <h3 className="text-sm font-ui font-medium text-[var(--text-secondary)] mb-3">
            Agent Cost Breakdown
          </h3>
          <div className="border border-[var(--border-default)] rounded-book overflow-hidden">
            <table className="w-full text-xs font-mono" data-testid="agent-cost-table">
              <thead>
                <tr className="bg-[var(--surface-elevated)] text-[var(--text-muted)]">
                  <th className="px-3 py-2 text-left font-ui">Agent</th>
                  <th className="px-3 py-2 text-right font-ui">Cost ($)</th>
                  <th className="px-3 py-2 text-right font-ui">Calls</th>
                  <th className="px-3 py-2 text-right font-ui">Cost/Call</th>
                </tr>
              </thead>
              <tbody>
                {agentBreakdown.map((row) => (
                  <tr key={row.agent} className="border-t border-[var(--border-default)]">
                    <td className="px-3 py-2">{row.agent}</td>
                    <td className="px-3 py-2 text-right">{formatCost(row.costUsd)}</td>
                    <td className="px-3 py-2 text-right">{row.calls}</td>
                    <td className="px-3 py-2 text-right">
                      {row.calls > 0 ? formatCost(row.costUsd / row.calls) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
