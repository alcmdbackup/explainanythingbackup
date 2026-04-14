// Tests for the evolution run detail page rendering with tabs.

import { render, screen, waitFor } from '@testing-library/react';
import EvolutionRunDetailPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/runs/run-abc12345',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ runId: 'run-abc12345-0000-0000-0000-000000000001' }),
}));

const mockGetEvolutionRunByIdAction = jest.fn().mockResolvedValue({
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
    strategy_id: 'strat-1',
    experiment_id: null,
    archived: false,
    run_summary: null,
    runner_id: null,
    last_heartbeat: null,
    metrics: [
      {
        id: 'cost-id', entity_type: 'run', entity_id: 'run-abc12345-0000-0000-0000-000000000001', metric_name: 'cost',
        value: 2.50, sigma: null, ci_lower: null, ci_upper: null, n: 1,
        origin_entity_type: null, origin_entity_id: null, aggregation_method: null,
        source: 'during_execution', stale: false,
        created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T12:00:00Z',
      },
    ],
    strategy_name: 'Test Strategy',
  },
});

jest.mock('@evolution/services/evolutionActions', () => ({
  getEvolutionRunByIdAction: (...args: unknown[]) => mockGetEvolutionRunByIdAction(...args),
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

jest.mock('@evolution/services/metricsActions', () => ({
  getEntityMetricsAction: jest.fn().mockResolvedValue({
    success: true,
    data: [],
    error: null,
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
  it('renders breadcrumb with Evolution and Runs links', async () => {
    render(<EvolutionRunDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('evolution-breadcrumb')).toBeInTheDocument();
    });
    expect(screen.getByText('Evolution')).toBeInTheDocument();
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
    expect(screen.getByTestId('tab-metrics')).toBeInTheDocument();
    expect(screen.getByTestId('tab-elo')).toBeInTheDocument();
    expect(screen.getByTestId('tab-lineage')).toBeInTheDocument();
    expect(screen.getByTestId('tab-variants')).toBeInTheDocument();
    expect(screen.getByTestId('tab-logs')).toBeInTheDocument();
  });

  it('defaults to timeline tab', async () => {
    render(<EvolutionRunDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('tab-timeline')).toBeInTheDocument();
    });
    // Timeline tab should be active by default (has accent-gold class)
    const timelineTab = screen.getByTestId('tab-timeline');
    expect(timelineTab.className).toContain('accent-gold');
  });

  // ─── F19: Failed run error banner ───────────────────────────

  it('F19: renders error banner when run is failed with error_message', async () => {
    mockGetEvolutionRunByIdAction.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'run-abc12345-0000-0000-0000-000000000001',
        explanation_id: 42,
        status: 'failed',
        budget_cap_usd: 5.00,
        error_message: 'Pipeline timeout after 300s',
        completed_at: null,
        created_at: '2026-03-01T00:00:00Z',
        prompt_id: null,
        pipeline_version: '2.0',
        strategy_id: 'strat-1',
        experiment_id: null,
        archived: false,
        run_summary: null,
        runner_id: null,
        last_heartbeat: null,
        metrics: [],
        strategy_name: 'Test Strategy',
      },
    });

    render(<EvolutionRunDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('run-error-banner')).toBeInTheDocument();
    });
    expect(screen.getByText('Run Failed')).toBeInTheDocument();
    expect(screen.getByText('Pipeline timeout after 300s')).toBeInTheDocument();
  });

  it('F19: does not render error banner for completed run', async () => {
    render(<EvolutionRunDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('entity-detail-header')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('run-error-banner')).not.toBeInTheDocument();
  });
});
