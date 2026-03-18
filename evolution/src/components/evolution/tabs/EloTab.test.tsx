// Tests for EloTab: loading, data display, top-N filter, error/empty states.

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { EloTab } from './EloTab';

const mockGetEloHistory = jest.fn();

jest.mock('@evolution/services/evolutionVisualizationActions', () => ({
  getEvolutionRunEloHistoryAction: (...args: unknown[]) => mockGetEloHistory(...args),
}));

jest.mock('@evolution/components/evolution/AutoRefreshProvider', () => ({
  useAutoRefresh: () => ({
    refreshKey: 0,
    reportRefresh: jest.fn(),
    reportError: jest.fn(),
  }),
}));

jest.mock('next/dynamic', () => {
  return jest.fn((loader: () => Promise<unknown>) => {
    // Return a simple chart mock component
    return function MockChart({ data, variants, topN }: { data: unknown[]; variants: unknown[]; topN: number }) {
      return (
        <div data-testid="mock-elo-chart">
          <span data-testid="chart-data-len">{Array.isArray(data) ? data.length : 0}</span>
          <span data-testid="chart-variants-len">{Array.isArray(variants) ? variants.length : 0}</span>
          <span data-testid="chart-topn">{topN}</span>
        </div>
      );
    };
  });
});

const ELO_DATA = {
  history: [
    { iteration: 1, ratings: { 'v1': 1200, 'v2': 1150, 'v3': 1100 }, sigmas: { 'v1': 50, 'v2': 60, 'v3': 70 } },
    { iteration: 2, ratings: { 'v1': 1250, 'v2': 1180, 'v3': 1050 }, sigmas: { 'v1': 40, 'v2': 50, 'v3': 65 } },
    { iteration: 3, ratings: { 'v1': 1300, 'v2': 1200, 'v3': 1000 }, sigmas: { 'v1': 30, 'v2': 45, 'v3': 60 } },
  ],
  variants: [
    { id: 'v1', shortId: 'v1', strategy: 'generation' },
    { id: 'v2', shortId: 'v2', strategy: 'structural_transform' },
    { id: 'v3', shortId: 'v3', strategy: 'polish' },
  ],
};

describe('EloTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEloHistory.mockResolvedValue({ success: true, data: ELO_DATA, error: null });
  });

  it('shows loading skeleton initially', () => {
    mockGetEloHistory.mockReturnValue(new Promise(() => {}));
    render(<EloTab runId="run-1" />);
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders elo tab with data', async () => {
    render(<EloTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('elo-tab')).toBeInTheDocument();
    });
  });

  it('shows error message on failure', async () => {
    mockGetEloHistory.mockResolvedValue({ success: false, data: null, error: { message: 'Not found' } });
    render(<EloTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText('Not found')).toBeInTheDocument();
    });
  });

  it('shows default error message when error has no message', async () => {
    mockGetEloHistory.mockResolvedValue({ success: false, data: null, error: null });
    render(<EloTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText('Failed to load rating history')).toBeInTheDocument();
    });
  });

  it('displays top-N label with variant count', async () => {
    render(<EloTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('elo-top-label')).toBeInTheDocument();
    });
    expect(screen.getByTestId('elo-top-label')).toHaveTextContent('5 of 3');
  });

  it('shows Rating Trajectories heading', async () => {
    render(<EloTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText('Rating Trajectories')).toBeInTheDocument();
    });
  });

  it('has a top-N range slider', async () => {
    render(<EloTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('elo-tab')).toBeInTheDocument();
    });
    const slider = screen.getByLabelText('Top');
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveAttribute('type', 'range');
  });

  it('updates top-N when slider changes', async () => {
    render(<EloTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('elo-tab')).toBeInTheDocument();
    });
    const slider = screen.getByLabelText('Top');
    fireEvent.change(slider, { target: { value: '2' } });
    expect(screen.getByTestId('elo-top-label')).toHaveTextContent('2 of 3');
  });

  it('calls action with runId', async () => {
    render(<EloTab runId="my-run-id" />);
    await waitFor(() => {
      expect(screen.getByTestId('elo-tab')).toBeInTheDocument();
    });
    expect(mockGetEloHistory).toHaveBeenCalledWith('my-run-id');
  });
});
