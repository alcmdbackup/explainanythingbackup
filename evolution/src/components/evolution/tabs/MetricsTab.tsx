'use client';
// Metrics tab for run detail page: shows key metrics from run_summary JSONB.
// V2 simplified — reads from run_summary instead of V1 experiment_rounds.

import { useEffect, useState, useCallback } from 'react';
import { MetricGrid, type MetricItem } from '@evolution/components/evolution/MetricGrid';
import { useAutoRefresh } from '@evolution/components/evolution/AutoRefreshProvider';
import { getEvolutionRunSummaryAction } from '@evolution/services/evolutionActions';
import { formatCost } from '@evolution/lib/utils/formatters';

interface MetricsTabProps {
  runId: string;
}

export function MetricsTab({ runId }: MetricsTabProps): JSX.Element {
  const [metricItems, setMetricItems] = useState<MetricItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { refreshKey, reportRefresh, reportError } = useAutoRefresh();

  const load = useCallback(async () => {
    const result = await getEvolutionRunSummaryAction(runId);
    if (result.success && result.data) {
      const summary = result.data;
      const items: MetricItem[] = [];

      if (summary.totalIterations != null) {
        items.push({ label: 'Iterations', value: summary.totalIterations });
      }
      if (summary.matchStats?.totalMatches != null) {
        items.push({ label: 'Total Matches', value: summary.matchStats.totalMatches });
      }
      if (summary.matchStats?.avgConfidence != null) {
        items.push({ label: 'Avg Confidence', value: `${(summary.matchStats.avgConfidence * 100).toFixed(0)}%` });
      }
      if (summary.topVariants?.[0]?.mu != null) {
        items.push({ label: 'Best Mu', value: summary.topVariants[0].mu.toFixed(1) });
      }
      if (summary.durationSeconds != null) {
        items.push({ label: 'Duration', value: `${summary.durationSeconds.toFixed(0)}s` });
      }

      setMetricItems(items);
      setError(null);
      reportRefresh();
    } else {
      setError(result.error?.message ?? 'No metrics available');
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

  if (error || metricItems.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--text-muted)]" data-testid="metrics-error">
        {error ?? 'No metrics available'}
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="metrics-tab">
      <MetricGrid metrics={metricItems} columns={4} testId="run-metrics" />
    </div>
  );
}
