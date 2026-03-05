// Tests for ExperimentAnalysisCard: main effects table, factor rankings, recommendations.
import { render, screen } from '@testing-library/react';
import { ExperimentAnalysisCard } from './ExperimentAnalysisCard';
import type { ExperimentStatus } from '@evolution/services/experimentActions';

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
  design: 'L8',
  runCounts: { total: 8, completed: 7, failed: 1, pending: 0 },
  analysisResults: {
    mainEffects: {
      model: { effect: 15.2, low: 1200, high: 1215.2 },
      iterations: { effect: -3.1, low: 1210, high: 1206.9 },
    },
    factorRanking: [
      { factor: 'model', importance: 0.85 },
      { factor: 'iterations', importance: 0.15 },
    ],
    recommendations: ['Use gpt-4.1-mini for best results', 'Iterations have minimal effect'],
    warnings: ['1 run failed — results may be less reliable'],
    completedRuns: 7,
    totalRuns: 8,
  },
};

describe('ExperimentAnalysisCard', () => {
  it('renders main effects table sorted by absolute effect', () => {
    render(<ExperimentAnalysisCard experiment={baseExperiment} />);
    const table = screen.getByTestId('main-effects-table');
    const rows = table.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('model');
    expect(rows[0].textContent).toContain('15.20');
  });

  it('renders factor rankings', () => {
    render(<ExperimentAnalysisCard experiment={baseExperiment} />);
    const rankings = screen.getByTestId('factor-rankings');
    expect(rankings.textContent).toContain('#1');
    expect(rankings.textContent).toContain('model');
  });

  it('renders recommendations', () => {
    render(<ExperimentAnalysisCard experiment={baseExperiment} />);
    const recs = screen.getByTestId('recommendations');
    expect(recs.textContent).toContain('Use gpt-4.1-mini');
  });

  it('renders warnings', () => {
    render(<ExperimentAnalysisCard experiment={baseExperiment} />);
    const warnings = screen.getByTestId('warnings');
    expect(warnings.textContent).toContain('1 run failed');
  });

  it('handles null analysisResults', () => {
    render(<ExperimentAnalysisCard experiment={{ ...baseExperiment, analysisResults: null }} />);
    expect(screen.getByText('No analysis results available.')).toBeInTheDocument();
  });

  it('shows analysis pending for active experiment', () => {
    render(<ExperimentAnalysisCard experiment={{ ...baseExperiment, status: 'running', analysisResults: null }} />);
    expect(screen.getByText('Analysis pending.')).toBeInTheDocument();
  });

  it('renders manual analysis per-run comparison table', () => {
    const manualExperiment: ExperimentStatus = {
      ...baseExperiment,
      design: 'manual',
      analysisResults: {
        type: 'manual',
        runs: [
          { runId: 'r1', configLabel: 'gpt-4o / gpt-4.1-nano', elo: 1350, cost: 0.45, 'eloPer$': 333 },
          { runId: 'r2', configLabel: 'gpt-4.1-mini / gpt-4.1-nano', elo: 1280, cost: 0.30, 'eloPer$': 267 },
        ],
        completedRuns: 2,
        totalRuns: 2,
        warnings: [],
      },
    };
    render(<ExperimentAnalysisCard experiment={manualExperiment} />);
    const table = screen.getByTestId('manual-runs-table');
    expect(table).toBeInTheDocument();
    // Sorted by Elo descending
    const rows = table.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('gpt-4o');
    expect(rows[0].textContent).toContain('1350');
    expect(rows[1].textContent).toContain('gpt-4.1-mini');
  });

  it('shows warnings in manual analysis', () => {
    render(
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
