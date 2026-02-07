// Tests for Evolution Dashboard overview page stat cards and quick links.

import { render, screen, waitFor } from '@testing-library/react';
import EvolutionDashboardOverviewPage from './page';
import { createSuccessResponse } from '@/testing/utils/component-test-helpers';
import type { DashboardData } from '@/lib/services/evolutionVisualizationActions';

const mockUsePathname = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => mockUsePathname(),
  useSearchParams: () => new URLSearchParams(),
}));

const mockGetDashboardData = jest.fn();
const mockGetOptimizationSummary = jest.fn();

jest.mock('@/lib/services/evolutionVisualizationActions', () => ({
  getEvolutionDashboardDataAction: (...args: unknown[]) => mockGetDashboardData(...args),
}));

jest.mock('@/lib/services/eloBudgetActions', () => ({
  getOptimizationSummaryAction: (...args: unknown[]) => mockGetOptimizationSummary(...args),
}));

// Mock AutoRefreshProvider to immediately call onRefresh
jest.mock('@/components/evolution', () => ({
  AutoRefreshProvider: ({ children, onRefresh }: { children: React.ReactNode; onRefresh: () => void }) => {
    // Call onRefresh on mount
    React.useEffect(() => { onRefresh(); }, [onRefresh]);
    return <div>{children}</div>;
  },
  RefreshIndicator: () => <div data-testid="refresh-indicator" />,
}));

import React from 'react';

const mockDashboardData: DashboardData = {
  activeRuns: 2,
  queueDepth: 5,
  successRate7d: 85,
  monthlySpend: 42.5,
  previousMonthSpend: 35.0,
  articlesEvolvedCount: 12,
  articleBankSize: 150,
  runsPerDay: [
    { date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), completed: 3, failed: 1, paused: 0 },
  ],
  dailySpend: [{ date: '2026-02-05', amount: 5.0 }],
  recentRuns: [
    {
      id: 'run-1',
      explanation_id: 42,
      status: 'completed' as const,
      phase: 'COMPETITION' as const,
      current_iteration: 5,
      total_cost_usd: 1.25,
      budget_cap_usd: 5.0,
      started_at: '2026-02-05T10:00:00Z',
      completed_at: '2026-02-05T12:00:00Z',
      created_at: '2026-02-05T09:00:00Z',
    },
  ],
};

const mockOptimizationData = {
  totalRuns: 10,
  totalStrategies: 3,
  totalSpentUsd: 100,
  avgEloPerDollar: 45.2,
  bestStrategy: { name: 'Strategy A', avgElo: 1350 },
  topAgent: { name: 'Critic', eloPerDollar: 60.5 },
};

describe('EvolutionDashboardOverviewPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePathname.mockReturnValue('/admin/evolution-dashboard');
    // Default: both actions succeed
    mockGetDashboardData.mockResolvedValue(createSuccessResponse(mockDashboardData));
    mockGetOptimizationSummary.mockResolvedValue({ success: true, data: mockOptimizationData });
  });

  it('renders stat cards with data', async () => {
    render(<EvolutionDashboardOverviewPage />);

    await waitFor(() => {
      expect(screen.getByTestId('stat-card-success-rate')).toHaveTextContent('85%');
    });

    expect(screen.getByTestId('stat-card-monthly-spend')).toHaveTextContent('$42.50');
    expect(screen.getByTestId('stat-card-bank-size')).toHaveTextContent('150');
    expect(screen.getByTestId('stat-card-avg-elo-per-dollar')).toHaveTextContent('45.2');
    expect(screen.getByTestId('stat-card-failed-runs')).toHaveTextContent('1');
  });

  it('renders quick link cards with correct hrefs', async () => {
    render(<EvolutionDashboardOverviewPage />);

    await waitFor(() => {
      expect(screen.getByText('Pipeline Runs')).toBeInTheDocument();
    });

    expect(screen.getByText('Pipeline Runs').closest('a')).toHaveAttribute('href', '/admin/quality/evolution');
    expect(screen.getByText('Ops Dashboard').closest('a')).toHaveAttribute('href', '/admin/quality/evolution/dashboard');
    expect(screen.getByText('Elo Optimization').closest('a')).toHaveAttribute('href', '/admin/quality/optimization');
    expect(screen.getByText('Article Bank').closest('a')).toHaveAttribute('href', '/admin/quality/article-bank');
    expect(screen.getByText('Quality Scores').closest('a')).toHaveAttribute('href', '/admin/quality');
  });

  it('handles dashboard action failure gracefully', async () => {
    mockGetDashboardData.mockResolvedValue({
      success: false,
      data: null,
      error: { message: 'DB connection failed', code: 'UNKNOWN_ERROR' },
    });

    render(<EvolutionDashboardOverviewPage />);

    await waitFor(() => {
      expect(screen.getByText('DB connection failed')).toBeInTheDocument();
    });

    // Optimization stats should still render
    expect(screen.getByTestId('stat-card-avg-elo-per-dollar')).toHaveTextContent('45.2');
  });

  it('handles optimization action failure gracefully', async () => {
    // eloBudgetActions uses { success: false, error?: string } shape (plain string, NOT ErrorResponse)
    mockGetOptimizationSummary.mockResolvedValue({
      success: false,
      error: 'Optimization service unavailable',
    });

    render(<EvolutionDashboardOverviewPage />);

    await waitFor(() => {
      expect(screen.getByTestId('stat-card-success-rate')).toHaveTextContent('85%');
    });

    expect(screen.getByTestId('stat-card-avg-elo-per-dollar')).toHaveTextContent('N/A');
  });

  it('handles Promise.allSettled rejected case', async () => {
    mockGetDashboardData.mockRejectedValue(new Error('Network error'));

    render(<EvolutionDashboardOverviewPage />);

    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeInTheDocument();
    });
  });

  it('shows N/A for avg elo/$ when optimization data is null', async () => {
    mockGetOptimizationSummary.mockResolvedValue({ success: true, data: undefined });

    render(<EvolutionDashboardOverviewPage />);

    await waitFor(() => {
      expect(screen.getByTestId('stat-card-avg-elo-per-dollar')).toHaveTextContent('N/A');
    });
  });

  it('shows spend trend subtitle', async () => {
    render(<EvolutionDashboardOverviewPage />);

    await waitFor(() => {
      // 42.5 vs 35.0 = ~21% increase
      expect(screen.getByTestId('stat-card-monthly-spend')).toHaveTextContent('↑ 21%');
    });
  });
});
