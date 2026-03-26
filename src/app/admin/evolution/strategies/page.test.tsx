// Tests for strategies list page rendering and RegistryPage integration.

import { render, screen, waitFor } from '@testing-library/react';
import StrategiesPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/strategies',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/services/strategyRegistryActions', () => ({
  listStrategiesAction: jest.fn().mockResolvedValue({
    success: true,
    data: {
      items: [{
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Test Strategy',
        label: 'Gen: gpt-4o | Judge: gpt-4o | 10 iters',
        description: 'A test strategy',
        config: { generationModel: 'gpt-4o', judgeModel: 'gpt-4o', iterations: 10 },
        config_hash: 'abc123',
        pipeline_type: 'full',
        status: 'active',
        created_by: 'admin',
        run_count: 5,
        total_cost_usd: 1.5,
        avg_final_elo: 1200,
        first_used_at: '2026-01-01T00:00:00Z',
        last_used_at: '2026-03-01T00:00:00Z',
        created_at: '2026-01-01T00:00:00Z',
      }],
      total: 1,
    },
  }),
  createStrategyAction: jest.fn().mockResolvedValue({ success: true, data: {} }),
  updateStrategyAction: jest.fn().mockResolvedValue({ success: true, data: {} }),
  cloneStrategyAction: jest.fn().mockResolvedValue({ success: true, data: {} }),
  archiveStrategyAction: jest.fn().mockResolvedValue({ success: true, data: { archived: true } }),
  deleteStrategyAction: jest.fn().mockResolvedValue({ success: true, data: { deleted: true } }),
}));

describe('StrategiesPage', () => {
  it('renders page title', () => {
    render(<StrategiesPage />);
    const headings = screen.getAllByText('Strategies');
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });

  it('renders breadcrumb with Evolution link', () => {
    render(<StrategiesPage />);
    expect(screen.getByText('Evolution')).toBeInTheDocument();
  });

  it('renders New Strategy button', () => {
    render(<StrategiesPage />);
    expect(screen.getByText('New Strategy')).toBeInTheDocument();
  });

  it('loads and displays strategy data', async () => {
    render(<StrategiesPage />);
    await waitFor(() => {
      expect(screen.getByText('Test Strategy')).toBeInTheDocument();
    });
  });

  it('shows status filter', () => {
    render(<StrategiesPage />);
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
  });

  it('shows pipeline filter', () => {
    render(<StrategiesPage />);
    expect(screen.getByLabelText('Pipeline')).toBeInTheDocument();
  });

  it('renders strategy label text', async () => {
    render(<StrategiesPage />);
    await waitFor(() => {
      expect(screen.getByText('Gen: gpt-4o | Judge: gpt-4o | 10 iters')).toBeInTheDocument();
    });
  });

  it('displays run count', async () => {
    render(<StrategiesPage />);
    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });

  it('shows active status text', async () => {
    render(<StrategiesPage />);
    await waitFor(() => {
      expect(screen.getByText('active')).toBeInTheDocument();
    });
  });

  it('renders strategies breadcrumb', () => {
    render(<StrategiesPage />);
    const headings = screen.getAllByText('Strategies');
    expect(headings.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('evolution-breadcrumb')).toBeInTheDocument();
  });

  it('renders table after loading', async () => {
    render(<StrategiesPage />);
    await waitFor(() => {
      expect(screen.getByText('Test Strategy')).toBeInTheDocument();
    });
  });

  it('calls listStrategiesAction on mount', () => {
    const { listStrategiesAction } = jest.requireMock('@evolution/services/strategyRegistryActions');
    render(<StrategiesPage />);
    expect(listStrategiesAction).toHaveBeenCalled();
  });

  it('does not render Created By column (F48)', async () => {
    render(<StrategiesPage />);
    await waitFor(() => {
      expect(screen.getByText('Test Strategy')).toBeInTheDocument();
    });
    expect(screen.queryByText('Created By')).not.toBeInTheDocument();
  });
});
