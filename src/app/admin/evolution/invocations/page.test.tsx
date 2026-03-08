// Tests for invocations list page rendering using EntityListPage.

import { render, screen } from '@testing-library/react';
import InvocationsListPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/invocations',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/services/evolutionVisualizationActions', () => ({
  listInvocationsAction: jest.fn(),
}));

import { listInvocationsAction } from '@evolution/services/evolutionVisualizationActions';

describe('InvocationsListPage', () => {
  beforeEach(() => {
    (listInvocationsAction as jest.Mock).mockResolvedValue({ success: true, data: { items: [], total: 0 } });
  });

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
    expect(screen.getByTestId('filter-runId')).toBeInTheDocument();
    expect(screen.getByTestId('filter-agent')).toBeInTheDocument();
    expect(screen.getByTestId('filter-status')).toBeInTheDocument();
  });

  it('renders entity list page wrapper', () => {
    render(<InvocationsListPage />);
    expect(screen.getByTestId('entity-list-page')).toBeInTheDocument();
  });
});
