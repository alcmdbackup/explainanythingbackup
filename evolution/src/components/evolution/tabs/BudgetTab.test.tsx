// Tests for budget section within the merged TimelineTab component.
// Migrated from standalone BudgetTab tests after tab merge (7→5).
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimelineTab } from './TimelineTab';
import * as visualizationActions from '@evolution/services/evolutionVisualizationActions';
import type { BudgetData, TimelineData } from '@evolution/services/evolutionVisualizationActions';

jest.mock('next/dynamic', () => {
  return jest.fn().mockImplementation(() => {
    function MockChart(props: Record<string, unknown>) {
      return <div data-testid="mock-chart" data-props={JSON.stringify(props)} />;
    }
    MockChart.displayName = 'MockChart';
    return MockChart;
  });
});

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

jest.mock('@evolution/components/evolution', () => ({
  PhaseIndicator: () => <span data-testid="phase-indicator" />,
}));

jest.mock('@evolution/components/evolution/agentDetails', () => ({
  AgentExecutionDetailView: () => <div data-testid="execution-detail" />,
}));

jest.mock('@evolution/services/evolutionVisualizationActions', () => ({
  getEvolutionRunTimelineAction: jest.fn(),
  getAgentInvocationDetailAction: jest.fn(),
  getEvolutionRunBudgetAction: jest.fn(),
}));

const baseTimelineData: TimelineData = {
  iterations: [],
  phaseTransitions: [],
};

const baseBudgetData: BudgetData = {
  agentBreakdown: [{ agent: 'generation', calls: 10, costUsd: 0.5 }],
  cumulativeBurn: [{ step: 1, agent: 'generation', cumulativeCost: 0.5, budgetCap: 5 }],
  estimate: null,
  prediction: null,
  agentBudgetCaps: {},
  runStatus: 'completed',
};

function mockActions(timeline: TimelineData = baseTimelineData, budget: BudgetData = baseBudgetData) {
  (visualizationActions.getEvolutionRunTimelineAction as jest.Mock).mockResolvedValue({
    success: true, data: timeline, error: null,
  });
  (visualizationActions.getEvolutionRunBudgetAction as jest.Mock).mockResolvedValue({
    success: true, data: budget, error: null,
  });
}

describe('TimelineTab — Budget Section', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders budget status within timeline tab', async () => {
    mockActions();
    render(<TimelineTab runId="test-run-id" />);
    await waitFor(() => expect(screen.getByTestId('budget-status')).toBeInTheDocument());
    expect(screen.getByTestId('budget-tab')).toBeInTheDocument();
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
    mockActions(baseTimelineData, dataWithPrediction);

    render(<TimelineTab runId="test-run-id" />);
    await waitFor(() => expect(screen.getByTestId('estimate-comparison')).toBeInTheDocument());
    expect(screen.getByText('Estimated vs Actual')).toBeInTheDocument();
    expect(screen.getByTestId('delta-badge')).toHaveTextContent('-10%');
    expect(screen.getByText('high confidence')).toBeInTheDocument();
  });

  it('hides estimate comparison when no prediction data', async () => {
    mockActions();
    render(<TimelineTab runId="test-run-id" />);
    await waitFor(() => expect(screen.getByTestId('budget-tab')).toBeInTheDocument());
    expect(screen.queryByTestId('estimate-comparison')).not.toBeInTheDocument();
  });

  it('renders agent budget caps table when caps present', async () => {
    const dataWithCaps: BudgetData = {
      ...baseBudgetData,
      agentBudgetCaps: { generation: 1.75, calibration: 0.75 },
    };
    mockActions(baseTimelineData, dataWithCaps);

    render(<TimelineTab runId="test-run-id" />);
    await waitFor(() => expect(screen.getByTestId('agent-budget-caps')).toBeInTheDocument());
    expect(screen.getByText('Agent Budget Caps')).toBeInTheDocument();
    expect(screen.getByText('generation')).toBeInTheDocument();
    expect(screen.getByText('calibration')).toBeInTheDocument();
  });

  it('re-fetches data when refreshKey changes from shared provider', async () => {
    jest.useFakeTimers();
    try {
      mockActions();

      // Render inside AutoRefreshProvider with isActive=true (simulates active run)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { AutoRefreshProvider } = require('@evolution/components/evolution/AutoRefreshProvider');
      await act(async () => {
        render(
          <AutoRefreshProvider isActive={true} intervalMs={5000}>
            <TimelineTab runId="test-run-id" />
          </AutoRefreshProvider>,
        );
      });
      await waitFor(() => expect(screen.getByTestId('budget-tab')).toBeInTheDocument());

      expect(visualizationActions.getEvolutionRunBudgetAction).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      await waitFor(() => {
        expect(visualizationActions.getEvolutionRunBudgetAction).toHaveBeenCalledTimes(2);
      });
      expect(visualizationActions.getEvolutionRunTimelineAction).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows error message on budget load failure', async () => {
    (visualizationActions.getEvolutionRunTimelineAction as jest.Mock).mockResolvedValue({
      success: true, data: baseTimelineData, error: null,
    });
    (visualizationActions.getEvolutionRunBudgetAction as jest.Mock).mockResolvedValue({
      success: false, data: null, error: { message: 'DB error' },
    });

    render(<TimelineTab runId="test-run-id" />);
    await waitFor(() => expect(screen.getByText('DB error')).toBeInTheDocument());
  });

  it('toggles budget details collapse', async () => {
    mockActions();
    render(<TimelineTab runId="test-run-id" />);
    await waitFor(() => expect(screen.getByTestId('budget-status')).toBeInTheDocument());

    // Budget details should be expanded by default
    expect(screen.getByText('Cumulative Burn')).toBeInTheDocument();

    // Collapse
    await userEvent.click(screen.getByTestId('budget-details-toggle'));
    expect(screen.queryByText('Cumulative Burn')).not.toBeInTheDocument();

    // Re-expand
    await userEvent.click(screen.getByTestId('budget-details-toggle'));
    expect(screen.getByText('Cumulative Burn')).toBeInTheDocument();
  });
});
