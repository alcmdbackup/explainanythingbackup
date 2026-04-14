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
  eloHistory: [[25], [26], [27]],
  diversityHistory: [0.5, 0.6],
  matchStats: { totalMatches: 50, avgConfidence: 0.85, decisiveRate: 0.7 },
  topVariants: [
    { id: 'v1', strategy: 'generation', elo: 27.5, isSeedVariant: false },
    { id: 'v2', strategy: 'seed_variant', elo: 25.0, isSeedVariant: true },
  ],
  seedVariantRank: 2,
  seedVariantElo: 25.0,
  strategyEffectiveness: {
    generation: { count: 5, avgElo: 26.0 },
    evolution: { count: 3, avgElo: 25.5 },
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

  it('renders top variants table with rank and elo', async () => {
    getEvolutionRunSummaryAction.mockResolvedValue({
      success: true, data: mockSummary, error: null,
    });
    getEvolutionCostBreakdownAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<MetricsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByText('Top Variants')).toBeInTheDocument());
    // mu 27.5 (legacy) → 1200 + (27.5-25)*16 = 1240
    expect(screen.getByText('1240')).toBeInTheDocument();
    // mu 25.0 (legacy) → 1200 + (25-25)*16 = 1200
    expect(screen.getByText('1200')).toBeInTheDocument();
  });

  it('renders strategy effectiveness table', async () => {
    getEvolutionRunSummaryAction.mockResolvedValue({
      success: true, data: mockSummary, error: null,
    });
    getEvolutionCostBreakdownAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<MetricsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByText('Strategy Effectiveness')).toBeInTheDocument());
    // "generation" appears in both top variants and strategy effectiveness tables
    expect(screen.getAllByText('generation').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('evolution')).toBeInTheDocument();
  });

  it('renders cost breakdown table', async () => {
    getEvolutionRunSummaryAction.mockResolvedValue({
      success: true, data: mockSummary, error: null,
    });
    getEvolutionCostBreakdownAction.mockResolvedValue({
      success: true, data: [
        { agent: 'generation', calls: 10, costUsd: 0.5 },
        { agent: 'ranking', calls: 20, costUsd: 1.0 },
      ], error: null,
    });

    render(<MetricsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByText('Cost by Agent')).toBeInTheDocument());
    expect(screen.getByText('$0.50')).toBeInTheDocument();
    expect(screen.getByText('$1.00')).toBeInTheDocument();
  });

  it('renders loading skeleton before data arrives', () => {
    getEvolutionRunSummaryAction.mockReturnValue(new Promise(() => {}));
    getEvolutionCostBreakdownAction.mockReturnValue(new Promise(() => {}));

    const { container } = render(<MetricsTab runId="run-1" />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows match stats metrics', async () => {
    getEvolutionRunSummaryAction.mockResolvedValue({
      success: true, data: mockSummary, error: null,
    });
    getEvolutionCostBreakdownAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<MetricsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('metrics-tab')).toBeInTheDocument());
    expect(screen.getByText('50')).toBeInTheDocument(); // totalMatches
    expect(screen.getByText('85.0%')).toBeInTheDocument(); // avgConfidence
    expect(screen.getByText('70.0%')).toBeInTheDocument(); // decisiveRate
  });

  it('shows seed-variant checkmark for the seed variant', async () => {
    getEvolutionRunSummaryAction.mockResolvedValue({
      success: true, data: mockSummary, error: null,
    });
    getEvolutionCostBreakdownAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<MetricsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByText('Top Variants')).toBeInTheDocument());
    // v2 is baseline, should show ✓
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  it('renders stop reason and duration', async () => {
    getEvolutionRunSummaryAction.mockResolvedValue({
      success: true, data: mockSummary, error: null,
    });
    getEvolutionCostBreakdownAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<MetricsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('metrics-tab')).toBeInTheDocument());
    expect(screen.getByText('iterations_complete')).toBeInTheDocument();
    expect(screen.getByText('120s')).toBeInTheDocument();
  });

  it('shows default error message when error has no message', async () => {
    getEvolutionRunSummaryAction.mockResolvedValue({
      success: false, data: null, error: null,
    });
    getEvolutionCostBreakdownAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<MetricsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByText('Failed to load summary')).toBeInTheDocument());
  });

  it('refetches when runId changes', async () => {
    getEvolutionRunSummaryAction.mockResolvedValue({
      success: true, data: mockSummary, error: null,
    });
    getEvolutionCostBreakdownAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    const { rerender } = render(<MetricsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('metrics-tab')).toBeInTheDocument());

    rerender(<MetricsTab runId="run-2" />);
    expect(getEvolutionRunSummaryAction).toHaveBeenCalledWith('run-2');
  });

  it('hides cost breakdown when empty', async () => {
    getEvolutionRunSummaryAction.mockResolvedValue({
      success: true, data: mockSummary, error: null,
    });
    getEvolutionCostBreakdownAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<MetricsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('metrics-tab')).toBeInTheDocument());
    expect(screen.queryByText('Cost by Agent')).not.toBeInTheDocument();
  });

  it('fetches both summary and cost breakdown in parallel', async () => {
    getEvolutionRunSummaryAction.mockResolvedValue({
      success: true, data: mockSummary, error: null,
    });
    getEvolutionCostBreakdownAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<MetricsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('metrics-tab')).toBeInTheDocument());

    expect(getEvolutionRunSummaryAction).toHaveBeenCalledWith('run-1');
    expect(getEvolutionCostBreakdownAction).toHaveBeenCalledWith('run-1');
  });

  it('shows seed-variant rank metric (renamed from Baseline Rank)', async () => {
    getEvolutionRunSummaryAction.mockResolvedValue({
      success: true, data: mockSummary, error: null,
    });
    getEvolutionCostBreakdownAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<MetricsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('metrics-tab')).toBeInTheDocument());
    expect(screen.getByText('Seed Variant Rank')).toBeInTheDocument();
  });
});
