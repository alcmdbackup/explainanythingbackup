// Tests for LineageTab: view toggle, data loading, error/empty states, tree content.

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { LineageTab } from './LineageTab';

const mockGetLineage = jest.fn();
const mockGetTreeSearch = jest.fn();

jest.mock('@evolution/services/evolutionVisualizationActions', () => ({
  getEvolutionRunLineageAction: (...args: unknown[]) => mockGetLineage(...args),
  getEvolutionRunTreeSearchAction: (...args: unknown[]) => mockGetTreeSearch(...args),
}));

jest.mock('next/dynamic', () => {
  return jest.fn(() => {
    return function MockDynamic(props: Record<string, unknown>) {
      return <div data-testid="mock-lineage-graph" {...props} />;
    };
  });
});

const LINEAGE_DATA = {
  nodes: [
    { id: 'v1', label: 'v1', iteration: 1, strategy: 'generation' },
    { id: 'v2', label: 'v2', iteration: 2, strategy: 'structural_transform' },
  ],
  edges: [{ source: 'v1', target: 'v2' }],
  treeSearchPath: null,
};

const TREE_DATA = {
  trees: [
    {
      nodes: [
        { id: 'n1', depth: 0, parentNodeId: null, pruned: false, revisionAction: { type: 'root', dimension: null, description: 'Root' } },
        { id: 'n2', depth: 1, parentNodeId: 'n1', pruned: false, revisionAction: { type: 'expand', dimension: 'clarity', description: 'Expand clarity' } },
        { id: 'n3', depth: 1, parentNodeId: 'n1', pruned: true, revisionAction: { type: 'expand', dimension: 'depth', description: 'Expand depth' } },
      ],
      result: { bestLeafNodeId: 'n2', maxDepth: 1, treeSize: 3, prunedBranches: 1, revisionPath: [{ type: 'expand', dimension: 'clarity' }] },
    },
  ],
};

describe('LineageTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLineage.mockResolvedValue({ success: true, data: LINEAGE_DATA, error: null });
    mockGetTreeSearch.mockResolvedValue({ success: true, data: TREE_DATA, error: null });
  });

  it('shows loading skeleton initially', () => {
    mockGetLineage.mockReturnValue(new Promise(() => {}));
    render(<LineageTab runId="run-1" />);
    // Should show a loading div (animate-pulse)
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders lineage tab with data', async () => {
    render(<LineageTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('lineage-tab')).toBeInTheDocument();
    });
  });

  it('shows error when lineage load fails', async () => {
    mockGetLineage.mockResolvedValue({ success: false, data: null, error: { message: 'DB error' } });
    render(<LineageTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText('DB error')).toBeInTheDocument();
    });
  });

  it('shows empty state when no lineage data', async () => {
    mockGetLineage.mockResolvedValue({ success: true, data: { nodes: [], edges: [] }, error: null });
    render(<LineageTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText('No lineage data available')).toBeInTheDocument();
    });
  });

  it('shows view toggle when tree data exists', async () => {
    render(<LineageTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('lineage-view-toggle')).toBeInTheDocument();
    });
    expect(screen.getByText('Full DAG')).toBeInTheDocument();
    expect(screen.getByText('Pruned Tree')).toBeInTheDocument();
  });

  it('hides view toggle when no tree data', async () => {
    mockGetTreeSearch.mockResolvedValue({ success: true, data: { trees: [] }, error: null });
    render(<LineageTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('lineage-tab')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('lineage-view-toggle')).not.toBeInTheDocument();
  });

  it('hides view toggle when tree search fails', async () => {
    mockGetTreeSearch.mockResolvedValue({ success: false, data: null, error: null });
    render(<LineageTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('lineage-tab')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('lineage-view-toggle')).not.toBeInTheDocument();
  });

  it('switches to tree view on toggle click', async () => {
    render(<LineageTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('lineage-view-toggle')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Pruned Tree'));
    await waitFor(() => {
      expect(screen.getByTestId('tree-tab')).toBeInTheDocument();
    });
  });

  it('switches back to lineage view', async () => {
    render(<LineageTab runId="run-1" initialView="tree" />);
    await waitFor(() => {
      expect(screen.getByTestId('lineage-view-toggle')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Full DAG'));
    expect(screen.queryByTestId('tree-tab')).not.toBeInTheDocument();
  });

  it('respects initialView prop', async () => {
    render(<LineageTab runId="run-1" initialView="tree" />);
    await waitFor(() => {
      expect(screen.getByTestId('tree-tab')).toBeInTheDocument();
    });
  });

  it('calls loadLineage and loadTree with runId', async () => {
    render(<LineageTab runId="test-run-123" />);
    await waitFor(() => {
      expect(screen.getByTestId('lineage-tab')).toBeInTheDocument();
    });
    expect(mockGetLineage).toHaveBeenCalledWith('test-run-123');
    expect(mockGetTreeSearch).toHaveBeenCalledWith('test-run-123');
  });
});

describe('TreeContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLineage.mockResolvedValue({ success: true, data: LINEAGE_DATA, error: null });
    mockGetTreeSearch.mockResolvedValue({ success: true, data: TREE_DATA, error: null });
  });

  it('displays tree stats (nodes, max depth, pruned)', async () => {
    render(<LineageTab runId="run-1" initialView="tree" />);
    await waitFor(() => {
      expect(screen.getByTestId('tree-tab')).toBeInTheDocument();
    });
    // treeSize = 3, maxDepth = 1, prunedBranches = 1
    const stats = screen.getByTestId('tree-tab').querySelectorAll('.font-semibold');
    const statTexts = Array.from(stats).map((el) => el.textContent);
    expect(statTexts).toContain('3');
    expect(statTexts).toContain('1');
  });

  it('shows tree selector when multiple trees exist', async () => {
    const multiTree = {
      trees: [
        TREE_DATA.trees[0],
        { ...TREE_DATA.trees[0], nodes: [TREE_DATA.trees[0].nodes[0]] },
      ],
    };
    mockGetTreeSearch.mockResolvedValue({ success: true, data: multiTree, error: null });

    render(<LineageTab runId="run-1" initialView="tree" />);
    await waitFor(() => {
      expect(screen.getByText('Tree 1')).toBeInTheDocument();
      expect(screen.getByText('Tree 2')).toBeInTheDocument();
    });
  });

  it('does not show tree selector for single tree', async () => {
    render(<LineageTab runId="run-1" initialView="tree" />);
    await waitFor(() => {
      expect(screen.getByTestId('tree-tab')).toBeInTheDocument();
    });
    expect(screen.queryByText('Tree 1')).not.toBeInTheDocument();
  });

  it('shows revision path', async () => {
    render(<LineageTab runId="run-1" initialView="tree" />);
    await waitFor(() => {
      expect(screen.getByText('clarity')).toBeInTheDocument();
    });
  });
});
