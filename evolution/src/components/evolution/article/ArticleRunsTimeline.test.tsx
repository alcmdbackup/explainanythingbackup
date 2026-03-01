// Tests for ArticleRunsTimeline: loading skeleton, run cards after fetch, and empty state.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ArticleRunsTimeline } from './ArticleRunsTimeline';
import * as articleDetailActions from '@evolution/services/articleDetailActions';
import type { ArticleRun } from '@evolution/services/articleDetailActions';

jest.mock('@evolution/services/articleDetailActions', () => ({
  getArticleRunsAction: jest.fn(),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

jest.mock('@evolution/components/evolution', () => ({
  EvolutionStatusBadge: ({ status }: any) => <span data-testid="status-badge">{status}</span>,
  EmptyState: ({ message }: any) => <div data-testid="empty-state">{message}</div>,
}));

jest.mock('@evolution/lib/utils/evolutionUrls', () => ({
  buildRunUrl: (id: string) => `/admin/quality/evolution/run/${id}`,
}));

jest.mock('@evolution/lib/utils/formatters', () => ({
  formatElo: (n: number) => String(Math.round(n)),
  formatCost: (n: number) => '$' + n.toFixed(2),
}));

const mockRuns: ArticleRun[] = [
  {
    id: 'run-aaaa-1111-bbbb-2222',
    status: 'completed',
    phase: 'done',
    pipelineType: 'full_evolution',
    winnerVariantId: 'var-aaaa-1111-bbbb-2222',
    winnerElo: 1480.5,
    totalVariants: 6,
    totalCostUsd: 1.23,
    createdAt: '2026-02-20T10:00:00Z',
    completedAt: '2026-02-20T11:00:00Z',
  },
  {
    id: 'run-cccc-3333-dddd-4444',
    status: 'running',
    phase: 'generation',
    pipelineType: null,
    winnerVariantId: null,
    winnerElo: null,
    totalVariants: 3,
    totalCostUsd: 0.45,
    createdAt: '2026-02-21T12:00:00Z',
    completedAt: null,
  },
];

describe('ArticleRunsTimeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading skeleton initially', () => {
    (articleDetailActions.getArticleRunsAction as jest.Mock).mockImplementation(
      () => new Promise(() => {}),
    );

    const { container } = render(<ArticleRunsTimeline explanationId={42} />);

    // Should show animate-pulse skeleton divs
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBeGreaterThan(0);

    // Should NOT show the timeline data-testid yet
    expect(screen.queryByTestId('article-runs-timeline')).not.toBeInTheDocument();
  });

  it('renders run cards after loading', async () => {
    (articleDetailActions.getArticleRunsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: mockRuns,
      error: null,
    });

    render(<ArticleRunsTimeline explanationId={42} />);

    await waitFor(() => {
      expect(screen.getByTestId('article-runs-timeline')).toBeInTheDocument();
    });

    // Should render both run cards
    const runCards = screen.getAllByTestId('article-run-card');
    expect(runCards).toHaveLength(2);

    // Truncated run IDs (first 8 chars)
    expect(screen.getByText('run-aaaa')).toBeInTheDocument();
    expect(screen.getByText('run-cccc')).toBeInTheDocument();

    // Status badges
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();

    // Winner Elo for first run
    expect(screen.getByText('1481')).toBeInTheDocument();
  });

  it('shows empty state when no runs', async () => {
    (articleDetailActions.getArticleRunsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: [],
      error: null,
    });

    render(<ArticleRunsTimeline explanationId={42} />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });

    expect(screen.getByText('No evolution runs yet for this article.')).toBeInTheDocument();
  });
});
