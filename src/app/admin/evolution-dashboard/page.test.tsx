// Tests for Evolution Dashboard overview page stat cards and quick links.

import { render, screen, waitFor } from '@testing-library/react';
import EvolutionDashboardOverviewPage from './page';
import { createSuccessResponse } from '@/testing/utils/component-test-helpers';
import type { DashboardData } from '@evolution/services/evolutionVisualizationActions';

const mockUsePathname = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => mockUsePathname(),
  useSearchParams: () => new URLSearchParams(),
}));

const mockGetDashboardData = jest.fn();

jest.mock('@evolution/services/evolutionVisualizationActions', () => ({
  getEvolutionDashboardDataAction: (...args: unknown[]) => mockGetDashboardData(...args),
}));

// Mock AutoRefreshProvider and useAutoRefresh for the new shared-tick API
jest.mock('@evolution/components/evolution', () => ({
  AutoRefreshProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  RefreshIndicator: () => <div data-testid="refresh-indicator" />,
  useAutoRefresh: () => ({
    refreshKey: 1,
    lastRefreshed: null,
    isActive: false,
    triggerRefresh: () => {},
    reportRefresh: () => {},
    reportError: () => {},
  }),
  EvolutionStatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

// Mock dynamic Recharts imports
jest.mock('next/dynamic', () => () => {
  function MockChart() { return <div data-testid="mock-chart" />; }
  return MockChart;
});

import React from 'react';

const mockDashboardData: DashboardData = {
  activeRuns: 2,
  queueDepth: 5,
  successRate7d: 85,
  monthlySpend: 42.5,
  previousMonthSpend: 35.0,
  articlesEvolvedCount: 12,
  arenaSize: 150,
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
      error_message: null,
      started_at: '2026-02-05T10:00:00Z',
      completed_at: '2026-02-05T12:00:00Z',
      created_at: '2026-02-05T09:00:00Z',
    },
  ],
};

describe('EvolutionDashboardOverviewPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePathname.mockReturnValue('/admin/evolution-dashboard');
    mockGetDashboardData.mockResolvedValue(createSuccessResponse(mockDashboardData));
  });

  it('renders quick link cards with correct hrefs', async () => {
    render(<EvolutionDashboardOverviewPage />);

    await waitFor(() => {
      expect(screen.getByText('Pipeline Runs')).toBeInTheDocument();
    });

    expect(screen.getByText('Pipeline Runs').closest('a')).toHaveAttribute('href', '/admin/evolution/runs');
    expect(screen.getByText('Arena').closest('a')).toHaveAttribute('href', '/admin/evolution/arena');
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
  });

  it('renders page title', async () => {
    render(<EvolutionDashboardOverviewPage />);

    expect(screen.getByText('Evolution Dashboard')).toBeInTheDocument();
  });

  it('renders summary metric cards with dashboard data', async () => {
    render(<EvolutionDashboardOverviewPage />);

    await waitFor(() => {
      expect(screen.getByTestId('summary-active-runs')).toHaveTextContent('2');
    });
    expect(screen.getByTestId('summary-active-runs')).toHaveTextContent('5 queued');
    expect(screen.getByTestId('summary-success-rate')).toHaveTextContent('85%');
    expect(screen.getByTestId('summary-success-rate')).toHaveTextContent('12 articles evolved');
    expect(screen.getByTestId('summary-monthly-spend')).toHaveTextContent('$42.50');
    expect(screen.getByTestId('summary-avg-cost')).toHaveTextContent('$1.25');
  });

  it('renders summary cards with loading placeholders when data is null', () => {
    mockGetDashboardData.mockResolvedValue(createSuccessResponse(null));
    render(<EvolutionDashboardOverviewPage />);

    // Before data loads, cards should show "—"
    expect(screen.getByTestId('summary-active-runs')).toHaveTextContent('—');
    expect(screen.getByTestId('summary-success-rate')).toHaveTextContent('—');
  });

  it('limits recent runs table to 5 rows', async () => {
    const manyRuns = Array.from({ length: 10 }, (_, i) => ({
      ...mockDashboardData.recentRuns[0],
      id: `run-${i}`,
    }));
    mockGetDashboardData.mockResolvedValue(createSuccessResponse({
      ...mockDashboardData,
      recentRuns: manyRuns,
    }));

    render(<EvolutionDashboardOverviewPage />);

    await waitFor(() => {
      const table = screen.getByTestId('dashboard-runs-table');
      expect(table).toBeInTheDocument();
    });

    // RunsTable with maxRows=5 should show "View all" link
    expect(screen.getByText(/View all/)).toBeInTheDocument();
  });
});
