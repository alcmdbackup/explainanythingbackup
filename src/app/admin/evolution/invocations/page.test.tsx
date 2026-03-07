// Tests for invocations list page rendering.

import { render, screen } from '@testing-library/react';
import InvocationsListPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/invocations',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/services/evolutionVisualizationActions', () => ({
  listInvocationsAction: jest.fn().mockResolvedValue({ success: true, data: { items: [], total: 0 } }),
}));

describe('InvocationsListPage', () => {
  it('renders page heading', () => {
    render(<InvocationsListPage />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Invocations');
  });

  it('renders breadcrumb with Dashboard link', () => {
    render(<InvocationsListPage />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders filter controls', () => {
    render(<InvocationsListPage />);
    expect(screen.getByTestId('invocation-run-filter')).toBeInTheDocument();
    expect(screen.getByTestId('invocation-agent-filter')).toBeInTheDocument();
    expect(screen.getByTestId('invocation-success-filter')).toBeInTheDocument();
  });

  it('renders refresh button', () => {
    render(<InvocationsListPage />);
    expect(screen.getByRole('button', { name: /refresh|loading/i })).toBeInTheDocument();
  });
});
