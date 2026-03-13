// Tests for experiment detail page rendering.

import { render, screen } from '@testing-library/react';
import { notFound } from 'next/navigation';
import ExperimentDetailPage from './page';
import { getExperimentStatusAction } from '@evolution/services/experimentActions';

jest.mock('next/navigation', () => ({
  notFound: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/experiments/exp-abc12345',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ experimentId: 'exp-abc12345' }),
}));

jest.mock('@evolution/services/experimentActions', () => ({
  getExperimentStatusAction: jest.fn().mockResolvedValue({
    success: true,
    data: {
      id: 'exp-abc12345',
      name: 'Test Experiment',
      status: 'completed',
      runs: [],
    },
  }),
}));

jest.mock('./ExperimentDetailContent', () => ({
  ExperimentDetailContent: (props: Record<string, unknown>) => (
    <div data-testid="experiment-detail-content">ExperimentDetailContent</div>
  ),
}));

describe('ExperimentDetailPage', () => {
  it('renders breadcrumb with Experiments link', async () => {
    const page = await ExperimentDetailPage({ params: Promise.resolve({ experimentId: 'exp-abc12345' }) });
    render(page);
    const breadcrumb = screen.getByTestId('evolution-breadcrumb');
    expect(breadcrumb).toBeInTheDocument();
    const link = screen.getByText('Experiments');
    expect(link.closest('a')).toHaveAttribute('href', '/admin/evolution/experiments');
  });

  it('renders breadcrumb with experiment name', async () => {
    const page = await ExperimentDetailPage({ params: Promise.resolve({ experimentId: 'exp-abc12345' }) });
    render(page);
    expect(screen.getByText('Test Experiment')).toBeInTheDocument();
  });

  it('renders ExperimentDetailContent', async () => {
    const page = await ExperimentDetailPage({ params: Promise.resolve({ experimentId: 'exp-abc12345' }) });
    render(page);
    expect(screen.getByTestId('experiment-detail-content')).toBeInTheDocument();
  });

  it('calls notFound when action fails', async () => {
    jest.mocked(notFound).mockImplementation(() => { throw new Error('NEXT_NOT_FOUND'); });
    jest.mocked(getExperimentStatusAction).mockResolvedValueOnce({ success: false, data: null, error: null });
    await expect(ExperimentDetailPage({ params: Promise.resolve({ experimentId: 'exp-abc12345' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});
