'use client';
// Evolution Dashboard overview page. Shows summary metrics, quick links, operational charts, and recent runs.

import { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  AutoRefreshProvider,
  RefreshIndicator,
  useAutoRefresh,
} from '@evolution/components/evolution';
import { formatCost } from '@evolution/lib/utils/formatters';
import { RunsTable, getBaseColumns } from '@evolution/components/evolution/RunsTable';
import {
  getEvolutionDashboardDataAction,
  type DashboardData,
  type DashboardRun,
} from '@evolution/services/evolutionVisualizationActions';

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

// ─── Summary metric card ────────────────────────────────────────

function SummaryCard({ label, value, subValue, testId }: {
  label: string;
  value: string | number;
  subValue?: string;
  testId?: string;
}): JSX.Element {
  return (
    <div
      className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4"
      data-testid={testId}
    >
      <div className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-display font-bold text-[var(--text-primary)] mt-1">{value}</div>
      {subValue && <div className="text-xs text-[var(--text-muted)] mt-0.5">{subValue}</div>}
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────

export default function EvolutionDashboardOverviewPage() {
  return (
    <AutoRefreshProvider isActive={true} intervalMs={15000}>
      <DashboardContent />
    </AutoRefreshProvider>
  );
}

function DashboardContent() {
  const { refreshKey, reportRefresh, reportError } = useAutoRefresh();
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const dashResult = await getEvolutionDashboardDataAction();
      if (dashResult.success) {
        setDashboardData(dashResult.data);
        setError(null);
        reportRefresh();
      } else {
        const msg = dashResult.error?.message ?? 'Dashboard data failed';
        setError(msg);
        reportError(msg);
      }
    }
    load();
  }, [refreshKey, reportRefresh, reportError]);

  // Compute summary metrics from dashboard data
  const avgCost = useMemo(() => {
    if (!dashboardData?.recentRuns.length) return '—';
    const completed = dashboardData.recentRuns.filter(r => r.status === 'completed');
    if (completed.length === 0) return '—';
    const avg = completed.reduce((s, r) => s + r.total_cost_usd, 0) / completed.length;
    return formatCost(avg);
  }, [dashboardData]);

  const spendTrend = useMemo(() => {
    if (!dashboardData) return undefined;
    const { monthlySpend, previousMonthSpend } = dashboardData;
    if (previousMonthSpend === 0) return undefined;
    const pct = ((monthlySpend - previousMonthSpend) / previousMonthSpend) * 100;
    const sign = pct >= 0 ? '+' : '';
    return `${sign}${pct.toFixed(0)}% vs last month`;
  }, [dashboardData]);

  return (
      <div className="space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
              Evolution Dashboard
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              At-a-glance metrics and trends for the content evolution pipeline
            </p>
          </div>
          <RefreshIndicator />
        </div>

        {error && (
          <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)] rounded-page text-[var(--status-error)] text-sm">
            {error}
          </div>
        )}

        {/* Summary metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            label="Active Runs"
            value={dashboardData?.activeRuns ?? '—'}
            subValue={dashboardData ? `${dashboardData.queueDepth} queued` : undefined}
            testId="summary-active-runs"
          />
          <SummaryCard
            label="Success Rate (7d)"
            value={dashboardData ? `${dashboardData.successRate7d}%` : '—'}
            subValue={dashboardData ? `${dashboardData.articlesEvolvedCount} articles evolved` : undefined}
            testId="summary-success-rate"
          />
          <SummaryCard
            label="Avg Cost / Run"
            value={avgCost}
            testId="summary-avg-cost"
          />
          <SummaryCard
            label="Monthly Spend"
            value={dashboardData ? formatCost(dashboardData.monthlySpend) : '—'}
            subValue={spendTrend}
            testId="summary-monthly-spend"
          />
        </div>

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
          <RunsTable<DashboardRun>
            runs={dashboardData?.recentRuns ?? []}
            columns={getBaseColumns<DashboardRun>()}
            loading={!dashboardData}
            compact
            maxRows={5}
            testId="dashboard-runs-table"
          />
        </div>
      </div>
  );
}
