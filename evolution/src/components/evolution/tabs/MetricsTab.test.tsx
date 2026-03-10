// Tests for MetricsTab: loading, data display, agent cost table, and error states.
import { render, screen, waitFor } from '@testing-library/react';
import { MetricsTab } from './MetricsTab';

const mockGetRunMetricsAction = jest.fn();

jest.mock('@evolution/services/experimentActions', () => ({
  getRunMetricsAction: (...args: unknown[]) => mockGetRunMetricsAction(...args),
}));

jest.mock('@evolution/components/evolution/AutoRefreshProvider', () => ({
  useAutoRefresh: () => ({
    refreshKey: 0,
    reportRefresh: jest.fn(),
    reportError: jest.fn(),
  }),
}));

const METRICS_DATA = {
  metrics: {
    totalVariants: { value: 12, sigma: null, ci: null, n: 12 },
    medianElo: { value: 1150, sigma: 25, ci: [1101, 1199] as [number, number], n: 12 },
    p90Elo: { value: 1350, sigma: 20, ci: [1311, 1389] as [number, number], n: 12 },
    maxElo: { value: 1500, sigma: 15, ci: [1471, 1529] as [number, number], n: 12 },
    cost: { value: 0.42, sigma: null, ci: null, n: 1 },
    'eloPer$': { value: 2857, sigma: null, ci: null, n: 1 },
  },
  agentBreakdown: [
    { agent: 'generation', costUsd: 0.30, calls: 10 },
    { agent: 'calibration', costUsd: 0.12, calls: 5 },
  ],
};

describe('MetricsTab', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading skeleton initially', () => {
    mockGetRunMetricsAction.mockReturnValue(new Promise(() => {}));
    render(<MetricsTab runId="run-1" />);
    expect(screen.getByTestId('metrics-loading')).toBeInTheDocument();
  });

  it('renders metric grid and agent cost table', async () => {
    mockGetRunMetricsAction.mockResolvedValue({ success: true, data: METRICS_DATA, error: null });
    render(<MetricsTab runId="run-1" />);

    await waitFor(() => expect(screen.getByTestId('metrics-tab')).toBeInTheDocument());

    expect(screen.getByText('Total Variants')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Median Elo')).toBeInTheDocument();
    expect(screen.getByText('P90 Elo')).toBeInTheDocument();
    expect(screen.getByText('Max Elo')).toBeInTheDocument();
  });

  it('renders agent cost breakdown table', async () => {
    mockGetRunMetricsAction.mockResolvedValue({ success: true, data: METRICS_DATA, error: null });
    render(<MetricsTab runId="run-1" />);

    await waitFor(() => expect(screen.getByTestId('agent-cost-table')).toBeInTheDocument());

    expect(screen.getByText('generation')).toBeInTheDocument();
    expect(screen.getByText('calibration')).toBeInTheDocument();
    expect(screen.getByText('Agent Cost Breakdown')).toBeInTheDocument();
  });

  it('shows error state when action fails', async () => {
    mockGetRunMetricsAction.mockResolvedValue({
      success: false,
      data: null,
      error: { message: 'Run not found' },
    });
    render(<MetricsTab runId="run-bad" />);

    await waitFor(() => expect(screen.getByTestId('metrics-error')).toBeInTheDocument());
    expect(screen.getByText('Run not found')).toBeInTheDocument();
  });

  it('handles empty metrics gracefully', async () => {
    mockGetRunMetricsAction.mockResolvedValue({
      success: true,
      data: { metrics: {}, agentBreakdown: [] },
      error: null,
    });
    render(<MetricsTab runId="run-empty" />);

    await waitFor(() => expect(screen.getByTestId('metrics-tab')).toBeInTheDocument());
    expect(screen.queryByTestId('agent-cost-table')).not.toBeInTheDocument();
  });
});
