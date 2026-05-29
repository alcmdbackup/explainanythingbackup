// Unit tests for ArenaLeaderboardTable D20 props (highlightVariantIds + filterToVariantIds).
// Per Phase 7 of rank_individual_paragraphs_evolution_20260525.

import { render, screen, waitFor } from '@testing-library/react';
import { ArenaLeaderboardTable } from './ArenaLeaderboardTable';

const TOPIC_ID = 'p0000000-0000-0000-0000-000000000001';
const VAR_A = 'a0000000-0000-0000-0000-000000000010';
const VAR_B = 'b0000000-0000-0000-0000-000000000020';
const VAR_C = 'c0000000-0000-0000-0000-000000000030';

const MOCK_ENTRIES = [
  {
    id: VAR_A,
    prompt_id: TOPIC_ID,
    run_id: null,
    variant_content: 'Variant A text.',
    elo_score: 1400,
    mu: 1400,
    sigma: 80,
    uncertainty: 80,
    arena_match_count: 5,
    generation_method: 'llm',
    generation: 1,
    agent_name: 'paragraph_rewrite',
    tactic_id: null,
    is_seed: false,
    archived_at: null,
    parent_variant_id: null,
    parent_elo: null,
    parent_uncertainty: null,
    parent_run_id: null,
  },
  {
    id: VAR_B,
    prompt_id: TOPIC_ID,
    run_id: null,
    variant_content: 'Variant B text.',
    elo_score: 1300,
    mu: 1300,
    sigma: 90,
    uncertainty: 90,
    arena_match_count: 4,
    generation_method: 'llm',
    generation: 1,
    agent_name: 'paragraph_rewrite',
    tactic_id: null,
    is_seed: false,
    archived_at: null,
    parent_variant_id: null,
    parent_elo: null,
    parent_uncertainty: null,
    parent_run_id: null,
  },
  {
    id: VAR_C,
    prompt_id: TOPIC_ID,
    run_id: null,
    variant_content: 'Variant C text.',
    elo_score: 1200,
    mu: 1200,
    sigma: 100,
    uncertainty: 100,
    arena_match_count: 3,
    generation_method: 'paragraph_original',
    generation: 0,
    agent_name: 'paragraph_original',
    tactic_id: null,
    is_seed: false,
    archived_at: null,
    parent_variant_id: null,
    parent_elo: null,
    parent_uncertainty: null,
    parent_run_id: null,
  },
];

const mockGetArenaEntriesAction = jest.fn();

jest.mock('@evolution/services/arenaActions', () => ({
  getArenaEntriesAction: (...args: unknown[]) => mockGetArenaEntriesAction(...args),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/arena/test',
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetArenaEntriesAction.mockResolvedValue({
    success: true,
    data: { items: MOCK_ENTRIES, total: MOCK_ENTRIES.length },
  });
});

describe('ArenaLeaderboardTable — D20 props', () => {
  it('renders all rows un-decorated when no highlight/filter provided', async () => {
    render(<ArenaLeaderboardTable topicId={TOPIC_ID} />);
    await waitFor(() => expect(screen.getByTestId('leaderboard-table')).toBeInTheDocument());
    // All 3 rows visible.
    expect(screen.getByTestId('lb-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('lb-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('lb-row-2')).toBeInTheDocument();
    // No highlight markers.
    expect(screen.queryByTestId('lb-highlight-marker')).not.toBeInTheDocument();
  });

  it('highlightVariantIds: decorates matching rows with ● in rank column', async () => {
    const highlight = new Set<string>([VAR_A, VAR_C]);
    render(<ArenaLeaderboardTable topicId={TOPIC_ID} highlightVariantIds={highlight} />);
    await waitFor(() => expect(screen.getByTestId('leaderboard-table')).toBeInTheDocument());
    // 2 markers should render (one per highlighted variant).
    const markers = screen.queryAllByTestId('lb-highlight-marker');
    expect(markers).toHaveLength(2);
  });

  it('highlightVariantIds: rows still all rendered (highlight is decoration only)', async () => {
    const highlight = new Set<string>([VAR_A]);
    render(<ArenaLeaderboardTable topicId={TOPIC_ID} highlightVariantIds={highlight} />);
    await waitFor(() => expect(screen.getByTestId('leaderboard-table')).toBeInTheDocument());
    expect(screen.getByTestId('lb-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('lb-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('lb-row-2')).toBeInTheDocument();
  });

  it('filterToVariantIds: renders only matching rows', async () => {
    const filter = new Set<string>([VAR_A, VAR_C]);
    render(<ArenaLeaderboardTable topicId={TOPIC_ID} filterToVariantIds={filter} />);
    await waitFor(() => expect(screen.getByTestId('leaderboard-table')).toBeInTheDocument());
    // 2 of 3 rows rendered.
    const rows = screen.queryAllByTestId(/^lb-row-/);
    expect(rows).toHaveLength(2);
  });

  it('filterToVariantIds: preserves absolute ranks from full sort (rank 3 stays "3")', async () => {
    // VAR_C has lowest Elo (1200) — its absolute rank in the full leaderboard is 3.
    // When filtered to just VAR_C, the rank column should still show "3", not "1".
    const filter = new Set<string>([VAR_C]);
    const { container } = render(<ArenaLeaderboardTable topicId={TOPIC_ID} filterToVariantIds={filter} />);
    await waitFor(() => expect(screen.getByTestId('leaderboard-table')).toBeInTheDocument());
    const rows = container.querySelectorAll('[data-testid^="lb-row-"]');
    expect(rows).toHaveLength(1);
    // The first td (rank column) text should include "3" (VAR_C's absolute rank).
    const rankCell = rows[0]!.querySelector('td');
    expect(rankCell?.textContent).toContain('3');
  });

  it('filterToVariantIds + highlightVariantIds: filtered rows also decorated', async () => {
    const filter = new Set<string>([VAR_A, VAR_B]);
    const highlight = new Set<string>([VAR_A]);
    render(<ArenaLeaderboardTable topicId={TOPIC_ID} filterToVariantIds={filter} highlightVariantIds={highlight} />);
    await waitFor(() => expect(screen.getByTestId('leaderboard-table')).toBeInTheDocument());
    expect(screen.queryAllByTestId(/^lb-row-/)).toHaveLength(2);
    expect(screen.queryAllByTestId('lb-highlight-marker')).toHaveLength(1);
  });
});
