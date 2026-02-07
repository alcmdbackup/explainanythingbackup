'use client';
// Evolution Dashboard overview page. Shows high-level stats and quick links to evolution sub-pages.

import { useState, useCallback } from 'react';
import Link from 'next/link';
import {
  AutoRefreshProvider,
  RefreshIndicator,
} from '@/components/evolution';
import {
  getEvolutionDashboardDataAction,
  type DashboardData,
} from '@/lib/services/evolutionVisualizationActions';
import { getOptimizationSummaryAction } from '@/lib/services/eloBudgetActions';

type OptimizationSummary = NonNullable<
  Awaited<ReturnType<typeof getOptimizationSummaryAction>> extends { data?: infer T } ? T : never
>;

function StatCard({ label, value, subtitle, testId }: { label: string; value: string; subtitle?: string; testId: string }) {
  return (
    <div
      className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4"
      data-testid={testId}
    >
      <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold text-[var(--text-primary)] mt-1">{value}</div>
      {subtitle && <div className="text-xs text-[var(--text-muted)] mt-1">{subtitle}</div>}
    </div>
  );
}

function QuickLinkCard({ title, description, href, icon }: { title: string; description: string; href: string; icon: string }) {
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

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function computeSpendTrend(current: number, previous: number): string {
  if (previous === 0) return '';
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 1) return '→ flat';
  return pct > 0 ? `↑ ${pct.toFixed(0)}%` : `↓ ${Math.abs(pct).toFixed(0)}%`;
}

export default function EvolutionDashboardOverviewPage() {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [optimizationData, setOptimizationData] = useState<OptimizationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRefresh = useCallback(async () => {
    const [dashResult, optResult] = await Promise.allSettled([
      getEvolutionDashboardDataAction(),
      getOptimizationSummaryAction(),
    ]);

    // Two-level unwrap: first check PromiseSettledResult status, then ActionResult shape
    // Dashboard action: ActionResult<T> = { success, data: T | null, error: ErrorResponse | null }
    if (dashResult.status === 'fulfilled' && dashResult.value.success) {
      setDashboardData(dashResult.value.data);
      setError(null);
    } else if (dashResult.status === 'fulfilled') {
      setError(dashResult.value.error?.message ?? 'Dashboard data failed');
    } else {
      setError(String(dashResult.reason));
    }

    // Optimization action: ActionResult<T> = { success, data?: T, error?: string }
    if (optResult.status === 'fulfilled' && optResult.value.success) {
      setOptimizationData(optResult.value.data ?? null);
    } else if (optResult.status === 'fulfilled') {
      setError(prev => prev ?? (optResult.value.error ?? 'Optimization data failed'));
    } else {
      setError(prev => prev ?? String(optResult.reason));
    }
  }, []);

  // Compute derived stats
  const lastCompletedRun = dashboardData?.recentRuns.find(r => r.status === 'completed');
  const lastCompletedLabel = lastCompletedRun?.completed_at
    ? formatRelativeTime(lastCompletedRun.completed_at)
    : 'N/A';

  const spendTrend = dashboardData
    ? computeSpendTrend(dashboardData.monthlySpend, dashboardData.previousMonthSpend)
    : '';

  const failedRuns7d = dashboardData
    ? dashboardData.runsPerDay
        .filter(d => {
          const daysAgo = (Date.now() - new Date(d.date).getTime()) / (24 * 60 * 60 * 1000);
          return daysAgo <= 7;
        })
        .reduce((sum, d) => sum + d.failed, 0)
    : 0;

  return (
    <AutoRefreshProvider onRefresh={handleRefresh}>
      <div className="space-y-6">
        {/* Header */}
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

        {/* Stat cards — differentiated from Ops Dashboard */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            label="Last Completed Run"
            value={lastCompletedLabel}
            testId="stat-card-last-completed"
          />
          <StatCard
            label="7d Success Rate"
            value={`${dashboardData?.successRate7d ?? 0}%`}
            testId="stat-card-success-rate"
          />
          <StatCard
            label="Monthly Spend"
            value={`$${(dashboardData?.monthlySpend ?? 0).toFixed(2)}`}
            subtitle={spendTrend || undefined}
            testId="stat-card-monthly-spend"
          />
          <StatCard
            label="Article Bank Size"
            value={String(dashboardData?.articleBankSize ?? 0)}
            testId="stat-card-bank-size"
          />
          <StatCard
            label="Avg Elo/$"
            value={optimizationData?.avgEloPerDollar != null
              ? optimizationData.avgEloPerDollar.toFixed(1)
              : 'N/A'}
            testId="stat-card-avg-elo-per-dollar"
          />
          <StatCard
            label="Failed Runs (7d)"
            value={String(failedRuns7d)}
            testId="stat-card-failed-runs"
          />
        </div>

        {/* Quick link cards */}
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
              title="Ops Dashboard"
              description="Operational metrics and charts"
              href="/admin/quality/evolution/dashboard"
              icon="📈"
            />
            <QuickLinkCard
              title="Elo Optimization"
              description="Strategy performance and ROI analysis"
              href="/admin/quality/optimization"
              icon="🎯"
            />
            <QuickLinkCard
              title="Article Bank"
              description="Browse and manage article bank entries"
              href="/admin/quality/article-bank"
              icon="📚"
            />
            <QuickLinkCard
              title="Quality Scores"
              description="Content quality scoring dashboard"
              href="/admin/quality"
              icon="⭐"
            />
          </div>
        </div>
      </div>
    </AutoRefreshProvider>
  );
}
