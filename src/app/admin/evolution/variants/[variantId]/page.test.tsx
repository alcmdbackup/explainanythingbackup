// Tests for variant detail page rendering.

import { render, screen } from '@testing-library/react';
import { notFound } from 'next/navigation';
import VariantDetailPage from './page';
import { getVariantFullDetailAction } from '@evolution/services/variantDetailActions';

jest.mock('next/navigation', () => ({
  notFound: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/variants/variant-abc123',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ variantId: 'variant-abc12345' }),
}));

jest.mock('@evolution/services/variantDetailActions', () => ({
  getVariantFullDetailAction: jest.fn().mockResolvedValue({
    success: true,
    data: {
      runId: 'run-00000001',
      explanationId: 42,
      explanationTitle: 'Test Explanation',
      variantId: 'variant-abc12345',
      content: 'Variant content here',
      iteration: 1,
      agentName: 'improver',
      eloRating: 1200,
      matches: [],
    },
  }),
}));

jest.mock('./VariantDetailContent', () => ({
  VariantDetailContent: ({ variant, variantId }: { variant: unknown; variantId: string }) => (
    <div data-testid="variant-detail-content">VariantDetailContent:{variantId}</div>
  ),
}));

describe('VariantDetailPage', () => {
  it('renders breadcrumb with Runs link', async () => {
    const page = await VariantDetailPage({ params: Promise.resolve({ variantId: 'variant-abc12345' }) });
    render(page);
    const breadcrumb = screen.getByTestId('evolution-breadcrumb');
    expect(breadcrumb).toBeInTheDocument();
    const runsLink = screen.getByText('Runs');
    expect(runsLink.closest('a')).toHaveAttribute('href', '/admin/evolution/runs');
  });

  it('renders breadcrumb with run segment', async () => {
    const page = await VariantDetailPage({ params: Promise.resolve({ variantId: 'variant-abc12345' }) });
    render(page);
    expect(screen.getByText('Run run-0000')).toBeInTheDocument();
  });

  it('passes data to VariantDetailContent', async () => {
    const page = await VariantDetailPage({ params: Promise.resolve({ variantId: 'variant-abc12345' }) });
    render(page);
    expect(screen.getByTestId('variant-detail-content')).toHaveTextContent('variant-abc12345');
  });

  it('calls notFound when action fails', async () => {
    jest.mocked(notFound).mockImplementation(() => { throw new Error('NEXT_NOT_FOUND'); });
    jest.mocked(getVariantFullDetailAction).mockResolvedValueOnce({ success: false, data: null });
    await expect(VariantDetailPage({ params: Promise.resolve({ variantId: 'variant-abc12345' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});
