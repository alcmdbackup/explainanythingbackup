// Tests for SidebarSwitcher conditional sidebar rendering based on pathname.

import { render, screen } from '@testing-library/react';
import { SidebarSwitcher } from './SidebarSwitcher';

const mockUsePathname = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => mockUsePathname(),
  useSearchParams: () => new URLSearchParams(),
}));

describe('SidebarSwitcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('renders AdminSidebar for admin paths', () => {
    it.each([
      '/admin',
      '/admin/users',
      '/admin/costs',
      '/admin/content',
      '/admin/settings',
      '/admin/audit',
    ])('shows "Admin Dashboard" title for %s', (pathname) => {
      mockUsePathname.mockReturnValue(pathname);
      render(<SidebarSwitcher />);
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });
  });

  describe('renders EvolutionSidebar for evolution paths', () => {
    it.each([
      '/admin/evolution-dashboard',
      '/admin/quality',
      '/admin/quality/evolution',
      '/admin/quality/evolution/run/abc-123',
      '/admin/quality/optimization',
      '/admin/quality/article-bank',
    ])('shows "Evolution Dashboard" title for %s', (pathname) => {
      mockUsePathname.mockReturnValue(pathname);
      render(<SidebarSwitcher />);
      expect(screen.getByText('Evolution Dashboard')).toBeInTheDocument();
    });
  });

  it('does NOT render EvolutionSidebar for /admin/quality-reports (greedy match edge case)', () => {
    mockUsePathname.mockReturnValue('/admin/quality-reports');
    render(<SidebarSwitcher />);
    expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
  });

  it('/admin/quality (no trailing slash) renders EvolutionSidebar', () => {
    mockUsePathname.mockReturnValue('/admin/quality');
    render(<SidebarSwitcher />);
    expect(screen.getByText('Evolution Dashboard')).toBeInTheDocument();
  });
});
