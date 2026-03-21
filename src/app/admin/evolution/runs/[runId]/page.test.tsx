// Tests for the evolution run detail page rendering with tabs.

import { render, screen, waitFor } from '@testing-library/react';
import EvolutionRunDetailPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/runs/run-abc12345',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ runId: 'run-abc12345-0000-0000-0000-000000000001' }),
}));

jest.mock('@evolution/services/evolutionActions', () => ({
  getEvolutionRunByIdAction: jest.fn().mockResolvedValue({
    success: true,
    data: {
      id: 'run-abc12345-0000-0000-0000-000000000001',
      explanation_id: 42,
      status: 'completed',
      budget_cap_usd: 5.00,
      error_message: null,
      completed_at: '2026-03-01T12:00:00Z',
      created_at: '2026-03-01T00:00:00Z',
      prompt_id: null,
      pipeline_version: '2.0',
      strategy_config_id: 'strat-1',
      experiment_id: null,
      archived: false,
      run_summary: null,
      runner_id: null,
      last_heartbeat: null,
      total_cost_usd: 2.50,
      strategy_name: 'Test Strategy',
    },
  }),
  getEvolutionRunLogsAction: jest.fn().mockResolvedValue({
    success: true,
    data: { items: [], total: 0 },
  }),
  getEvolutionRunSummaryAction: jest.fn().mockResolvedValue({
    success: true,
    data: null,
  }),
  getEvolutionCostBreakdownAction: jest.fn().mockResolvedValue({
    success: true,
    data: [],
  }),
}));

jest.mock('@evolution/services/evolutionVisualizationActions', () => ({
  getEvolutionRunEloHistoryAction: jest.fn().mockResolvedValue({
    success: true,
    data: [],
  }),
  getEvolutionRunLineageAction: jest.fn().mockResolvedValue({
    success: true,
    data: [],
  }),
}));

jest.mock('@evolution/lib/utils/formatters', () => ({
  formatCost: (v: number) => `$${v.toFixed(2)}`,
}));

jest.mock('@evolution/lib/utils/evolutionUrls', () => ({
  buildExplanationUrl: (id: number) => `/admin/explanations/${id}`,
  buildRunUrl: (id: string) => `/admin/evolution/runs/${id}`,
  buildVariantDetailUrl: (runId: string, variantId: string) => `/admin/evolution/runs/${runId}/variants/${variantId}`,
}));

describe('EvolutionRunDetailPage', () => {
  it('renders breadcrumb with Dashboard and Runs links', async () => {
    render(<EvolutionRunDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('evolution-breadcrumb')).toBeInTheDocument();
    });
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Runs')).toBeInTheDocument();
  });

  it('renders entity detail header with run ID', async () => {
    render(<EvolutionRunDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('entity-detail-header')).toBeInTheDocument();
    });
  });

  it('renders tab bar with all tabs', async () => {
    render(<EvolutionRunDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('tab-bar')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.getByTestId('tab-elo')).toBeInTheDocument();
    expect(screen.getByTestId('tab-lineage')).toBeInTheDocument();
    expect(screen.getByTestId('tab-variants')).toBeInTheDocument();
    expect(screen.getByTestId('tab-logs')).toBeInTheDocument();
  });

  it('defaults to overview tab', async () => {
    render(<EvolutionRunDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    });
    // Overview tab should be active (has accent-gold class)
    const overviewTab = screen.getByTestId('tab-overview');
    expect(overviewTab.className).toContain('accent-gold');
  });
});
