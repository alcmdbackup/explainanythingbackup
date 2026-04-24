// Tests for RunsTable V2: columns, loading, empty state, budget warnings, and row click.

import { render, screen, fireEvent } from '@testing-library/react';
import { RunsTable, getBaseColumns, type BaseRun } from './RunsTable';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@evolution/lib/utils/formatters', () => ({
  formatCost: (v: number) => `$${v.toFixed(2)}`,
  formatDate: (d: string) => new Date(d).toLocaleDateString(),
}));

function makeMetric(name: string, value: number) {
  return {
    id: `${name}-id`,
    entity_type: 'run' as const,
    entity_id: 'run-id',
    metric_name: name,
    value,
    uncertainty: null,
    ci_lower: null,
    ci_upper: null,
    n: 1,
    origin_entity_type: null,
    origin_entity_id: null,
    aggregation_method: null,
    source: 'during_execution',
    stale: false,
    created_at: '2026-03-19T00:00:00Z',
    updated_at: '2026-03-19T00:00:00Z',
  };
}

const mockRuns: BaseRun[] = [
  {
    id: 'run-1',
    explanation_id: 42,
    status: 'completed',
    metrics: [makeMetric('cost', 0.45)],
    budget_cap_usd: 1.00,
    error_message: null,
    completed_at: '2026-03-19T01:00:00Z',
    created_at: '2026-03-19T00:00:00Z',
    strategy_name: 'Test Strategy',
  },
  {
    id: 'run-2',
    explanation_id: null,
    status: 'running',
    metrics: [makeMetric('cost', 0.90)],
    budget_cap_usd: 1.00,
    error_message: null,
    completed_at: null,
    created_at: '2026-03-18T00:00:00Z',
    strategy_name: null,
  },
];

describe('RunsTable', () => {
  const columns = getBaseColumns<BaseRun>();

  it('renders runs', () => {
    render(<RunsTable runs={mockRuns} columns={columns} />);
    expect(screen.getByTestId('run-row-run-1')).toBeInTheDocument();
    expect(screen.getByTestId('run-row-run-2')).toBeInTheDocument();
  });

  it('renders loading skeleton', () => {
    render(<RunsTable runs={[]} columns={columns} loading />);
    expect(screen.queryByTestId('run-row-run-1')).toBeNull();
  });

  it('renders empty state', () => {
    render(<RunsTable runs={[]} columns={columns} />);
    expect(screen.getByText('No runs found')).toBeInTheDocument();
  });

  it('shows budget warning for high cost runs', () => {
    render(<RunsTable runs={mockRuns} columns={columns} />);
    expect(screen.getByTestId('budget-warning')).toBeInTheDocument();
  });

  it('respects maxRows', () => {
    render(<RunsTable runs={mockRuns} columns={columns} maxRows={1} compact />);
    expect(screen.getByTestId('run-row-run-1')).toBeInTheDocument();
    expect(screen.queryByTestId('run-row-run-2')).toBeNull();
  });

  it('F2: getBaseColumns() returns unique column headers (no duplicates)', () => {
    const cols = getBaseColumns<BaseRun>();
    const headers = cols.map(c => c.header);
    const uniqueHeaders = new Set(headers);
    expect(uniqueHeaders.size).toBe(headers.length);
  });

  it('F2: cost column header is "Spent" not "Cost"', () => {
    const cols = getBaseColumns<BaseRun>();
    const costCol = cols.find(c => c.key === 'cost');
    expect(costCol).toBeDefined();
    expect(costCol!.header).toBe('Spent');
  });

  // B2 (use_playwright_find_bugs_ux_issues_20260422): when the rolled-up `cost`
  // metric is missing, RunsTable's Spent cell must fall back to summing
  // generation_cost + ranking_cost + seed_cost so legacy completed runs don't
  // render "$0.00".
  it('B2: Spent falls back to gen+rank+seed sum when cost metric is missing', () => {
    const fallbackRun: BaseRun = {
      id: 'run-fb',
      explanation_id: null,
      status: 'completed',
      metrics: [
        makeMetric('generation_cost', 0.04),
        makeMetric('ranking_cost', 0.05),
        makeMetric('seed_cost', 0.01),
        // NOTE: no `cost` metric — this is the legacy state we're testing.
      ],
      budget_cap_usd: 1.00,
      error_message: null,
      completed_at: '2026-03-19T01:00:00Z',
      created_at: '2026-03-19T00:00:00Z',
      strategy_name: null,
    };
    render(<RunsTable runs={[fallbackRun]} columns={getBaseColumns<BaseRun>()} />);
    // gen 0.04 + rank 0.05 + seed 0.01 = 0.10 → "$0.10"
    expect(screen.getByText('$0.10')).toBeInTheDocument();
  });
});
