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
      { href: '/admin/evolution/tactics', label: 'Tactics', icon: '⚔️', testId: 'evolution-sidebar-nav-tactics', description: 'Generation tactics registry' },
      { href: '/admin/evolution/criteria', label: 'Criteria', icon: '🎯', testId: 'evolution-sidebar-nav-criteria', description: 'Quality evaluation criteria' },
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
  // Tools: utilities that are not entity-list pages. Match Viewer
  // (match_viewer_with_experimentation_procedures_20260605) browses judge matches and
  // re-runs judging in a display-only sandbox; Prompt Editor tests rewrite prompts live.
  {
    label: 'Tools',
    items: [
      { href: '/admin/evolution/matches', label: 'Match Viewer', icon: '⚖️', testId: 'evolution-sidebar-nav-matches', description: 'Judge match history and re-run comparisons' },
      { href: '/admin/evolution/judge-rubrics', label: 'Judge Rubrics', icon: '📋', testId: 'evolution-sidebar-nav-judge-rubrics', description: 'Weighted rubric bundles for rubric-based judging' },
      { href: '/admin/evolution/prompt-editor', label: 'Prompt Editor', icon: '🎛️', testId: 'evolution-sidebar-nav-prompt-editor', description: 'Test rewrite prompts live' },
      { href: '/admin/evolution/judge-lab', label: 'Judge Lab', icon: '🧮', testId: 'evolution-sidebar-nav-judge-lab', description: 'Systematic judge-settings evaluation on a test set' },
      { href: '/admin/evolution/weight-inference', label: 'Implied Rubric Weights', icon: '🪄', testId: 'evolution-sidebar-nav-weight-inference', description: 'Infer judge-rubric weights from pairwise winners (human or LLM-judged)' },
    ],
  },
];

const DASHBOARD_PATH = '/admin/evolution-dashboard';

const activeOverrides: Record<string, (pathname: string) => boolean> = Object.fromEntries(
  navGroups.flatMap(g => g.items).map(({ href }) => [
    href,
    href === DASHBOARD_PATH
      ? (p: string) => p === href
      : (p: string) => p === href || p.startsWith(`${href}/`),
  ]),
);

// Fix #2/#19 (use_playwright_find_ux_issues_bugs_20260501): the sidebar header
// said "Evolution Dashboard" on every evolution page, including the Runs/Arena/
// Experiments lists. The breadcrumb already carries section context, so the
// header just needs to identify the section root — "Evolution" is enough.
export function EvolutionSidebar(): JSX.Element {
  return (
    <BaseSidebar
      title="Evolution"
      navItems={navGroups}
      backLink={{ label: '← Back to Admin', href: '/admin', testId: 'evolution-sidebar-back-to-admin' }}
      activeOverrides={activeOverrides}
    />
  );
}
