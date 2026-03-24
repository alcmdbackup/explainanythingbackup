// Tests for ExperimentOverviewCard: status badge, metrics, cancel button.
import { render, screen } from '@testing-library/react';
import type { V2Experiment } from './ExperimentDetailContent';

jest.mock('@evolution/services/experimentActions', () => ({
  cancelExperimentAction: jest.fn(),
}));

import { cancelExperimentAction } from '@evolution/services/experimentActions';
import { ExperimentOverviewCard } from './ExperimentOverviewCard';

const baseExperiment: V2Experiment = {
  id: 'exp-001-uuid-test-value',
  name: 'Test Experiment',
  status: 'completed',
  prompt_id: 'prompt-uuid-1',
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
  evolution_runs: [
    { id: 'r1', status: 'completed' },
    { id: 'r2', status: 'completed' },
  ],
  metrics: {
    maxElo: 1350,
    totalCost: 7.5,
    runs: [
      { runId: 'r1', elo: 1350, cost: 4.0, eloPerDollar: 338 },
      { runId: 'r2', elo: 1280, cost: 3.5, eloPerDollar: 366 },
    ],
  },
};

describe('ExperimentOverviewCard', () => {
  beforeEach(() => {
    (cancelExperimentAction as jest.Mock).mockResolvedValue({ success: true });
  });

  it('renders status badge', () => {
    render(<ExperimentOverviewCard experiment={baseExperiment} />);
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Completed');
  });

  it('renders truncated experiment ID', () => {
    render(<ExperimentOverviewCard experiment={baseExperiment} />);
    expect(screen.getByTestId('experiment-id')).toHaveTextContent('exp-001-');
  });

  it('renders run counts', () => {
    render(<ExperimentOverviewCard experiment={baseExperiment} />);
    expect(screen.getByText('2/2')).toBeInTheDocument();
  });

  it('hides cancel button for terminal experiments', () => {
    render(<ExperimentOverviewCard experiment={baseExperiment} />);
    expect(screen.queryByTestId('cancel-button')).not.toBeInTheDocument();
  });

  it('shows cancel button for active experiments', () => {
    render(<ExperimentOverviewCard experiment={{ ...baseExperiment, status: 'running' }} />);
    expect(screen.getByTestId('cancel-button')).toBeInTheDocument();
  });
});
