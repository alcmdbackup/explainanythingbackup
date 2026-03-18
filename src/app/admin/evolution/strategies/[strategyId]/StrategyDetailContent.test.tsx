// Tests for StrategyDetailContent: tabs, metrics, rename, status badge.

import { render, screen, fireEvent, act } from '@testing-library/react';
import { StrategyDetailContent } from './StrategyDetailContent';

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const mockUpdateStrategy = jest.fn();
jest.mock('@evolution/services/strategyRegistryActions', () => ({
  updateStrategyAction: (...args: unknown[]) => mockUpdateStrategy(...args),
}));

jest.mock('@evolution/components/evolution', () => ({
  EntityDetailHeader: ({ title, statusBadge, onRename }: { title: string; statusBadge: React.ReactNode; onRename?: (name: string) => Promise<void> }) => (
    <div data-testid="detail-header">
      <h1 data-testid="title">{title}</h1>
      {statusBadge}
      {onRename && <button data-testid="rename-btn" onClick={() => onRename('New Name')}>Rename</button>}
    </div>
  ),
  MetricGrid: ({ metrics }: { metrics: Array<{ label: string; value: string | number }> }) => (
    <div data-testid="metric-grid">
      {metrics.map((m) => <div key={m.label}><span>{m.label}</span><span>{String(m.value)}</span></div>)}
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
        <button key={t.id} data-testid={`tab-${t.id}`} onClick={() => onTabChange(t.id)}>{t.label}</button>
      ))}
      <div data-testid="tab-content">{children}</div>
    </div>
  ),
  useTabState: (tabs: Array<{ id: string }>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const [tab, setTab] = require('react').useState(tabs[0].id);
    return [tab, setTab];
  },
}));

jest.mock('../../_components/StrategyConfigDisplay', () => ({
  StrategyConfigDisplay: () => <div data-testid="config-display">Config</div>,
}));

jest.mock('./StrategyMetricsSection', () => ({
  StrategyMetricsSection: () => <div data-testid="metrics-section">Metrics</div>,
}));

jest.mock('@evolution/components/evolution/tabs/RelatedRunsTab', () => ({
  RelatedRunsTab: ({ strategyId }: { strategyId: string }) => <div data-testid="related-runs">{strategyId}</div>,
}));

const STRATEGY = {
  id: 'strat-1',
  name: 'My Strategy',
  label: 'Strategy Label',
  description: null,
  status: 'active',
  config: { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterations: 10 },
  config_hash: 'abc123',
  is_predefined: false,
  pipeline_type: 'full',
  created_by: 'admin',
  run_count: 2,
  total_cost_usd: 0.80,
  avg_final_elo: 1350,
  avg_elo_per_dollar: 1687.5,
  best_final_elo: 1400,
  worst_final_elo: 1300,
  stddev_final_elo: 50,
  peak_elo: 1450,
  max_elo: 1400,
  created_at: '2026-01-01T00:00:00Z',
};

const RUNS = [
  { runId: 'r1', finalElo: 1400, totalCostUsd: 0.50, status: 'completed' },
  { runId: 'r2', finalElo: 1300, totalCostUsd: 0.30, status: 'completed' },
];

describe('StrategyDetailContent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders strategy name as title', () => {
    render(<StrategyDetailContent strategy={STRATEGY as never} runs={RUNS as never[]} strategyId="strat-1" />);
    expect(screen.getByTestId('title')).toHaveTextContent('My Strategy');
  });

  it('renders 4 tab buttons', () => {
    render(<StrategyDetailContent strategy={STRATEGY as never} runs={RUNS as never[]} strategyId="strat-1" />);
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.getByTestId('tab-config')).toBeInTheDocument();
    expect(screen.getByTestId('tab-metrics')).toBeInTheDocument();
    expect(screen.getByTestId('tab-runs')).toBeInTheDocument();
  });

  it('switches to config tab', () => {
    render(<StrategyDetailContent strategy={STRATEGY as never} runs={RUNS as never[]} strategyId="strat-1" />);
    fireEvent.click(screen.getByTestId('tab-config'));
    expect(screen.getByTestId('config-display')).toBeInTheDocument();
  });

  it('switches to runs tab', () => {
    render(<StrategyDetailContent strategy={STRATEGY as never} runs={RUNS as never[]} strategyId="strat-1" />);
    fireEvent.click(screen.getByTestId('tab-runs'));
    expect(screen.getByTestId('related-runs')).toHaveTextContent('strat-1');
  });

  it('calls updateStrategyAction on rename', async () => {
    mockUpdateStrategy.mockResolvedValue({ success: true });
    render(<StrategyDetailContent strategy={STRATEGY as never} runs={RUNS as never[]} strategyId="strat-1" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('rename-btn'));
    });

    expect(mockUpdateStrategy).toHaveBeenCalledWith({ id: 'strat-1', name: 'New Name' });
  });
});
