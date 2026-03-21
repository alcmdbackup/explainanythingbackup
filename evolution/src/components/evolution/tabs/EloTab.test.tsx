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
        { iteration: 1, mu: 25.0 },
        { iteration: 2, mu: 26.5 },
        { iteration: 3, mu: 27.1 },
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

  it('renders error on failure', async () => {
    getEvolutionRunEloHistoryAction.mockResolvedValue({
      success: false,
      data: null,
      error: { message: 'Network error' },
    });

    render(<EloTab runId="run-1" />);
    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
  });
});
