// Tests for ArticleOverviewCard: renders article metadata summary with title, ID, and stat cells.

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ArticleOverviewCard } from './ArticleOverviewCard';
import type { ArticleOverview } from '@evolution/services/articleDetailActions';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

jest.mock('@evolution/lib/utils/evolutionUrls', () => ({
  buildExplanationUrl: (id: number) => `/results?explanation_id=${id}`,
}));

jest.mock('@evolution/lib/utils/formatters', () => ({
  formatElo: (n: number) => String(Math.round(n)),
  formatCost: (n: number) => '$' + n.toFixed(2),
}));

const baseOverview: ArticleOverview = {
  explanationId: 42,
  title: 'How Quantum Computing Works',
  totalRuns: 7,
  bestElo: 1523.8,
  bestVariantId: 'abcd1234-ef56-7890-abcd-ef1234567890',
  hofEntries: 3,
};

describe('ArticleOverviewCard', () => {
  it('renders title and explanation ID', () => {
    render(<ArticleOverviewCard overview={baseOverview} />);

    expect(screen.getByText('How Quantum Computing Works')).toBeInTheDocument();
    expect(screen.getByText('Explanation #42')).toBeInTheDocument();
  });

  it('renders all 4 stat cells', () => {
    render(<ArticleOverviewCard overview={baseOverview} />);

    expect(screen.getByText('7')).toBeInTheDocument(); // totalRuns
    expect(screen.getByText('1524')).toBeInTheDocument(); // bestElo rounded
    expect(screen.getByText('abcd1234')).toBeInTheDocument(); // bestVariantId truncated to 8
    expect(screen.getByText('3')).toBeInTheDocument(); // hofEntries

    // Labels
    expect(screen.getByText('Total Runs')).toBeInTheDocument();
    expect(screen.getByText('Best Elo')).toBeInTheDocument();
    expect(screen.getByText('Best Variant')).toBeInTheDocument();
    expect(screen.getByText('HoF Entries')).toBeInTheDocument();
  });

  it('renders dashes when bestElo and bestVariantId are null', () => {
    const overview: ArticleOverview = {
      ...baseOverview,
      bestElo: null,
      bestVariantId: null,
    };

    render(<ArticleOverviewCard overview={overview} />);

    // Two em-dash characters for bestElo and bestVariantId
    const dashes = screen.getAllByText('\u2014');
    expect(dashes).toHaveLength(2);
  });

  it('has data-testid="article-overview-card"', () => {
    render(<ArticleOverviewCard overview={baseOverview} />);

    expect(screen.getByTestId('article-overview-card')).toBeInTheDocument();
  });
});
