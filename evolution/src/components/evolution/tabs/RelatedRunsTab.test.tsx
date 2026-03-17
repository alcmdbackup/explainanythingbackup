// Tests for RelatedRunsTab: fetches runs by strategy/experiment/prompt and renders EntityTable.

import { render, screen, waitFor } from '@testing-library/react';
import { RelatedRunsTab } from './RelatedRunsTab';

jest.mock('@evolution/services/eloBudgetActions', () => ({
  getStrategyRunsAction: jest.fn().mockResolvedValue({
    success: true,
    data: [
      { runId: 'run-001', status: 'completed', finalElo: 1200, totalCostUsd: 1.5, iterations: 10, startedAt: new Date('2026-01-01'), explanationTitle: 'Topic A' },
    ],
  }),
}));

jest.mock('@evolution/services/experimentActions', () => ({
  getExperimentRunsAction: jest.fn().mockResolvedValue({
    success: true,
    data: [
      { id: 'run-002', status: 'running', eloScore: 1100, costUsd: 0.5, createdAt: '2026-01-02' },
    ],
  }),
}));

jest.mock('@evolution/services/evolutionActions', () => ({
  getEvolutionRunsAction: jest.fn().mockResolvedValue({
    success: true,
    data: [
      { id: 'run-003', status: 'pending', total_cost_usd: 0, current_iteration: 0, created_at: '2026-01-03' },
    ],
  }),
}));

describe('RelatedRunsTab', () => {
  it('fetches strategy runs and renders table', async () => {
    render(<RelatedRunsTab strategyId="strat-001" />);
    await waitFor(() => {
      expect(screen.getByText(/run-001/)).toBeInTheDocument();
    });
    expect(screen.getByText('Topic A')).toBeInTheDocument();
    const { getStrategyRunsAction } = require('@evolution/services/eloBudgetActions');
    expect(getStrategyRunsAction).toHaveBeenCalledWith({ strategyId: 'strat-001', limit: 50 });
  });

  it('fetches experiment runs and renders table', async () => {
    render(<RelatedRunsTab experimentId="exp-001" />);
    await waitFor(() => {
      expect(screen.getByText(/run-002/)).toBeInTheDocument();
    });
    const { getExperimentRunsAction } = require('@evolution/services/experimentActions');
    expect(getExperimentRunsAction).toHaveBeenCalledWith({ experimentId: 'exp-001' });
  });

  it('fetches prompt runs and renders table', async () => {
    render(<RelatedRunsTab promptId="prompt-001" />);
    await waitFor(() => {
      expect(screen.getByText(/run-003/)).toBeInTheDocument();
    });
    const { getEvolutionRunsAction } = require('@evolution/services/evolutionActions');
    expect(getEvolutionRunsAction).toHaveBeenCalledWith({ promptId: 'prompt-001' });
  });

  it('shows loading state', () => {
    render(<RelatedRunsTab strategyId="strat-001" />);
    expect(screen.getByTestId('related-runs-skeleton')).toBeInTheDocument();
  });

  it('shows empty state when no runs', async () => {
    const { getStrategyRunsAction } = require('@evolution/services/eloBudgetActions');
    getStrategyRunsAction.mockResolvedValueOnce({ success: true, data: [] });
    render(<RelatedRunsTab strategyId="strat-empty" />);
    await waitFor(() => {
      expect(screen.getByText('No runs found.')).toBeInTheDocument();
    });
  });

  it('renders row links to run detail', async () => {
    render(<RelatedRunsTab strategyId="strat-001" />);
    await waitFor(() => {
      expect(screen.getByText(/run-001/)).toBeInTheDocument();
    });
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/admin/evolution/runs/run-001');
  });
});
