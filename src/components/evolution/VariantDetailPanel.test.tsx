// Tests for VariantDetailPanel: match history, dimension scores, parent lineage, agent jump.

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { VariantDetailPanel } from './VariantDetailPanel';
import type { VariantDetail } from '@/lib/services/evolutionVisualizationActions';

const mockGetDetail = jest.fn();
jest.mock('@/lib/services/evolutionVisualizationActions', () => ({
  getVariantDetailAction: (...args: unknown[]) => mockGetDetail(...args),
}));

const mockDetail: VariantDetail = {
  id: 'variant-abc-123',
  text: 'This is the variant content for testing purposes.',
  elo: 1350,
  strategy: 'narrative',
  iterationBorn: 3,
  costUsd: 0.0042,
  parentIds: ['parent-001', 'parent-002'],
  parentTexts: {
    'parent-001': 'This is the original parent content.',
  },
  matches: [
    { opponentId: 'opp-001', won: true, confidence: 0.85, dimensionScores: { clarity: 'A', depth: 'B' } },
    { opponentId: 'opp-002', won: false, confidence: 0.6, dimensionScores: {} },
  ],
  dimensionScores: { clarity: 0.8, depth: 0.65, engagement: 0.9 },
};

describe('VariantDetailPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDetail.mockResolvedValue({ success: true, data: mockDetail, error: null });
  });

  it('renders variant detail panel with all sections', async () => {
    render(<VariantDetailPanel runId="run-1" variantId="variant-abc-123" />);
    await waitFor(() => {
      expect(screen.getByTestId('variant-detail-panel')).toBeInTheDocument();
    });
    expect(screen.getByText('Elo 1350')).toBeInTheDocument();
    expect(screen.getByText('narrative')).toBeInTheDocument();
    expect(screen.getByText('gen 3')).toBeInTheDocument();
  });

  it('shows dimension score bars', async () => {
    render(<VariantDetailPanel runId="run-1" variantId="variant-abc-123" />);
    await waitFor(() => {
      expect(screen.getByTestId('dimension-scores')).toBeInTheDocument();
    });
    expect(screen.getByText('clarity')).toBeInTheDocument();
    expect(screen.getByText('0.8')).toBeInTheDocument();
  });

  it('shows match history with W/L indicators', async () => {
    render(<VariantDetailPanel runId="run-1" variantId="variant-abc-123" />);
    await waitFor(() => {
      expect(screen.getByTestId('match-history')).toBeInTheDocument();
    });
    expect(screen.getByText('Match History (2)')).toBeInTheDocument();
    expect(screen.getByText('W')).toBeInTheDocument();
    expect(screen.getByText('L')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
  });

  it('shows parent lineage with diff toggle', async () => {
    render(<VariantDetailPanel runId="run-1" variantId="variant-abc-123" />);
    await waitFor(() => {
      expect(screen.getByTestId('parent-lineage')).toBeInTheDocument();
    });
    expect(screen.getByText('Parents (2)')).toBeInTheDocument();
    expect(screen.getByTestId('toggle-diff')).toHaveTextContent('show diff');

    fireEvent.click(screen.getByTestId('toggle-diff'));
    expect(screen.getByTestId('toggle-diff')).toHaveTextContent('hide diff');
  });

  it('shows jump to agent link', async () => {
    render(<VariantDetailPanel runId="run-1" variantId="variant-abc-123" agentName="narrative" generation={3} />);
    await waitFor(() => {
      expect(screen.getByTestId('jump-to-agent')).toBeInTheDocument();
    });
    expect(screen.getByTestId('jump-to-agent')).toHaveAttribute(
      'href',
      '/admin/quality/evolution/run/run-1?tab=timeline&iteration=3&agent=narrative',
    );
  });

  it('shows cost display', async () => {
    render(<VariantDetailPanel runId="run-1" variantId="variant-abc-123" />);
    await waitFor(() => {
      expect(screen.getByText('$0.0042')).toBeInTheDocument();
    });
  });

  it('handles error state', async () => {
    mockGetDetail.mockResolvedValue({
      success: false,
      data: null,
      error: { message: 'Not found', code: 'NOT_FOUND' },
    });
    render(<VariantDetailPanel runId="run-1" variantId="bad-id" />);
    await waitFor(() => {
      expect(screen.getByText('Not found')).toBeInTheDocument();
    });
  });

  it('handles empty matches gracefully', async () => {
    mockGetDetail.mockResolvedValue({
      success: true,
      data: { ...mockDetail, matches: [], dimensionScores: null },
      error: null,
    });
    render(<VariantDetailPanel runId="run-1" variantId="variant-abc-123" />);
    await waitFor(() => {
      expect(screen.getByTestId('variant-detail-panel')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('match-history')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dimension-scores')).not.toBeInTheDocument();
  });
});
