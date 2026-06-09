// Tests for LineageTab V2: loading, data display, empty and error states.

import { render, screen, waitFor } from '@testing-library/react';
import { LineageTab } from './LineageTab';

const mockGetLineage = jest.fn();

jest.mock('@evolution/services/evolutionVisualizationActions', () => ({
  getEvolutionRunLineageAction: (...args: unknown[]) => mockGetLineage(...args),
}));

jest.mock('@evolution/components/evolution/visualizations/LineageGraph', () => ({
  LineageGraph: ({ nodes }: { nodes: Array<{ variantKind?: string }> }) => (
    <div
      data-testid="lineage-graph"
      data-variant-kinds={nodes.map((n) => n.variantKind ?? 'article').join(',')}
    >
      {nodes.length} nodes
    </div>
  ),
}));

describe('LineageTab', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders loading skeleton initially', () => {
    mockGetLineage.mockReturnValue(new Promise(() => {}));
    render(<LineageTab runId="run-1" />);
    expect(screen.queryByTestId('lineage-tab')).toBeNull();
  });

  it('renders lineage graph with data', async () => {
    mockGetLineage.mockResolvedValue({
      success: true,
      data: [
        { id: 'v1', generation: 0, agentName: 'generation', eloScore: 1200, isWinner: false, parentId: null },
        { id: 'v2', generation: 1, agentName: 'evolution', eloScore: 1350, isWinner: true, parentId: 'v1' },
      ],
      error: null,
    });

    render(<LineageTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('lineage-tab')).toBeInTheDocument());
    expect(screen.getByTestId('lineage-graph')).toBeInTheDocument();
  });

  it('carries variantKind onto graph nodes so LineageGraph can style paragraph variants normally', async () => {
    // The LineageGraph d3 styling can't be asserted in RTL (d3 .attr() is mocked), so we verify
    // the LineageTab graphNodes mapping threads variantKind through — the unit-testable guarantee.
    mockGetLineage.mockResolvedValue({
      success: true,
      data: [
        { id: 'v1', generation: 0, agentName: 'paragraph_rewrite', eloScore: 1200, isWinner: false, parentId: null, parentIds: [], persisted: false, variantKind: 'paragraph' },
        { id: 'v2', generation: 1, agentName: 'generation', eloScore: 1350, isWinner: true, parentId: 'v1', parentIds: ['v1'], persisted: true, variantKind: 'article' },
      ],
      error: null,
    });

    render(<LineageTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('lineage-graph')).toBeInTheDocument());
    expect(screen.getByTestId('lineage-graph').getAttribute('data-variant-kinds')).toBe('paragraph,article');
  });

  it('renders empty state when no nodes', async () => {
    mockGetLineage.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<LineageTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('lineage-tab-empty')).toBeInTheDocument());
  });

  it('renders error', async () => {
    mockGetLineage.mockResolvedValue({
      success: false, data: null, error: { message: 'DB error' },
    });

    render(<LineageTab runId="run-1" />);
    await waitFor(() => expect(screen.getByText('DB error')).toBeInTheDocument());
  });
});
