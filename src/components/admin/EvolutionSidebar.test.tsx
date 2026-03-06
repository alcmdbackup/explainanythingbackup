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
      { testId: 'evolution-sidebar-nav-explorer', href: '/admin/quality/explorer' },
      { testId: 'evolution-sidebar-nav-optimization', href: '/admin/quality/optimization' },
      { testId: 'evolution-sidebar-nav-pipeline-runs', href: '/admin/quality/evolution' },
      { testId: 'evolution-sidebar-nav-hall-of-fame', href: '/admin/quality/hall-of-fame' },
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

  it('highlights Pipeline Runs for /admin/quality/evolution', () => {
    mockUsePathname.mockReturnValue('/admin/quality/evolution');
    render(<EvolutionSidebar />);

    const pipelineRuns = screen.getByTestId('evolution-sidebar-nav-pipeline-runs');
    expect(pipelineRuns.className).toContain('bg-[var(--accent-gold)]');
  });

  it('renders Pipeline Runs label for pipeline runs', () => {
    render(<EvolutionSidebar />);

    const pipelineRuns = screen.getByTestId('evolution-sidebar-nav-pipeline-runs');
    expect(pipelineRuns).toHaveTextContent('Pipeline Runs');
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
