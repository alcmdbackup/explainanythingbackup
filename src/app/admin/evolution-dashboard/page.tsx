'use client';
// Evolution Dashboard overview page. Shows quick links, operational charts, and recent runs.

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  AutoRefreshProvider,
  RefreshIndicator,
  EvolutionStatusBadge,
} from '@/components/evolution';
import { ElapsedTime } from '@/components/evolution/ElapsedTime';
import {
  getEvolutionDashboardDataAction,
  type DashboardData,
  type DashboardRun,
} from '@/lib/services/evolutionVisualizationActions';

// ─── Shared chart constants ─────────────────────────────────────

const AXIS_TICK = { fontSize: 10, fill: 'var(--text-muted)' };
const TOOLTIP_STYLE = {
  background: 'var(--surface-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  fontSize: 12,
};

// ─── Lazy-load Recharts ─────────────────────────────────────────

const RunsChart = dynamic(() => import('recharts').then((mod) => {
  const { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } = mod;
  function Chart({ data }: { data: DashboardData['runsPerDay'] }): JSX.Element {
    if (data.length === 0) return <EmptyChart label="No run data yet" />;
    return (
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data}>
          <XAxis dataKey="date" tick={AXIS_TICK} tickFormatter={(v: string) => v.slice(5)} />
          <YAxis tick={AXIS_TICK} width={30} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
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
  function Chart({ data }: { data: DashboardData['dailySpend'] }): JSX.Element {
    if (data.length === 0) return <EmptyChart label="No spend data yet" />;
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <XAxis dataKey="date" tick={AXIS_TICK} tickFormatter={(v: string) => v.slice(5)} />
          <YAxis tick={AXIS_TICK} width={40} tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`$${Number(v ?? 0).toFixed(2)}`, 'Spend']} />
          <Bar dataKey="amount" fill="var(--accent-gold)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return Chart;
}), { ssr: false, loading: () => <ChartSkeleton /> });

function ChartSkeleton(): JSX.Element {
  return <div className="h-[220px] bg-[var(--surface-secondary)] rounded-book animate-pulse" />;
}

function EmptyChart({ label }: { label: string }): JSX.Element {
  return (
    <div className="h-[220px] flex items-center justify-center text-sm text-[var(--text-muted)]">
      {label}
    </div>
  );
}

// ─── Quick link card ────────────────────────────────────────────

interface QuickLinkCardProps {
  title: string;
  description: string;
  href: string;
  icon: string;
}

function QuickLinkCard({ title, description, href, icon }: QuickLinkCardProps): JSX.Element {
  return (
    <Link
      href={href}
      className="block p-4 bg-[var(--surface-secondary)] rounded-book border border-[var(--border-default)] hover:border-[var(--accent-gold)] transition-colors"
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <h3 className="font-semibold text-[var(--text-primary)]">{title}</h3>
          <p className="text-sm text-[var(--text-muted)] mt-1">{description}</p>
        </div>
      </div>
    </Link>
  );
}

// ─── Main page ──────────────────────────────────────────────────

export default function EvolutionDashboardOverviewPage() {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRefresh = useCallback(async () => {
    const dashResult = await getEvolutionDashboardDataAction();

    if (dashResult.success) {
      setDashboardData(dashResult.data);
      setError(null);
    } else {
      setError(dashResult.error?.message ?? 'Dashboard data failed');
    }
  }, []);

  return (
    <AutoRefreshProvider onRefresh={handleRefresh}>
      <div className="space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
              Evolution Dashboard
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Overview of the content evolution pipeline
            </p>
          </div>
          <RefreshIndicator />
        </div>

        {error && (
          <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)] rounded-page text-[var(--status-error)] text-sm">
            {error}
          </div>
        )}

        <div>
          <h2 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">Quick Links</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <QuickLinkCard
              title="Pipeline Runs"
              description="View and manage evolution pipeline runs"
              href="/admin/quality/evolution"
              icon="🔄"
            />
            <QuickLinkCard
              title="Elo Optimization"
              description="Strategy performance and ROI analysis"
              href="/admin/quality/optimization"
              icon="🎯"
            />
            <QuickLinkCard
              title="Hall of Fame"
              description="Browse and manage hall of fame entries"
              href="/admin/quality/hall-of-fame"
              icon="📚"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">Runs Over Time (30d)</h3>
            <RunsChart data={dashboardData?.runsPerDay ?? []} />
          </div>
          <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">Daily Spend (30d)</h3>
            <SpendChart data={dashboardData?.dailySpend ?? []} />
          </div>
        </div>

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
                  <th className="p-3 text-left">Duration</th>
                  <th className="p-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {!dashboardData && (
                  <tr><td colSpan={7} className="p-8 text-center text-[var(--text-muted)]">Loading...</td></tr>
                )}
                {dashboardData && dashboardData.recentRuns.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-[var(--text-muted)]">No runs found</td></tr>
                )}
                {dashboardData && dashboardData.recentRuns.length > 0 &&
                  dashboardData.recentRuns.map((run: DashboardRun) => (
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
                      <td className="p-3"><ElapsedTime startedAt={run.started_at} completedAt={run.completed_at} status={run.status} /></td>
                      <td className="p-3 text-[var(--text-muted)] text-xs">{new Date(run.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AutoRefreshProvider>
  );
}
