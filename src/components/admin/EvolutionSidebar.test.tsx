// Tests for EvolutionSidebar nav items, active state, and back link.

import { render, screen } from '@testing-library/react';
import { EvolutionSidebar } from './EvolutionSidebar';

const mockUsePathname = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => mockUsePathname(),
  useSearchParams: () => new URLSearchParams(),
}));

describe('EvolutionSidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePathname.mockReturnValue('/admin/evolution-dashboard');
  });

  it('renders all nav items with correct hrefs', () => {
    render(<EvolutionSidebar />);

    const expectedItems = [
      { testId: 'evolution-sidebar-nav-overview', href: '/admin/evolution-dashboard' },
      { testId: 'evolution-sidebar-nav-start-experiment', href: '/admin/evolution/start-experiment' },
      { testId: 'evolution-sidebar-nav-experiments', href: '/admin/evolution/experiments' },
      { testId: 'evolution-sidebar-nav-prompts', href: '/admin/evolution/prompts' },
      { testId: 'evolution-sidebar-nav-strategies', href: '/admin/evolution/strategies' },
      { testId: 'evolution-sidebar-nav-tactics', href: '/admin/evolution/tactics' },
      { testId: 'evolution-sidebar-nav-runs', href: '/admin/evolution/runs' },
      { testId: 'evolution-sidebar-nav-invocations', href: '/admin/evolution/invocations' },
      { testId: 'evolution-sidebar-nav-variants', href: '/admin/evolution/variants' },
      { testId: 'evolution-sidebar-nav-arena', href: '/admin/evolution/arena' },
    ];

    for (const { testId, href } of expectedItems) {
      const link = screen.getByTestId(testId);
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', href);
    }
  });

  it('highlights Overview for /admin/evolution-dashboard', () => {
    mockUsePathname.mockReturnValue('/admin/evolution-dashboard');
    render(<EvolutionSidebar />);

    const overview = screen.getByTestId('evolution-sidebar-nav-overview');
    expect(overview.className).toContain('bg-[var(--accent-gold)]');
  });

  it('highlights Runs for /admin/evolution/runs', () => {
    mockUsePathname.mockReturnValue('/admin/evolution/runs');
    render(<EvolutionSidebar />);

    const runs = screen.getByTestId('evolution-sidebar-nav-runs');
    expect(runs.className).toContain('bg-[var(--accent-gold)]');
  });

  it('renders Runs label for runs nav item', () => {
    render(<EvolutionSidebar />);

    const runs = screen.getByTestId('evolution-sidebar-nav-runs');
    expect(runs).toHaveTextContent('Runs');
  });

  it('has Back to Admin link pointing to /admin', () => {
    render(<EvolutionSidebar />);

    const backLink = screen.getByTestId('evolution-sidebar-back-to-admin');
    expect(backLink).toHaveAttribute('href', '/admin');
    expect(backLink).toHaveTextContent('← Back to Admin');
  });

  it('renders title "Evolution Dashboard"', () => {
    render(<EvolutionSidebar />);
    expect(screen.getByText('Evolution Dashboard')).toBeInTheDocument();
  });
});
