// Tests for MetricsTab: loading, data display, and error states (V2 run_summary).
import { render, screen, waitFor } from '@testing-library/react';
import { MetricsTab } from './MetricsTab';

const mockGetEvolutionRunSummaryAction = jest.fn();

jest.mock('@evolution/services/evolutionActions', () => ({
  getEvolutionRunSummaryAction: (...args: unknown[]) => mockGetEvolutionRunSummaryAction(...args),
}));

jest.mock('@evolution/components/evolution/AutoRefreshProvider', () => ({
  useAutoRefresh: () => ({
    refreshKey: 0,
    reportRefresh: jest.fn(),
    reportError: jest.fn(),
  }),
}));

const SUMMARY_DATA = {
  totalIterations: 10,
  matchStats: { totalMatches: 42, avgConfidence: 0.85 },
  topVariants: [{ mu: 1.234 }],
  durationSeconds: 123,
};

describe('MetricsTab', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading skeleton initially', () => {
    mockGetEvolutionRunSummaryAction.mockReturnValue(new Promise(() => {}));
    render(<MetricsTab runId="run-1" />);
    expect(screen.getByTestId('metrics-loading')).toBeInTheDocument();
  });

  it('renders metric grid with run summary data', async () => {
    mockGetEvolutionRunSummaryAction.mockResolvedValue({ success: true, data: SUMMARY_DATA, error: null });
    render(<MetricsTab runId="run-1" />);

    await waitFor(() => expect(screen.getByTestId('metrics-tab')).toBeInTheDocument());

    expect(screen.getByText('Iterations')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('Total Matches')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Avg Confidence')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText('Best Mu')).toBeInTheDocument();
    expect(screen.getByText('1.2')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('123s')).toBeInTheDocument();
  });

  it('shows error state when action fails', async () => {
    mockGetEvolutionRunSummaryAction.mockResolvedValue({
      success: false,
      data: null,
      error: { message: 'Run not found' },
    });
    render(<MetricsTab runId="run-bad" />);

    await waitFor(() => expect(screen.getByTestId('metrics-error')).toBeInTheDocument());
    expect(screen.getByText('Run not found')).toBeInTheDocument();
  });

  it('handles empty summary gracefully', async () => {
    mockGetEvolutionRunSummaryAction.mockResolvedValue({
      success: true,
      data: {},
      error: null,
    });
    render(<MetricsTab runId="run-empty" />);

    await waitFor(() => expect(screen.getByTestId('metrics-error')).toBeInTheDocument());
    expect(screen.getByText('No metrics available')).toBeInTheDocument();
  });
});
