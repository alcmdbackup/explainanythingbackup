// Tests for arena list page rendering with status filter and topic display.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ArenaListPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/arena',
  useSearchParams: () => new URLSearchParams(),
}));

const MOCK_TOPICS = [
  {
    id: '550e8400-e29b-41d4-a716-446655440000',
    prompt: 'Explain quantum computing to a beginner in simple terms that anyone can understand without technical background',
    name: 'Quantum Computing Intro',
    status: 'active' as const,
    created_at: '2026-03-01T09:00:00Z',
    entry_count: 5,
  },
  {
    id: '660e8400-e29b-41d4-a716-446655440001',
    prompt: 'Describe photosynthesis',
    name: 'Photosynthesis',
    status: 'archived' as const,
    created_at: '2026-02-15T09:00:00Z',
    entry_count: 3,
  },
];

const mockGetArenaTopicsAction = jest.fn().mockResolvedValue({
  success: true,
  data: MOCK_TOPICS,
});

jest.mock('@evolution/services/arenaActions', () => ({
  getArenaTopicsAction: (...args: unknown[]) => mockGetArenaTopicsAction(...args),
}));

describe('ArenaListPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetArenaTopicsAction.mockResolvedValue({ success: true, data: MOCK_TOPICS });
  });

  it('renders page title', async () => {
    render(<ArenaListPage />);
    await waitFor(() => {
      expect(screen.getByText('Arena Topics')).toBeInTheDocument();
    });
  });

  it('renders breadcrumb with Evolution link', async () => {
    render(<ArenaListPage />);
    await waitFor(() => {
      expect(screen.getByText('Evolution')).toBeInTheDocument();
      expect(screen.getByText('Arena')).toBeInTheDocument();
    });
  });

  it('renders topic titles', async () => {
    render(<ArenaListPage />);
    await waitFor(() => {
      expect(screen.getByText('Quantum Computing Intro')).toBeInTheDocument();
      expect(screen.getByText('Photosynthesis')).toBeInTheDocument();
    });
  });

  it('truncates long prompts', async () => {
    render(<ArenaListPage />);
    await waitFor(() => {
      expect(screen.getByText(/Explain quantum computing/)).toBeInTheDocument();
    });
    // The full prompt is > 80 chars so it should be truncated
    const promptCell = screen.getByText(/Explain quantum computing/);
    expect(promptCell.textContent).toContain('…');
  });

  it('renders status filter', async () => {
    render(<ArenaListPage />);
    await waitFor(() => {
      const filter = screen.getByTestId('filter-status');
      expect(filter).toBeInTheDocument();
    });
  });

  it('calls action with status filter when changed', async () => {
    const user = userEvent.setup();
    render(<ArenaListPage />);

    await waitFor(() => {
      expect(screen.getByTestId('filter-status')).toBeInTheDocument();
    });

    const filter = screen.getByTestId('filter-status');
    await user.selectOptions(filter, 'active');

    await waitFor(() => {
      expect(mockGetArenaTopicsAction).toHaveBeenCalledWith({ status: 'active', filterTestContent: true });
    });
  });

  it('shows empty state when no topics', async () => {
    mockGetArenaTopicsAction.mockResolvedValue({ success: true, data: [] });
    render(<ArenaListPage />);
    await waitFor(() => {
      expect(screen.getByText('No arena topics found')).toBeInTheDocument();
    });
  });

  it('renders entry count for topics', async () => {
    render(<ArenaListPage />);
    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });

  it('renders hide test content checkbox', async () => {
    render(<ArenaListPage />);
    await waitFor(() => {
      const filter = screen.getByTestId('filter-filterTestContent');
      expect(filter).toBeInTheDocument();
      expect(filter).toHaveTextContent('Hide test content');
    });
  });

  it('displays topic status badges', async () => {
    render(<ArenaListPage />);
    await waitFor(() => {
      expect(screen.getByText('active')).toBeInTheDocument();
      expect(screen.getByText('archived')).toBeInTheDocument();
    });
  });
});
