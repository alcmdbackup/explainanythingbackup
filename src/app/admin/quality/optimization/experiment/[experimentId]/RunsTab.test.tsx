// Tests for RunsTab: run table rendering, links to detail pages, empty state.
import { render, screen, waitFor } from '@testing-library/react';

const mockGetExperimentRunsAction = jest.fn();

jest.mock('@evolution/services/experimentActions', () => ({
  getExperimentRunsAction: (...args: unknown[]) => mockGetExperimentRunsAction(...args),
}));

jest.mock('@evolution/lib/utils/evolutionUrls', () => ({
  buildRunUrl: (id: string) => `/admin/quality/evolution/run/${id}`,
}));

import { RunsTab } from './RunsTab';

describe('RunsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders run table with links to run detail pages', async () => {
    mockGetExperimentRunsAction.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          status: 'completed',
          eloScore: 1350,
          costUsd: 1.234,
          experimentRow: 3,
          createdAt: '2026-02-01T00:00:00Z',
          completedAt: '2026-02-01T01:00:00Z',
        },
      ],
    });

    render(<RunsTab experimentId="exp-1" />);

    await waitFor(() => {
      // Run ID is truncated and linked
      expect(screen.getByText('aaaaaaaa…')).toBeInTheDocument();
    });

    const link = screen.getByText('aaaaaaaa…');
    expect(link.closest('a')).toHaveAttribute(
      'href',
      '/admin/quality/evolution/run/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    );

    // Status, Elo, cost, L8 row
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('1350')).toBeInTheDocument();
    expect(screen.getByText('$1.234')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows empty state when no runs', async () => {
    mockGetExperimentRunsAction.mockResolvedValue({
      success: true,
      data: [],
    });

    render(<RunsTab experimentId="exp-1" />);

    await waitFor(() => {
      expect(screen.getByText('No runs yet.')).toBeInTheDocument();
    });
  });

  it('renders flat table without round grouping', async () => {
    mockGetExperimentRunsAction.mockResolvedValue({
      success: true,
      data: [
        { id: 'run-a', status: 'completed', eloScore: 1200, costUsd: 1, experimentRow: 1, createdAt: '2026-02-01T00:00:00Z', completedAt: null },
        { id: 'run-b', status: 'completed', eloScore: 1300, costUsd: 2, experimentRow: 2, createdAt: '2026-02-02T00:00:00Z', completedAt: null },
      ],
    });

    render(<RunsTab experimentId="exp-1" />);

    await waitFor(() => {
      expect(screen.getByText('run-a…')).toBeInTheDocument();
      expect(screen.getByText('run-b…')).toBeInTheDocument();
    });
    // No round headings
    expect(screen.queryByText(/Round/)).not.toBeInTheDocument();
  });

  it('shows Budget column and Model column for manual design', async () => {
    mockGetExperimentRunsAction.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'run-m1',
          status: 'completed',
          eloScore: 1350,
          costUsd: 0.45,
          budgetCapUsd: 0.50,
          experimentRow: null,
          generationModel: 'gpt-4o',
          judgeModel: 'gpt-4.1-nano',
          createdAt: '2026-03-01T00:00:00Z',
          completedAt: null,
        },
      ],
    });

    render(<RunsTab experimentId="exp-1" design="manual" />);

    await waitFor(() => {
      expect(screen.getByText('Budget')).toBeInTheDocument();
      expect(screen.getByText('Model')).toBeInTheDocument();
      expect(screen.getByText('$0.50')).toBeInTheDocument();
      expect(screen.getByText('gpt-4o')).toBeInTheDocument();
    });
    // No L8 Row column for manual
    expect(screen.queryByText('L8 Row')).not.toBeInTheDocument();
  });

  it('shows L8 Row column for non-manual design', async () => {
    mockGetExperimentRunsAction.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'run-l8',
          status: 'completed',
          eloScore: 1200,
          costUsd: 1,
          budgetCapUsd: 5,
          experimentRow: 3,
          generationModel: null,
          judgeModel: null,
          createdAt: '2026-02-01T00:00:00Z',
          completedAt: null,
        },
      ],
    });

    render(<RunsTab experimentId="exp-1" design="L8" />);

    await waitFor(() => {
      expect(screen.getByText('L8 Row')).toBeInTheDocument();
      expect(screen.getByText('$5.00')).toBeInTheDocument();
    });
  });
});
