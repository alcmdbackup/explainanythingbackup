'use client';
// Cost accuracy panel showing estimation delta trend, per-agent accuracy, confidence
// calibration cards, and outlier runs. Used in the optimization dashboard.

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  getCostAccuracyOverviewAction,
  type CostAccuracyOverview,
} from '@evolution/services/costAnalyticsActions';
import { formatCost, formatCostDetailed } from '@evolution/lib/utils/formatters';

const DeltaChart = dynamic(() => import('recharts').then((mod) => {
  const { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } = mod;
  function Chart({ data }: { data: CostAccuracyOverview['recentDeltas'] }) {
    if (data.length === 0) return <div className="h-[220px] flex items-center justify-center text-sm text-[var(--text-muted)]">No data</div>;
    return (
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <XAxis dataKey="createdAt" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickFormatter={(v: string) => new Date(v).toLocaleDateString()} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={45} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip contentStyle={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 12 }} formatter={(v) => [`${Number(v ?? 0).toFixed(1)}%`, 'Delta']} />
          <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="4 4" />
          <Line type="monotone" dataKey="deltaPercent" stroke="var(--accent-gold)" dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  return Chart;
}), { ssr: false, loading: () => <div className="h-[220px] bg-[var(--surface-secondary)] rounded-book animate-pulse" /> });

export function CostAccuracyPanel() {
  const [data, setData] = useState<CostAccuracyOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const result = await getCostAccuracyOverviewAction();
      if (result.success && result.data) setData(result.data);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4" data-testid="cost-accuracy-panel">
        <div className="h-[220px] bg-[var(--surface-elevated)] rounded-book animate-pulse" />
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-[var(--surface-elevated)] rounded-book animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const agents = Object.entries(data.perAgentAccuracy).sort(([, a], [, b]) => Math.abs(b.avgDeltaPercent) - Math.abs(a.avgDeltaPercent));

  return (
    <div className="space-y-4" data-testid="cost-accuracy-panel">
      {/* Confidence calibration cards */}
      <div className="grid grid-cols-3 gap-3">
        {(['high', 'medium', 'low'] as const).map(level => {
          const cal = data.confidenceCalibration[level];
          return (
            <div key={level} className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-3">
              <div className="text-xs text-[var(--text-muted)] capitalize">{level} confidence</div>
              <div className="text-lg font-mono font-semibold text-[var(--text-primary)]">
                {cal.count > 0 ? `±${cal.avgAbsDeltaPercent}%` : '--'}
              </div>
              <div className="text-xs text-[var(--text-muted)]">{cal.count} run{cal.count !== 1 ? 's' : ''}</div>
            </div>
          );
        })}
      </div>

      {/* Delta trend chart */}
      <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">Estimation Delta Over Time</h3>
        <DeltaChart data={data.recentDeltas} />
      </div>

      {/* Per-agent accuracy table */}
      {agents.length > 0 && (
        <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">Per-Agent Accuracy</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[var(--text-muted)]">
                <th className="text-left py-1">Agent</th>
                <th className="text-right py-1">Avg Est.</th>
                <th className="text-right py-1">Avg Actual</th>
                <th className="text-right py-1">Delta</th>
              </tr>
            </thead>
            <tbody>
              {agents.map(([agent, stats]) => (
                <tr key={agent} className="border-t border-[var(--border-default)]">
                  <td className="py-1.5 font-mono">{agent}</td>
                  <td className="py-1.5 text-right font-mono">{formatCostDetailed(stats.avgEstimated)}</td>
                  <td className="py-1.5 text-right font-mono">{formatCostDetailed(stats.avgActual)}</td>
                  <td className={`py-1.5 text-right font-mono ${
                    Math.abs(stats.avgDeltaPercent) <= 10 ? 'text-[var(--status-success)]'
                      : Math.abs(stats.avgDeltaPercent) <= 30 ? 'text-[var(--accent-gold)]'
                        : 'text-[var(--status-error)]'
                  }`}>
                    {stats.avgDeltaPercent >= 0 ? '+' : ''}{stats.avgDeltaPercent}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Outliers */}
      {data.outliers.length > 0 && (
        <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">Outliers (&gt;50% off)</h3>
          <div className="space-y-1">
            {data.outliers.map(o => (
              <div key={o.runId} className="flex items-center justify-between text-xs">
                <Link href={`/admin/quality/evolution/run/${o.runId}`} className="font-mono text-[var(--accent-gold)] hover:underline">
                  {o.runId.substring(0, 8)}
                </Link>
                <span className="text-[var(--status-error)] font-mono">
                  {o.deltaPercent >= 0 ? '+' : ''}{o.deltaPercent}% ({formatCost(o.estimatedUsd)} est / {formatCost(o.actualUsd)} actual)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
