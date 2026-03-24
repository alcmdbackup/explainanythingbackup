// Tests for RunsTab: V2 run table rendering, links to detail pages, empty state.
import { render, screen, waitFor } from '@testing-library/react';

const mockGetExperimentAction = jest.fn();

jest.mock('@evolution/services/experimentActions', () => ({
  getExperimentAction: (...args: unknown[]) => mockGetExperimentAction(...args),
}));

jest.mock('@evolution/lib/utils/evolutionUrls', () => ({
  buildRunUrl: (id: string) => `/admin/evolution/runs/${id}`,
}));

import { RunsTab } from './RunsTab';

describe('RunsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders run table with links to run detail pages', async () => {
    mockGetExperimentAction.mockResolvedValue({
      success: true,
      data: {
        id: 'exp-1',
        name: 'Test',
        status: 'completed',
        prompt_id: 'p1',
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
        evolution_runs: [
          {
            id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            status: 'completed',
            created_at: '2026-02-01T00:00:00Z',
          },
        ],
        metrics: { maxElo: null, totalCost: 0, runs: [] },
      },
    });

    render(<RunsTab experimentId="exp-1" />);

    await waitFor(() => {
      expect(screen.getByText('aaaaaaaa…')).toBeInTheDocument();
    });

    const link = screen.getByText('aaaaaaaa…');
    expect(link.closest('a')).toHaveAttribute(
      'href',
      '/admin/evolution/runs/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    );

    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('shows empty state when no runs', async () => {
    mockGetExperimentAction.mockResolvedValue({
      success: true,
      data: {
        id: 'exp-1',
        name: 'Test',
        status: 'completed',
        prompt_id: 'p1',
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
        evolution_runs: [],
        metrics: { maxElo: null, totalCost: 0, runs: [] },
      },
    });

    render(<RunsTab experimentId="exp-1" />);

    await waitFor(() => {
      expect(screen.getByText('No runs yet.')).toBeInTheDocument();
    });
  });

  it('renders flat table without round grouping', async () => {
    mockGetExperimentAction.mockResolvedValue({
      success: true,
      data: {
        id: 'exp-1',
        name: 'Test',
        status: 'completed',
        prompt_id: 'p1',
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
        evolution_runs: [
          { id: 'run-aaaa-0001', status: 'completed', created_at: '2026-02-01T00:00:00Z' },
          { id: 'run-bbbb-0002', status: 'completed', created_at: '2026-02-02T00:00:00Z' },
        ],
        metrics: { maxElo: null, totalCost: 0, runs: [] },
      },
    });

    render(<RunsTab experimentId="exp-1" />);

    await waitFor(() => {
      expect(screen.getByText('run-aaaa…')).toBeInTheDocument();
      expect(screen.getByText('run-bbbb…')).toBeInTheDocument();
    });
    // No round headings
    expect(screen.queryByText(/Round/)).not.toBeInTheDocument();
  });

  it('shows created date column', async () => {
    mockGetExperimentAction.mockResolvedValue({
      success: true,
      data: {
        id: 'exp-1',
        name: 'Test',
        status: 'completed',
        prompt_id: 'p1',
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
        evolution_runs: [
          {
            id: 'run-m1mm-0001',
            status: 'completed',
            created_at: '2026-03-01T00:00:00Z',
          },
        ],
        metrics: { maxElo: null, totalCost: 0, runs: [] },
      },
    });

    render(<RunsTab experimentId="exp-1" />);

    await waitFor(() => {
      expect(screen.getByText('Created')).toBeInTheDocument();
      expect(screen.getByText('run-m1mm…')).toBeInTheDocument();
    });
  });
});
