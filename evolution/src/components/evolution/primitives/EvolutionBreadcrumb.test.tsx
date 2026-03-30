// Tests for shared EvolutionBreadcrumb component.

import { render, screen } from '@testing-library/react';
import { EvolutionBreadcrumb } from './EvolutionBreadcrumb';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import React from 'react';

describe('EvolutionBreadcrumb', () => {
  it('renders nothing for empty items', () => {
    const { container } = render(<EvolutionBreadcrumb items={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders single item as plain text (no link)', () => {
    render(<EvolutionBreadcrumb items={[{ label: 'Explorer' }]} />);
    expect(screen.getByText('Explorer')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders linked parent and plain current page', () => {
    render(
      <EvolutionBreadcrumb items={[
        { label: 'Dashboard', href: '/admin/evolution-dashboard' },
        { label: 'Explorer' },
      ]} />,
    );
    const link = screen.getByRole('link', { name: 'Dashboard' });
    expect(link).toHaveAttribute('href', '/admin/evolution-dashboard');
    expect(screen.getByText('Explorer')).toBeInTheDocument();
  });

  it('renders 3-level breadcrumb for run detail with tab', () => {
    render(
      <EvolutionBreadcrumb items={[
        { label: 'Evolution', href: '/admin/evolution/runs' },
        { label: 'Run abc123', href: '?tab=timeline' },
        { label: 'Timeline' },
      ]} />,
    );
    expect(screen.getByRole('link', { name: 'Evolution' })).toHaveAttribute('href', '/admin/evolution/runs');
    expect(screen.getByRole('link', { name: 'Run abc123' })).toHaveAttribute('href', '?tab=timeline');
    expect(screen.getByText('Timeline')).toBeInTheDocument();
  });

  it('renders separators between items', () => {
    render(
      <EvolutionBreadcrumb items={[
        { label: 'A', href: '/a' },
        { label: 'B' },
      ]} />,
    );
    expect(screen.getAllByText('/')).toHaveLength(1);
  });

  it('has aria-label and data-testid', () => {
    render(<EvolutionBreadcrumb items={[{ label: 'X' }]} />);
    const nav = screen.getByTestId('evolution-breadcrumb');
    expect(nav).toHaveAttribute('aria-label', 'Breadcrumb');
  });
});
