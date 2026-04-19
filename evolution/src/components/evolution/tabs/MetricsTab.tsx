'use client';
// Run metrics tab using run_summary JSONB fields from V2 schema.
// Displays iterations, duration, match stats, top variants, and tactic effectiveness.

import { useEffect, useState } from 'react';
import { MetricGrid, type MetricItem } from '@evolution/components/evolution';
import {
  getEvolutionRunSummaryAction,
  getEvolutionCostBreakdownAction,
  type AgentCostBreakdown,
} from '@evolution/services/evolutionActions';
import type { EvolutionRunSummary } from '@evolution/lib/types';
import { formatCost, formatEloWithUncertainty, formatEloCIRange } from '@evolution/lib/utils/formatters';

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
    { label: 'Seed Variant Rank', value: summary.seedVariantRank ?? '—' },
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
                  <th scope="col" className="px-3 py-2 text-left">Rank</th>
                  <th scope="col" className="px-3 py-2 text-left">Tactic</th>
                  <th scope="col" className="px-3 py-2 text-right" title="Elo ± rating uncertainty (per variant)">Elo</th>
                  <th scope="col" className="px-3 py-2 text-right" title="95% CI = Elo ± 1.96 × uncertainty">95% CI</th>
                  <th scope="col" className="px-3 py-2 text-center">Seed?</th>
                </tr>
              </thead>
              <tbody>
                {summary.topVariants.map((v, i) => {
                  // topVariants stored as Elo-scale; legacy mu-scale values (<100) heuristically converted.
                  const raw = v.elo;
                  const elo = raw < 100 ? 1200 + (raw - 25) * 16 : raw;
                  // Phase 4b: uncertainty is optional (absent on pre-Phase-4b rows).
                  const u = v.uncertainty;
                  const ratingLabel = u != null ? (formatEloWithUncertainty(elo, u) ?? Math.round(elo)) : Math.round(elo);
                  const ciLabel = u != null ? (formatEloCIRange(elo, u) ?? '—') : '—';
                  return (
                  <tr key={v.id} className="border-t border-[var(--border-default)]">
                    <td className="px-3 py-2 text-[var(--text-muted)]">#{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-xs">{v.tactic}</td>
                    <td className="px-3 py-2 text-right font-semibold">{ratingLabel}</td>
                    <td className="px-3 py-2 text-right text-xs text-[var(--text-muted)]">{ciLabel}</td>
                    <td className="px-3 py-2 text-center">{v.isSeedVariant ? '✓' : ''}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tactic Effectiveness */}
      {Object.keys(summary.tacticEffectiveness).length > 0 && (
        <div>
          <h4 className="text-lg font-display font-semibold text-[var(--text-primary)] mb-3">Tactic Effectiveness</h4>
          <div className="overflow-x-auto border border-[var(--border-default)] rounded-book">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-elevated)]">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">Tactic</th>
                  <th scope="col" className="px-3 py-2 text-right">Count</th>
                  <th scope="col" className="px-3 py-2 text-right" title="Mean Elo across variants in this tactic bucket, with SE of the mean when n≥2. Distinct from per-variant rating uncertainty — this is the spread of variant Elos in this bucket.">Avg Elo ± SE</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary.tacticEffectiveness)
                  .map(([tactic, stats]) => {
                    // Backward compat: schema normalizes legacy avgMu to avgElo. Legacy mu-scale values heuristically converted.
                    const raw = stats.avgElo;
                    const avgElo = raw < 100 ? 1200 + (raw - 25) * 16 : raw;
                    return [tactic, stats, avgElo] as const;
                  })
                  .sort((a, b) => b[2] - a[2])
                  .map(([tactic, stats, avgElo]) => {
                    // Phase 4b: seAvgElo = SE of the mean within this tactic bucket (NOT rating CI).
                    // Only populated when count >= 2; older rows omit it.
                    const se = stats.seAvgElo;
                    const label = se != null && se > 0
                      ? `${Math.round(avgElo)} ± ${Math.round(se)}`
                      : String(Math.round(avgElo));
                    return (
                    <tr key={tactic} className="border-t border-[var(--border-default)]">
                      <td className="px-3 py-2 font-mono text-xs">{tactic}</td>
                      <td className="px-3 py-2 text-right text-[var(--text-muted)]">{stats.count}</td>
                      <td className="px-3 py-2 text-right font-semibold">{label}</td>
                    </tr>
                    );
                  })}
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
                  <th scope="col" className="px-3 py-2 text-left">Agent</th>
                  <th scope="col" className="px-3 py-2 text-right">Calls</th>
                  <th scope="col" className="px-3 py-2 text-right">Cost</th>
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
