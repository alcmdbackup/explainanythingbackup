// Tests for RunsTable V2: columns, loading, empty state, budget warnings, and row click.

import { render, screen, fireEvent } from '@testing-library/react';
import { RunsTable, getBaseColumns, type BaseRun } from './RunsTable';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@evolution/lib/utils/formatters', () => ({
  formatCost: (v: number) => `$${v.toFixed(2)}`,
}));

const mockRuns: BaseRun[] = [
  {
    id: 'run-1',
    explanation_id: 42,
    status: 'completed',
    total_cost_usd: 0.45,
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
    total_cost_usd: 0.90,
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
});
