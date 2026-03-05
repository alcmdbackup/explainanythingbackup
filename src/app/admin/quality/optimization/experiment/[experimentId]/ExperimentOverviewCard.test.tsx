// Tests for ExperimentOverviewCard: status badge, budget bar, factor table, cancel button.
import { render, screen } from '@testing-library/react';
import type { ExperimentStatus } from '@evolution/services/experimentActions';

jest.mock('@evolution/services/experimentActions', () => ({
  cancelExperimentAction: jest.fn().mockResolvedValue({ success: true }),
}));

import { ExperimentOverviewCard } from './ExperimentOverviewCard';

const baseStatus: ExperimentStatus = {
  id: 'exp-001-uuid-test-value',
  name: 'Test Experiment',
  status: 'completed',
  optimizationTarget: 'elo',
  totalBudgetUsd: 10,
  spentUsd: 7.5,
  convergenceThreshold: 10,
  factorDefinitions: {
    model: { low: 'deepseek-chat', high: 'gpt-4.1-mini' },
    iterations: { low: 2, high: 4 },
  },
  promptId: 'prompt-uuid-1',
  promptTitle: 'test prompt',
  resultsSummary: null,
  errorMessage: null,
  createdAt: '2026-02-01T00:00:00Z',
  design: 'L8',
  analysisResults: null,
  runCounts: { total: 8, completed: 8, failed: 0, pending: 0 },
};

describe('ExperimentOverviewCard', () => {
  it('renders status badge', () => {
    render(<ExperimentOverviewCard status={baseStatus} />);
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Completed');
  });

  it('renders truncated experiment ID', () => {
    render(<ExperimentOverviewCard status={baseStatus} />);
    expect(screen.getByTestId('experiment-id')).toHaveTextContent('exp-001-');
  });

  it('renders budget progress', () => {
    render(<ExperimentOverviewCard status={baseStatus} />);
    expect(screen.getByText('Budget')).toBeInTheDocument();
    expect(screen.getByText('$7.50 / $10.00')).toBeInTheDocument();
  });

  it('renders factor table', () => {
    render(<ExperimentOverviewCard status={baseStatus} />);
    const table = screen.getByTestId('factor-table');
    expect(table).toBeInTheDocument();
    expect(screen.getByText('model')).toBeInTheDocument();
    expect(screen.getByText('deepseek-chat')).toBeInTheDocument();
  });

  it('hides cancel button for terminal experiments', () => {
    render(<ExperimentOverviewCard status={baseStatus} />);
    expect(screen.queryByTestId('cancel-button')).not.toBeInTheDocument();
  });

  it('shows cancel button for active experiments', () => {
    render(<ExperimentOverviewCard status={{ ...baseStatus, status: 'running' }} />);
    expect(screen.getByTestId('cancel-button')).toBeInTheDocument();
  });

  it('renders prompt link to arena topic', () => {
    render(<ExperimentOverviewCard status={baseStatus} />);
    const link = screen.getByTestId('prompt-link');
    expect(link).toBeInTheDocument();
    expect(link).toHaveTextContent('test prompt');
    expect(link.closest('a')).toHaveAttribute('href', '/admin/quality/arena/prompt-uuid-1');
  });

  it('renders manual experiment info instead of factor table', () => {
    const manualStatus: ExperimentStatus = {
      ...baseStatus,
      design: 'manual',
      factorDefinitions: {},
      runCounts: { total: 3, completed: 2, failed: 1, pending: 0 },
      totalBudgetUsd: 1.50,
    };
    render(<ExperimentOverviewCard status={manualStatus} />);
    expect(screen.getByText('Manual Experiment')).toBeInTheDocument();
    expect(screen.getByText(/3 runs configured/)).toBeInTheDocument();
    expect(screen.queryByTestId('factor-table')).not.toBeInTheDocument();
  });
});
