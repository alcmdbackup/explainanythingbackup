// Tests for AdminSidebar nav items after evolution consolidation.

import { render, screen } from '@testing-library/react';
import { AdminSidebar } from './AdminSidebar';

const mockUsePathname = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => mockUsePathname(),
  useSearchParams: () => new URLSearchParams(),
}));

describe('AdminSidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePathname.mockReturnValue('/admin');
  });

  it('renders exactly 10 nav items', () => {
    render(<AdminSidebar />);

    const navItems = screen.getAllByRole('link').filter(
      link => link.getAttribute('data-testid')?.startsWith('admin-sidebar-nav-')
    );
    expect(navItems).toHaveLength(10);
  });

  it('has Evolution item linking to /admin/evolution-dashboard', () => {
    render(<AdminSidebar />);

    const evolutionLink = screen.getByTestId('admin-sidebar-nav-evolution');
    expect(evolutionLink).toHaveAttribute('href', '/admin/evolution-dashboard');
    expect(evolutionLink).toHaveTextContent('Evolution');
  });

  it('does not contain removed items (optimization, arena, quality)', () => {
    render(<AdminSidebar />);

    expect(screen.queryByTestId('admin-sidebar-nav-optimization')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-sidebar-nav-arena')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-sidebar-nav-quality')).not.toBeInTheDocument();
  });

  it('has Back to App link pointing to /', () => {
    render(<AdminSidebar />);

    const backLink = screen.getByTestId('admin-sidebar-back-to-app');
    expect(backLink).toHaveAttribute('href', '/');
    expect(backLink).toHaveTextContent('← Back to App');
  });

  it('renders title "Admin Dashboard"', () => {
    render(<AdminSidebar />);
    expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
  });
});
