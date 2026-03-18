// Tests for ArenaPage: topic table, cross-topic summaries, prompt bank coverage, generate dialog.

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/arena',
  useSearchParams: () => new URLSearchParams(),
}));

const mockPush = jest.fn();

jest.mock('next/link', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    __esModule: true,
    default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
      React.createElement('a', { href, ...props }, children),
  };
});

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('@/lib/utils/modelOptions', () => ({
  MODEL_OPTIONS: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano'],
}));

jest.mock('@evolution/components/evolution', () => ({
  EvolutionBreadcrumb: ({ items }: { items: { label: string; href?: string }[] }) => (
    <nav data-testid="evolution-breadcrumb">
      {items.map((item) =>
        item.href ? (
          <a key={item.label} href={item.href}>{item.label}</a>
        ) : (
          <span key={item.label}>{item.label}</span>
        ),
      )}
    </nav>
  ),
  TableSkeleton: ({ columns, rows }: { columns: number; rows: number }) => (
    <div data-testid="table-skeleton">Loading {columns}x{rows}</div>
  ),
  EmptyState: ({ message, suggestion }: { message: string; suggestion?: string }) => (
    <div data-testid="empty-state">
      <span>{message}</span>
      {suggestion && <span>{suggestion}</span>}
    </div>
  ),
}));

jest.mock('@evolution/components/evolution/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, title, message, onConfirm, onClose, confirmLabel }: {
    open: boolean; title: string; message: string;
    onConfirm: () => Promise<void>; onClose: () => void; confirmLabel?: string;
  }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <span data-testid="confirm-title">{title}</span>
        <span data-testid="confirm-message">{message}</span>
        <button data-testid="confirm-yes" onClick={onConfirm}>{confirmLabel ?? 'Confirm'}</button>
        <button data-testid="confirm-close" onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

jest.mock('@evolution/services/arenaActions', () => ({
  getArenaTopicsAction: jest.fn(),
  getCrossTopicSummaryAction: jest.fn(),
  addToArenaAction: jest.fn(),
  deleteArenaTopicAction: jest.fn(),
  generateAndAddToArenaAction: jest.fn(),
  getPromptBankCoverageAction: jest.fn(),
  getPromptBankMethodSummaryAction: jest.fn(),
  runArenaComparisonAction: jest.fn(),
}));

jest.mock('@evolution/services/promptRegistryActions', () => ({
  archivePromptAction: jest.fn(),
  unarchivePromptAction: jest.fn(),
}));

jest.mock('@evolution/config/promptBankConfig', () => ({
  PROMPT_BANK: {
    prompts: [
      { prompt: 'Test prompt 1', difficulty: 'easy', domain: 'science' },
      { prompt: 'Test prompt 2', difficulty: 'medium', domain: 'history' },
    ],
    methods: [
      { type: 'oneshot', model: 'gpt-4.1', label: 'oneshot_gpt4' },
    ],
    comparison: { judgeModel: 'gpt-4.1', rounds: 3 },
  },
}));

import {
  getArenaTopicsAction,
  getCrossTopicSummaryAction,
  deleteArenaTopicAction,
  getPromptBankCoverageAction,
  getPromptBankMethodSummaryAction,
  runArenaComparisonAction,
} from '@evolution/services/arenaActions';

import { toast } from 'sonner';

import ArenaPage from './page';

// ─── Test data ───────────────────────────────────────────────

const MOCK_TOPIC_1 = {
  id: 'topic-1',
  prompt: 'Explain quantum computing',
  status: 'active',
  entry_count: 3,
  elo_min: 1100,
  elo_max: 1300,
  total_cost: 0.05,
  best_method: 'oneshot',
  created_at: '2026-01-15T00:00:00Z',
  updated_at: '2026-01-15T00:00:00Z',
};

const MOCK_TOPIC_2 = {
  id: 'topic-2',
  prompt: 'History of the Roman Empire',
  status: 'active',
  entry_count: 5,
  elo_min: 1000,
  elo_max: 1400,
  total_cost: 0.12,
  best_method: 'evolution_winner',
  created_at: '2026-01-20T00:00:00Z',
  updated_at: '2026-01-20T00:00:00Z',
};

const MOCK_SUMMARIES = [
  {
    generation_method: 'oneshot',
    entry_count: 10,
    avg_elo: 1200,
    avg_cost: 0.003,
    avg_elo_per_dollar: 400000,
    win_rate: 0.45,
  },
  {
    generation_method: 'evolution_winner',
    entry_count: 8,
    avg_elo: 1350,
    avg_cost: 0.015,
    avg_elo_per_dollar: 90000,
    win_rate: 0.65,
  },
];

const MOCK_COVERAGE: Array<{
  prompt: string;
  topicId: string | null;
  methods: Record<string, { exists: boolean; matchCount?: number }>;
}> = [
  {
    prompt: 'Test prompt 1',
    topicId: 'topic-1',
    methods: { oneshot_gpt4: { exists: true, matchCount: 3 } },
  },
  {
    prompt: 'Test prompt 2',
    topicId: 'topic-2',
    methods: { oneshot_gpt4: { exists: false } },
  },
];

const MOCK_METHOD_SUMMARY = [
  { label: 'oneshot_gpt4', avgElo: 1200, winRate: 0.55, entryCount: 1 },
];

// ─── Helpers ────────────────────────────────────────────────

function setupMocksSuccess() {
  (getArenaTopicsAction as jest.Mock).mockResolvedValue({ success: true, data: [MOCK_TOPIC_1, MOCK_TOPIC_2] });
  (getCrossTopicSummaryAction as jest.Mock).mockResolvedValue({ success: true, data: MOCK_SUMMARIES });
  (getPromptBankCoverageAction as jest.Mock).mockResolvedValue({ success: true, data: MOCK_COVERAGE });
  (getPromptBankMethodSummaryAction as jest.Mock).mockResolvedValue({ success: true, data: MOCK_METHOD_SUMMARY });
}

function setupMocksEmpty() {
  (getArenaTopicsAction as jest.Mock).mockResolvedValue({ success: true, data: [] });
  (getCrossTopicSummaryAction as jest.Mock).mockResolvedValue({ success: true, data: [] });
  (getPromptBankCoverageAction as jest.Mock).mockResolvedValue({ success: true, data: [] });
  (getPromptBankMethodSummaryAction as jest.Mock).mockResolvedValue({ success: true, data: [] });
}

// ─── Tests ──────────────────────────────────────────────────

describe('ArenaPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMocksSuccess();
  });

  // 1. Loading state
  it('shows loading skeleton while data is being fetched', () => {
    // Make the action never resolve so we stay in loading
    (getArenaTopicsAction as jest.Mock).mockReturnValue(new Promise(() => {}));

    render(<ArenaPage />);
    expect(screen.getByTestId('table-skeleton')).toBeInTheDocument();
  });

  // 2. Renders arena page with topics table
  it('renders arena page with topics table after loading', async () => {
    render(<ArenaPage />);

    await waitFor(() => {
      expect(screen.getByTestId('topic-row-topic-1')).toBeInTheDocument();
    });

    expect(screen.getByTestId('topic-row-topic-1')).toHaveTextContent('Explain quantum computing');
    expect(screen.getByTestId('topic-row-topic-2')).toHaveTextContent('History of the Roman Empire');
  });

  // 3. Empty state when no topics
  it('shows empty state when no topics exist', async () => {
    setupMocksEmpty();

    render(<ArenaPage />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });

    expect(screen.getByText('No topics yet')).toBeInTheDocument();
  });

  // 4. Error handling on load failure
  it('shows error message when topics fail to load', async () => {
    (getArenaTopicsAction as jest.Mock).mockResolvedValue({
      success: false,
      data: null,
      error: { message: 'Database connection failed' },
    });

    render(<ArenaPage />);

    await waitFor(() => {
      expect(screen.getByText('Database connection failed')).toBeInTheDocument();
    });
  });

  // 5. Cross-topic summary section renders with data
  it('renders cross-topic summary section when summaries exist and topics have elo', async () => {
    render(<ArenaPage />);

    await waitFor(() => {
      expect(screen.getByTestId('cross-topic-summary')).toBeInTheDocument();
    });

    const summarySection = screen.getByTestId('cross-topic-summary');

    // Method badges and metrics are present in the summary section
    expect(summarySection).toHaveTextContent('oneshot');
    expect(summarySection).toHaveTextContent('evolution winner');
    expect(summarySection).toHaveTextContent('10 entries');
    expect(summarySection).toHaveTextContent('8 entries');
    expect(summarySection).toHaveTextContent('1200');
    expect(summarySection).toHaveTextContent('1350');
    expect(summarySection).toHaveTextContent('45%');
    expect(summarySection).toHaveTextContent('65%');
  });

  // 6. Cross-topic summary hidden when empty
  it('hides cross-topic summary when fewer than 2 summaries', async () => {
    (getCrossTopicSummaryAction as jest.Mock).mockResolvedValue({ success: true, data: [MOCK_SUMMARIES[0]] });

    render(<ArenaPage />);

    await waitFor(() => {
      expect(screen.getByTestId('topics-table')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('cross-topic-summary')).not.toBeInTheDocument();
  });

  // 7. Topic rows show correct data
  it('displays correct data in topic rows', async () => {
    render(<ArenaPage />);

    await waitFor(() => {
      expect(screen.getByTestId('topic-row-topic-1')).toBeInTheDocument();
    });

    const row1 = screen.getByTestId('topic-row-topic-1');
    expect(row1).toHaveTextContent('Explain quantum computing');
    expect(row1).toHaveTextContent('3'); // entry count
    // Rating range with en-dash
    expect(row1).toHaveTextContent('1100\u20131300');
    expect(row1).toHaveTextContent('$0.0500');

    const row2 = screen.getByTestId('topic-row-topic-2');
    expect(row2).toHaveTextContent('5'); // entry count
    expect(row2).toHaveTextContent('1000\u20131400');
  });

  // 8. Delete topic via confirm dialog
  it('opens confirm dialog and deletes topic on confirm', async () => {
    (deleteArenaTopicAction as jest.Mock).mockResolvedValue({ success: true });

    render(<ArenaPage />);

    await waitFor(() => {
      expect(screen.getByTestId('delete-topic-topic-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('delete-topic-topic-1'));

    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    });

    expect(screen.getByTestId('confirm-title')).toHaveTextContent('Delete Topic');
    expect(screen.getByTestId('confirm-message')).toHaveTextContent('Explain quantum computing');

    fireEvent.click(screen.getByTestId('confirm-yes'));

    await waitFor(() => {
      expect(deleteArenaTopicAction).toHaveBeenCalledWith('topic-1');
    });

    expect(toast.success).toHaveBeenCalledWith('Topic deleted');
  });

  // 9. Page title and breadcrumb
  it('renders page title and breadcrumb', async () => {
    render(<ArenaPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Arena');
    expect(screen.getByTestId('evolution-breadcrumb')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  // 10. Prompt bank coverage section loads
  it('renders prompt bank section with coverage data', async () => {
    render(<ArenaPage />);

    await waitFor(() => {
      expect(screen.getByTestId('prompt-bank-section')).toBeInTheDocument();
    });

    expect(screen.getByText('Prompt Bank')).toBeInTheDocument();
    // Method summary labels exist in the prompt bank section
    const pbSection = screen.getByTestId('prompt-bank-section');
    expect(pbSection).toHaveTextContent('oneshot_gpt4');
  });

  // 11. Generate article dialog opens
  it('opens generate article dialog on button click', async () => {
    render(<ArenaPage />);

    await waitFor(() => {
      expect(screen.getByTestId('generate-article-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('generate-article-btn'));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Generate new article' })).toBeInTheDocument();
    });

    expect(screen.getByTestId('generate-model')).toBeInTheDocument();
    expect(screen.getByTestId('generate-submit')).toBeInTheDocument();
  });

  // 12. Run comparison button
  it('renders run comparisons button in prompt bank section', async () => {
    render(<ArenaPage />);

    await waitFor(() => {
      expect(screen.getByTestId('run-all-comparisons-btn')).toBeInTheDocument();
    });

    expect(screen.getByTestId('run-all-comparisons-btn')).toHaveTextContent('Run Comparisons');
  });

  // 13. Clicking topic row navigates to topic detail
  it('navigates to topic detail when clicking a row', async () => {
    render(<ArenaPage />);

    await waitFor(() => {
      expect(screen.getByTestId('topic-row-topic-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('topic-row-topic-1'));
    expect(mockPush).toHaveBeenCalledWith('/admin/evolution/arena/topic-1');
  });

  // 14. Error fallback message when no error.message
  it('shows fallback error message when error has no message', async () => {
    (getArenaTopicsAction as jest.Mock).mockResolvedValue({
      success: false,
      data: null,
      error: null,
    });

    render(<ArenaPage />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load topics')).toBeInTheDocument();
    });
  });

  // 15. Cross-topic summary hidden when topics have no elo
  it('hides cross-topic summary when no topics have elo ratings', async () => {
    const topicsNoElo = [
      { ...MOCK_TOPIC_1, elo_min: null, elo_max: null },
      { ...MOCK_TOPIC_2, elo_min: null, elo_max: null },
    ];
    (getArenaTopicsAction as jest.Mock).mockResolvedValue({ success: true, data: topicsNoElo });

    render(<ArenaPage />);

    await waitFor(() => {
      expect(screen.getByTestId('topics-table')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('cross-topic-summary')).not.toBeInTheDocument();
  });
});
