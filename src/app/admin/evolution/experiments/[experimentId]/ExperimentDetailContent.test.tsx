// Tests for ExperimentDetailContent: tabs, metrics, cancel button, status badge.

import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ExperimentDetailContent, type V2Experiment } from './ExperimentDetailContent';

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const mockCancelExperiment = jest.fn();
jest.mock('@evolution/services/experimentActions', () => ({
  cancelExperimentAction: (...args: unknown[]) => mockCancelExperiment(...args),
}));

jest.mock('@evolution/components/evolution', () => ({
  EntityDetailHeader: ({ title, statusBadge, actions }: { title: string; statusBadge: React.ReactNode; actions?: React.ReactNode }) => (
    <div data-testid="detail-header">
      <h1>{title}</h1>
      {statusBadge}
      {actions}
    </div>
  ),
  StatusBadge: ({ status }: { variant: string; status: string }) => (
    <span data-testid="status-badge">{status.charAt(0).toUpperCase() + status.slice(1)}</span>
  ),
  MetricGrid: ({ metrics }: { metrics: Array<{ label: string; value: string }> }) => (
    <div data-testid="metric-grid">
      {metrics.map((m) => <div key={m.label}><span>{m.label}</span><span>{m.value}</span></div>)}
    </div>
  ),
  EntityDetailTabs: ({ tabs, activeTab, onTabChange, children }: {
    tabs: Array<{ id: string; label: string }>;
    activeTab: string;
    onTabChange: (id: string) => void;
    children: React.ReactNode;
  }) => (
    <div data-testid="detail-tabs">
      {tabs.map((t) => (
        <button key={t.id} data-testid={`tab-${t.id}`} onClick={() => onTabChange(t.id)} className={activeTab === t.id ? 'active' : ''}>
          {t.label}
        </button>
      ))}
      <div data-testid="tab-content">{children}</div>
    </div>
  ),
  EntityMetricsTab: ({ entityType, entityId }: { entityType: string; entityId: string }) => (
    <div data-testid="entity-metrics-tab">{entityType}:{entityId}</div>
  ),
  useTabState: (tabs: Array<{ id: string }>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const [tab, setTab] = require('react').useState(tabs[0]!.id);
    return [tab, setTab];
  },
}));

jest.mock('./ExperimentAnalysisCard', () => ({
  ExperimentAnalysisCard: () => <div data-testid="analysis-card">Analysis</div>,
}));

jest.mock('@evolution/components/evolution/tabs/RelatedRunsTab', () => ({
  RelatedRunsTab: ({ experimentId }: { experimentId: string }) => <div data-testid="related-runs">{experimentId}</div>,
}));

function makeExperiment(overrides: Partial<V2Experiment> = {}): V2Experiment {
  return {
    id: 'exp-1',
    name: 'Test Experiment',
    status: 'completed',
    prompt_id: '12345678-abcd-0000-0000-000000000000',
    created_at: '2026-01-15T00:00:00Z',
    updated_at: '2026-01-15T01:00:00Z',
    evolution_runs: [
      { id: 'r1', status: 'completed' },
      { id: 'r2', status: 'completed' },
    ],
    metrics: { maxElo: 1400, totalCost: 2.50, runs: [] },
    ...overrides,
  };
}

describe('ExperimentDetailContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders experiment title', () => {
    render(<ExperimentDetailContent experiment={makeExperiment()} />);
    expect(screen.getByText('Test Experiment')).toBeInTheDocument();
  });

  it('renders status badge', () => {
    render(<ExperimentDetailContent experiment={makeExperiment()} />);
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Completed');
  });

  it('renders status badge for running experiment', () => {
    render(<ExperimentDetailContent experiment={makeExperiment({ status: 'running' })} />);
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Running');
  });

  it('shows cancel button for active experiments', () => {
    render(<ExperimentDetailContent experiment={makeExperiment({ status: 'running' })} />);
    expect(screen.getByTestId('cancel-button')).toBeInTheDocument();
  });

  it('hides cancel button for completed experiments', () => {
    render(<ExperimentDetailContent experiment={makeExperiment()} />);
    expect(screen.queryByTestId('cancel-button')).not.toBeInTheDocument();
  });

  it('shows entity metrics tab on default tab', () => {
    render(<ExperimentDetailContent experiment={makeExperiment()} />);
    expect(screen.getByTestId('entity-metrics-tab')).toBeInTheDocument();
  });

  it('switches to analysis tab', () => {
    render(<ExperimentDetailContent experiment={makeExperiment()} />);
    fireEvent.click(screen.getByTestId('tab-analysis'));
    expect(screen.getByTestId('analysis-card')).toBeInTheDocument();
  });

  it('switches to runs tab', () => {
    render(<ExperimentDetailContent experiment={makeExperiment()} />);
    fireEvent.click(screen.getByTestId('tab-runs'));
    expect(screen.getByTestId('related-runs')).toHaveTextContent('exp-1');
  });

  it('calls cancelExperimentAction on cancel click', async () => {
    mockCancelExperiment.mockResolvedValue({ success: true, data: { cancelled: true }, error: null });
    render(<ExperimentDetailContent experiment={makeExperiment({ status: 'pending' })} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('cancel-button'));
    });

    expect(mockCancelExperiment).toHaveBeenCalledWith({ experimentId: 'exp-1' });
  });

  it('shows error toast when cancel fails', async () => {
    const { toast } = jest.requireMock('sonner');
    mockCancelExperiment.mockResolvedValue({ success: false, data: null, error: { message: 'Cannot cancel' } });
    render(<ExperimentDetailContent experiment={makeExperiment({ status: 'running' })} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('cancel-button'));
    });

    expect(toast.error).toHaveBeenCalledWith('Cannot cancel');
  });

  it('renders 3 tab buttons', () => {
    render(<ExperimentDetailContent experiment={makeExperiment()} />);
    expect(screen.getByTestId('tab-metrics')).toBeInTheDocument();
    expect(screen.getByTestId('tab-analysis')).toBeInTheDocument();
    expect(screen.getByTestId('tab-runs')).toBeInTheDocument();
  });
});
