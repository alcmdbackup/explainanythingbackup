'use client';
// Budget analysis tab showing cumulative burn curve and agent cost breakdown.
// Visualizes spend progression relative to the budget cap.

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  getEvolutionRunBudgetAction,
  type BudgetData,
} from '@/lib/services/evolutionVisualizationActions';

const BurnChart = dynamic(() => import('recharts').then((mod) => {
  const { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } = mod;
  function Chart({ data }: { data: BudgetData['cumulativeBurn'] }) {
    if (data.length === 0) return <div className="h-[280px] flex items-center justify-center text-sm text-[var(--text-muted)]">No cost data</div>;
    const budgetCap = data[0]?.budgetCap ?? 5;
    return (
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data}>
          <XAxis dataKey="step" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={50} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
          <Tooltip contentStyle={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 12 }} formatter={(v) => [`$${Number(v ?? 0).toFixed(3)}`, 'Cost']} />
          <ReferenceLine y={budgetCap} stroke="var(--status-error)" strokeDasharray="4 4" label={{ value: `Cap $${budgetCap}`, fill: 'var(--status-error)', fontSize: 10 }} />
          <Area type="monotone" dataKey="cumulativeCost" stroke="var(--accent-gold)" fill="var(--accent-gold)" fillOpacity={0.2} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }
  return Chart;
}), { ssr: false, loading: () => <div className="h-[280px] bg-[var(--surface-secondary)] rounded-book animate-pulse" /> });

const AgentBarChart = dynamic(() => import('recharts').then((mod) => {
  const { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } = mod;
  function Chart({ data }: { data: BudgetData['agentBreakdown'] }) {
    if (data.length === 0) return <div className="h-[200px] flex items-center justify-center text-sm text-[var(--text-muted)]">No cost data</div>;
    return (
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} layout="vertical">
          <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
          <YAxis type="category" dataKey="agent" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={100} />
          <Tooltip contentStyle={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 12 }} formatter={(v) => [`$${Number(v ?? 0).toFixed(3)}`, 'Cost']} />
          <Bar dataKey="costUsd" fill="var(--accent-gold)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return Chart;
}), { ssr: false, loading: () => <div className="h-[200px] bg-[var(--surface-secondary)] rounded-book animate-pulse" /> });

export function BudgetTab({ runId }: { runId: string }) {
  const [data, setData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const result = await getEvolutionRunBudgetAction(runId);
      if (result.success && result.data) {
        setData(result.data);
      } else {
        setError(result.error?.message ?? 'Failed to load budget data');
      }
      setLoading(false);
    }
    load();
  }, [runId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-[280px] bg-[var(--surface-elevated)] rounded-book animate-pulse" />
        <div className="h-[200px] bg-[var(--surface-elevated)] rounded-book animate-pulse" />
      </div>
    );
  }

  if (error) return <div className="text-[var(--status-error)] text-sm p-4">{error}</div>;

  const prediction = data?.prediction;
  const estimate = data?.estimate;

  return (
    <div className="space-y-6" data-testid="budget-tab">
      {/* Estimated vs Actual comparison (only shown when estimate data exists) */}
      {prediction && (
        <div
          className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4 space-y-3"
          data-testid="estimate-comparison"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)]">Estimated vs Actual</h3>
            {estimate && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded ${
                  estimate.confidence === 'high'
                    ? 'bg-[var(--status-success)]/10 text-[var(--status-success)]'
                    : estimate.confidence === 'medium'
                      ? 'bg-[var(--accent-gold)]/10 text-[var(--accent-gold)]'
                      : 'bg-[var(--text-muted)]/10 text-[var(--text-muted)]'
                }`}
              >
                {estimate.confidence} confidence
              </span>
            )}
          </div>

          {/* Summary delta badge */}
          <div className="flex items-center gap-4 text-sm">
            <span className="text-[var(--text-muted)]">
              Estimated: <span className="font-mono font-semibold text-[var(--text-secondary)]">${prediction.estimatedUsd.toFixed(2)}</span>
            </span>
            <span className="text-[var(--text-muted)]">
              Actual: <span className="font-mono font-semibold text-[var(--text-secondary)]">${prediction.actualUsd.toFixed(2)}</span>
            </span>
            <span
              className={`text-xs font-mono px-2 py-0.5 rounded ${
                Math.abs(prediction.deltaPercent) <= 10
                  ? 'bg-[var(--status-success)]/10 text-[var(--status-success)]'
                  : Math.abs(prediction.deltaPercent) <= 30
                    ? 'bg-[var(--accent-gold)]/10 text-[var(--accent-gold)]'
                    : 'bg-[var(--status-error)]/10 text-[var(--status-error)]'
              }`}
              data-testid="delta-badge"
            >
              {prediction.deltaPercent >= 0 ? '+' : ''}{prediction.deltaPercent.toFixed(0)}%
              {prediction.deltaPercent > 0 ? ' over' : prediction.deltaPercent < 0 ? ' under' : ''} estimate
            </span>
          </div>

          {/* Per-agent comparison bars */}
          <div className="space-y-1.5">
            {Object.entries(prediction.perAgent)
              .sort(([, a], [, b]) => Math.max(b.estimated, b.actual) - Math.max(a.estimated, a.actual))
              .map(([agent, { estimated, actual }]) => {
                const maxVal = Math.max(estimated, actual, 0.001);
                return (
                  <div key={agent} className="flex items-center gap-2 text-xs">
                    <span className="w-28 text-[var(--text-muted)] font-mono truncate">{agent}</span>
                    <div className="flex-1 space-y-0.5">
                      <div className="h-2 bg-[var(--surface-secondary)] rounded overflow-hidden">
                        <div
                          className="h-full bg-[var(--accent-gold)]/40 rounded border border-[var(--accent-gold)]"
                          style={{ width: `${(estimated / maxVal) * 100}%` }}
                          title={`Estimated: $${estimated.toFixed(3)}`}
                        />
                      </div>
                      <div className="h-2 bg-[var(--surface-secondary)] rounded overflow-hidden">
                        <div
                          className="h-full bg-[var(--accent-gold)] rounded"
                          style={{ width: `${(actual / maxVal) * 100}%` }}
                          title={`Actual: $${actual.toFixed(3)}`}
                        />
                      </div>
                    </div>
                    <span className="w-20 text-right text-[var(--text-muted)]">
                      ${estimated.toFixed(3)} / ${actual.toFixed(3)}
                    </span>
                  </div>
                );
              })}
            <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] pt-1">
              <span className="flex items-center gap-1">
                <span className="w-3 h-2 bg-[var(--accent-gold)]/40 border border-[var(--accent-gold)] rounded-sm" /> estimated
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-2 bg-[var(--accent-gold)] rounded-sm" /> actual
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">Cumulative Burn</h3>
        <BurnChart data={data?.cumulativeBurn ?? []} />
      </div>

      <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">Agent Cost Breakdown</h3>
        <AgentBarChart data={data?.agentBreakdown ?? []} />
      </div>
    </div>
  );
}
