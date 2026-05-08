// Tests for LineageGraph D3 component: renders SVG container, calls D3 APIs, and handles empty data.
import { render, screen, act } from '@testing-library/react';
import { LineageGraph } from './LineageGraph';
import type { LineageData } from '@evolution/services/evolutionVisualizationActions';

// D3 is mocked via jest.config.js moduleNameMapper → src/testing/mocks/d3.ts

const sampleNodes: LineageData['nodes'] = [
  { id: 'v1-full-id', shortId: 'v1-full-', tactic: 'structural_transform', elo: 1250, iterationBorn: 1, isWinner: false },
  { id: 'v2-full-id', shortId: 'v2-full-', tactic: 'lexical_simplify', elo: 1350, iterationBorn: 2, isWinner: true },
];

const sampleEdges: LineageData['edges'] = [
  { source: 'v1-full-id', target: 'v2-full-id' },
];

describe('LineageGraph', () => {
  it('renders SVG container with data-testid', async () => {
    await act(async () => {
      render(<LineageGraph nodes={sampleNodes} edges={sampleEdges} />);
    });
    expect(screen.getByTestId('lineage-graph')).toBeInTheDocument();
  });

  it('renders without crashing when nodes are empty', async () => {
    await act(async () => {
      render(<LineageGraph nodes={[]} edges={[]} />);
    });
    expect(screen.getByTestId('lineage-graph')).toBeInTheDocument();
  });

  it('does not render detail panel initially', async () => {
    await act(async () => {
      render(<LineageGraph nodes={sampleNodes} edges={sampleEdges} />);
    });
    expect(screen.queryByTestId('lineage-detail-panel')).not.toBeInTheDocument();
  });

  it('sets correct SVG dimensions', async () => {
    await act(async () => {
      render(<LineageGraph nodes={sampleNodes} edges={sampleEdges} />);
    });
    const svg = screen.getByTestId('lineage-graph');
    expect(svg.getAttribute('width')).toBe('100%');
    expect(svg.getAttribute('height')).toBe('500');
  });

  // bring_back_debate_agent_20260506 Phase 4.9 — multi-parent edge rendering.
  it('accepts multi-parent edges with parentIndex (debate variants emit two edges)', async () => {
    // Debate variants emit parentIds = [winner.id, loser.id] (Decision §20). The lineage
    // graph receives two edges per debate variant: solid primary (parentIndex=0) +
    // dashed additional (parentIndex=1). The D3 rendering layer applies the dashed style
    // based on parentIndex; this test verifies the data shape flows through the component
    // without errors. Visual dashed-style assertions live in Playwright (Phase 5.1).
    const winnerId = 'winner-aaaaaaaa';
    const loserId = 'loser-bbbbbbbb';
    const synthesisId = 'synthesis-cccccccc';
    const multiParentNodes: LineageData['nodes'] = [
      { id: winnerId, shortId: winnerId.slice(0, 8), tactic: 'structural_transform', elo: 1300, iterationBorn: 1, isWinner: false },
      { id: loserId, shortId: loserId.slice(0, 8), tactic: 'lexical_simplify', elo: 1280, iterationBorn: 1, isWinner: false },
      { id: synthesisId, shortId: synthesisId.slice(0, 8), tactic: 'debate_synthesis', elo: 1320, iterationBorn: 2, isWinner: true },
    ];
    const multiParentEdges: LineageData['edges'] = [
      { source: winnerId, target: synthesisId, parentIndex: 0 },   // solid (canonical primary)
      { source: loserId, target: synthesisId, parentIndex: 1 },    // dashed (additional)
    ];

    await act(async () => {
      render(<LineageGraph nodes={multiParentNodes} edges={multiParentEdges} />);
    });
    expect(screen.getByTestId('lineage-graph')).toBeInTheDocument();
  });

  it('accepts single-parent edges without parentIndex (single-parent variants stay solid)', async () => {
    // Single-parent variants emit a 1-element parentIds array; the resulting edge
    // has no parentIndex set (or parentIndex=0). Rendering must remain solid.
    const singleParentEdges: LineageData['edges'] = [
      { source: 'v1-full-id', target: 'v2-full-id', parentIndex: 0 },
    ];
    await act(async () => {
      render(<LineageGraph nodes={sampleNodes} edges={singleParentEdges} />);
    });
    expect(screen.getByTestId('lineage-graph')).toBeInTheDocument();
  });
});
