// Tests for the evolution dashboard page rendering and data display.

import { render, screen, waitFor } from '@testing-library/react';
import EvolutionDashboardPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution-dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/services/evolutionVisualizationActions', () => ({
  getEvolutionDashboardDataAction: jest.fn().mockResolvedValue({
    success: true,
    data: {
      activeRuns: 2,
      queueDepth: 5,
      completedRuns: 42,
      failedRuns: 3,
      totalCostUsd: 125.50,
      avgCostPerRun: 2.79,
      recentRuns: [
        {
          id: 'run-001',
          status: 'running',
          strategy_name: 'Test Strategy',
          total_cost_usd: 1.50,
          created_at: '2026-03-01T00:00:00Z',
          completed_at: null,
        },
      ],
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

describe('EvolutionDashboardPage', () => {
  it('renders page title', () => {
    render(<EvolutionDashboardPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Evolution Dashboard');
  });

  it('renders metric grid with dashboard data', async () => {
    render(<EvolutionDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-metrics')).toBeInTheDocument();
    });
    expect(screen.getByTestId('metric-active-runs')).toBeInTheDocument();
    expect(screen.getByTestId('metric-queue-depth')).toBeInTheDocument();
    expect(screen.getByTestId('metric-completed-runs')).toBeInTheDocument();
    expect(screen.getByTestId('metric-failed-runs')).toBeInTheDocument();
  });

  it('renders recent runs table', async () => {
    render(<EvolutionDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-runs-table')).toBeInTheDocument();
    });
  });

  it('renders Recent Runs heading', async () => {
    render(<EvolutionDashboardPage />);
    await waitFor(() => {
      expect(screen.getByText('Recent Runs')).toBeInTheDocument();
    });
  });
});
