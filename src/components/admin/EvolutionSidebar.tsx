'use client';
// Evolution sidebar navigation with grouped sections. Thin wrapper over BaseSidebar.

import { BaseSidebar, type NavGroup } from '@/components/admin/BaseSidebar';

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/admin/evolution-dashboard', label: 'Dashboard', icon: '📊', testId: 'evolution-sidebar-nav-overview', description: 'At-a-glance metrics and trends' },
    ],
  },
  {
    label: 'Runs',
    items: [
      { href: '/admin/quality/evolution', label: 'Pipeline Runs', icon: '🔄', testId: 'evolution-sidebar-nav-pipeline-runs', description: 'Queue, manage, and monitor runs' },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { href: '/admin/quality/explorer', label: 'Explorer', icon: '🔍', testId: 'evolution-sidebar-nav-explorer', description: 'Cross-dimensional analysis' },
      { href: '/admin/quality/optimization', label: 'Rating Optimization', icon: '🎯', testId: 'evolution-sidebar-nav-optimization', description: 'Strategy performance and ROI' },
    ],
  },
  {
    label: 'Reference',
    items: [
      { href: '/admin/quality/prompts', label: 'Prompts', icon: '📝', testId: 'evolution-sidebar-nav-prompts', description: 'Manage prompt templates' },
      { href: '/admin/quality/strategies', label: 'Strategies', icon: '🧪', testId: 'evolution-sidebar-nav-strategies', description: 'Evolution strategy configs' },
      { href: '/admin/quality/arena', label: 'Arena', icon: '📚', testId: 'evolution-sidebar-nav-arena', description: 'Best evolved content' },
    ],
  },
];

const activeOverrides: Record<string, (pathname: string) => boolean> = {
  '/admin/evolution-dashboard': (p) => p === '/admin/evolution-dashboard',
  '/admin/quality/evolution': (p) =>
    p === '/admin/quality/evolution' || p.startsWith('/admin/quality/evolution/'),
};

export function EvolutionSidebar() {
  return (
    <BaseSidebar
      title="Evolution Dashboard"
      navItems={navGroups}
      backLink={{ label: '← Back to Admin', href: '/admin', testId: 'evolution-sidebar-back-to-admin' }}
      activeOverrides={activeOverrides}
    />
  );
}
