// Tests for VariantOverviewCard: metadata display, stat cells, winner badge, attribution, and navigation links.

import React from 'react';
import { render, screen } from '@testing-library/react';
import { VariantOverviewCard } from './VariantOverviewCard';
import type { VariantFullDetail } from '@evolution/services/variantDetailActions';

jest.mock('@evolution/lib/utils/formatters', () => ({
  formatElo: (n: number) => String(Math.round(n)),
  formatCost: (n: number) => '$' + n.toFixed(2),
}));

jest.mock('@evolution/components/evolution', () => ({
  EvolutionStatusBadge: ({ status }: any) => <span data-testid="status-badge">{status}</span>,
}));

jest.mock('@evolution/components/evolution/AttributionBadge', () => ({
  AttributionBadge: ({ attribution }: any) => <span data-testid="attribution-badge">{attribution?.gain}</span>,
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

function makeVariant(overrides: Partial<VariantFullDetail> = {}): VariantFullDetail {
  return {
    id: 'abcdef12-3456-7890-abcd-ef1234567890',
    runId: 'run-001',
    explanationId: null,
    explanationTitle: null,
    variantContent: 'Some variant content here.',
    eloScore: 1425,
    generation: 5,
    agentName: 'narrative',
    matchCount: 12,
    isWinner: false,
    parentVariantId: null,
    eloAttribution: null,
    createdAt: '2026-02-25T12:00:00Z',
    runStatus: 'completed',
    runCreatedAt: '2026-02-25T10:00:00Z',
    ...overrides,
  };
}

describe('VariantOverviewCard', () => {
  it('renders variant short ID in heading', () => {
    render(<VariantOverviewCard variant={makeVariant()} />);
    expect(screen.getByText('Variant abcdef12')).toBeInTheDocument();
  });

  it('renders all 4 stat cells', () => {
    render(<VariantOverviewCard variant={makeVariant({ eloScore: 1425, agentName: 'narrative', generation: 5, matchCount: 12 })} />);
    const stats = screen.getByTestId('variant-stats');
    expect(stats).toBeInTheDocument();
    expect(screen.getByText('1425')).toBeInTheDocument();
    expect(screen.getByText('narrative')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows "Winner" badge when isWinner=true', () => {
    render(<VariantOverviewCard variant={makeVariant({ isWinner: true })} />);
    expect(screen.getByText('Winner')).toBeInTheDocument();
  });

  it('does not show "Winner" badge when isWinner=false', () => {
    render(<VariantOverviewCard variant={makeVariant({ isWinner: false })} />);
    expect(screen.queryByText('Winner')).not.toBeInTheDocument();
  });

  it('shows attribution badge when eloAttribution is present', () => {
    const attribution = { gain: 42, ci: 20, zScore: 2.1, deltaMu: 2, sigmaDelta: 0.9 };
    render(<VariantOverviewCard variant={makeVariant({ eloAttribution: attribution })} />);
    expect(screen.getByTestId('attribution-badge')).toBeInTheDocument();
    expect(screen.getByTestId('attribution-badge')).toHaveTextContent('42');
  });

  it('does not show attribution badge when eloAttribution is null', () => {
    render(<VariantOverviewCard variant={makeVariant({ eloAttribution: null })} />);
    expect(screen.queryByTestId('attribution-badge')).not.toBeInTheDocument();
  });

  it('has data-testid="variant-overview-card" and "variant-stats"', () => {
    render(<VariantOverviewCard variant={makeVariant()} />);
    expect(screen.getByTestId('variant-overview-card')).toBeInTheDocument();
    expect(screen.getByTestId('variant-stats')).toBeInTheDocument();
  });

  it('shows "Article History" link when explanationId is set', () => {
    render(<VariantOverviewCard variant={makeVariant({ explanationId: 42 })} />);
    const link = screen.getByText('Article History');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/admin/quality/evolution/article/42');
  });

  it('does not show "Article History" link when explanationId is null', () => {
    render(<VariantOverviewCard variant={makeVariant({ explanationId: null })} />);
    expect(screen.queryByText('Article History')).not.toBeInTheDocument();
  });

  it('always shows "View Run" link', () => {
    render(<VariantOverviewCard variant={makeVariant({ runId: 'run-xyz' })} />);
    const link = screen.getByText('View Run');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/admin/quality/evolution/run/run-xyz');
  });

  it('renders status badge with run status', () => {
    render(<VariantOverviewCard variant={makeVariant({ runStatus: 'running' })} />);
    expect(screen.getByTestId('status-badge')).toHaveTextContent('running');
  });
});
