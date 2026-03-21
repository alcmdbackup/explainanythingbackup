// Tests for variant detail page rendering with V2 actions.

import { render, screen } from '@testing-library/react';
import { notFound } from 'next/navigation';
import VariantDetailPage from './page';
import { getVariantFullDetailAction } from '@evolution/services/variantDetailActions';

jest.mock('next/navigation', () => ({
  notFound: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/variants/aaaaaaaa-1111-2222-3333-444444444444',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ variantId: 'aaaaaaaa-1111-2222-3333-444444444444' }),
}));

jest.mock('@evolution/services/variantDetailActions', () => ({
  getVariantFullDetailAction: jest.fn().mockResolvedValue({
    success: true,
    data: {
      id: 'aaaaaaaa-1111-2222-3333-444444444444',
      runId: 'bbbbbbbb-1111-2222-3333-444444444444',
      explanationId: 1,
      explanationTitle: 'Test Explanation',
      variantContent: 'Some variant content text',
      eloScore: 1520,
      generation: 2,
      agentName: 'mutator',
      matchCount: 8,
      isWinner: true,
      parentVariantId: null,
      createdAt: '2026-03-01T00:00:00Z',
      runStatus: 'completed',
      runCreatedAt: '2026-03-01T00:00:00Z',
    },
  }),
  getVariantParentsAction: jest.fn().mockResolvedValue({ success: true, data: [] }),
  getVariantChildrenAction: jest.fn().mockResolvedValue({ success: true, data: [] }),
  getVariantLineageChainAction: jest.fn().mockResolvedValue({ success: true, data: [] }),
}));

jest.mock('./VariantDetailContent', () => ({
  VariantDetailContent: (props: Record<string, unknown>) => (
    <div data-testid="variant-detail-content">VariantDetailContent</div>
  ),
}));

describe('VariantDetailPage', () => {
  it('renders breadcrumb with Variants link', async () => {
    const page = await VariantDetailPage({ params: Promise.resolve({ variantId: 'aaaaaaaa-1111-2222-3333-444444444444' }) });
    render(page);
    const breadcrumb = screen.getByTestId('evolution-breadcrumb');
    expect(breadcrumb).toBeInTheDocument();
    expect(screen.getByText('Variants').closest('a')).toHaveAttribute('href', '/admin/evolution/variants');
  });

  it('renders VariantDetailContent', async () => {
    const page = await VariantDetailPage({ params: Promise.resolve({ variantId: 'aaaaaaaa-1111-2222-3333-444444444444' }) });
    render(page);
    expect(screen.getByTestId('variant-detail-content')).toBeInTheDocument();
  });

  it('calls notFound when action fails', async () => {
    jest.mocked(notFound).mockImplementation(() => { throw new Error('NEXT_NOT_FOUND'); });
    jest.mocked(getVariantFullDetailAction).mockResolvedValueOnce({ success: false, data: null, error: null });
    await expect(VariantDetailPage({ params: Promise.resolve({ variantId: 'aaaaaaaa-1111-2222-3333-444444444444' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});
