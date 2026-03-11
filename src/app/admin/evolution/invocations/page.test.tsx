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

  it('renders Experiment and Strategy column headers', async () => {
    (listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        items: [{
          id: 'inv-1',
          run_id: 'run-1',
          iteration: 1,
          agent_name: 'generator',
          execution_order: 0,
          success: true,
          cost_usd: 0.01,
          skipped: false,
          error_message: null,
          created_at: '2026-01-01T00:00:00Z',
          experiment_name: 'Test Exp',
          strategy_name: 'Test Strat',
        }],
        total: 1,
      },
    });
    render(<InvocationsListPage />);
    expect(await screen.findByText('Experiment')).toBeInTheDocument();
    expect(screen.getByText('Strategy')).toBeInTheDocument();
    expect(screen.getByText('Test Exp')).toBeInTheDocument();
    expect(screen.getByText('Test Strat')).toBeInTheDocument();
  });

  it('renders "—" when experiment_name and strategy_name are null', async () => {
    (listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        items: [{
          id: 'inv-2',
          run_id: 'run-2',
          iteration: 1,
          agent_name: 'generator',
          execution_order: 0,
          success: true,
          cost_usd: 0.01,
          skipped: false,
          error_message: null,
          created_at: '2026-01-01T00:00:00Z',
          experiment_name: null,
          strategy_name: null,
        }],
        total: 1,
      },
    });
    render(<InvocationsListPage />);
    const dashes = await screen.findAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });
});
