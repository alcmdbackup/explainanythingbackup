// Tests for the strategy detail page: loading, success, error states, tabs.

import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import StrategyDetailPage from './page';
import { getStrategyDetailAction } from '@evolution/services/strategyRegistryActions';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/strategies/strat-1',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ strategyId: 'strat-1' }),
}));

jest.mock('@evolution/services/strategyRegistryActions', () => ({
  getStrategyDetailAction: jest.fn().mockResolvedValue({
    success: true,
    data: {
      id: 'strat-1',
      name: 'Test Strategy',
      label: 'test-strategy',
      description: 'A test strategy',
      config: { iterations: 5, budgetUsd: 10, judgeModel: 'gpt-4o', generationModel: 'gpt-4o' },
      config_hash: 'abc123',
      pipeline_type: 'full',
      status: 'active',
      created_by: 'admin',
      run_count: 3,
      total_cost_usd: 7.5,
      avg_final_elo: 1500,
      first_used_at: '2026-03-01T00:00:00Z',
      last_used_at: '2026-03-01T12:00:00Z',
      created_at: '2026-02-15T00:00:00Z',
    },
  }),
}));

jest.mock('@evolution/components/evolution', () => ({
  EvolutionBreadcrumb: ({ items }: { items: Array<{ label: string }> }) => (
    <nav data-testid="breadcrumb">{items.map((i, idx) => <span key={idx}>{i.label}</span>)}</nav>
  ),
  EntityDetailHeader: ({ title }: { title: string }) => (
    <div data-testid="entity-detail-header">{title}</div>
  ),
  EntityDetailTabs: ({ children, activeTab }: { children: React.ReactNode; activeTab: string }) => (
    <div data-testid="entity-detail-tabs" data-active-tab={activeTab}>{children}</div>
  ),
  useTabState: () => {
    const [active, setActive] = useState('metrics');
    return [active, setActive];
  },
  EntityMetricsTab: ({ entityType, entityId }: { entityType: string; entityId: string }) => (
    <div data-testid="entity-metrics-tab">{entityType}:{entityId}</div>
  ),
}));

jest.mock('@evolution/components/evolution/tabs/LogsTab', () => ({
  LogsTab: ({ entityType, entityId }: { entityType: string; entityId: string }) => (
    <div data-testid="logs-tab">{entityType}:{entityId}</div>
  ),
}));

jest.mock('@/app/admin/evolution/_components/StrategyConfigDisplay', () => ({
  StrategyConfigDisplay: ({ config }: { config: unknown }) => (
    <div data-testid="strategy-config-display">Config</div>
  ),
}));

describe('StrategyDetailPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading state initially', () => {
    render(<StrategyDetailPage />);
    expect(screen.getByText('Loading strategy...')).toBeInTheDocument();
  });

  it('renders strategy name after loading', async () => {
    render(<StrategyDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('entity-detail-header')).toHaveTextContent('Test Strategy');
    });
  });

  it('renders breadcrumb with Dashboard and Strategies links', async () => {
    render(<StrategyDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Strategies')).toBeInTheDocument();
    });
  });

  it('renders entity detail header', async () => {
    render(<StrategyDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('entity-detail-header')).toBeInTheDocument();
    });
  });

  it('renders entity detail tabs', async () => {
    render(<StrategyDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('entity-detail-tabs')).toBeInTheDocument();
    });
  });

  it('renders metrics tab content by default', async () => {
    render(<StrategyDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('entity-metrics-tab')).toBeInTheDocument();
    });
  });

  it('shows error state on failed load', async () => {
    jest.mocked(getStrategyDetailAction).mockResolvedValueOnce({
      success: false,
      data: null,
      error: { message: 'Strategy not found' },
    });

    render(<StrategyDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Strategy not found')).toBeInTheDocument();
    });
  });

  it('shows "Error" heading on error state', async () => {
    jest.mocked(getStrategyDetailAction).mockResolvedValueOnce({
      success: false,
      data: null,
      error: { message: 'Failed' },
    });

    render(<StrategyDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument();
    });
  });

  it('shows default error message when no error message provided', async () => {
    jest.mocked(getStrategyDetailAction).mockResolvedValueOnce({
      success: false,
      data: null,
      error: null,
    });

    render(<StrategyDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Failed to load strategy')).toBeInTheDocument();
    });
  });

  it('calls getStrategyDetailAction with strategyId', async () => {
    render(<StrategyDetailPage />);
    await waitFor(() => {
      expect(getStrategyDetailAction).toHaveBeenCalledWith('strat-1');
    });
  });
});
