'use client';
/**
 * Admin dashboard page.
 * Displays overview metrics, system health, and quick links to admin sections.
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getSystemHealthAction } from '@/lib/services/featureFlags';
import { getReportCountsAction } from '@/lib/services/contentReports';
import { getCostSummaryAction } from '@/lib/services/costAnalytics';

interface DashboardStats {
  explanations: number;
  users: number;
  pendingReports: number;
  totalCost: number;
  databaseHealth: 'healthy' | 'degraded' | 'down';
}

export default function AdminPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStats = useCallback(async () => {
    setLoading(true);

    const [healthResult, reportsResult, costsResult] = await Promise.all([
      getSystemHealthAction(),
      getReportCountsAction(),
      getCostSummaryAction({})
    ]);

    setStats({
      explanations: healthResult.data?.totalExplanations || 0,
      users: healthResult.data?.totalUsers || 0,
      pendingReports: reportsResult.data?.pending || 0,
      totalCost: costsResult.data?.totalCost || 0,
      databaseHealth: healthResult.data?.database || 'down'
    });

    setLoading(false);
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(2)}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
          Admin Dashboard
        </h1>
        <button
          onClick={loadStats}
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          Refresh
        </button>
      </div>

      {/* System Health Banner */}
      <div className={`p-4 rounded-lg border ${
        stats?.databaseHealth === 'healthy'
          ? 'bg-green-50 border-green-200'
          : stats?.databaseHealth === 'degraded'
          ? 'bg-yellow-50 border-yellow-200'
          : 'bg-red-50 border-red-200'
      }`}>
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full ${
            stats?.databaseHealth === 'healthy'
              ? 'bg-green-500'
              : stats?.databaseHealth === 'degraded'
              ? 'bg-yellow-500'
              : 'bg-red-500'
          }`} />
          <div>
            <span className={`font-medium ${
              stats?.databaseHealth === 'healthy'
                ? 'text-green-800'
                : stats?.databaseHealth === 'degraded'
                ? 'text-yellow-800'
                : 'text-red-800'
            }`}>
              System Status: {loading ? 'Checking...' : stats?.databaseHealth === 'healthy' ? 'All Systems Operational' : stats?.databaseHealth === 'degraded' ? 'Degraded Performance' : 'System Issues Detected'}
            </span>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Explanations"
          value={loading ? '...' : stats?.explanations.toLocaleString() || '0'}
          icon="📝"
        />
        <StatCard
          title="Pending Reports"
          value={loading ? '...' : stats?.pendingReports.toString() || '0'}
          icon="🚨"
          highlight={stats?.pendingReports ? stats.pendingReports > 0 : false}
        />
        <StatCard
          title="LLM Costs (30d)"
          value={loading ? '...' : formatCost(stats?.totalCost || 0)}
          icon="💰"
        />
        <StatCard
          title="Active Users"
          value={loading ? '...' : stats?.users.toLocaleString() || '0'}
          icon="👥"
        />
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <DashboardCard
          title="Content"
          description="Manage explanations"
          href="/admin/content"
          icon="📝"
        />
        <DashboardCard
          title="Reports Queue"
          description="Review user reports"
          href="/admin/reports"
          icon="🚨"
          badge={stats?.pendingReports ? `${stats.pendingReports} pending` : undefined}
        />
        <DashboardCard
          title="Users"
          description="Manage user accounts"
          href="/admin/users"
          icon="👥"
        />
        <DashboardCard
          title="Costs"
          description="LLM usage analytics"
          href="/admin/costs"
          icon="💰"
        />
        <DashboardCard
          title="Whitelist"
          description="Link management"
          href="/admin/whitelist"
          icon="🔗"
        />
        <DashboardCard
          title="Audit Log"
          description="Admin activity history"
          href="/admin/audit"
          icon="📋"
        />
        <DashboardCard
          title="Settings"
          description="Feature flags and config"
          href="/admin/settings"
          icon="⚙️"
        />
        <DashboardCard
          title="Dev Tools"
          description="Debug and test pages"
          href="/admin/dev-tools"
          icon="🛠️"
        />
      </div>

      {/* Recent Activity Placeholder */}
      <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] p-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
          Quick Actions
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/reports?status=pending"
            className="px-3 py-2 text-sm bg-[var(--bg-tertiary)] rounded hover:bg-[var(--accent-primary)] hover:text-white transition-colors"
          >
            Review Pending Reports
          </Link>
          <Link
            href="/admin/audit"
            className="px-3 py-2 text-sm bg-[var(--bg-tertiary)] rounded hover:bg-[var(--accent-primary)] hover:text-white transition-colors"
          >
            View Recent Activity
          </Link>
          <Link
            href="/admin/costs"
            className="px-3 py-2 text-sm bg-[var(--bg-tertiary)] rounded hover:bg-[var(--accent-primary)] hover:text-white transition-colors"
          >
            Check Cost Analytics
          </Link>
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  icon: string;
  highlight?: boolean;
}

function StatCard({ title, value, icon, highlight }: StatCardProps) {
  return (
    <div className={`p-4 rounded-lg border ${
      highlight
        ? 'bg-red-50 border-red-200'
        : 'bg-[var(--bg-secondary)] border-[var(--border-color)]'
    }`}>
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <p className="text-sm text-[var(--text-muted)]">{title}</p>
          <p className={`text-xl font-bold ${highlight ? 'text-red-600' : 'text-[var(--text-primary)]'}`}>
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

interface DashboardCardProps {
  title: string;
  description: string;
  href: string;
  icon: string;
  badge?: string;
}

function DashboardCard({ title, description, href, icon, badge }: DashboardCardProps) {
  return (
    <Link
      href={href}
      className="block p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] hover:border-[var(--accent-primary)] transition-colors"
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{icon}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-[var(--text-primary)]">{title}</h3>
            {badge && (
              <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full">
                {badge}
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--text-muted)] mt-1">{description}</p>
        </div>
      </div>
    </Link>
  );
}
