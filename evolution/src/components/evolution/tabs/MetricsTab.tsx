'use client';
// Run metrics tab using run_summary JSONB fields from V2 schema.
// Displays iterations, duration, match stats, top variants, and strategy effectiveness.

import { useEffect, useState } from 'react';
import { MetricGrid, type MetricItem } from '@evolution/components/evolution';
import {
  getEvolutionRunSummaryAction,
  getEvolutionCostBreakdownAction,
  type AgentCostBreakdown,
} from '@evolution/services/evolutionActions';
import type { EvolutionRunSummary } from '@evolution/lib/types';
import { formatCost } from '@evolution/lib/utils/formatters';

interface MetricsTabProps {
  runId: string;
}

export function MetricsTab({ runId }: MetricsTabProps): JSX.Element {
  const [summary, setSummary] = useState<EvolutionRunSummary | null>(null);
  const [costBreakdown, setCostBreakdown] = useState<AgentCostBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [summaryResult, costResult] = await Promise.all([
        getEvolutionRunSummaryAction(runId),
        getEvolutionCostBreakdownAction(runId),
      ]);

      if (summaryResult.success) setSummary(summaryResult.data);
      else setError(summaryResult.error?.message ?? 'Failed to load summary');

      if (costResult.success && costResult.data) setCostBreakdown(costResult.data);
      setLoading(false);
    }
    load();
  }, [runId]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map(i => (
          <div key={i} className="h-32 bg-[var(--surface-elevated)] rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) return <div className="text-[var(--status-error)] text-sm p-4">{error}</div>;

  if (!summary) {
    return (
      <div className="text-[var(--text-muted)] text-sm p-8 text-center" data-testid="metrics-tab-empty">
        No metrics available. Run may still be in progress.
      </div>
    );
  }

  const overviewMetrics: MetricItem[] = [
    { label: 'Total Iterations', value: summary.totalIterations },
    { label: 'Variants', value: summary.topVariants.length },
    { label: 'Total Comparisons', value: summary.matchStats.totalMatches },
    { label: 'Duration', value: summary.durationSeconds > 0 ? `${Math.round(summary.durationSeconds)}s` : '—' },
    { label: 'Final Phase', value: summary.finalPhase },
    { label: 'Stop Reason', value: summary.stopReason },
    { label: 'Avg Confidence', value: `${(summary.matchStats.avgConfidence * 100).toFixed(1)}%` },
    { label: 'Decisive Rate', value: `${(summary.matchStats.decisiveRate * 100).toFixed(1)}%` },
    { label: 'Baseline Rank', value: summary.baselineRank ?? '—' },
  ];

  return (
    <div className="space-y-6" data-testid="metrics-tab">
      <MetricGrid metrics={overviewMetrics} />

      {/* Top Variants */}
      {summary.topVariants.length > 0 && (
        <div>
          <h4 className="text-lg font-display font-semibold text-[var(--text-primary)] mb-3">Top Variants</h4>
          <div className="overflow-x-auto border border-[var(--border-default)] rounded-book">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-elevated)]">
                <tr>
                  <th className="px-3 py-2 text-left">Rank</th>
                  <th className="px-3 py-2 text-left">Strategy</th>
                  <th className="px-3 py-2 text-right">Mu</th>
                  <th className="px-3 py-2 text-center">Baseline?</th>
                </tr>
              </thead>
              <tbody>
                {summary.topVariants.map((v, i) => (
                  <tr key={v.id} className="border-t border-[var(--border-default)]">
                    <td className="px-3 py-2 text-[var(--text-muted)]">#{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-xs">{v.strategy}</td>
                    <td className="px-3 py-2 text-right font-semibold">{v.mu.toFixed(2)}</td>
                    <td className="px-3 py-2 text-center">{v.isBaseline ? '✓' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Strategy Effectiveness */}
      {Object.keys(summary.strategyEffectiveness).length > 0 && (
        <div>
          <h4 className="text-lg font-display font-semibold text-[var(--text-primary)] mb-3">Strategy Effectiveness</h4>
          <div className="overflow-x-auto border border-[var(--border-default)] rounded-book">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-elevated)]">
                <tr>
                  <th className="px-3 py-2 text-left">Strategy</th>
                  <th className="px-3 py-2 text-right">Count</th>
                  <th className="px-3 py-2 text-right">Avg Mu</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary.strategyEffectiveness)
                  .sort(([, a], [, b]) => b.avgMu - a.avgMu)
                  .map(([strategy, stats]) => (
                    <tr key={strategy} className="border-t border-[var(--border-default)]">
                      <td className="px-3 py-2 font-mono text-xs">{strategy}</td>
                      <td className="px-3 py-2 text-right text-[var(--text-muted)]">{stats.count}</td>
                      <td className="px-3 py-2 text-right font-semibold">{stats.avgMu.toFixed(2)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cost Breakdown */}
      {costBreakdown.length > 0 && (
        <div>
          <h4 className="text-lg font-display font-semibold text-[var(--text-primary)] mb-3">Cost by Agent</h4>
          <div className="overflow-x-auto border border-[var(--border-default)] rounded-book">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-elevated)]">
                <tr>
                  <th className="px-3 py-2 text-left">Agent</th>
                  <th className="px-3 py-2 text-right">Calls</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {costBreakdown.map(cb => (
                  <tr key={cb.agent} className="border-t border-[var(--border-default)]">
                    <td className="px-3 py-2 font-mono text-xs">{cb.agent}</td>
                    <td className="px-3 py-2 text-right text-[var(--text-muted)]">{cb.calls}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatCost(cb.costUsd)}</td>
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
