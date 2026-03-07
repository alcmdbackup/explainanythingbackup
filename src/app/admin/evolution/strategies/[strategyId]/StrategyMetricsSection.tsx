// Client component for strategy aggregate metrics with bootstrap CIs and per-run breakdown.
// Loaded on-demand in the strategy detail page.

'use client';

import { useState, useEffect } from 'react';
import { getStrategyMetricsAction } from '@evolution/services/experimentActions';
import type { StrategyMetricsResult, MetricValue } from '@evolution/experiments/evolution/experimentMetrics';

function fmtMetric(mv: MetricValue | null | undefined, decimals = 0, prefix = ''): string {
  if (!mv) return '—';
  return `${prefix}${mv.value.toFixed(decimals)}`;
}

function CIBadge({ mv, decimals = 0 }: { mv: MetricValue | null | undefined; decimals?: number }) {
  if (!mv?.ci) return null;
  if (mv.n < 2) return null;
  return (
    <span className="text-[var(--text-muted)] ml-1 text-xs">
      [{mv.ci[0].toFixed(decimals)}, {mv.ci[1].toFixed(decimals)}]
      {mv.n === 2 && <span className="ml-0.5 text-[var(--status-warning)]" title="Low confidence (N=2)">*</span>}
    </span>
  );
}

function MetricCard({ label, mv, decimals = 0, prefix = '' }: {
  label: string;
  mv: MetricValue | null | undefined;
  decimals?: number;
  prefix?: string;
}) {
  return (
    <div className="p-3 bg-[var(--surface-elevated)] rounded-page">
      <span className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide">{label}</span>
      <p className="text-sm font-mono text-[var(--text-primary)]">
        {fmtMetric(mv, decimals, prefix)}
        <CIBadge mv={mv} decimals={decimals} />
      </p>
    </div>
  );
}

export function StrategyMetricsSection({ strategyConfigId }: { strategyConfigId: string }) {
  const [data, setData] = useState<StrategyMetricsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const result = await getStrategyMetricsAction({ strategyConfigId });
        if (!cancelled) {
          if (result.success && result.data) {
            setData(result.data);
          } else {
            setError(result.error?.message ?? 'Failed to load metrics');
          }
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [strategyConfigId]);

  if (loading) {
    return <div className="p-4 text-xs font-body text-[var(--text-muted)]">Loading strategy metrics...</div>;
  }

  if (error || !data) {
    return <div className="p-4 text-xs font-body text-[var(--text-muted)]">{error ?? 'No metrics available.'}</div>;
  }

  if (data.runs.length === 0) {
    return <div className="p-4 text-xs font-body text-[var(--text-muted)]">No completed runs with metrics.</div>;
  }

  const agg = data.aggregate;
  const agentCostKeys = Object.keys(agg)
    .filter((k) => k.startsWith('agentCost:'))
    .sort();

  return (
    <div className="space-y-4">
      {/* Aggregate metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <MetricCard label="Max Elo" mv={agg.maxElo} />
        <MetricCard label="Median Elo" mv={agg.medianElo} />
        <MetricCard label="90p Elo" mv={agg.p90Elo} />
        <MetricCard label="Avg Cost" mv={agg.cost} decimals={2} prefix="$" />
        <MetricCard label="Avg Variants" mv={agg.totalVariants} />
        <MetricCard label="Elo/$" mv={agg['eloPer$']} />
      </div>

      {/* Agent cost breakdown */}
      {agentCostKeys.length > 0 && (
        <div className="border border-[var(--border-default)] rounded-page p-3">
          <h4 className="text-lg font-display font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">
            Agent Cost Breakdown (mean across runs)
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {agentCostKeys.map((k) => {
              const mv = agg[k as keyof typeof agg] as MetricValue | null | undefined;
              return (
                <div key={k} className="text-xs font-mono text-[var(--text-secondary)]">
                  {k.replace('agentCost:', '')}: {fmtMetric(mv, 3, '$')}
                  <CIBadge mv={mv} decimals={3} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-run table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-ui" data-testid="strategy-metrics-table">
          <thead>
            <tr className="text-[var(--text-muted)] border-b border-[var(--border-default)]">
              <th className="text-left py-1 pr-2">Run</th>
              <th className="text-left py-1 pr-2">Config</th>
              <th className="text-right py-1 pr-2">Variants</th>
              <th className="text-right py-1 pr-2">Median Elo</th>
              <th className="text-right py-1 pr-2">90p Elo</th>
              <th className="text-right py-1 pr-2">Max Elo</th>
              <th className="text-right py-1 pr-2">Cost</th>
              <th className="text-right py-1">Elo/$</th>
            </tr>
          </thead>
          <tbody>
            {data.runs.map((run) => {
              const m = run.metrics;
              return (
                <tr key={run.runId} className="border-b border-[var(--border-default)] last:border-0">
                  <td className="py-1.5 pr-2 font-mono text-[var(--text-primary)]">{run.runId.slice(0, 8)}</td>
                  <td className="py-1.5 pr-2 text-[var(--text-secondary)] max-w-[150px] truncate">{run.configLabel}</td>
                  <td className="py-1.5 pr-2 text-right font-mono text-[var(--text-secondary)]">{fmtMetric(m.totalVariants)}</td>
                  <td className="py-1.5 pr-2 text-right font-mono text-[var(--text-secondary)]">{fmtMetric(m.medianElo)}</td>
                  <td className="py-1.5 pr-2 text-right font-mono text-[var(--text-secondary)]">{fmtMetric(m.p90Elo)}</td>
                  <td className="py-1.5 pr-2 text-right font-mono text-[var(--text-secondary)]">
                    {fmtMetric(m.maxElo)}
                    {m.maxElo?.sigma != null && (
                      <span className="text-[var(--text-muted)] ml-1">±{m.maxElo.sigma.toFixed(0)}</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono text-[var(--text-secondary)]">${fmtMetric(m.cost, 3)}</td>
                  <td className="py-1.5 text-right font-mono text-[var(--text-secondary)]">{fmtMetric(m['eloPer$'])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
