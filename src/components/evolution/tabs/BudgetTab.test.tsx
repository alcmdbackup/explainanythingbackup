// Tests for BudgetTab component: estimate vs actual comparison, delta badges, and graceful degradation.
import { render, screen, waitFor } from '@testing-library/react';
import { BudgetTab } from './BudgetTab';
import * as visualizationActions from '@/lib/services/evolutionVisualizationActions';
import type { BudgetData } from '@/lib/services/evolutionVisualizationActions';

jest.mock('next/dynamic', () => {
  return jest.fn().mockImplementation(() => {
    function MockChart(props: Record<string, unknown>) {
      return <div data-testid="mock-chart" data-props={JSON.stringify(props)} />;
    }
    MockChart.displayName = 'MockChart';
    return MockChart;
  });
});

jest.mock('@/lib/services/evolutionVisualizationActions', () => ({
  getEvolutionRunBudgetAction: jest.fn(),
}));

const baseBudgetData: BudgetData = {
  agentBreakdown: [{ agent: 'generation', calls: 10, costUsd: 0.5 }],
  cumulativeBurn: [{ step: 1, agent: 'generation', cumulativeCost: 0.5, budgetCap: 5 }],
  estimate: null,
  prediction: null,
};

describe('BudgetTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders budget tab with charts', async () => {
    (visualizationActions.getEvolutionRunBudgetAction as jest.Mock).mockResolvedValue({
      success: true, data: baseBudgetData, error: null,
    });

    render(<BudgetTab runId="test-run-id" />);
    await waitFor(() => expect(screen.getByTestId('budget-tab')).toBeInTheDocument());
    expect(screen.getByText('Cumulative Burn')).toBeInTheDocument();
    expect(screen.getByText('Agent Cost Breakdown')).toBeInTheDocument();
  });

  it('shows estimate comparison when prediction data exists', async () => {
    const dataWithPrediction: BudgetData = {
      ...baseBudgetData,
      estimate: {
        totalUsd: 1.50,
        perAgent: { generation: 0.8, calibration: 0.4, evolution: 0.3 },
        perIteration: 0.5,
        confidence: 'high',
      },
      prediction: {
        estimatedUsd: 1.50,
        actualUsd: 1.35,
        deltaUsd: -0.15,
        deltaPercent: -10,
        confidence: 'high',
        perAgent: {
          generation: { estimated: 0.8, actual: 0.7 },
          calibration: { estimated: 0.4, actual: 0.35 },
          evolution: { estimated: 0.3, actual: 0.3 },
        },
      },
    };
    (visualizationActions.getEvolutionRunBudgetAction as jest.Mock).mockResolvedValue({
      success: true, data: dataWithPrediction, error: null,
    });

    render(<BudgetTab runId="test-run-id" />);
    await waitFor(() => expect(screen.getByTestId('estimate-comparison')).toBeInTheDocument());
    expect(screen.getByText('Estimated vs Actual')).toBeInTheDocument();
    expect(screen.getByTestId('delta-badge')).toHaveTextContent('-10%');
    expect(screen.getByText('high confidence')).toBeInTheDocument();
  });

  it('hides estimate comparison when no prediction data', async () => {
    (visualizationActions.getEvolutionRunBudgetAction as jest.Mock).mockResolvedValue({
      success: true, data: baseBudgetData, error: null,
    });

    render(<BudgetTab runId="test-run-id" />);
    await waitFor(() => expect(screen.getByTestId('budget-tab')).toBeInTheDocument());
    expect(screen.queryByTestId('estimate-comparison')).not.toBeInTheDocument();
  });

  it('shows loading skeleton initially', () => {
    (visualizationActions.getEvolutionRunBudgetAction as jest.Mock).mockReturnValue(
      new Promise(() => {}), // never resolves
    );
    render(<BudgetTab runId="test-run-id" />);
    expect(screen.queryByTestId('budget-tab')).not.toBeInTheDocument();
  });

  it('shows error message on failure', async () => {
    (visualizationActions.getEvolutionRunBudgetAction as jest.Mock).mockResolvedValue({
      success: false, data: null, error: { message: 'DB error' },
    });

    render(<BudgetTab runId="test-run-id" />);
    await waitFor(() => expect(screen.getByText('DB error')).toBeInTheDocument());
  });
});
