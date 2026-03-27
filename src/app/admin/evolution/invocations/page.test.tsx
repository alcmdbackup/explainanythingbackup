// Tests for invocations list page rendering.

import { render, screen, waitFor } from '@testing-library/react';
import InvocationsListPage from './page';

const mockToastError = jest.fn();
jest.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args), success: jest.fn() },
}));

const mockInvocations = [
  {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    run_id: 'bbbbbbbb-1111-2222-3333-444444444444',
    agent_name: 'mutator',
    iteration: 1,
    execution_order: 1,
    success: true,
    cost_usd: 0.125,
    duration_ms: 3200,
    created_at: '2026-03-01T00:00:00Z',
  },
  {
    id: 'cccccccc-1111-2222-3333-444444444444',
    run_id: 'bbbbbbbb-1111-2222-3333-444444444444',
    agent_name: 'evaluator',
    iteration: 1,
    execution_order: 2,
    success: false,
    cost_usd: 0.050,
    duration_ms: 1500,
    created_at: '2026-03-01T00:00:00Z',
  },
];

const mockListInvocations = jest.fn().mockResolvedValue({
  success: true,
  data: { items: mockInvocations, total: 2 },
});

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/invocations',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/services/invocationActions', () => ({
  listInvocationsAction: (...args: unknown[]) => mockListInvocations(...args),
}));

describe('InvocationsListPage', () => {
  beforeEach(() => {
    mockListInvocations.mockClear();
  });

  it('renders breadcrumb with Evolution link', async () => {
    render(<InvocationsListPage />);
    await waitFor(() => expect(screen.getByText('Evolution')).toBeInTheDocument());
    expect(screen.getByText('Evolution').closest('a')).toHaveAttribute('href', '/admin/evolution-dashboard');
  });

  it('renders page title', async () => {
    render(<InvocationsListPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Invocations'));
  });

  it('displays invocation data after loading', async () => {
    render(<InvocationsListPage />);
    await waitFor(() => expect(screen.getByText('mutator')).toBeInTheDocument());
    expect(screen.getByText('evaluator')).toBeInTheDocument();
    expect(screen.getByText('$0.125')).toBeInTheDocument();
  });

  it('calls listInvocationsAction on mount', async () => {
    render(<InvocationsListPage />);
    await waitFor(() => expect(mockListInvocations).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, offset: 0 }),
    ));
  });

  it('shows success/failure indicators', async () => {
    render(<InvocationsListPage />);
    await waitFor(() => expect(screen.getByText('✓')).toBeInTheDocument());
    expect(screen.getByText('✗')).toBeInTheDocument();
  });

  it('shows total count', async () => {
    render(<InvocationsListPage />);
    await waitFor(() => expect(screen.getByText('2 items')).toBeInTheDocument());
  });

  it('renders Invocations breadcrumb item', async () => {
    render(<InvocationsListPage />);
    await waitFor(() => {
      const breadcrumb = screen.getByTestId('evolution-breadcrumb');
      expect(breadcrumb).toHaveTextContent('Invocations');
    });
  });

  it('displays agent name column header', async () => {
    render(<InvocationsListPage />);
    await waitFor(() => expect(screen.getByText('Agent')).toBeInTheDocument());
  });

  it('displays cost column header', async () => {
    render(<InvocationsListPage />);
    await waitFor(() => expect(screen.getByText('Cost')).toBeInTheDocument());
  });

  it('renders hide test content filter checkbox', async () => {
    render(<InvocationsListPage />);
    await waitFor(() => {
      const filter = screen.getByTestId('filter-filterTestContent');
      expect(filter).toBeInTheDocument();
      expect(filter).toHaveTextContent('Hide test content');
    });
  });

  it('H1: shows error toast when fetch fails', async () => {
    mockListInvocations.mockResolvedValueOnce({ success: false, error: { message: 'DB error' } });
    render(<InvocationsListPage />);
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('DB error');
    });
  });
});
