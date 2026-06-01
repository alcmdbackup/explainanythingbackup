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
  parentVariantIds: [],
  parentElo: null,
  parentUncertainty: null,
  parentRunId: null,
  createdAt: '2026-03-01T00:00:00Z',
  runStatus: 'completed',
  runCreatedAt: '2026-03-01T00:00:00Z',
  persisted: true,
  variantKind: 'article',
  agentInvocationId: null,
  agentInvocationName: null,
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

  it('renders "Produced by" cross-link when agentInvocationId is populated', () => {
    const withInvocation: VariantFullDetail = {
      ...mockVariant,
      agentInvocationId: 'cccccccc-1111-2222-3333-444444444444',
      agentInvocationName: 'evaluate_criteria_then_generate_from_previous_article',
    };
    render(<VariantDetailContent variant={withInvocation} />);
    const crossLinks = screen.getByTestId('cross-links');
    const link = crossLinks.querySelector(
      'a[href="/admin/evolution/invocations/cccccccc-1111-2222-3333-444444444444"]',
    );
    expect(link).toBeInTheDocument();
    // Label uses agent_name (more useful than UUID-8) for wrapper-agent disambiguation
    expect(crossLinks).toHaveTextContent('Produced by');
    expect(crossLinks).toHaveTextContent('evaluate_criteria_then_generate_from_previous_article');
  });

  it('omits "Produced by" link when agentInvocationId is null (legacy variants)', () => {
    // mockVariant has agentInvocationId: null — legacy variant pre-migration 20260418000003
    render(<VariantDetailContent variant={mockVariant} />);
    const crossLinks = screen.getByTestId('cross-links');
    expect(crossLinks).not.toHaveTextContent('Produced by');
  });

  it('falls back to UUID-8 label when agentInvocationName is unexpectedly null', () => {
    const partial: VariantFullDetail = {
      ...mockVariant,
      agentInvocationId: 'cccccccc-1111-2222-3333-444444444444',
      agentInvocationName: null,
    };
    render(<VariantDetailContent variant={partial} />);
    const crossLinks = screen.getByTestId('cross-links');
    expect(crossLinks).toHaveTextContent('Produced by');
    expect(crossLinks).toHaveTextContent('cccccccc'); // first 8 chars of UUID
  });

  it('shows the discarded banner for a discarded ARTICLE variant (persisted=false)', () => {
    const discardedArticle: VariantFullDetail = { ...mockVariant, persisted: false, variantKind: 'article' };
    render(<VariantDetailContent variant={discardedArticle} />);
    expect(screen.getByTestId('variant-discarded-banner')).toBeInTheDocument();
  });

  it('does NOT show the discarded banner for a PARAGRAPH variant (persisted=false by design, not discarded)', () => {
    // Paragraph-recombine variants are always persisted=false (sync_to_arena never sets persisted),
    // but they are surfaced, not discarded — the generate-agent banner must not fire.
    const paragraph: VariantFullDetail = { ...mockVariant, persisted: false, variantKind: 'paragraph' };
    render(<VariantDetailContent variant={paragraph} />);
    expect(screen.queryByTestId('variant-discarded-banner')).not.toBeInTheDocument();
  });

  it('does NOT show the discarded banner for a surfaced article variant (persisted=true)', () => {
    render(<VariantDetailContent variant={mockVariant} />);
    expect(screen.queryByTestId('variant-discarded-banner')).not.toBeInTheDocument();
  });
});
