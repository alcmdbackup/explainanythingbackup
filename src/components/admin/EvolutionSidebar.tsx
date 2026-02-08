'use client';
// Evolution sidebar navigation. Thin wrapper over BaseSidebar with evolution-specific nav items.

import { BaseSidebar, NavItem } from '@/components/admin/BaseSidebar';

const navItems: NavItem[] = [
  { href: '/admin/evolution-dashboard', label: 'Overview', icon: '📊', testId: 'evolution-sidebar-nav-overview' },
  { href: '/admin/quality/evolution', label: 'Runs', icon: '🔄', testId: 'evolution-sidebar-nav-pipeline-runs' },
  { href: '/admin/quality/evolution/dashboard', label: 'Ops Dashboard', icon: '📈', testId: 'evolution-sidebar-nav-ops-dashboard' },
  { href: '/admin/quality/explorer', label: 'Explorer', icon: '🔍', testId: 'evolution-sidebar-nav-explorer' },
  { href: '/admin/quality/prompts', label: 'Prompts', icon: '📝', testId: 'evolution-sidebar-nav-prompts' },
  { href: '/admin/quality/strategies', label: 'Strategies', icon: '🧪', testId: 'evolution-sidebar-nav-strategies' },
  { href: '/admin/quality/optimization', label: 'Elo Optimization', icon: '🎯', testId: 'evolution-sidebar-nav-optimization' },
  { href: '/admin/quality/article-bank', label: 'Article Bank', icon: '📚', testId: 'evolution-sidebar-nav-article-bank' },
  { href: '/admin/quality', label: 'Quality Scores', icon: '⭐', testId: 'evolution-sidebar-nav-quality' },
];

const activeOverrides: Record<string, (pathname: string) => boolean> = {
  '/admin/evolution-dashboard': (p) => p === '/admin/evolution-dashboard',
  '/admin/quality': (p) => p === '/admin/quality',
  '/admin/quality/evolution': (p) =>
    p === '/admin/quality/evolution' ||
    (p.startsWith('/admin/quality/evolution') && !p.startsWith('/admin/quality/evolution/dashboard')),
};

export function EvolutionSidebar() {
  return (
    <BaseSidebar
      title="Evolution Dashboard"
      navItems={navItems}
      backLink={{ label: '← Back to Admin', href: '/admin', testId: 'evolution-sidebar-back-to-admin' }}
      activeOverrides={activeOverrides}
    />
  );
}
