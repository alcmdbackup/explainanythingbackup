// Tests for the evolution runs list page rendering and filters.

import { render, screen, waitFor } from '@testing-library/react';
import EvolutionRunsPage from './page';

const mockToastError = jest.fn();
jest.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args), success: jest.fn() },
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/runs',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/services/evolutionActions', () => ({
  getEvolutionRunsAction: jest.fn().mockResolvedValue({
    success: true,
    data: {
      items: [
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
      total: 1,
    },
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
  it('renders breadcrumb with Evolution link', () => {
    render(<EvolutionRunsPage />);
    expect(screen.getByText('Evolution')).toBeInTheDocument();
  });

  it('renders status filter', () => {
    render(<EvolutionRunsPage />);
    expect(screen.getByTestId('filter-status')).toBeInTheDocument();
  });

  it('renders hide test content checkbox (checked by default)', () => {
    render(<EvolutionRunsPage />);
    const label = screen.getByTestId('filter-filterTestContent');
    const checkbox = label.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeInTheDocument();
    expect(checkbox.checked).toBe(true);
  });

  it('does not render include archived filter (archive removed)', () => {
    render(<EvolutionRunsPage />);
    expect(screen.queryByTestId('filter-includeArchived')).not.toBeInTheDocument();
  });

  it('renders runs table', async () => {
    render(<EvolutionRunsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-list-table')).toBeInTheDocument();
    });
  });

  it('renders entity list page wrapper', () => {
    render(<EvolutionRunsPage />);
    expect(screen.getByTestId('entity-list-page')).toBeInTheDocument();
  });

  it('renders Runs breadcrumb item', () => {
    render(<EvolutionRunsPage />);
    expect(screen.getByText('Runs')).toBeInTheDocument();
  });

  it('displays run data after loading', async () => {
    render(<EvolutionRunsPage />);
    await waitFor(() => {
      expect(screen.getByText('Test Strategy')).toBeInTheDocument();
    });
  });

  it('displays run cost', async () => {
    render(<EvolutionRunsPage />);
    await waitFor(() => {
      expect(screen.getByText('$2.50')).toBeInTheDocument();
    });
  });

  it('renders status badge for completed run', async () => {
    render(<EvolutionRunsPage />);
    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });
  });

  it('renders page heading', () => {
    render(<EvolutionRunsPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Evolution Runs');
  });

  it('calls getEvolutionRunsAction on mount', () => {
    const { getEvolutionRunsAction } = jest.requireMock('@evolution/services/evolutionActions');
    render(<EvolutionRunsPage />);
    expect(getEvolutionRunsAction).toHaveBeenCalled();
  });

  it('H1: shows error toast when fetch fails', async () => {
    const { getEvolutionRunsAction } = jest.requireMock('@evolution/services/evolutionActions');
    getEvolutionRunsAction.mockResolvedValueOnce({ success: false, error: { message: 'DB error' } });
    render(<EvolutionRunsPage />);
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('DB error');
    });
  });
});
