// Tests for LineageGraph D3 component: renders SVG container, calls D3 APIs, and handles empty data.
import { render, screen, act } from '@testing-library/react';
import { LineageGraph } from './LineageGraph';
import type { LineageData } from '@/lib/services/evolutionVisualizationActions';

// D3 is mocked via jest.config.js moduleNameMapper → src/testing/mocks/d3.ts

const sampleNodes: LineageData['nodes'] = [
  { id: 'v1-full-id', shortId: 'v1-full-', strategy: 'structural_transform', elo: 1250, iterationBorn: 1, isWinner: false },
  { id: 'v2-full-id', shortId: 'v2-full-', strategy: 'lexical_simplify', elo: 1350, iterationBorn: 2, isWinner: true },
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
});
