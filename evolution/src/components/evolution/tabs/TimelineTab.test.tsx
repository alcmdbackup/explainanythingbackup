// Tests for TimelineTab component: expandable agent rows and per-agent metrics display.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TimelineTab } from './TimelineTab';
import * as visualizationActions from '@evolution/services/evolutionVisualizationActions';
import type { TimelineData } from '@evolution/services/evolutionVisualizationActions';

jest.mock('next/dynamic', () => {
  return jest.fn().mockImplementation(() => {
    function MockChart(props: Record<string, unknown>) {
      return <div data-testid="mock-chart" data-props={JSON.stringify(props)} />;
    }
    MockChart.displayName = 'MockChart';
    return MockChart;
  });
});

jest.mock('@evolution/services/evolutionVisualizationActions', () => ({
  getEvolutionRunTimelineAction: jest.fn(),
  getAgentInvocationDetailAction: jest.fn(),
  getEvolutionRunBudgetAction: jest.fn().mockResolvedValue({
    success: true,
    data: {
      agentBreakdown: [],
      cumulativeBurn: [{ step: 1, agent: 'generation', cumulativeCost: 0.5, budgetCap: 5 }],
      estimate: null,
      prediction: null,
      agentBudgetCaps: {},
      runStatus: 'completed',
    },
    error: null,
  }),
}));

const mockTimelineData: TimelineData = {
  iterations: [
    {
      iteration: 0,
      phase: 'EXPANSION',
      agents: [
        {
          name: 'generation',
          costUsd: 0.01,
          variantsAdded: 3,
          matchesPlayed: 0,
          newVariantIds: ['abc-123', 'def-456', 'ghi-789'],
          diversityScoreAfter: null,
        },
        {
          name: 'calibration',
          costUsd: 0.005,
          variantsAdded: 0,
          matchesPlayed: 5,
          eloChanges: { 'abc-123': 20, 'def-456': -15, 'ghi-789': -5 },
          diversityScoreAfter: 0.73,
        },
        {
          name: 'proximity',
          costUsd: 0.002,
          variantsAdded: 0,
          matchesPlayed: 0,
          diversityScoreAfter: 0.75,
        },
      ],
      totalCostUsd: 0.017,
      totalVariantsAdded: 3,
      totalMatchesPlayed: 5,
    },
  ],
  phaseTransitions: [],
};

describe('TimelineTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (visualizationActions.getEvolutionRunTimelineAction as jest.Mock).mockResolvedValue({
      success: true,
      data: mockTimelineData,
      error: null,
    });
  });

  it('renders timeline tab with iteration data', async () => {
    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('iteration-0')).toBeInTheDocument();
    });

    expect(screen.getByText('Iteration 0')).toBeInTheDocument();
  });

  it('displays all agents per iteration', async () => {
    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('iteration-0')).toBeInTheDocument();
    });

    expect(screen.getByTestId('agent-row-generation')).toBeInTheDocument();
    expect(screen.getByTestId('agent-row-calibration')).toBeInTheDocument();
    expect(screen.getByTestId('agent-row-proximity')).toBeInTheDocument();
  });

  it('displays iteration summary in header', async () => {
    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('iteration-0')).toBeInTheDocument();
    });

    // Summary should show agent count, variants, and cost in a combined pattern
    // The header has format: "3 agents • +3 variants • $0.017"
    expect(screen.getByText(/3 agents.*\+3 variants.*\$0\.017/)).toBeInTheDocument();
  });

  it('expands agent detail panel when row is clicked', async () => {
    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('iteration-0')).toBeInTheDocument();
    });

    // Click on generation agent row
    fireEvent.click(screen.getByTestId('agent-row-generation'));

    // Detail panel should be visible
    await waitFor(() => {
      expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
    });

    // Should show metrics
    expect(screen.getByText('Variants Added')).toBeInTheDocument();
    expect(screen.getByTestId('metric-variants-added')).toHaveTextContent('3');
  });

  it('collapses agent detail panel when clicked again', async () => {
    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('iteration-0')).toBeInTheDocument();
    });

    // Click to expand
    fireEvent.click(screen.getByTestId('agent-row-generation'));
    await waitFor(() => {
      expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
    });

    // Click to collapse
    fireEvent.click(screen.getByTestId('agent-row-generation'));
    await waitFor(() => {
      expect(screen.queryByTestId('agent-detail-panel')).not.toBeInTheDocument();
    });
  });

  it('allows multiple agents to be expanded simultaneously', async () => {
    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('iteration-0')).toBeInTheDocument();
    });

    // Expand generation
    fireEvent.click(screen.getByTestId('agent-row-generation'));
    await waitFor(() => {
      expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
    });

    // Expand calibration
    fireEvent.click(screen.getByTestId('agent-row-calibration'));
    await waitFor(() => {
      // Should now have two detail panels
      expect(screen.getAllByTestId('agent-detail-panel')).toHaveLength(2);
    });
  });

  it('renders loading skeleton initially', () => {
    (visualizationActions.getEvolutionRunTimelineAction as jest.Mock).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<TimelineTab runId="test-run-id" />);

    // Timeline tab wrapper exists but iteration content should not be present
    expect(screen.getByTestId('timeline-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('iteration-0')).not.toBeInTheDocument();
  });

  it('displays error message on failure', async () => {
    (visualizationActions.getEvolutionRunTimelineAction as jest.Mock).mockResolvedValue({
      success: false,
      data: null,
      error: { message: 'Failed to load timeline' },
    });

    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load timeline')).toBeInTheDocument();
    });
  });

  it('displays empty state when no data', async () => {
    (visualizationActions.getEvolutionRunTimelineAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { iterations: [], phaseTransitions: [] },
      error: null,
    });

    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByText('No timeline data available')).toBeInTheDocument();
    });
  });
});

describe('AGENT_PALETTE coverage', () => {
  // All 13 agents that appear in checkpoints (from PipelineAgents + flowCritique inline).
  const ALL_CHECKPOINT_AGENTS = [
    'generation', 'calibration', 'evolution', 'reflection',
    'iterativeEditing', 'debate', 'proximity', 'metaReview',
    'tournament', 'treeSearch', 'sectionDecomposition',
    'outlineGeneration', 'flowCritique',
  ];

  it('has a palette color for every checkpoint agent name', async () => {
    (visualizationActions.getEvolutionRunTimelineAction as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        iterations: [{
          iteration: 0,
          phase: 'COMPETITION',
          agents: ALL_CHECKPOINT_AGENTS.map(name => ({
            name,
            costUsd: 0.001,
            variantsAdded: 0,
            matchesPlayed: 0,
          })),
          totalCostUsd: 0.013,
          totalVariantsAdded: 0,
          totalMatchesPlayed: 0,
        }],
        phaseTransitions: [],
      },
      error: null,
    });

    render(<TimelineTab runId="palette-test" />);

    await waitFor(() => {
      expect(screen.getByTestId('iteration-0')).toBeInTheDocument();
    });

    // Every agent row should have a colored indicator (not the muted fallback).
    // The fallback is 'var(--text-muted)'; a palette hit uses a hex color.
    for (const name of ALL_CHECKPOINT_AGENTS) {
      const row = screen.getByTestId(`agent-row-${name}`);
      const indicator = row.querySelector('.w-1.h-4.rounded-full') as HTMLElement;
      expect(indicator).toBeTruthy();
      expect(indicator.style.backgroundColor).not.toBe('var(--text-muted)');
      // Hex colors get normalized to rgb() by jsdom
      expect(indicator.style.backgroundColor).toMatch(/^rgb/);
    }
  });
});

describe('AgentDetailPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (visualizationActions.getEvolutionRunTimelineAction as jest.Mock).mockResolvedValue({
      success: true,
      data: mockTimelineData,
      error: null,
    });
  });

  it('renders metrics grid with all fields', async () => {
    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('iteration-0')).toBeInTheDocument();
    });

    // Expand calibration (has more metrics)
    fireEvent.click(screen.getByTestId('agent-row-calibration'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
    });

    expect(screen.getByText('Matches Played')).toBeInTheDocument();
    expect(screen.getByTestId('metric-matches-played')).toHaveTextContent('5');
    expect(screen.getByText('Diversity After')).toBeInTheDocument();
    expect(screen.getByText('0.73')).toBeInTheDocument();
  });

  it('renders newVariantIds as short IDs', async () => {
    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('iteration-0')).toBeInTheDocument();
    });

    // Expand generation (has newVariantIds)
    fireEvent.click(screen.getByTestId('agent-row-generation'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
    });

    // Should show truncated variant IDs
    expect(screen.getByText('abc-123')).toBeInTheDocument();
    expect(screen.getByText('def-456')).toBeInTheDocument();
  });

  it('renders eloChanges with positive/negative styling', async () => {
    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('iteration-0')).toBeInTheDocument();
    });

    // Expand calibration (has eloChanges)
    fireEvent.click(screen.getByTestId('agent-row-calibration'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
    });

    expect(screen.getByText('Rating Changes')).toBeInTheDocument();
    // Check for positive change
    expect(screen.getByText(/abc-12.*\+20/)).toBeInTheDocument();
    // Check for negative change
    expect(screen.getByText(/def-45.*-15/)).toBeInTheDocument();
  });

  it('handles null diversityScoreAfter gracefully', async () => {
    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('iteration-0')).toBeInTheDocument();
    });

    // Expand generation (has null diversityScoreAfter)
    fireEvent.click(screen.getByTestId('agent-row-generation'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
    });

    // Should show dash for null
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('displays error message when agent.error is present', async () => {
    const dataWithError: TimelineData = {
      ...mockTimelineData,
      iterations: [
        {
          ...mockTimelineData.iterations[0],
          agents: [
            {
              name: 'generation',
              costUsd: 0.01,
              variantsAdded: 0,
              matchesPlayed: 0,
              error: 'Budget exceeded',
            },
          ],
        },
      ],
    };

    (visualizationActions.getEvolutionRunTimelineAction as jest.Mock).mockResolvedValue({
      success: true,
      data: dataWithError,
      error: null,
    });

    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('iteration-0')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-row-generation'));

    await waitFor(() => {
      expect(screen.getByText(/Budget exceeded/)).toBeInTheDocument();
    });
  });
});

describe('Execution detail lazy-loading', () => {
  const dataWithDetail: TimelineData = {
    iterations: [
      {
        iteration: 0,
        phase: 'EXPANSION',
        agents: [
          {
            name: 'proximity',
            costUsd: 0.002,
            variantsAdded: 0,
            matchesPlayed: 0,
            hasExecutionDetail: true,
          },
          {
            name: 'generation',
            costUsd: 0.01,
            variantsAdded: 3,
            matchesPlayed: 0,
          },
        ],
        totalCostUsd: 0.012,
        totalVariantsAdded: 3,
        totalMatchesPlayed: 0,
      },
    ],
    phaseTransitions: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (visualizationActions.getEvolutionRunTimelineAction as jest.Mock).mockResolvedValue({
      success: true,
      data: dataWithDetail,
      error: null,
    });
  });

  it('fetches and renders execution detail when agent has hasExecutionDetail', async () => {
    (visualizationActions.getAgentInvocationDetailAction as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        detailType: 'proximity',
        totalCost: 0.002,
        newEntrants: 3,
        existingVariants: 5,
        diversityScore: 0.823,
        totalPairsComputed: 15,
      },
    });

    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('iteration-0')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-row-proximity'));

    await waitFor(() => {
      expect(visualizationActions.getAgentInvocationDetailAction).toHaveBeenCalledWith(
        'test-run-id', 0, 'proximity'
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('proximity-detail')).toBeInTheDocument();
    });

    expect(screen.getByText('0.823')).toBeInTheDocument();
  });

  it('does not fetch execution detail for agents without hasExecutionDetail', async () => {
    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('iteration-0')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-row-generation'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
    });

    expect(visualizationActions.getAgentInvocationDetailAction).not.toHaveBeenCalled();
  });

  it('shows fallback when execution detail fetch returns null', async () => {
    (visualizationActions.getAgentInvocationDetailAction as jest.Mock).mockResolvedValue({
      success: false,
      data: null,
    });

    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('iteration-0')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-row-proximity'));

    await waitFor(() => {
      expect(screen.getByText('No execution detail available')).toBeInTheDocument();
    });
  });

  it('renders View Details link when agent has invocationId', async () => {
    const dataWithInvId: TimelineData = {
      iterations: [{
        iteration: 0,
        phase: 'EXPANSION',
        agents: [{
          name: 'generation',
          costUsd: 0.01,
          variantsAdded: 1,
          matchesPlayed: 0,
          invocationId: 'inv-123-456',
          diversityScoreAfter: null,
        }],
      }],
      phaseTransitions: [],
    };

    (visualizationActions.getEvolutionRunTimelineAction as jest.Mock).mockResolvedValue({
      success: true,
      data: dataWithInvId,
      error: null,
    });

    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('iteration-0')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-row-generation'));

    await waitFor(() => {
      const link = screen.getByTestId('view-invocation-detail');
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/admin/quality/evolution/invocation/inv-123-456');
    });
  });

  it('does not render View Details link when agent has no invocationId', async () => {
    const dataNoInvId: TimelineData = {
      iterations: [{
        iteration: 0,
        phase: 'EXPANSION',
        agents: [{
          name: 'generation',
          costUsd: 0.01,
          variantsAdded: 1,
          matchesPlayed: 0,
          diversityScoreAfter: null,
        }],
      }],
      phaseTransitions: [],
    };

    (visualizationActions.getEvolutionRunTimelineAction as jest.Mock).mockResolvedValue({
      success: true,
      data: dataNoInvId,
      error: null,
    });

    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('iteration-0')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-row-generation'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('view-invocation-detail')).not.toBeInTheDocument();
  });
});
