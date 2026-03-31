// Tests for arena topic detail page with leaderboard rendering and column sorting.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ArenaTopicDetailPage from './page';

const MOCK_TOPIC = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  prompt: 'Explain photosynthesis to a 5-year-old.',
  name: 'Photosynthesis Explainer',
  status: 'active' as const,
  created_at: '2026-03-01T09:00:00Z',
};

const MOCK_ENTRIES = [
  {
    id: '660e8400-e29b-41d4-a716-446655440001',
    prompt_id: '550e8400-e29b-41d4-a716-446655440000',
    run_id: null,
    variant_content: 'Plants use sunlight and water to make their own food through a process called photosynthesis.',
    synced_to_arena: true,
    generation_method: 'manual',
    model: null,
    cost_usd: null,
    elo_score: 1400,
    mu: 1400,
    sigma: 80,
    arena_match_count: 5,
    archived_at: null,
    created_at: '2026-03-01T09:30:00Z',
  },
  {
    id: '770e8400-e29b-41d4-a716-446655440002',
    prompt_id: '550e8400-e29b-41d4-a716-446655440000',
    run_id: 'aaa00000-0000-0000-0000-000000000001',
    variant_content: 'Imagine the sun is like a big lamp...',
    synced_to_arena: true,
    generation_method: 'llm',
    model: 'gpt-4',
    cost_usd: 0.25,
    elo_score: 1200,
    mu: 1200,
    sigma: 100,
    arena_match_count: 3,
    archived_at: null,
    created_at: '2026-03-02T09:00:00Z',
  },
];

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/arena/550e8400-e29b-41d4-a716-446655440000',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ topicId: '550e8400-e29b-41d4-a716-446655440000' }),
}));

const mockGetArenaTopicDetailAction = jest.fn().mockResolvedValue({
  success: true,
  data: MOCK_TOPIC,
});

const mockGetArenaEntriesAction = jest.fn().mockResolvedValue({
  success: true,
  data: MOCK_ENTRIES,
});

jest.mock('@evolution/services/arenaActions', () => ({
  getArenaTopicDetailAction: (...args: unknown[]) => mockGetArenaTopicDetailAction(...args),
  getArenaEntriesAction: (...args: unknown[]) => mockGetArenaEntriesAction(...args),
}));

describe('ArenaTopicDetailPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetArenaTopicDetailAction.mockResolvedValue({ success: true, data: MOCK_TOPIC });
    mockGetArenaEntriesAction.mockResolvedValue({ success: true, data: { entries: MOCK_ENTRIES, total: MOCK_ENTRIES.length } });
  });

  it('renders topic title in header', async () => {
    render(<ArenaTopicDetailPage />);
    await waitFor(() => {
      const header = screen.getByTestId('entity-detail-header');
      expect(header).toHaveTextContent('Photosynthesis Explainer');
    });
  });

  it('renders breadcrumb with Arena link', async () => {
    render(<ArenaTopicDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Arena')).toBeInTheDocument();
    });
    const arenaLink = screen.getByText('Arena');
    expect(arenaLink.closest('a')).toHaveAttribute('href', '/admin/evolution/arena');
  });

  it('renders topic prompt text', async () => {
    render(<ArenaTopicDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Explain photosynthesis to a 5-year-old.')).toBeInTheDocument();
    });
  });

  it('renders leaderboard table', async () => {
    render(<ArenaTopicDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('leaderboard-table')).toBeInTheDocument();
    });
  });

  it('renders entries sorted by rank', async () => {
    render(<ArenaTopicDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('1400')).toBeInTheDocument();
      expect(screen.getByText('1200')).toBeInTheDocument();
    });
  });

  it('renders entry links to entry detail', async () => {
    render(<ArenaTopicDetailPage />);
    await waitFor(() => {
      const entryLink = screen.getByText(/Plants use sunlight/);
      expect(entryLink.closest('a')).toHaveAttribute(
        'href',
        '/admin/evolution/variants/660e8400-e29b-41d4-a716-446655440001',
      );
    });
  });

  it('shows not found card when topic fails to load', async () => {
    mockGetArenaTopicDetailAction.mockResolvedValue({
      success: false,
      data: null,
      error: { message: 'Network error' },
    });
    render(<ArenaTopicDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Arena Topic not found')).toBeInTheDocument();
    });
  });

  it('shows empty leaderboard message when no entries', async () => {
    mockGetArenaEntriesAction.mockResolvedValue({ success: true, data: [] });
    render(<ArenaTopicDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('No entries yet.')).toBeInTheDocument();
    });
  });

  it('renders sortable column headers (F41)', async () => {
    render(<ArenaTopicDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('leaderboard-table')).toBeInTheDocument();
    });
    // Elo header should show descending indicator by default
    const eloHeader = screen.getAllByText(/Elo/).find(el => !el.textContent?.includes('±'))!;
    expect(eloHeader.textContent).toContain('\u25BC');
  });

  it('toggles sort direction when clicking same column (F41)', async () => {
    const user = userEvent.setup();
    render(<ArenaTopicDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('leaderboard-table')).toBeInTheDocument();
    });
    const eloHeader = screen.getAllByText(/Elo/).find(el => !el.textContent?.includes('±'))!;
    // Default is desc, clicking should toggle to asc
    await user.click(eloHeader);
    expect(eloHeader.textContent).toContain('\u25B2');
  });

  it('switches sort column and resets direction to desc (F41)', async () => {
    const user = userEvent.setup();
    render(<ArenaTopicDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('leaderboard-table')).toBeInTheDocument();
    });
    const eloSigmaHeader = screen.getByText(/Elo ± σ/);
    await user.click(eloSigmaHeader);
    expect(eloSigmaHeader.textContent).toContain('\u25BC'); // defaults to desc
    // Elo should no longer show indicator
    const eloHeader = screen.getAllByText(/Elo/).find(el => !el.textContent?.includes('±'))!;
    expect(eloHeader.textContent).not.toContain('\u25B2');
    expect(eloHeader.textContent).not.toContain('\u25BC');
  });
});
