'use client';
// Evolution sidebar navigation with grouped sections. Thin wrapper over BaseSidebar.

import { BaseSidebar, type NavGroup } from '@/components/admin/BaseSidebar';

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/admin/evolution-dashboard', label: 'Dashboard', icon: '📊', testId: 'evolution-sidebar-nav-overview', description: 'At-a-glance metrics and trends' },
      { href: '/admin/evolution/start-experiment', label: 'Start Experiment', icon: '🧪', testId: 'evolution-sidebar-nav-start-experiment', description: 'Launch a new experiment' },
    ],
  },
  {
    label: 'Entities',
    items: [
      { href: '/admin/evolution/experiments', label: 'Experiments', icon: '🔬', testId: 'evolution-sidebar-nav-experiments', description: 'Experiment history and detail' },
      { href: '/admin/evolution/prompts', label: 'Prompts', icon: '📝', testId: 'evolution-sidebar-nav-prompts', description: 'Manage prompt templates' },
      { href: '/admin/evolution/strategies', label: 'Strategies', icon: '⚙️', testId: 'evolution-sidebar-nav-strategies', description: 'Evolution strategy configs' },
      { href: '/admin/evolution/runs', label: 'Runs', icon: '🔄', testId: 'evolution-sidebar-nav-runs', description: 'Pipeline run history' },
      { href: '/admin/evolution/invocations', label: 'Invocations', icon: '🤖', testId: 'evolution-sidebar-nav-invocations', description: 'Agent invocation history' },
      { href: '/admin/evolution/variants', label: 'Variants', icon: '📄', testId: 'evolution-sidebar-nav-variants', description: 'Generated variant history' },
    ],
  },
  {
    label: 'Results',
    items: [
      { href: '/admin/evolution/arena', label: 'Arena', icon: '🏟️', testId: 'evolution-sidebar-nav-arena', description: 'Best evolved content' },
    ],
  },
];

/** Matches exact path or any sub-path (prefix match). */
function prefixMatcher(base: string): (pathname: string) => boolean {
  return (p) => p === base || p.startsWith(`${base}/`);
}

/** Dashboard uses exact match only; all other nav items use prefix matching. */
const activeOverrides: Record<string, (pathname: string) => boolean> = Object.fromEntries(
  navGroups.flatMap(g => g.items).map(item => [
    item.href,
    item.href === '/admin/evolution-dashboard'
      ? (p: string) => p === item.href
      : prefixMatcher(item.href),
  ]),
);

export function EvolutionSidebar(): JSX.Element {
  return (
    <BaseSidebar
      title="Evolution Dashboard"
      navItems={navGroups}
      backLink={{ label: '← Back to Admin', href: '/admin', testId: 'evolution-sidebar-back-to-admin' }}
      activeOverrides={activeOverrides}
    />
  );
}
