// Tests for MetricsTab V2: loading, metrics display, empty state, and cost breakdown.
import { render, screen, waitFor } from '@testing-library/react';
import { MetricsTab } from './MetricsTab';

jest.mock('@evolution/services/evolutionActions', () => ({
  getEvolutionRunSummaryAction: jest.fn(),
  getEvolutionCostBreakdownAction: jest.fn(),
}));

jest.mock('@evolution/lib/utils/formatters', () => ({
  formatCost: (v: number) => `$${v.toFixed(2)}`,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getEvolutionRunSummaryAction, getEvolutionCostBreakdownAction } = require('@evolution/services/evolutionActions');

const mockSummary = {
  version: 3,
  stopReason: 'iterations_complete',
  finalPhase: 'COMPETITION',
  totalIterations: 10,
  durationSeconds: 120,
  muHistory: [25, 26, 27],
  diversityHistory: [0.5, 0.6],
  matchStats: { totalMatches: 50, avgConfidence: 0.85, decisiveRate: 0.7 },
  topVariants: [
    { id: 'v1', strategy: 'generation', mu: 27.5, isBaseline: false },
    { id: 'v2', strategy: 'original_baseline', mu: 25.0, isBaseline: true },
  ],
  baselineRank: 2,
  baselineMu: 25.0,
  strategyEffectiveness: {
    generation: { count: 5, avgMu: 26.0 },
    evolution: { count: 3, avgMu: 25.5 },
  },
  metaFeedback: null,
};

describe('MetricsTab', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders metrics after loading', async () => {
    getEvolutionRunSummaryAction.mockResolvedValue({
      success: true, data: mockSummary, error: null,
    });
    getEvolutionCostBreakdownAction.mockResolvedValue({
      success: true, data: [{ agent: 'generation', calls: 10, costUsd: 0.5 }], error: null,
    });

    render(<MetricsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('metrics-tab')).toBeInTheDocument());
    expect(screen.getByTestId('metric-total-iterations')).toBeInTheDocument();
    expect(screen.getByText('COMPETITION')).toBeInTheDocument();
  });

  it('shows empty state when no summary', async () => {
    getEvolutionRunSummaryAction.mockResolvedValue({
      success: true, data: null, error: null,
    });
    getEvolutionCostBreakdownAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<MetricsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('metrics-tab-empty')).toBeInTheDocument());
  });

  it('renders error on failure', async () => {
    getEvolutionRunSummaryAction.mockResolvedValue({
      success: false, data: null, error: { message: 'DB error' },
    });
    getEvolutionCostBreakdownAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<MetricsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByText('DB error')).toBeInTheDocument());
  });
});
