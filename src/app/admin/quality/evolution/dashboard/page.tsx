'use client';
// Operational dashboard for monitoring evolution pipeline health.
// Shows active runs, queue depth, success rate, spend trends, and recent runs table.

import { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  AutoRefreshProvider,
  RefreshIndicator,
  EvolutionStatusBadge,
} from '@/components/evolution';
import {
  getEvolutionDashboardDataAction,
  type DashboardData,
  type DashboardRun,
} from '@/lib/services/evolutionVisualizationActions';

// Lazy-load Recharts to avoid shipping chart code in the initial bundle
const RunsChart = dynamic(() => import('recharts').then((mod) => {
  const { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } = mod;
  function Chart({ data }: { data: DashboardData['runsPerDay'] }) {
    if (data.length === 0) return <EmptyChart label="No run data yet" />;
    return (
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data}>
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={(v: string) => v.slice(5)} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={30} />
          <Tooltip contentStyle={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 12 }} />
          <Area type="monotone" dataKey="completed" stackId="1" stroke="var(--status-success)" fill="var(--status-success)" fillOpacity={0.3} />
          <Area type="monotone" dataKey="failed" stackId="1" stroke="var(--status-error)" fill="var(--status-error)" fillOpacity={0.3} />
          <Area type="monotone" dataKey="paused" stackId="1" stroke="var(--text-muted)" fill="var(--text-muted)" fillOpacity={0.2} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }
  return Chart;
}), { ssr: false, loading: () => <ChartSkeleton /> });

const SpendChart = dynamic(() => import('recharts').then((mod) => {
  const { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } = mod;
  function Chart({ data }: { data: DashboardData['dailySpend'] }) {
    if (data.length === 0) return <EmptyChart label="No spend data yet" />;
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={(v: string) => v.slice(5)} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={40} tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
          <Tooltip contentStyle={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 12 }} formatter={(v) => [`$${Number(v ?? 0).toFixed(2)}`, 'Spend']} />
          <Bar dataKey="amount" fill="var(--accent-gold)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return Chart;
}), { ssr: false, loading: () => <ChartSkeleton /> });

function ChartSkeleton() {
  return <div className="h-[220px] bg-[var(--surface-secondary)] rounded-book animate-pulse" />;
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-[220px] flex items-center justify-center text-sm text-[var(--text-muted)]">
      {label}
    </div>
  );
}

function StatCard({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div
      className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4"
      data-testid={testId}
    >
      <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold text-[var(--text-primary)] mt-1">{value}</div>
    </div>
  );
}

export default function EvolutionDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRefresh = useCallback(async () => {
    const result = await getEvolutionDashboardDataAction();
    if (result.success && result.data) {
      setData(result.data);
      setError(null);
    } else {
      setError(result.error?.message ?? 'Failed to load dashboard data');
    }
  }, []);

  return (
    <AutoRefreshProvider onRefresh={handleRefresh}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <div className="text-xs text-[var(--text-muted)] mb-1">
              <Link href="/admin/quality/evolution" className="hover:text-[var(--accent-gold)]">Evolution</Link>
              <span className="mx-1">/</span>
              <span>Dashboard</span>
            </div>
            <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
              Evolution Dashboard
            </h1>
          </div>
          <RefreshIndicator />
        </div>

        {error && (
          <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)] rounded-page text-[var(--status-error)] text-sm">
            {error}
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Active Runs" value={String(data?.activeRuns ?? 0)} testId="stat-card-active" />
          <StatCard label="Queue Depth" value={String(data?.queueDepth ?? 0)} testId="stat-card-queue" />
          <StatCard label="7d Success Rate" value={`${data?.successRate7d ?? 0}%`} testId="stat-card-success" />
          <StatCard label="Monthly Spend" value={`$${(data?.monthlySpend ?? 0).toFixed(2)}`} testId="stat-card-spend" />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">Runs Over Time (30d)</h3>
            <RunsChart data={data?.runsPerDay ?? []} />
          </div>
          <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">Daily Spend (30d)</h3>
            <SpendChart data={data?.dailySpend ?? []} />
          </div>
        </div>

        {/* Recent runs table */}
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">Recent Runs</h3>
          <div className="overflow-x-auto border border-[var(--border-default)] rounded-book">
            <table className="w-full text-sm" data-testid="dashboard-runs-table">
              <thead className="bg-[var(--surface-elevated)]">
                <tr>
                  <th className="p-3 text-left">Explanation</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-left">Phase</th>
                  <th className="p-3 text-right">Iteration</th>
                  <th className="p-3 text-right">Cost</th>
                  <th className="p-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {!data ? (
                  <tr><td colSpan={6} className="p-8 text-center text-[var(--text-muted)]">Loading...</td></tr>
                ) : data.recentRuns.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-[var(--text-muted)]">No runs found</td></tr>
                ) : (
                  data.recentRuns.map((run: DashboardRun) => (
                    <tr key={run.id} className="border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)]">
                      <td className="p-3">
                        <Link
                          href={`/admin/quality/evolution/run/${run.id}`}
                          className="font-mono text-xs text-[var(--accent-gold)] hover:underline"
                        >
                          #{run.explanation_id}
                        </Link>
                      </td>
                      <td className="p-3"><EvolutionStatusBadge status={run.status} /></td>
                      <td className="p-3 text-[var(--text-secondary)] text-xs">{run.phase}</td>
                      <td className="p-3 text-right text-[var(--text-muted)]">{run.current_iteration}</td>
                      <td className="p-3 text-right font-mono">${run.total_cost_usd.toFixed(2)}</td>
                      <td className="p-3 text-[var(--text-muted)] text-xs">{new Date(run.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AutoRefreshProvider>
  );
}
