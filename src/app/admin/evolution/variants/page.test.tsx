// Tests for variants list page rendering and filtering.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VariantsListPage from './page';

const mockToastError = jest.fn();
jest.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args), success: jest.fn() },
}));

const mockVariants = [
  {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    run_id: 'bbbbbbbb-1111-2222-3333-444444444444',
    explanation_id: 1,
    elo_score: 1520,
    generation: 2,
    agent_name: 'mutator',
    match_count: 8,
    is_winner: true,
    created_at: '2026-03-01T00:00:00Z',
    strategy_name: null,
  },
  {
    id: 'cccccccc-1111-2222-3333-444444444444',
    run_id: 'bbbbbbbb-1111-2222-3333-444444444444',
    explanation_id: 1,
    elo_score: 1480,
    generation: 1,
    agent_name: 'generator',
    match_count: 5,
    is_winner: false,
    created_at: '2026-03-01T00:00:00Z',
    strategy_name: null,
  },
];

const mockListVariants = jest.fn().mockResolvedValue({
  success: true,
  data: { items: mockVariants, total: 2 },
});

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/variants',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/services/evolutionActions', () => ({
  listVariantsAction: (...args: unknown[]) => mockListVariants(...args),
}));

describe('VariantsListPage', () => {
  beforeEach(() => {
    mockListVariants.mockClear();
  });

  it('renders breadcrumb with Evolution link', async () => {
    render(<VariantsListPage />);
    await waitFor(() => expect(screen.getByText('Evolution')).toBeInTheDocument());
    expect(screen.getByText('Evolution').closest('a')).toHaveAttribute('href', '/admin/evolution-dashboard');
  });

  it('renders page title', async () => {
    render(<VariantsListPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Variants'));
  });

  it('displays variant data after loading', async () => {
    render(<VariantsListPage />);
    await waitFor(() => expect(screen.getByText('mutator')).toBeInTheDocument());
    expect(screen.getByText('generator')).toBeInTheDocument();
    expect(screen.getByText('1520')).toBeInTheDocument();
    expect(screen.getByText('★')).toBeInTheDocument();
  });

  it('calls listVariantsAction on mount', async () => {
    render(<VariantsListPage />);
    await waitFor(() => expect(mockListVariants).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, offset: 0 }),
    ));
  });

  it('renders agent name filter input', async () => {
    render(<VariantsListPage />);
    await waitFor(() => expect(screen.getByPlaceholderText('Filter by agent...')).toBeInTheDocument());
  });

  it('renders winner filter select', async () => {
    render(<VariantsListPage />);
    await waitFor(() => expect(screen.getByLabelText('Winner')).toBeInTheDocument());
  });

  it('shows total count', async () => {
    render(<VariantsListPage />);
    await waitFor(() => expect(screen.getByText('2 items')).toBeInTheDocument());
  });

  it('renders Variants breadcrumb item', async () => {
    render(<VariantsListPage />);
    await waitFor(() => {
      const breadcrumb = screen.getByTestId('evolution-breadcrumb');
      expect(breadcrumb).toHaveTextContent('Variants');
    });
  });

  it('displays elo score column data', async () => {
    render(<VariantsListPage />);
    await waitFor(() => expect(screen.getByText('1480')).toBeInTheDocument());
  });

  it('displays match count column data', async () => {
    render(<VariantsListPage />);
    await waitFor(() => expect(screen.getByText('8')).toBeInTheDocument());
  });

  it('shows generation number for mutator variant', async () => {
    render(<VariantsListPage />);
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
  });

  it('renders hide test content checkbox', async () => {
    render(<VariantsListPage />);
    await waitFor(() => {
      const filter = screen.getByTestId('filter-filterTestContent');
      expect(filter).toBeInTheDocument();
      expect(filter).toHaveTextContent('Hide test content');
    });
  });

  it('H1: shows error toast when fetch fails', async () => {
    mockListVariants.mockResolvedValueOnce({ success: false, error: { message: 'DB error' } });
    render(<VariantsListPage />);
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('DB error');
    });
  });
});
