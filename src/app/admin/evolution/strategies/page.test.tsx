// Tests for StrategyRegistryPage: CRUD, filters, sorting, dialogs, performance stats.

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import StrategyRegistryPage from './page';

// ─── Mocks ──────────────────────────────────────────────────────

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

jest.mock('next/link', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return function MockLink({ children, ...props }: any) {
    return React.createElement('a', props, children);
  };
});

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/strategies',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/services/strategyRegistryActions', () => ({
  getStrategiesAction: jest.fn(),
  getStrategyPresetsAction: jest.fn(),
  createStrategyAction: jest.fn(),
  updateStrategyAction: jest.fn(),
  cloneStrategyAction: jest.fn(),
  archiveStrategyAction: jest.fn(),
  unarchiveStrategyAction: jest.fn(),
  deleteStrategyAction: jest.fn(),
}));

jest.mock('@evolution/services/eloBudgetActions', () => ({
  getStrategiesPeakStatsAction: jest.fn(),
}));

jest.mock('@evolution/lib/core/budgetRedistribution', () => ({
  REQUIRED_AGENTS: ['generation', 'calibration'],
  OPTIONAL_AGENTS: ['tournament', 'ranking', 'proximity', 'reflection'],
  validateAgentSelection: jest.fn().mockReturnValue([]),
}));

jest.mock('@evolution/lib/core/agentToggle', () => ({
  toggleAgent: jest.fn((agents: string[], agent: string) =>
    agents.includes(agent) ? agents.filter((a: string) => a !== agent) : [...agents, agent],
  ),
}));

jest.mock('@/lib/client_utilities', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('@evolution/components/evolution', () => ({
  EvolutionBreadcrumb: ({ items }: any) => (
    <nav data-testid="evolution-breadcrumb">
      {items.map((i: any, idx: number) =>
        i.href ? <a key={idx} href={i.href}>{i.label}</a> : <span key={idx}>{i.label}</span>,
      )}
    </nav>
  ),
  TableSkeleton: () => <div data-testid="table-skeleton">Loading...</div>,
  EmptyState: ({ message, suggestion }: any) => (
    <div data-testid="empty-state">{message} {suggestion}</div>
  ),
}));

jest.mock('@evolution/components/evolution/StatusBadge', () => ({
  StatusBadge: ({ status, variant }: any) => <span data-testid="status-badge">{status}</span>,
}));

jest.mock('@evolution/components/evolution/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, title, message, onConfirm, onClose, confirmLabel }: any) =>
    open ? (
      <div data-testid="confirm-dialog">
        <span>{title}</span>
        <span>{message}</span>
        <button onClick={onConfirm}>{confirmLabel}</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    ) : null,
}));

jest.mock('./strategyFormUtils', () => ({
  formToConfig: jest.fn((form: any) => ({
    generationModel: form.generationModel,
    judgeModel: form.judgeModel,
    iterations: form.iterations,
    enabledAgents: form.enabledAgents,
  })),
  rowToForm: jest.fn((row: any, defaults: string[]) => ({
    name: row.name,
    description: row.description ?? '',
    generationModel: row.config.generationModel,
    judgeModel: row.config.judgeModel,
    iterations: row.config.iterations,
    enabledAgents: defaults,
    singleArticle: false,
    budgetCapUsd: 0.5,
  })),
}));

jest.mock('@/lib/utils/modelOptions', () => ({
  MODEL_OPTIONS: ['gpt-4.1-nano', 'deepseek-chat'],
}));

jest.mock('@evolution/lib/utils/evolutionUrls', () => ({
  buildStrategyUrl: (id: string) => `/admin/evolution/strategies/${id}`,
}));

// ─── Imports after mocks ────────────────────────────────────────

import { toast } from 'sonner';
import {
  getStrategiesAction,
  getStrategyPresetsAction,
  createStrategyAction,
  cloneStrategyAction,
  archiveStrategyAction,
  deleteStrategyAction,
} from '@evolution/services/strategyRegistryActions';
import { getStrategiesPeakStatsAction } from '@evolution/services/eloBudgetActions';

// ─── Helpers ────────────────────────────────────────────────────

const mockStrategy = (overrides: Record<string, unknown> = {}) => ({
  id: 'strat-001',
  config_hash: 'hash1',
  name: 'Alpha Strategy',
  description: 'Test description',
  label: 'alpha-strategy',
  config: {
    generationModel: 'deepseek-chat',
    judgeModel: 'gpt-4.1-nano',
    iterations: 50,
    enabledAgents: ['tournament', 'ranking'],
  },
  is_predefined: true,
  pipeline_type: 'full' as const,
  status: 'active' as const,
  created_by: 'admin' as const,
  run_count: 5,
  total_cost_usd: 2.5,
  avg_final_elo: 1200,
  avg_elo_per_dollar: 150.5,
  best_final_elo: 1400,
  worst_final_elo: 1000,
  stddev_final_elo: 80,
  first_used_at: '2026-01-01T00:00:00Z',
  last_used_at: '2026-03-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

function setupDefaultMocks(strategies = [mockStrategy()]) {
  (getStrategiesAction as jest.Mock).mockResolvedValue({ success: true, data: strategies });
  (getStrategyPresetsAction as jest.Mock).mockResolvedValue({ success: true, data: [] });
  (getStrategiesPeakStatsAction as jest.Mock).mockResolvedValue({ success: true, data: [] });
}

// ─── Tests ──────────────────────────────────────────────────────

describe('StrategyRegistryPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDefaultMocks();
  });

  // 1. Loading state
  it('shows skeleton while loading', () => {
    (getStrategiesAction as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves
    render(<StrategyRegistryPage />);
    expect(screen.getByTestId('table-skeleton')).toBeInTheDocument();
  });

  // 2. Renders strategy table with data
  it('renders strategy table with data after loading', async () => {
    render(<StrategyRegistryPage />);
    expect(await screen.findByText('Alpha Strategy')).toBeInTheDocument();
    expect(screen.getByTestId('strategies-table')).toBeInTheDocument();
  });

  // 3. Error state display
  it('displays error message when loading fails', async () => {
    (getStrategiesAction as jest.Mock).mockResolvedValue({
      success: false,
      data: null,
      error: { message: 'Database connection lost' },
    });
    render(<StrategyRegistryPage />);
    expect(await screen.findByText('Database connection lost')).toBeInTheDocument();
  });

  // 4. Empty state display
  it('shows empty state when no strategies match', async () => {
    setupDefaultMocks([]);
    render(<StrategyRegistryPage />);
    expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
  });

  // 5. Status filter changes trigger reload
  it('reloads data when status filter changes', async () => {
    render(<StrategyRegistryPage />);
    await screen.findByText('Alpha Strategy');
    const callsBefore = (getStrategiesAction as jest.Mock).mock.calls.length;

    fireEvent.change(screen.getByTestId('status-filter'), { target: { value: 'archived' } });
    await waitFor(() => {
      expect((getStrategiesAction as jest.Mock).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  // 6. CreatedBy filter works
  it('reloads data when createdBy filter changes', async () => {
    render(<StrategyRegistryPage />);
    await screen.findByText('Alpha Strategy');
    const callsBefore = (getStrategiesAction as jest.Mock).mock.calls.length;

    fireEvent.change(screen.getByTestId('created-by-filter'), { target: { value: 'system' } });
    await waitFor(() => {
      expect((getStrategiesAction as jest.Mock).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  // 7. Pipeline filter works
  it('reloads data when pipeline filter changes', async () => {
    render(<StrategyRegistryPage />);
    await screen.findByText('Alpha Strategy');
    const callsBefore = (getStrategiesAction as jest.Mock).mock.calls.length;

    fireEvent.change(screen.getByTestId('pipeline-filter'), { target: { value: 'single' } });
    await waitFor(() => {
      expect((getStrategiesAction as jest.Mock).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  // 8. Sort by different columns
  it('sorts by name column when header is clicked', async () => {
    setupDefaultMocks([
      mockStrategy({ id: 'strat-a', name: 'Zeta', run_count: 1 }),
      mockStrategy({ id: 'strat-b', name: 'Alpha', run_count: 10 }),
    ]);
    render(<StrategyRegistryPage />);
    await screen.findByText('Zeta');

    // Click Name header to sort ascending by name
    fireEvent.click(screen.getByText('Name'));
    const rows = screen.getAllByText(/Zeta|Alpha/);
    // Alpha should come before Zeta in ascending
    expect(rows[0]).toHaveTextContent('Alpha');
    expect(rows[1]).toHaveTextContent('Zeta');
  });

  // 9. Create button opens dialog
  it('opens create dialog when Create Strategy button is clicked', async () => {
    render(<StrategyRegistryPage />);
    await screen.findByText('Alpha Strategy');

    fireEvent.click(screen.getByTestId('create-strategy-btn'));
    expect(screen.getByRole('dialog', { name: 'Create strategy' })).toBeInTheDocument();
    expect(screen.getByText('Create Strategy', { selector: 'h2' })).toBeInTheDocument();
  });

  // 10. Edit button opens dialog
  it('opens edit dialog when Edit action is clicked for predefined strategy', async () => {
    render(<StrategyRegistryPage />);
    await screen.findByText('Alpha Strategy');

    fireEvent.click(screen.getByTitle('Edit'));
    expect(screen.getByRole('dialog', { name: 'Edit strategy' })).toBeInTheDocument();
    expect(screen.getByText('Edit Strategy', { selector: 'h2' })).toBeInTheDocument();
  });

  // 11. Clone button opens dialog
  it('opens clone dialog when Clone action is clicked', async () => {
    render(<StrategyRegistryPage />);
    await screen.findByText('Alpha Strategy');

    fireEvent.click(screen.getByTitle('Clone'));
    expect(screen.getByRole('dialog', { name: 'Clone strategy' })).toBeInTheDocument();
    expect(screen.getByText('Clone Strategy')).toBeInTheDocument();
  });

  // 12. Archive via confirm dialog
  it('shows archive confirm dialog when Archive is clicked', async () => {
    render(<StrategyRegistryPage />);
    await screen.findByText('Alpha Strategy');

    fireEvent.click(screen.getByTitle('Archive'));
    expect(await screen.findByTestId('confirm-dialog')).toBeInTheDocument();
    expect(screen.getByText('Archive Strategy')).toBeInTheDocument();
  });

  // 13. Execute archive via confirm dialog
  it('archives strategy when confirmed', async () => {
    (archiveStrategyAction as jest.Mock).mockResolvedValue({ success: true });
    render(<StrategyRegistryPage />);
    await screen.findByText('Alpha Strategy');

    fireEvent.click(screen.getByTitle('Archive'));
    await screen.findByTestId('confirm-dialog');

    await act(async () => {
      fireEvent.click(screen.getByText('Archive', { selector: '[data-testid="confirm-dialog"] button' }));
    });

    expect(archiveStrategyAction).toHaveBeenCalledWith('strat-001');
    expect(toast.success).toHaveBeenCalled();
  });

  // 14. Delete via confirm dialog
  it('shows delete confirm dialog for predefined strategy with zero runs', async () => {
    setupDefaultMocks([mockStrategy({ run_count: 0 })]);
    render(<StrategyRegistryPage />);
    await screen.findByText('Alpha Strategy');

    fireEvent.click(screen.getByTitle('Delete'));
    expect(await screen.findByTestId('confirm-dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete Strategy')).toBeInTheDocument();
  });

  // 15. Execute delete via confirm dialog
  it('deletes strategy when confirmed', async () => {
    setupDefaultMocks([mockStrategy({ run_count: 0 })]);
    (deleteStrategyAction as jest.Mock).mockResolvedValue({ success: true });
    render(<StrategyRegistryPage />);
    await screen.findByText('Alpha Strategy');

    fireEvent.click(screen.getByTitle('Delete'));
    await screen.findByTestId('confirm-dialog');

    await act(async () => {
      fireEvent.click(screen.getByText('Delete', { selector: '[data-testid="confirm-dialog"] button' }));
    });

    expect(deleteStrategyAction).toHaveBeenCalledWith('strat-001');
    expect(toast.success).toHaveBeenCalled();
  });

  // 16. Create strategy submits form
  it('submits create form and reloads data', async () => {
    (createStrategyAction as jest.Mock).mockResolvedValue({ success: true, data: { id: 'strat-new' } });
    render(<StrategyRegistryPage />);
    await screen.findByText('Alpha Strategy');

    fireEvent.click(screen.getByTestId('create-strategy-btn'));

    const nameInput = screen.getByTestId('strategy-name-input');
    fireEvent.change(nameInput, { target: { value: 'New Strategy' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('strategy-submit-btn'));
    });

    expect(createStrategyAction).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Strategy "New Strategy" created');
  });

  // 17. Page title and breadcrumb render
  it('renders page title', async () => {
    render(<StrategyRegistryPage />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Strategy Registry');
  });

  it('renders breadcrumb with Dashboard link', async () => {
    render(<StrategyRegistryPage />);
    expect(screen.getByTestId('evolution-breadcrumb')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  // 18. Strategy rows show correct data
  it('displays strategy name, run count, and avg elo', async () => {
    render(<StrategyRegistryPage />);
    expect(await screen.findByText('Alpha Strategy')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument(); // run_count
    expect(screen.getByText('1200')).toBeInTheDocument(); // avg_final_elo
    expect(screen.getByText('150.5')).toBeInTheDocument(); // avg_elo_per_dollar
  });

  // 19. Strategy count label
  it('shows strategy count text', async () => {
    render(<StrategyRegistryPage />);
    expect(await screen.findByText('1 strategy')).toBeInTheDocument();
  });

  // 20. Unarchive button for archived strategy
  it('shows unarchive button for archived strategies', async () => {
    setupDefaultMocks([mockStrategy({ status: 'archived' })]);
    render(<StrategyRegistryPage />);
    await screen.findByText('Alpha Strategy');
    expect(screen.getByTitle('Unarchive')).toBeInTheDocument();
  });

  // 21. Clone dialog pre-fills name
  it('pre-fills clone dialog with source name + (Copy)', async () => {
    render(<StrategyRegistryPage />);
    await screen.findByText('Alpha Strategy');

    fireEvent.click(screen.getByTitle('Clone'));
    const input = screen.getByTestId('clone-name-input') as HTMLInputElement;
    expect(input.value).toBe('Alpha Strategy (Copy)');
  });

  // 22. Clone submit calls action
  it('submits clone form and reloads data', async () => {
    (cloneStrategyAction as jest.Mock).mockResolvedValue({ success: true, data: { id: 'strat-cloned' } });
    render(<StrategyRegistryPage />);
    await screen.findByText('Alpha Strategy');

    fireEvent.click(screen.getByTitle('Clone'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('clone-submit-btn'));
    });

    expect(cloneStrategyAction).toHaveBeenCalledWith({
      sourceId: 'strat-001',
      name: 'Alpha Strategy (Copy)',
      description: undefined,
    });
    expect(toast.success).toHaveBeenCalled();
  });

  // 23. Error toast on exception during load
  it('shows error toast when loadData throws', async () => {
    (getStrategiesAction as jest.Mock).mockRejectedValue(new Error('Network error'));
    render(<StrategyRegistryPage />);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to load strategy data');
    });
  });

  // 24. Peak stats are fetched for strategies with runs
  it('fetches peak stats for strategies with run_count > 0', async () => {
    render(<StrategyRegistryPage />);
    await screen.findByText('Alpha Strategy');
    expect(getStrategiesPeakStatsAction).toHaveBeenCalledWith(['strat-001']);
  });
});
