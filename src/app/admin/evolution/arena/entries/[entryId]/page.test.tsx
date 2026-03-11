// Tests for arena entry detail page: renders entry metadata, content, and cross-links.

import { render, screen } from '@testing-library/react';
import ArenaEntryDetailPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/arena/entries/entry-123',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ entryId: 'entry-123' }),
}));

jest.mock('@evolution/services/arenaActions', () => ({
  getArenaEntryDetailAction: jest.fn().mockResolvedValue({
    success: true,
    data: {
      id: 'entry-123',
      topic_id: 'topic-456',
      content: 'Test article content',
      generation_method: 'evolution',
      model: 'gpt-4o',
      total_cost_usd: 0.05,
      evolution_run_id: 'run-789',
      evolution_variant_id: null,
      metadata: { iterations: 3, duration_seconds: 120 },
      created_at: '2026-01-01T00:00:00Z',
    },
  }),
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

describe('ArenaEntryDetailPage', () => {
  it('renders entity detail header with method and model', async () => {
    render(<ArenaEntryDetailPage />);
    await screen.findByTestId('entity-detail-header');
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('evolution · gpt-4o');
  });

  it('renders overview metrics', async () => {
    render(<ArenaEntryDetailPage />);
    expect(await screen.findByText('Method')).toBeInTheDocument();
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();
  });

  it('renders cross-link to topic', async () => {
    render(<ArenaEntryDetailPage />);
    await screen.findByTestId('cross-links');
  });

  it('renders evolution details section', async () => {
    render(<ArenaEntryDetailPage />);
    expect(await screen.findByText('Evolution Details')).toBeInTheDocument();
  });

  it('renders breadcrumb with Arena link', async () => {
    render(<ArenaEntryDetailPage />);
    const link = await screen.findByText('Arena');
    expect(link.closest('a')).toHaveAttribute('href', '/admin/evolution/arena');
  });
});
