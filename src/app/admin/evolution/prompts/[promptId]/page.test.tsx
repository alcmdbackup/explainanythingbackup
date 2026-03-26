// Tests for the prompt detail page: loading, success, error states, prompt text display.

import { render, screen, waitFor } from '@testing-library/react';
import PromptDetailPage from './page';
import { getPromptDetailAction } from '@evolution/services/arenaActions';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/prompts/prompt-1',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ promptId: 'prompt-1' }),
}));

jest.mock('@evolution/services/arenaActions', () => ({
  getPromptDetailAction: jest.fn().mockResolvedValue({
    success: true,
    data: {
      id: 'prompt-1',
      name: 'Test Prompt',
      prompt: 'Explain the concept of gravity in simple terms.',
      status: 'active',
      deleted_at: null,
      archived_at: null,
      created_at: '2026-03-01T00:00:00Z',
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
  MetricGrid: ({ metrics }: { metrics: Array<{ label: string; value: string }> }) => (
    <div data-testid="metric-grid">{metrics.map((m, i) => <span key={i}>{m.label}: {m.value}</span>)}</div>
  ),
  EntityMetricsTab: ({ entityType, entityId }: { entityType: string; entityId: string }) => (
    <div data-testid="entity-metrics-tab">{entityType}:{entityId}</div>
  ),
}));

describe('PromptDetailPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading state initially', () => {
    render(<PromptDetailPage />);
    expect(screen.getByText('Loading prompt...')).toBeInTheDocument();
  });

  it('renders prompt name after loading', async () => {
    render(<PromptDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('entity-detail-header')).toHaveTextContent('Test Prompt');
    });
  });

  it('renders breadcrumb with Evolution and Prompts links', async () => {
    render(<PromptDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Evolution')).toBeInTheDocument();
      expect(screen.getByText('Prompts')).toBeInTheDocument();
    });
  });

  it('renders prompt text', async () => {
    render(<PromptDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Explain the concept of gravity in simple terms.')).toBeInTheDocument();
    });
  });

  it('renders entity detail header', async () => {
    render(<PromptDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('entity-detail-header')).toBeInTheDocument();
    });
  });

  it('renders entity metrics tab', async () => {
    render(<PromptDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('entity-metrics-tab')).toBeInTheDocument();
    });
  });

  it('shows error state on failed load', async () => {
    jest.mocked(getPromptDetailAction).mockResolvedValueOnce({
      success: false,
      data: null,
      error: { message: 'Prompt not found' },
    });

    render(<PromptDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Prompt not found')).toBeInTheDocument();
    });
  });

  it('calls getPromptDetailAction with promptId', async () => {
    render(<PromptDetailPage />);
    await waitFor(() => {
      expect(getPromptDetailAction).toHaveBeenCalledWith('prompt-1');
    });
  });
});
