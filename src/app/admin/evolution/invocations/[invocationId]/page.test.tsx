// Tests for invocation detail page rendering.

import { render, screen } from '@testing-library/react';
import { notFound } from 'next/navigation';
import InvocationDetailPage from './page';
import { getInvocationFullDetailAction } from '@evolution/services/evolutionVisualizationActions';

jest.mock('next/navigation', () => ({
  notFound: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/invocations/inv-abc12345',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ invocationId: 'inv-abc12345' }),
}));

jest.mock('@evolution/services/evolutionVisualizationActions', () => ({
  getInvocationFullDetailAction: jest.fn().mockResolvedValue({
    success: true,
    data: {
      invocation: {
        id: 'inv-abc12345',
        runId: 'run-00000001',
        agentName: 'improver',
        iteration: 2,
      },
      run: { id: 'run-00000001', status: 'completed' },
      diffMetrics: null,
      inputVariant: null,
      variantDiffs: [],
      eloHistory: [],
    },
  }),
}));

jest.mock('./InvocationDetailContent', () => ({
  InvocationDetailContent: (props: Record<string, unknown>) => (
    <div data-testid="invocation-detail-content">InvocationDetailContent</div>
  ),
}));

describe('InvocationDetailPage', () => {
  it('renders breadcrumb with Runs link', async () => {
    const page = await InvocationDetailPage({ params: Promise.resolve({ invocationId: 'inv-abc12345' }) });
    render(page);
    const breadcrumb = screen.getByTestId('evolution-breadcrumb');
    expect(breadcrumb).toBeInTheDocument();
    const runsLink = screen.getByText('Runs');
    expect(runsLink.closest('a')).toHaveAttribute('href', '/admin/evolution/runs');
  });

  it('renders breadcrumb with run segment', async () => {
    const page = await InvocationDetailPage({ params: Promise.resolve({ invocationId: 'inv-abc12345' }) });
    render(page);
    expect(screen.getByText('Run run-0000')).toBeInTheDocument();
  });

  it('renders InvocationDetailContent', async () => {
    const page = await InvocationDetailPage({ params: Promise.resolve({ invocationId: 'inv-abc12345' }) });
    render(page);
    expect(screen.getByTestId('invocation-detail-content')).toBeInTheDocument();
  });

  it('calls notFound when action fails', async () => {
    jest.mocked(notFound).mockImplementation(() => { throw new Error('NEXT_NOT_FOUND'); });
    jest.mocked(getInvocationFullDetailAction).mockResolvedValueOnce({ success: false, data: null });
    await expect(InvocationDetailPage({ params: Promise.resolve({ invocationId: 'inv-abc12345' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});
