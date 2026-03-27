// Tests for EntityDetailPageClient: config-driven shell with loading/success/error states, tabs.

import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { EntityDetailPageClient, type DetailPageConfig } from './EntityDetailPageClient';
import { toast } from 'sonner';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/test',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
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
  useTabState: (tabs: Array<{ id: string }>) => {
    const [active, setActive] = useState(tabs[0]?.id ?? '');
    return [active, setActive];
  },
}));

interface TestData {
  id: string;
  name: string;
  status: string;
}

const MOCK_DATA: TestData = { id: 'test-123', name: 'Test Entity', status: 'active' };

function createConfig(overrides?: Partial<DetailPageConfig<TestData>>): DetailPageConfig<TestData> {
  return {
    breadcrumbs: [{ label: 'Dashboard', href: '/admin' }],
    title: (d) => d.name,
    tabs: [{ id: 'overview', label: 'Overview' }, { id: 'logs', label: 'Logs' }],
    renderTabContent: (tabId) => <div data-testid={`tab-content-${tabId}`}>Tab: {tabId}</div>,
    ...overrides,
  };
}

describe('EntityDetailPageClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading state initially', () => {
    const loadData = () => new Promise<TestData>(() => {}); // Never resolves
    render(<EntityDetailPageClient config={createConfig()} loadData={loadData} />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders entity title after loading', async () => {
    const loadData = jest.fn().mockResolvedValue(MOCK_DATA);
    render(<EntityDetailPageClient config={createConfig()} loadData={loadData} />);

    await waitFor(() => {
      expect(screen.getByTestId('entity-detail-header')).toHaveTextContent('Test Entity');
    });
  });

  it('renders breadcrumb', async () => {
    const loadData = jest.fn().mockResolvedValue(MOCK_DATA);
    render(<EntityDetailPageClient config={createConfig()} loadData={loadData} />);

    await waitFor(() => {
      expect(screen.getByTestId('breadcrumb')).toBeInTheDocument();
    });
  });

  it('renders error state when loadData throws', async () => {
    const loadData = jest.fn().mockRejectedValue(new Error('Load failed'));
    render(<EntityDetailPageClient config={createConfig()} loadData={loadData} />);

    await waitFor(() => {
      expect(screen.getByText('Load failed')).toBeInTheDocument();
    });
  });

  it('calls toast.error on load failure', async () => {
    const loadData = jest.fn().mockRejectedValue(new Error('Network error'));
    render(<EntityDetailPageClient config={createConfig()} loadData={loadData} />);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Network error');
    });
  });

  it('renders tabs after successful load', async () => {
    const loadData = jest.fn().mockResolvedValue(MOCK_DATA);
    render(<EntityDetailPageClient config={createConfig()} loadData={loadData} />);

    await waitFor(() => {
      expect(screen.getByTestId('entity-detail-tabs')).toBeInTheDocument();
    });
  });

  it('renders tab content for active tab', async () => {
    const loadData = jest.fn().mockResolvedValue(MOCK_DATA);
    render(<EntityDetailPageClient config={createConfig()} loadData={loadData} />);

    await waitFor(() => {
      expect(screen.getByTestId('tab-content-overview')).toBeInTheDocument();
    });
  });

  it('renders entity detail header', async () => {
    const loadData = jest.fn().mockResolvedValue(MOCK_DATA);
    render(<EntityDetailPageClient config={createConfig()} loadData={loadData} />);

    await waitFor(() => {
      expect(screen.getByTestId('entity-detail-header')).toBeInTheDocument();
    });
  });

  it('shows "Error" breadcrumb on error', async () => {
    const loadData = jest.fn().mockRejectedValue(new Error('Fail'));
    render(<EntityDetailPageClient config={createConfig()} loadData={loadData} />);

    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument();
    });
  });

  it('shows "Entity not found" when data is null-ish without error', async () => {
    const loadData = jest.fn().mockResolvedValue(null);
    render(<EntityDetailPageClient config={createConfig()} loadData={loadData} />);

    await waitFor(() => {
      expect(screen.getByText('Entity not found')).toBeInTheDocument();
    });
  });

  it('handles non-Error thrown values', async () => {
    const loadData = jest.fn().mockRejectedValue('string error');
    render(<EntityDetailPageClient config={createConfig()} loadData={loadData} />);

    await waitFor(() => {
      expect(screen.getByText('string error')).toBeInTheDocument();
    });
  });

  it('shows breadcrumb with entity title on success', async () => {
    const loadData = jest.fn().mockResolvedValue(MOCK_DATA);
    render(<EntityDetailPageClient config={createConfig()} loadData={loadData} />);

    await waitFor(() => {
      expect(screen.getByTestId('entity-detail-header')).toHaveTextContent('Test Entity');
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  it('calls loadData on mount', async () => {
    const loadData = jest.fn().mockResolvedValue(MOCK_DATA);
    render(<EntityDetailPageClient config={createConfig()} loadData={loadData} />);

    await waitFor(() => {
      expect(screen.getByTestId('entity-detail-header')).toBeInTheDocument();
    });

    expect(loadData).toHaveBeenCalled();
  });

  it('shows loading skeleton with animate-pulse class', () => {
    const loadData = () => new Promise<TestData>(() => {});
    const { container } = render(<EntityDetailPageClient config={createConfig()} loadData={loadData} />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
