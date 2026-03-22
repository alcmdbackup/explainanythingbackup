// Tests for the evolution runs list page rendering and filters.

import { render, screen, waitFor } from '@testing-library/react';
import EvolutionRunsPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/runs',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/services/evolutionActions', () => ({
  getEvolutionRunsAction: jest.fn().mockResolvedValue({
    success: true,
    data: [
      {
        id: 'run-abc12345-0000-0000-0000-000000000001',
        explanation_id: 42,
        status: 'completed',
        budget_cap_usd: 5.00,
        error_message: null,
        completed_at: '2026-03-01T12:00:00Z',
        created_at: '2026-03-01T00:00:00Z',
        prompt_id: null,
        pipeline_version: '2.0',
        strategy_id: 'strat-1',
        experiment_id: null,
        archived: false,
        run_summary: null,
        runner_id: null,
        last_heartbeat: null,
        total_cost_usd: 2.50,
        strategy_name: 'Test Strategy',
      },
    ],
  }),
}));

jest.mock('@evolution/lib/utils/formatters', () => ({
  formatCost: (v: number) => `$${v.toFixed(2)}`,
}));

jest.mock('@evolution/lib/utils/evolutionUrls', () => ({
  buildExplanationUrl: (id: number) => `/admin/explanations/${id}`,
  buildRunUrl: (id: string) => `/admin/evolution/runs/${id}`,
}));

describe('EvolutionRunsPage', () => {
  it('renders page title', () => {
    render(<EvolutionRunsPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Evolution Runs');
  });

  it('renders breadcrumb with Dashboard link', () => {
    render(<EvolutionRunsPage />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders status filter select', () => {
    render(<EvolutionRunsPage />);
    expect(screen.getByTestId('status-filter')).toBeInTheDocument();
  });

  it('renders archived toggle', () => {
    render(<EvolutionRunsPage />);
    expect(screen.getByTestId('archived-toggle')).toBeInTheDocument();
  });

  it('renders runs table', async () => {
    render(<EvolutionRunsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-list-table')).toBeInTheDocument();
    });
  });
});
