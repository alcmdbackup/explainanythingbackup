// Tests for RunMetricsTab: renders metric grid, handles loading/error/empty states, agent cost table.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { RunMetricsTab } from './RunMetricsTab';

const mockGetRunMetricsAction = jest.fn();
jest.mock('@evolution/services/experimentActions', () => ({
  getRunMetricsAction: (...args: unknown[]) => mockGetRunMetricsAction(...args),
}));

describe('RunMetricsTab', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state initially', () => {
    mockGetRunMetricsAction.mockReturnValue(new Promise(() => {})); // never resolves
    render(<RunMetricsTab runId="test-run-id" />);
    expect(screen.getByText('Computing metrics...')).toBeInTheDocument();
  });

  it('renders metrics grid for a completed run', async () => {
    mockGetRunMetricsAction.mockResolvedValue({
      success: true,
      data: {
        metrics: {
          totalVariants: { value: 12, sigma: null, ci: null, n: 1 },
          medianElo: { value: 1350, sigma: null, ci: null, n: 1 },
          p90Elo: { value: 1450, sigma: null, ci: null, n: 1 },
          maxElo: { value: 1500, sigma: 25, ci: null, n: 1 },
          cost: { value: 0.543, sigma: null, ci: null, n: 1 },
          'eloPer$': { value: 553, sigma: null, ci: null, n: 1 },
          'agentCost:generator': { value: 0.3, sigma: null, ci: null, n: 1 },
          'agentCost:judge': { value: 0.2, sigma: null, ci: null, n: 1 },
        },
        agentBreakdown: [
          { agent: 'generator', costUsd: 0.3, calls: 1 },
          { agent: 'judge', costUsd: 0.2, calls: 1 },
        ],
      },
      error: null,
    });

    render(<RunMetricsTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('run-metrics-tab')).toBeInTheDocument();
    });

    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('1350')).toBeInTheDocument();
    expect(screen.getByText('1450')).toBeInTheDocument();
    expect(screen.getByText('$0.543')).toBeInTheDocument();
    expect(screen.getByText('553')).toBeInTheDocument();

    // Agent cost table
    expect(screen.getByTestId('agent-cost-table')).toBeInTheDocument();
    expect(screen.getByText('generator')).toBeInTheDocument();
    expect(screen.getByText('judge')).toBeInTheDocument();
  });

  it('shows error state', async () => {
    mockGetRunMetricsAction.mockResolvedValue({
      success: false,
      data: null,
      error: { message: 'Run not found' },
    });

    render(<RunMetricsTab runId="bad-id" />);

    await waitFor(() => {
      expect(screen.getByText('Run not found')).toBeInTheDocument();
    });
  });

  it('shows empty state when no metrics', async () => {
    mockGetRunMetricsAction.mockResolvedValue({
      success: true,
      data: { metrics: {}, agentBreakdown: [] },
      error: null,
    });

    render(<RunMetricsTab runId="empty-run" />);

    await waitFor(() => {
      expect(screen.getByText('No metrics available for this run.')).toBeInTheDocument();
    });
  });
});
