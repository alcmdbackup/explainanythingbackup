// Tests for ExperimentAnalysisCard: main effects table, factor rankings, recommendations.
import { render, screen, waitFor, act } from '@testing-library/react';
import { ExperimentAnalysisCard } from './ExperimentAnalysisCard';
import type { ExperimentStatus } from '@evolution/services/experimentActions';

jest.mock('@evolution/services/experimentActions', () => ({
  getExperimentMetricsAction: jest.fn().mockResolvedValue({ success: true, data: null }),
}));

const baseExperiment: ExperimentStatus = {
  id: 'exp-1',
  name: 'Test',
  status: 'completed',
  optimizationTarget: 'elo',
  totalBudgetUsd: 10,
  spentUsd: 5,
  convergenceThreshold: 10,
  factorDefinitions: {},
  promptId: 'prompt-uuid-1',
  promptTitle: 'Test prompt',
  resultsSummary: null,
  errorMessage: null,
  createdAt: '2026-02-01T00:00:00Z',
  design: 'manual',
  runCounts: { total: 2, completed: 2, failed: 0, pending: 0 },
  analysisResults: {
    type: 'manual',
    runs: [
      { runId: 'r1', configLabel: 'gpt-4o / gpt-4.1-nano', elo: 1350, cost: 0.45, 'eloPer$': 333 },
      { runId: 'r2', configLabel: 'gpt-4.1-mini / gpt-4.1-nano', elo: 1280, cost: 0.30, 'eloPer$': 267 },
    ],
    completedRuns: 2,
    totalRuns: 2,
    warnings: ['1 run failed — results may be less reliable'],
  },
};

async function renderAndSettle(ui: React.ReactElement) {
  await act(async () => {
    render(ui);
  });
  // Wait for loading state to resolve
  await waitFor(() => {
    expect(screen.queryByText('Loading metrics...')).not.toBeInTheDocument();
  });
}

describe('ExperimentAnalysisCard', () => {
  it('renders manual analysis per-run comparison table', async () => {
    await renderAndSettle(<ExperimentAnalysisCard experiment={baseExperiment} />);
    const table = screen.getByTestId('manual-runs-table');
    const rows = table.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('gpt-4o');
    expect(rows[0].textContent).toContain('1350');
  });

  it('renders warnings', async () => {
    await renderAndSettle(<ExperimentAnalysisCard experiment={baseExperiment} />);
    expect(screen.getByText('1 run failed — results may be less reliable')).toBeInTheDocument();
  });

  it('handles null analysisResults', async () => {
    await renderAndSettle(<ExperimentAnalysisCard experiment={{ ...baseExperiment, analysisResults: null }} />);
    expect(screen.getByText('No analysis results available.')).toBeInTheDocument();
  });

  it('shows analysis pending for active experiment', () => {
    render(<ExperimentAnalysisCard experiment={{ ...baseExperiment, status: 'running', analysisResults: null }} />);
    expect(screen.getByText('Analysis pending.')).toBeInTheDocument();
  });

  it('shows warnings in manual analysis with incomplete runs', async () => {
    await renderAndSettle(
      <ExperimentAnalysisCard
        experiment={{
          ...baseExperiment,
          design: 'manual',
          analysisResults: {
            type: 'manual',
            runs: [],
            completedRuns: 0,
            totalRuns: 2,
            warnings: ['2 of 2 runs incomplete'],
          },
        }}
      />,
    );
    expect(screen.getByText('2 of 2 runs incomplete')).toBeInTheDocument();
  });
});
