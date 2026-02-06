// Tests for TimelineTab component: expandable agent rows and per-agent metrics display.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TimelineTab } from './TimelineTab';
import * as visualizationActions from '@/lib/services/evolutionVisualizationActions';
import type { TimelineData } from '@/lib/services/evolutionVisualizationActions';

jest.mock('@/lib/services/evolutionVisualizationActions', () => ({
  getEvolutionRunTimelineAction: jest.fn(),
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
      expect(screen.getByTestId('timeline-tab')).toBeInTheDocument();
    });

    expect(screen.getByText('Iteration 0')).toBeInTheDocument();
  });

  it('displays all agents per iteration', async () => {
    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('timeline-tab')).toBeInTheDocument();
    });

    expect(screen.getByTestId('agent-row-generation')).toBeInTheDocument();
    expect(screen.getByTestId('agent-row-calibration')).toBeInTheDocument();
    expect(screen.getByTestId('agent-row-proximity')).toBeInTheDocument();
  });

  it('displays iteration summary in header', async () => {
    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('timeline-tab')).toBeInTheDocument();
    });

    // Summary should show agent count, variants, and cost in a combined pattern
    // The header has format: "3 agents • +3 variants • $0.017"
    expect(screen.getByText(/3 agents.*\+3 variants.*\$0\.017/)).toBeInTheDocument();
  });

  it('expands agent detail panel when row is clicked', async () => {
    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('timeline-tab')).toBeInTheDocument();
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
      expect(screen.getByTestId('timeline-tab')).toBeInTheDocument();
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
      expect(screen.getByTestId('timeline-tab')).toBeInTheDocument();
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

    // Should show skeleton while loading
    expect(screen.queryByTestId('timeline-tab')).not.toBeInTheDocument();
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
      expect(screen.getByTestId('timeline-tab')).toBeInTheDocument();
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
      expect(screen.getByTestId('timeline-tab')).toBeInTheDocument();
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
      expect(screen.getByTestId('timeline-tab')).toBeInTheDocument();
    });

    // Expand calibration (has eloChanges)
    fireEvent.click(screen.getByTestId('agent-row-calibration'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
    });

    expect(screen.getByText('Elo Changes')).toBeInTheDocument();
    // Check for positive change
    expect(screen.getByText(/abc-12.*\+20/)).toBeInTheDocument();
    // Check for negative change
    expect(screen.getByText(/def-45.*-15/)).toBeInTheDocument();
  });

  it('handles null diversityScoreAfter gracefully', async () => {
    render(<TimelineTab runId="test-run-id" />);

    await waitFor(() => {
      expect(screen.getByTestId('timeline-tab')).toBeInTheDocument();
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
      expect(screen.getByTestId('timeline-tab')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('agent-row-generation'));

    await waitFor(() => {
      expect(screen.getByText(/Budget exceeded/)).toBeInTheDocument();
    });
  });
});
