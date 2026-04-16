// Tests for EloTab V2: loading state, chart rendering, empty state, and error handling.
import { render, screen, waitFor } from '@testing-library/react';
import { EloTab } from './EloTab';

jest.mock('@evolution/services/evolutionVisualizationActions', () => ({
  getEvolutionRunEloHistoryAction: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getEvolutionRunEloHistoryAction } = require('@evolution/services/evolutionVisualizationActions');

describe('EloTab', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading skeleton initially', () => {
    getEvolutionRunEloHistoryAction.mockReturnValue(new Promise(() => {}));
    render(<EloTab runId="run-1" />);
    expect(screen.queryByTestId('elo-tab')).toBeNull();
  });

  it('renders chart with history data', async () => {
    getEvolutionRunEloHistoryAction.mockResolvedValue({
      success: true,
      data: [
        { iteration: 1, elo: 1200 },
        { iteration: 2, elo: 1224 },
        { iteration: 3, elo: 1234 },
      ],
      error: null,
    });

    render(<EloTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('elo-tab')).toBeInTheDocument());
    expect(screen.getByText(/Rating History/)).toBeInTheDocument();
  });

  it('renders empty state when no history', async () => {
    getEvolutionRunEloHistoryAction.mockResolvedValue({
      success: true,
      data: [],
      error: null,
    });

    render(<EloTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('elo-tab-empty')).toBeInTheDocument());
  });

  it('renders multi-line chart with top-K elos data', async () => {
    getEvolutionRunEloHistoryAction.mockResolvedValue({
      success: true,
      data: [
        { iteration: 1, elo: 1200, elos: [1200, 1192, 1181] },
        { iteration: 2, elo: 1224, elos: [1224, 1202, 1184] },
        { iteration: 3, elo: 1234, elos: [1234, 1216, 1203] },
      ],
      error: null,
    });

    render(<EloTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('elo-tab')).toBeInTheDocument());
    expect(screen.getByText(/Top 3/)).toBeInTheDocument();
    // Should render 3 polylines (one per rank) + legend
    const svg = screen.getByTestId('elo-tab').querySelector('svg');
    expect(svg?.querySelectorAll('polyline')).toHaveLength(3);
  });

  it('renders single-line chart with legacy data (no elos field)', async () => {
    getEvolutionRunEloHistoryAction.mockResolvedValue({
      success: true,
      data: [
        { iteration: 1, elo: 1200 },
        { iteration: 2, elo: 1224 },
      ],
      error: null,
    });

    render(<EloTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('elo-tab')).toBeInTheDocument());
    expect(screen.queryByText(/Top/)).toBeNull();
    const svg = screen.getByTestId('elo-tab').querySelector('svg');
    expect(svg?.querySelectorAll('polyline')).toHaveLength(1);
  });

  it('renders error on failure', async () => {
    getEvolutionRunEloHistoryAction.mockResolvedValue({
      success: false,
      data: null,
      error: { message: 'Network error' },
    });

    render(<EloTab runId="run-1" />);
    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
  });

  // Phase 4b: uncertainty band
  it('renders uncertainty band polygon when uncertainties present', async () => {
    getEvolutionRunEloHistoryAction.mockResolvedValue({
      success: true,
      data: [
        { iteration: 1, elo: 1200, uncertainties: [50] },
        { iteration: 2, elo: 1224, uncertainties: [40] },
        { iteration: 3, elo: 1234, uncertainties: [30] },
      ],
      error: null,
    });

    render(<EloTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('elo-tab')).toBeInTheDocument());
    expect(screen.getByTestId('elo-uncertainty-band')).toBeInTheDocument();
  });

  it('does NOT render uncertainty band when uncertainties absent (legacy)', async () => {
    getEvolutionRunEloHistoryAction.mockResolvedValue({
      success: true,
      data: [
        { iteration: 1, elo: 1200 },
        { iteration: 2, elo: 1224 },
      ],
      error: null,
    });

    render(<EloTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('elo-tab')).toBeInTheDocument());
    expect(screen.queryByTestId('elo-uncertainty-band')).not.toBeInTheDocument();
  });
});
