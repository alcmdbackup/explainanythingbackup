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

jest.mock('@/lib/services/evolutionVisualizationActions', () => ({
  getEvolutionDashboardDataAction: (...args: unknown[]) => mockGetDashboardData(...args),
}));

// Mock AutoRefreshProvider to immediately call onRefresh
jest.mock('@/components/evolution', () => ({
  AutoRefreshProvider: ({ children, onRefresh }: { children: React.ReactNode; onRefresh: () => void }) => {
    // Call onRefresh on mount
    React.useEffect(() => { onRefresh(); }, [onRefresh]);
    return <div>{children}</div>;
  },
  RefreshIndicator: () => <div data-testid="refresh-indicator" />,
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
  hallOfFameSize: 150,
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

    expect(screen.getByText('Pipeline Runs').closest('a')).toHaveAttribute('href', '/admin/quality/evolution');
    expect(screen.getByText('Elo Optimization').closest('a')).toHaveAttribute('href', '/admin/quality/optimization');
    expect(screen.getByText('Hall of Fame').closest('a')).toHaveAttribute('href', '/admin/quality/hall-of-fame');
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
});
