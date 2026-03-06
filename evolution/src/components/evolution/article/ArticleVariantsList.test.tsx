// Tests for ArticleVariantsList: variant table rendering, empty state, and winner star display.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ArticleVariantsList } from './ArticleVariantsList';
import * as articleDetailActions from '@evolution/services/articleDetailActions';
import type { ArticleVariant } from '@evolution/services/articleDetailActions';

jest.mock('@evolution/services/articleDetailActions', () => ({
  getArticleVariantsAction: jest.fn(),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

jest.mock('@evolution/components/evolution', () => ({
  EmptyState: ({ message }: any) => <div data-testid="empty-state">{message}</div>,
}));

jest.mock('@evolution/components/evolution/AttributionBadge', () => ({
  AttributionBadge: ({ attribution }: any) => <span data-testid="attribution-badge">{attribution?.gain}</span>,
}));

jest.mock('@evolution/lib/utils/evolutionUrls', () => ({
  buildVariantDetailUrl: (id: string) => `/admin/quality/evolution/variant/${id}`,
  buildRunUrl: (id: string) => `/admin/quality/evolution/run/${id}`,
}));

jest.mock('@evolution/lib/utils/formatters', () => ({
  formatElo: (n: number) => String(Math.round(n)),
  formatCost: (n: number) => '$' + n.toFixed(2),
}));

const mockVariants: ArticleVariant[] = [
  {
    id: 'var-aaaa-1111-bbbb-2222',
    runId: 'run-xxxx-1111-yyyy-2222',
    agentName: 'evolution',
    eloScore: 1520.3,
    generation: 3,
    matchCount: 15,
    isWinner: true,
    eloAttribution: { gain: 42.5, ci: 18.3, zScore: 2.3, deltaMu: 3.1, sigmaDelta: 1.35 },
  },
  {
    id: 'var-cccc-3333-dddd-4444',
    runId: 'run-xxxx-1111-yyyy-2222',
    agentName: 'generation',
    eloScore: 1380.7,
    generation: 2,
    matchCount: 10,
    isWinner: false,
    eloAttribution: null,
  },
];

describe('ArticleVariantsList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading skeleton initially', () => {
    (articleDetailActions.getArticleVariantsAction as jest.Mock).mockImplementation(
      () => new Promise(() => {}),
    );

    const { container } = render(<ArticleVariantsList explanationId={42} />);

    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBeGreaterThan(0);

    expect(screen.queryByTestId('article-variants-list')).not.toBeInTheDocument();
  });

  it('renders variant table after loading', async () => {
    (articleDetailActions.getArticleVariantsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: mockVariants,
      error: null,
    });

    render(<ArticleVariantsList explanationId={42} />);

    await waitFor(() => {
      expect(screen.getByTestId('article-variants-list')).toBeInTheDocument();
    });

    // Table headers
    expect(screen.getByText('Variant')).toBeInTheDocument();
    expect(screen.getByText('Run')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('Elo')).toBeInTheDocument();
    expect(screen.getByText('Gen')).toBeInTheDocument();
    expect(screen.getByText('Matches')).toBeInTheDocument();
    expect(screen.getByText('Attribution')).toBeInTheDocument();

    // Truncated variant IDs (first 8 chars)
    expect(screen.getByText('var-aaaa')).toBeInTheDocument();
    expect(screen.getByText('var-cccc')).toBeInTheDocument();

    // Truncated run ID
    expect(screen.getAllByText('run-xxxx')).toHaveLength(2);

    // Agent names
    expect(screen.getByText('evolution')).toBeInTheDocument();
    expect(screen.getByText('generation')).toBeInTheDocument();

    // Elo scores rounded
    expect(screen.getByText('1520')).toBeInTheDocument();
    expect(screen.getByText('1381')).toBeInTheDocument();

    // Generations
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    // Match counts
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('shows empty state when no variants', async () => {
    (articleDetailActions.getArticleVariantsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: [],
      error: null,
    });

    render(<ArticleVariantsList explanationId={42} />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });

    expect(screen.getByText('No variants found for this article.')).toBeInTheDocument();
  });

  it('shows winner star for winning variant', async () => {
    (articleDetailActions.getArticleVariantsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: mockVariants,
      error: null,
    });

    render(<ArticleVariantsList explanationId={42} />);

    await waitFor(() => {
      expect(screen.getByTestId('article-variants-list')).toBeInTheDocument();
    });

    // Only one winner star should be rendered
    const stars = screen.getAllByText('\u2605');
    expect(stars).toHaveLength(1);
    expect(stars[0]).toHaveAttribute('title', 'Winner');
  });

  it('renders attribution badge only for variants with attribution', async () => {
    (articleDetailActions.getArticleVariantsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: mockVariants,
      error: null,
    });

    render(<ArticleVariantsList explanationId={42} />);

    await waitFor(() => {
      expect(screen.getByTestId('article-variants-list')).toBeInTheDocument();
    });

    // Only one attribution badge (first variant has eloAttribution, second is null)
    const badges = screen.getAllByTestId('attribution-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent('42.5');
  });

  it('has data-testid="article-variants-list"', async () => {
    (articleDetailActions.getArticleVariantsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: mockVariants,
      error: null,
    });

    render(<ArticleVariantsList explanationId={42} />);

    await waitFor(() => {
      expect(screen.getByTestId('article-variants-list')).toBeInTheDocument();
    });
  });
});
