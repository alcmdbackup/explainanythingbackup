// Tests for ExperimentAnalysisCard: V2 metrics table rendering.
import { render, screen } from '@testing-library/react';
import { ExperimentAnalysisCard } from './ExperimentAnalysisCard';
import type { V2Experiment } from './ExperimentDetailContent';

const baseExperiment: V2Experiment = {
  id: 'exp-1',
  name: 'Test',
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
    totalCost: 0.75,
    runs: [
      { runId: 'r1', elo: 1350, cost: 0.45, eloPerDollar: 3000 },
      { runId: 'r2', elo: 1280, cost: 0.30, eloPerDollar: 4267 },
    ],
  },
};

describe('ExperimentAnalysisCard', () => {
  it('renders V2 metrics table with per-run data', () => {
    render(<ExperimentAnalysisCard experiment={baseExperiment} />);
    const table = screen.getByTestId('metrics-v2-table');
    const rows = table.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
  });

  it('shows summary cards', () => {
    render(<ExperimentAnalysisCard experiment={baseExperiment} />);
    expect(screen.getByText('Completed Runs')).toBeInTheDocument();
    expect(screen.getByText('Total Cost')).toBeInTheDocument();
    expect(screen.getByText('Best Elo')).toBeInTheDocument();
  });

  it('handles empty metrics', () => {
    const empty: V2Experiment = {
      ...baseExperiment,
      metrics: { maxElo: null, totalCost: 0, runs: [] },
    };
    render(<ExperimentAnalysisCard experiment={empty} />);
    expect(screen.getByText('No analysis results available.')).toBeInTheDocument();
  });

  it('shows pending message for active experiment with no metrics', () => {
    const active: V2Experiment = {
      ...baseExperiment,
      status: 'running',
      metrics: { maxElo: null, totalCost: 0, runs: [] },
    };
    render(<ExperimentAnalysisCard experiment={active} />);
    expect(screen.getByText('Analysis will be available once runs complete.')).toBeInTheDocument();
  });
});
