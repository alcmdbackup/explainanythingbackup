// Tests for VariantDetailContent client component rendering.

import { render, screen } from '@testing-library/react';
import { VariantDetailContent } from './VariantDetailContent';
import type { VariantFullDetail } from '@evolution/services/variantDetailActions';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/variants/aaaaaaaa-1111-2222-3333-444444444444',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/services/variantDetailActions', () => ({
  getVariantParentsAction: jest.fn().mockResolvedValue({ success: true, data: [] }),
  getVariantChildrenAction: jest.fn().mockResolvedValue({ success: true, data: [] }),
  getVariantLineageChainAction: jest.fn().mockResolvedValue({ success: true, data: [] }),
}));

jest.mock('@evolution/services/metricsActions', () => ({
  getEntityMetricsAction: jest.fn().mockResolvedValue({ success: true, data: [], error: null }),
}));

const mockVariant: VariantFullDetail = {
  id: 'aaaaaaaa-1111-2222-3333-444444444444',
  runId: 'bbbbbbbb-1111-2222-3333-444444444444',
  explanationId: 1,
  explanationTitle: 'Test Explanation',
  variantContent: 'Variant content text here',
  eloScore: 1520,
  generation: 2,
  agentName: 'mutator',
  matchCount: 8,
  isWinner: true,
  parentVariantId: null,
  parentElo: null,
  parentUncertainty: null,
  parentRunId: null,
  createdAt: '2026-03-01T00:00:00Z',
  runStatus: 'completed',
  runCreatedAt: '2026-03-01T00:00:00Z',
  persisted: true,
};

describe('VariantDetailContent', () => {
  it('renders entity detail header with variant ID', () => {
    render(<VariantDetailContent variant={mockVariant} />);
    expect(screen.getByTestId('entity-detail-header')).toBeInTheDocument();
    expect(screen.getByText('Variant aaaaaaaa')).toBeInTheDocument();
  });

  it('shows winner badge when variant is winner', () => {
    render(<VariantDetailContent variant={mockVariant} />);
    expect(screen.getByText('Winner')).toBeInTheDocument();
  });

  it('shows metric cards for agent, generation, rating, matches', () => {
    render(<VariantDetailContent variant={mockVariant} />);
    expect(screen.getByText('mutator')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1520')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('renders tabs including content tab', () => {
    render(<VariantDetailContent variant={mockVariant} />);
    // Content tab is selected by default, so both tab label and content section exist
    expect(screen.getByRole('tab', { name: 'Content' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Metrics' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Lineage' })).toBeInTheDocument();
  });

  it('renders run cross-link', () => {
    render(<VariantDetailContent variant={mockVariant} />);
    const crossLinks = screen.getByTestId('cross-links');
    const link = crossLinks.querySelector('a[href="/admin/evolution/runs/bbbbbbbb-1111-2222-3333-444444444444"]');
    expect(link).toBeInTheDocument();
  });

  it('does not show winner badge for non-winner', () => {
    const nonWinner = { ...mockVariant, isWinner: false };
    render(<VariantDetailContent variant={nonWinner} />);
    expect(screen.queryByText('Winner')).not.toBeInTheDocument();
  });
});
