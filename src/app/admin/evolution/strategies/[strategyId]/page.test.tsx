// Tests for strategy detail page rendering.

import { render, screen } from '@testing-library/react';
import { notFound } from 'next/navigation';
import StrategyDetailPage from './page';
import { getStrategyDetailAction } from '@evolution/services/strategyRegistryActions';

jest.mock('next/navigation', () => ({
  notFound: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/strategies/strat-abc12345',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ strategyId: 'strat-abc12345' }),
}));

jest.mock('@evolution/services/strategyRegistryActions', () => ({
  getStrategyDetailAction: jest.fn().mockResolvedValue({
    success: true,
    data: {
      id: 'strat-abc12345',
      name: 'test-strategy',
      label: 'Test Strategy',
      config: { iterations: 10 },
    },
  }),
}));

jest.mock('@evolution/services/eloBudgetActions', () => ({
  getStrategyRunsAction: jest.fn().mockResolvedValue({ success: true, data: [] }),
}));

jest.mock('./StrategyDetailContent', () => ({
  StrategyDetailContent: (props: Record<string, unknown>) => (
    <div data-testid="strategy-detail-content">StrategyDetailContent</div>
  ),
}));

describe('StrategyDetailPage', () => {
  it('renders breadcrumb with Strategies link', async () => {
    const page = await StrategyDetailPage({ params: Promise.resolve({ strategyId: 'strat-abc12345' }) });
    render(page);
    const breadcrumb = screen.getByTestId('evolution-breadcrumb');
    expect(breadcrumb).toBeInTheDocument();
    const link = screen.getByText('Strategies');
    expect(link.closest('a')).toHaveAttribute('href', '/admin/evolution/strategies');
  });

  it('renders breadcrumb with strategy name', async () => {
    const page = await StrategyDetailPage({ params: Promise.resolve({ strategyId: 'strat-abc12345' }) });
    render(page);
    expect(screen.getByText('test-strategy')).toBeInTheDocument();
  });

  it('renders StrategyDetailContent', async () => {
    const page = await StrategyDetailPage({ params: Promise.resolve({ strategyId: 'strat-abc12345' }) });
    render(page);
    expect(screen.getByTestId('strategy-detail-content')).toBeInTheDocument();
  });

  it('calls notFound when action fails', async () => {
    jest.mocked(notFound).mockImplementation(() => { throw new Error('NEXT_NOT_FOUND'); });
    jest.mocked(getStrategyDetailAction).mockResolvedValueOnce({ success: false, data: null, error: null });
    await expect(StrategyDetailPage({ params: Promise.resolve({ strategyId: 'strat-abc12345' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});
