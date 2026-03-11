// Tests for arena topic detail page — verifies rows render as links, no expand/collapse controls,
// and the breadcrumb navigation renders correctly.

import { render, screen, waitFor } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useParams: () => ({ topicId: 'topic-1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/arena/topic-1',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('next/dynamic', () => (fn: () => unknown) => {
  // Return a stub component instead of loading the dynamic import
  const StubComponent = () => null;
  StubComponent.displayName = 'DynamicStub';
  return StubComponent;
});

jest.mock('diff', () => ({
  diffWordsWithSpace: jest.fn(() => []),
}));

jest.mock('@evolution/services/arenaActions', () => ({
  getArenaTopicAction: jest.fn(),
  getArenaLeaderboardAction: jest.fn(),
  getArenaEntriesAction: jest.fn(),
  getArenaMatchHistoryAction: jest.fn(),
  runArenaComparisonAction: jest.fn(),
  deleteArenaEntryAction: jest.fn(),
  addToArenaAction: jest.fn(),
}));

jest.mock('@evolution/services/promptRegistryActions', () => ({
  archivePromptAction: jest.fn(),
  unarchivePromptAction: jest.fn(),
}));

jest.mock('@evolution/services/evolutionActions', () => ({
  getEvolutionRunsAction: jest.fn(),
  getEvolutionVariantsAction: jest.fn(),
  getEvolutionRunSummaryAction: jest.fn(),
}));

import {
  getArenaTopicAction,
  getArenaLeaderboardAction,
  getArenaEntriesAction,
  getArenaMatchHistoryAction,
} from '@evolution/services/arenaActions';

import ArenaTopicDetailPage from './page';

const MOCK_TOPIC = {
  id: 'topic-1',
  prompt: 'What is photosynthesis?',
  title: 'Photosynthesis',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const MOCK_LEADERBOARD_ENTRY = {
  entry_id: 'entry-1',
  topic_id: 'topic-1',
  generation_method: 'oneshot',
  model: 'gpt-4.1-nano',
  display_elo: 1200,
  ci_lower: 1150,
  ci_upper: 1250,
  match_count: 5,
  total_cost_usd: 0.01,
  run_cost_usd: null,
  elo_per_dollar: 120.0,
  strategy_label: null,
  experiment_name: null,
  run_budget_cap_usd: null,
  evolution_run_id: null,
  created_at: '2026-01-01T00:00:00Z',
};

const MOCK_ENTRY = {
  id: 'entry-1',
  topic_id: 'topic-1',
  content: 'Photosynthesis is the process...',
  generation_method: 'oneshot',
  model: 'gpt-4.1-nano',
  total_cost_usd: 0.01,
  evolution_run_id: null,
  evolution_variant_id: null,
  metadata: null,
  created_at: '2026-01-01T00:00:00Z',
};

describe('ArenaTopicDetailPage', () => {
  beforeEach(() => {
    (getArenaTopicAction as jest.Mock).mockResolvedValue({ success: true, data: MOCK_TOPIC });
    (getArenaLeaderboardAction as jest.Mock).mockResolvedValue({ success: true, data: [MOCK_LEADERBOARD_ENTRY] });
    (getArenaEntriesAction as jest.Mock).mockResolvedValue({ success: true, data: [MOCK_ENTRY] });
    (getArenaMatchHistoryAction as jest.Mock).mockResolvedValue({ success: true, data: [] });
  });

  it('renders leaderboard rows as links to entry detail pages (no expand state)', async () => {
    render(<ArenaTopicDetailPage />);

    // Wait for data to load (loading spinner disappears, leaderboard appears)
    const entryLink = await screen.findByTestId('entry-link-0');
    expect(entryLink.closest('a')).toHaveAttribute('href', '/admin/evolution/arena/entries/entry-1');
  });

  it('has no expand/collapse controls (no ▲/▼ characters)', async () => {
    render(<ArenaTopicDetailPage />);

    await screen.findByTestId('leaderboard-table');

    const html = document.body.innerHTML;
    expect(html).not.toContain('▲');
    expect(html).not.toContain('▼');
    expect(html).not.toContain('\u25b2');
    expect(html).not.toContain('\u25bc');
  });

  it('renders breadcrumb with Arena link', async () => {
    render(<ArenaTopicDetailPage />);

    await screen.findByTestId('evolution-breadcrumb');

    const breadcrumb = screen.getByTestId('evolution-breadcrumb');
    expect(breadcrumb).toBeInTheDocument();
    // Arena is the first breadcrumb item (links back to arena list)
    const arenaLink = breadcrumb.querySelector('a[href="/admin/evolution/arena"]');
    expect(arenaLink).toBeInTheDocument();
    expect(arenaLink).toHaveTextContent('Arena');
  });
});
