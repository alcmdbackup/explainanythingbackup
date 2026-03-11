// Run metrics tab: displays per-run Elo stats, cost, and per-agent cost breakdown.
// Calls getRunMetricsAction which uses computeRunMetrics from experimentMetrics.

'use client';

import { useState, useEffect } from 'react';
import { getRunMetricsAction } from '@evolution/services/experimentActions';
import type { MetricsBag } from '@evolution/experiments/evolution/experimentMetrics';

function fmtNum(v: number | undefined | null, decimals = 0): string {
  if (v == null) return '\u2014';
  return v.toFixed(decimals);
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 bg-[var(--surface-elevated)] rounded-page">
      <span className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide">{label}</span>
      <p className="text-sm font-mono text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

export function RunMetricsTab({ runId }: { runId: string }) {
  const [metrics, setMetrics] = useState<MetricsBag | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getRunMetricsAction(runId).then((result) => {
      if (result.success && result.data) {
        setMetrics(result.data.metrics);
      } else {
        setError(result.error?.message || 'Failed to load metrics');
      }
      setLoading(false);
    });
  }, [runId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[var(--text-muted)] py-8">
        <div className="w-4 h-4 border-2 border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
        <span className="font-ui text-sm">Computing metrics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 text-sm text-[var(--status-error)] border border-[var(--status-error)] rounded-page bg-[var(--status-error)]/10">
        {error}
      </div>
    );
  }

  if (!metrics || Object.keys(metrics).length === 0) {
    return (
      <div className="text-sm text-[var(--text-muted)] py-8 text-center">
        No metrics available for this run.
      </div>
    );
  }

  const agentCosts = Object.entries(metrics)
    .filter(([k]) => k.startsWith('agentCost:'))
    .map(([k, v]) => ({ agent: k.replace('agentCost:', ''), cost: v?.value ?? 0 }))
    .sort((a, b) => b.cost - a.cost);

  return (
    <div className="space-y-4" data-testid="run-metrics-tab">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <SummaryCard label="Variants" value={fmtNum(metrics.totalVariants?.value)} />
        <SummaryCard label="Median Elo" value={fmtNum(metrics.medianElo?.value)} />
        <SummaryCard label="90p Elo" value={fmtNum(metrics.p90Elo?.value)} />
        <SummaryCard
          label="Max Elo"
          value={
            metrics.maxElo?.sigma != null
              ? `${fmtNum(metrics.maxElo?.value)} \u00B1${metrics.maxElo.sigma.toFixed(0)}`
              : fmtNum(metrics.maxElo?.value)
          }
        />
        <SummaryCard label="Cost" value={`$${fmtNum(metrics.cost?.value, 3)}`} />
        <SummaryCard label="Elo/$" value={fmtNum(metrics['eloPer$']?.value)} />
      </div>

      {agentCosts.length > 0 && (
        <div className="border border-[var(--border-default)] rounded-page overflow-hidden bg-[var(--surface-secondary)]">
          <div className="p-3 space-y-2">
            <h5 className="text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wide">
              Agent Cost Breakdown
            </h5>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-ui" data-testid="agent-cost-table">
                <thead>
                  <tr className="text-[var(--text-muted)] border-b border-[var(--border-default)]">
                    <th className="text-left py-1 pr-2">Agent</th>
                    <th className="text-right py-1 pr-2">Cost</th>
                    <th className="text-right py-1">% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {agentCosts.map(({ agent, cost }) => {
                    const totalCost = metrics.cost?.value ?? 1;
                    const pct = totalCost > 0 ? (cost / totalCost) * 100 : 0;
                    return (
                      <tr key={agent} className="border-b border-[var(--border-default)] last:border-0">
                        <td className="py-1.5 pr-2 font-mono text-[var(--text-primary)]">{agent}</td>
                        <td className="py-1.5 pr-2 text-right font-mono text-[var(--text-secondary)]">${cost.toFixed(3)}</td>
                        <td className="py-1.5 text-right font-mono text-[var(--text-secondary)]">{pct.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
