// Tests for BaseSidebar shared rendering, activeOverrides, and default active state logic.

import { render, screen } from '@testing-library/react';
import { BaseSidebar, NavItem } from './BaseSidebar';

const mockUsePathname = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => mockUsePathname(),
  useSearchParams: () => new URLSearchParams(),
}));

const testItems: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: '📊', testId: 'nav-dashboard' },
  { href: '/admin/users', label: 'Users', icon: '👥', testId: 'nav-users' },
  { href: '/admin/settings', label: 'Settings', icon: '⚙️', testId: 'nav-settings' },
];

const defaultProps = {
  title: 'Test Sidebar',
  navItems: testItems,
  backLink: { label: '← Back', href: '/', testId: 'back-link' },
};

describe('BaseSidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePathname.mockReturnValue('/admin');
  });

  it('renders title, nav items, and back link', () => {
    render(<BaseSidebar {...defaultProps} />);

    expect(screen.getByText('Test Sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('nav-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('nav-users')).toBeInTheDocument();
    expect(screen.getByTestId('nav-settings')).toBeInTheDocument();
    expect(screen.getByTestId('back-link')).toHaveAttribute('href', '/');
    expect(screen.getByText('← Back')).toBeInTheDocument();
  });

  it('uses default startsWith active state when no overrides', () => {
    mockUsePathname.mockReturnValue('/admin/users/123');
    render(<BaseSidebar {...defaultProps} />);

    const usersLink = screen.getByTestId('nav-users');
    expect(usersLink.className).toContain('bg-[var(--accent-gold)]');
  });

  it('applies activeOverrides when provided', () => {
    mockUsePathname.mockReturnValue('/admin');
    const overrides = {
      '/admin': (p: string) => p === '/admin',
    };
    render(<BaseSidebar {...defaultProps} activeOverrides={overrides} />);

    const dashboardLink = screen.getByTestId('nav-dashboard');
    expect(dashboardLink.className).toContain('bg-[var(--accent-gold)]');

    // Users should NOT be active (default startsWith would match /admin, but override restricts /admin to exact)
    const usersLink = screen.getByTestId('nav-users');
    expect(usersLink.className).not.toContain('bg-[var(--accent-gold)]');
  });

  it('renders empty nav gracefully', () => {
    render(<BaseSidebar {...defaultProps} navItems={[]} />);

    expect(screen.getByText('Test Sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('back-link')).toBeInTheDocument();
  });

  it('inactive items get default styling class', () => {
    mockUsePathname.mockReturnValue('/other/page');
    render(<BaseSidebar {...defaultProps} />);

    const dashboardLink = screen.getByTestId('nav-dashboard');
    expect(dashboardLink.className).toContain('text-[var(--text-secondary)]');
    expect(dashboardLink.className).not.toContain('bg-[var(--accent-gold)]');
  });
});
