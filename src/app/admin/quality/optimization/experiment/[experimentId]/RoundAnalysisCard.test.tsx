// Tests for RoundAnalysisCard: main effects table, factor rankings, recommendations.
import { render, screen } from '@testing-library/react';
import { RoundAnalysisCard } from './RoundAnalysisCard';
import type { ExperimentStatus } from '@evolution/services/experimentActions';

type Round = ExperimentStatus['rounds'][number];

const baseRound: Round = {
  roundNumber: 1,
  type: 'screening',
  design: 'L8',
  status: 'completed',
  batchRunId: 'batch-1',
  completedAt: '2026-02-01T00:00:00Z',
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

describe('RoundAnalysisCard', () => {
  it('renders round header with type and design', () => {
    render(<RoundAnalysisCard round={baseRound} />);
    expect(screen.getByText('Round 1')).toBeInTheDocument();
    expect(screen.getByText('screening (L8)')).toBeInTheDocument();
  });

  it('renders main effects table sorted by absolute effect', () => {
    render(<RoundAnalysisCard round={baseRound} />);
    const table = screen.getByTestId('main-effects-table');
    const rows = table.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    // model (15.2) should be first since |15.2| > |-3.1|
    expect(rows[0].textContent).toContain('model');
    expect(rows[0].textContent).toContain('15.20');
  });

  it('renders factor rankings', () => {
    render(<RoundAnalysisCard round={baseRound} />);
    const rankings = screen.getByTestId('factor-rankings');
    expect(rankings.textContent).toContain('#1');
    expect(rankings.textContent).toContain('model');
  });

  it('renders recommendations', () => {
    render(<RoundAnalysisCard round={baseRound} />);
    const recs = screen.getByTestId('recommendations');
    expect(recs.textContent).toContain('Use gpt-4.1-mini');
  });

  it('renders warnings', () => {
    render(<RoundAnalysisCard round={baseRound} />);
    const warnings = screen.getByTestId('warnings');
    expect(warnings.textContent).toContain('1 run failed');
  });

  it('handles null analysisResults', () => {
    render(<RoundAnalysisCard round={{ ...baseRound, analysisResults: null }} />);
    expect(screen.getByText('No analysis results available.')).toBeInTheDocument();
  });

  it('shows run counts including failures', () => {
    render(<RoundAnalysisCard round={baseRound} />);
    expect(screen.getByText('7/8 runs')).toBeInTheDocument();
    expect(screen.getByText('1 failed')).toBeInTheDocument();
  });
});
