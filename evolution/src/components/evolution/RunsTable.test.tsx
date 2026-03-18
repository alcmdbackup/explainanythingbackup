// Tests for RunsTable: columns, loading, empty state, budget warnings, progress bar, actions.

import { render, screen, fireEvent } from '@testing-library/react';
import { RunsTable, getBaseColumns, type BaseRun } from './RunsTable';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('next/link', () => {
  return function MockLink({ children, href, ...props }: { children: React.ReactNode; href: string } & Record<string, unknown>) {
    return <a href={href} {...props}>{children}</a>;
  };
});

jest.mock('@evolution/components/evolution', () => ({
  EvolutionStatusBadge: ({ status }: { status: string }) => <span data-testid="status-badge">{status}</span>,
}));

jest.mock('@evolution/components/evolution/TableSkeleton', () => ({
  TableSkeleton: ({ columns, rows }: { columns: number; rows: number }) => (
    <div data-testid="table-skeleton">{columns}x{rows}</div>
  ),
}));

jest.mock('@evolution/components/evolution/EmptyState', () => ({
  EmptyState: ({ message }: { message: string }) => <div data-testid="empty-state">{message}</div>,
}));

jest.mock('@evolution/components/evolution/ElapsedTime', () => ({
  ElapsedTime: () => <span data-testid="elapsed-time">0s</span>,
}));

function makeRun(overrides: Partial<BaseRun> = {}): BaseRun {
  return {
    id: 'run-1',
    explanation_id: 42,
    status: 'completed',
    phase: 'COMPETITION',
    current_iteration: 5,
    total_cost_usd: 0.50,
    budget_cap_usd: 1.00,
    error_message: null,
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T01:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('RunsTable', () => {
  const columns = getBaseColumns<BaseRun>();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders table with column headers', () => {
    render(<RunsTable runs={[makeRun()]} columns={columns} />);
    expect(screen.getByText('Explanation')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Phase')).toBeInTheDocument();
    expect(screen.getByText('Progress')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
  });

  it('renders run rows', () => {
    const runs = [makeRun({ id: 'r1' }), makeRun({ id: 'r2', explanation_id: 43 })];
    render(<RunsTable runs={runs} columns={columns} />);
    expect(screen.getByTestId('run-row-r1')).toBeInTheDocument();
    expect(screen.getByTestId('run-row-r2')).toBeInTheDocument();
  });

  it('shows loading skeleton when loading', () => {
    render(<RunsTable runs={[]} columns={columns} loading />);
    expect(screen.getByTestId('table-skeleton')).toBeInTheDocument();
  });

  it('shows empty state when no runs', () => {
    render(<RunsTable runs={[]} columns={columns} />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No runs found')).toBeInTheDocument();
  });

  it('navigates to run on row click (default)', () => {
    render(<RunsTable runs={[makeRun()]} columns={columns} />);
    fireEvent.click(screen.getByTestId('run-row-run-1'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('run-1'));
  });

  it('calls custom onRowClick handler', () => {
    const handler = jest.fn();
    render(<RunsTable runs={[makeRun()]} columns={columns} onRowClick={handler} />);
    fireEvent.click(screen.getByTestId('run-row-run-1'));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-1' }));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('renders explanation link for runs with explanation_id', () => {
    render(<RunsTable runs={[makeRun({ explanation_id: 42 })]} columns={columns} />);
    expect(screen.getByText('#42')).toBeInTheDocument();
  });

  it('renders short run id for runs without explanation_id', () => {
    render(<RunsTable runs={[makeRun({ explanation_id: null, id: '12345678-abcd-ef01-2345-6789abcdef00' })]} columns={columns} />);
    expect(screen.getByText('12345678')).toBeInTheDocument();
  });

  it('renders status badge', () => {
    render(<RunsTable runs={[makeRun({ status: 'running' })]} columns={columns} />);
    expect(screen.getByTestId('status-badge')).toHaveTextContent('running');
  });

  it('renders phase', () => {
    render(<RunsTable runs={[makeRun({ phase: 'EXPANSION' as BaseRun['phase'] })]} columns={columns} />);
    expect(screen.getByText('EXPANSION')).toBeInTheDocument();
  });

  it('renders iteration count', () => {
    render(<RunsTable runs={[makeRun({ current_iteration: 7 })]} columns={columns} />);
    expect(screen.getByText('Iter 7')).toBeInTheDocument();
  });

  it('shows progress bar for running runs', () => {
    render(<RunsTable runs={[makeRun({ status: 'running', total_cost_usd: 0.5, budget_cap_usd: 1.0 })]} columns={columns} />);
    expect(screen.getByTestId('progress-bar')).toBeInTheDocument();
  });

  it('hides progress bar for completed runs', () => {
    render(<RunsTable runs={[makeRun({ status: 'completed' })]} columns={columns} />);
    expect(screen.queryByTestId('progress-bar')).not.toBeInTheDocument();
  });

  it('shows budget warning at 80%+ usage', () => {
    render(<RunsTable runs={[makeRun({ total_cost_usd: 0.85, budget_cap_usd: 1.0 })]} columns={columns} />);
    expect(screen.getByTestId('budget-warning')).toBeInTheDocument();
    expect(screen.getByTestId('budget-warning')).toHaveTextContent('!');
  });

  it('shows critical budget warning at 90%+ usage', () => {
    render(<RunsTable runs={[makeRun({ total_cost_usd: 0.95, budget_cap_usd: 1.0 })]} columns={columns} />);
    expect(screen.getByTestId('budget-warning')).toHaveTextContent('!!');
  });

  it('does not show budget warning below 80%', () => {
    render(<RunsTable runs={[makeRun({ total_cost_usd: 0.5, budget_cap_usd: 1.0 })]} columns={columns} />);
    expect(screen.queryByTestId('budget-warning')).not.toBeInTheDocument();
  });

  it('limits rows with maxRows prop', () => {
    const runs = [makeRun({ id: 'r1' }), makeRun({ id: 'r2' }), makeRun({ id: 'r3' })];
    render(<RunsTable runs={runs} columns={columns} maxRows={2} compact />);
    expect(screen.getByTestId('run-row-r1')).toBeInTheDocument();
    expect(screen.getByTestId('run-row-r2')).toBeInTheDocument();
    expect(screen.queryByTestId('run-row-r3')).not.toBeInTheDocument();
  });

  it('shows "View all" link when compact with maxRows exceeded', () => {
    const runs = [makeRun({ id: 'r1' }), makeRun({ id: 'r2' }), makeRun({ id: 'r3' })];
    render(<RunsTable runs={runs} columns={columns} maxRows={2} compact />);
    expect(screen.getByText('View all 3 runs')).toBeInTheDocument();
  });

  it('renders actions column when renderActions provided', () => {
    render(
      <RunsTable
        runs={[makeRun()]}
        columns={columns}
        renderActions={(run) => <button data-testid="action-btn">Kill {run.id}</button>}
      />,
    );
    expect(screen.getByText('Actions')).toBeInTheDocument();
    expect(screen.getByTestId('action-btn')).toBeInTheDocument();
  });

  it('does not render actions column when renderActions not provided', () => {
    render(<RunsTable runs={[makeRun()]} columns={columns} />);
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
  });

  it('uses custom testId', () => {
    render(<RunsTable runs={[makeRun()]} columns={columns} testId="my-table" />);
    expect(screen.getByTestId('my-table')).toBeInTheDocument();
  });
});
