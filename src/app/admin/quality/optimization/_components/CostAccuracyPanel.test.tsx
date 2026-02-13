// Tests for CostAccuracyPanel component: confidence cards, per-agent table, and empty state.
import { render, screen, waitFor } from '@testing-library/react';
import { CostAccuracyPanel } from './CostAccuracyPanel';
import * as costAnalyticsActions from '@/lib/services/costAnalyticsActions';
import type { CostAccuracyOverview } from '@/lib/services/costAnalyticsActions';

jest.mock('next/dynamic', () => {
  return jest.fn().mockImplementation(() => {
    function MockChart(props: Record<string, unknown>) {
      return <div data-testid="mock-chart" data-props={JSON.stringify(props)} />;
    }
    MockChart.displayName = 'MockChart';
    return MockChart;
  });
});

jest.mock('next/link', () => {
  return function MockLink({ children, href }: { children: React.ReactNode; href: string }) {
    return <a href={href}>{children}</a>;
  };
});

jest.mock('@/lib/services/costAnalyticsActions', () => ({
  getCostAccuracyOverviewAction: jest.fn(),
}));

const mockOverview: CostAccuracyOverview = {
  recentDeltas: [
    { runId: '12345678-0000-0000-0000-000000000000', deltaPercent: 10, createdAt: '2026-02-09T00:00:00Z' },
    { runId: '12345678-0000-0000-0000-000000000001', deltaPercent: -5, createdAt: '2026-02-08T00:00:00Z' },
  ],
  perAgentAccuracy: {
    generation: { avgEstimated: 0.6, avgActual: 0.7, avgDeltaPercent: 16.7 },
    calibration: { avgEstimated: 0.3, avgActual: 0.28, avgDeltaPercent: -6.7 },
  },
  confidenceCalibration: {
    high: { count: 5, avgAbsDeltaPercent: 8.2 },
    medium: { count: 3, avgAbsDeltaPercent: 22.1 },
    low: { count: 1, avgAbsDeltaPercent: 45.0 },
  },
  outliers: [
    { runId: '12345678-0000-0000-0000-000000000099', deltaPercent: 120, estimatedUsd: 1.0, actualUsd: 2.2 },
  ],
};

describe('CostAccuracyPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders confidence cards and per-agent table', async () => {
    (costAnalyticsActions.getCostAccuracyOverviewAction as jest.Mock).mockResolvedValue({
      success: true, data: mockOverview, error: null,
    });

    render(<CostAccuracyPanel />);
    // Wait for the data-loaded state (confidence text appears)
    await waitFor(() => expect(screen.getByText(/Estimation Delta Over Time/)).toBeInTheDocument());

    // Confidence cards
    expect(screen.getByText(/±8\.2%/)).toBeInTheDocument();
    expect(screen.getByText(/±22\.1%/)).toBeInTheDocument();
    expect(screen.getByText(/±45%/)).toBeInTheDocument();

    // Per-agent table
    expect(screen.getByText('generation')).toBeInTheDocument();
    expect(screen.getByText('calibration')).toBeInTheDocument();

    // Outlier
    expect(screen.getByText(/12345678/)).toBeInTheDocument();
  });

  it('renders empty state when no data', async () => {
    const emptyOverview: CostAccuracyOverview = {
      recentDeltas: [],
      perAgentAccuracy: {},
      confidenceCalibration: {
        high: { count: 0, avgAbsDeltaPercent: 0 },
        medium: { count: 0, avgAbsDeltaPercent: 0 },
        low: { count: 0, avgAbsDeltaPercent: 0 },
      },
      outliers: [],
    };
    (costAnalyticsActions.getCostAccuracyOverviewAction as jest.Mock).mockResolvedValue({
      success: true, data: emptyOverview, error: null,
    });

    render(<CostAccuracyPanel />);
    await waitFor(() => expect(screen.getByText(/Estimation Delta Over Time/)).toBeInTheDocument());

    // Should show '--' for zero-count confidence
    const dashes = screen.getAllByText('--');
    expect(dashes.length).toBe(3);
  });

  it('shows loading skeleton initially', () => {
    (costAnalyticsActions.getCostAccuracyOverviewAction as jest.Mock).mockReturnValue(
      new Promise(() => {}),
    );
    render(<CostAccuracyPanel />);
    expect(screen.getByTestId('cost-accuracy-panel')).toBeInTheDocument();
  });
});
