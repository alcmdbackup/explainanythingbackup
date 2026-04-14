// Tests for TimelineTab: loading, empty, populated with generate/swiss iterations, and run outcome.

import { render, screen, waitFor } from '@testing-library/react';
import { TimelineTab } from './TimelineTab';
import * as invocationActions from '@evolution/services/invocationActions';
import type { InvocationListEntry } from '@evolution/services/invocationActions';
import type { EvolutionRun } from '@evolution/services/evolutionActions';

jest.mock('@evolution/services/invocationActions', () => ({
  listInvocationsAction: jest.fn(),
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const RUN_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const INV_ID_1 = 'bbbbbbbb-0000-0000-0000-000000000001';
const INV_ID_2 = 'bbbbbbbb-0000-0000-0000-000000000002';
const INV_ID_3 = 'bbbbbbbb-0000-0000-0000-000000000003';
const INV_ID_4 = 'bbbbbbbb-0000-0000-0000-000000000004';
const VARIANT_ID = 'cccccccc-0000-0000-0000-000000000001';

const BASE_RUN: EvolutionRun = {
  id: RUN_ID,
  explanation_id: null,
  status: 'completed',
  budget_cap_usd: 1.0,
  error_message: null,
  completed_at: '2026-04-10T00:01:00Z',
  created_at: '2026-04-10T00:00:00Z',
  prompt_id: null,
  pipeline_version: 'v2',
  strategy_id: 'strat-1',
  experiment_id: null,
  archived: false,
  run_summary: {
    version: 3,
    stopReason: 'iterations_complete',
    finalPhase: 'COMPETITION',
    totalIterations: 2,
    durationSeconds: 60,
    eloHistory: [[25], [30]],
    diversityHistory: [1, 0.8],
    matchStats: { totalMatches: 12, avgConfidence: 0.75, decisiveRate: 0.83 },
    topVariants: [{ id: VARIANT_ID, strategy: 'structural_transform', elo: 31.5, isBaseline: false }],
    baselineRank: 2,
    baselineElo: 22.4,
    strategyEffectiveness: {},
    metaFeedback: null,
  },
  runner_id: null,
  last_heartbeat: null,
};

// Generate iteration: 2 parallel Generate agents + 1 Merge agent
const GEN_INVOCATIONS: InvocationListEntry[] = [
  {
    id: INV_ID_1,
    run_id: RUN_ID,
    agent_name: 'GenerateFromSeedArticleAgent',
    iteration: 1,
    execution_order: 0,
    success: true,
    cost_usd: 0.002,
    duration_ms: 5000,
    error_message: null,
    created_at: '2026-04-10T00:00:05Z',
  },
  {
    id: INV_ID_2,
    run_id: RUN_ID,
    agent_name: 'GenerateFromSeedArticleAgent',
    iteration: 1,
    execution_order: 1,
    success: true,
    cost_usd: 0.002,
    duration_ms: 6000,
    error_message: null,
    created_at: '2026-04-10T00:00:05Z',
  },
  {
    id: INV_ID_3,
    run_id: RUN_ID,
    agent_name: 'MergeRatingsAgent',
    iteration: 1,
    execution_order: 2,
    success: true,
    cost_usd: 0.0,
    duration_ms: 500,
    error_message: null,
    created_at: '2026-04-10T00:00:11Z',
  },
  // Swiss iteration 2
  {
    id: INV_ID_4,
    run_id: RUN_ID,
    agent_name: 'SwissRankingAgent',
    iteration: 2,
    execution_order: 0,
    success: true,
    cost_usd: 0.003,
    duration_ms: 8000,
    error_message: null,
    created_at: '2026-04-10T00:00:15Z',
  },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TimelineTab', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders loading skeleton initially', () => {
    (invocationActions.listInvocationsAction as jest.Mock).mockReturnValue(
      new Promise(() => {/* never resolves */}),
    );
    render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);
    expect(screen.getByTestId('timeline-loading')).toBeInTheDocument();
  });

  it('renders empty state when no invocations', async () => {
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: [], total: 0 },
    });
    render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);
    await waitFor(() =>
      expect(screen.getByTestId('timeline-empty')).toBeInTheDocument(),
    );
  });

  it('renders error state on action failure', async () => {
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: false,
      error: { message: 'DB error' },
    });
    render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);
    await waitFor(() =>
      expect(screen.getByTestId('timeline-error')).toHaveTextContent('DB error'),
    );
  });

  it('renders gantt chart and iteration groups', async () => {
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: GEN_INVOCATIONS, total: GEN_INVOCATIONS.length },
    });
    render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);

    await waitFor(() =>
      expect(screen.getByTestId('timeline-gantt')).toBeInTheDocument(),
    );

    // Both iteration groups present
    expect(screen.getByTestId('timeline-iter-1')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-iter-2')).toBeInTheDocument();

    // Generate iteration label shows parallel count
    expect(screen.getByTestId('timeline-iter-1')).toHaveTextContent('2× parallel');

    // Swiss iteration label
    expect(screen.getByTestId('timeline-iter-2')).toHaveTextContent('swiss');

    // One bar per invocation
    expect(screen.getByTestId(`timeline-bar-${INV_ID_1}`)).toBeInTheDocument();
    expect(screen.getByTestId(`timeline-bar-${INV_ID_2}`)).toBeInTheDocument();
    expect(screen.getByTestId(`timeline-bar-${INV_ID_3}`)).toBeInTheDocument();
    expect(screen.getByTestId(`timeline-bar-${INV_ID_4}`)).toBeInTheDocument();
  });

  it('renders run outcome section from run_summary', async () => {
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: GEN_INVOCATIONS, total: GEN_INVOCATIONS.length },
    });
    render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);

    await waitFor(() =>
      expect(screen.getByTestId('timeline-outcome')).toBeInTheDocument(),
    );

    expect(screen.getByTestId('timeline-outcome')).toHaveTextContent('iterations complete');
    expect(screen.getByTestId('timeline-outcome')).toHaveTextContent('12');  // total matches
    expect(screen.getByTestId('timeline-outcome')).toHaveTextContent('83%'); // decisive rate
    expect(screen.getByTestId('timeline-outcome')).toHaveTextContent('#3');  // baseline rank (2 + 1)
  });

  it('shows invocation bars as links to invocation detail pages', async () => {
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: GEN_INVOCATIONS, total: GEN_INVOCATIONS.length },
    });
    render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);

    await waitFor(() =>
      expect(screen.getByTestId(`timeline-bar-${INV_ID_1}`)).toBeInTheDocument(),
    );

    const bar = screen.getByTestId(`timeline-bar-${INV_ID_1}`);
    expect(bar).toHaveAttribute('href', `/admin/evolution/invocations/${INV_ID_1}`);
  });

  it('does not render outcome section when run_summary is null', async () => {
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: GEN_INVOCATIONS, total: GEN_INVOCATIONS.length },
    });
    const runNoSummary = { ...BASE_RUN, run_summary: null };
    render(<TimelineTab runId={RUN_ID} run={runNoSummary} />);

    await waitFor(() =>
      expect(screen.getByTestId('timeline-gantt')).toBeInTheDocument(),
    );

    expect(screen.queryByTestId('timeline-outcome')).not.toBeInTheDocument();
  });

  it('renders bar when duration_ms is null (em-dash in duration column)', async () => {
    const nullDuration: InvocationListEntry = {
      ...GEN_INVOCATIONS[0]!,
      id: 'dddddddd-0000-0000-0000-000000000001',
      duration_ms: null,
    };
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: [nullDuration], total: 1 },
    });
    render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);

    await waitFor(() =>
      expect(screen.getByTestId(`timeline-bar-${nullDuration.id}`)).toBeInTheDocument(),
    );
    // Duration column shows em-dash for null duration
    expect(screen.getByTestId(`timeline-inv-${nullDuration.id}`)).toHaveTextContent('—');
  });

  it('groups invocations with null iteration into Setup section', async () => {
    const noIter: InvocationListEntry = {
      ...GEN_INVOCATIONS[0]!,
      id: 'eeeeeeee-0000-0000-0000-000000000001',
      iteration: null,
    };
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: [noIter], total: 1 },
    });
    render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);

    await waitFor(() =>
      expect(screen.getByTestId('timeline-iter--1')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('timeline-iter--1')).toHaveTextContent('Setup');
  });

  it('renders ✗ failure indicator for failed invocations', async () => {
    const failed: InvocationListEntry = {
      ...GEN_INVOCATIONS[0]!,
      id: 'ffffffff-0000-0000-0000-000000000001',
      success: false,
      error_message: 'budget exceeded',
    };
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: [failed], total: 1 },
    });
    render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);

    await waitFor(() =>
      expect(screen.getByTestId(`timeline-inv-${failed.id}`)).toBeInTheDocument(),
    );
    expect(screen.getByTestId(`timeline-inv-${failed.id}`)).toHaveTextContent('✗');
  });

  it('shows truncation warning when total exceeds returned items', async () => {
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: GEN_INVOCATIONS, total: 250 },
    });
    render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);

    await waitFor(() =>
      expect(screen.getByTestId('timeline-truncation-warning')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('timeline-truncation-warning')).toHaveTextContent('4 of 250');
  });

  it('renders gantt when run.completed_at is null (falls back to last invocation end)', async () => {
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: GEN_INVOCATIONS, total: GEN_INVOCATIONS.length },
    });
    const runNoCompletedAt = { ...BASE_RUN, completed_at: null };
    render(<TimelineTab runId={RUN_ID} run={runNoCompletedAt} />);

    // Chart renders without crashing — fallback totalMs computed from last invocation
    await waitFor(() =>
      expect(screen.getByTestId('timeline-gantt')).toBeInTheDocument(),
    );
    // All bars still render
    expect(screen.getByTestId(`timeline-bar-${INV_ID_4}`)).toBeInTheDocument();
  });

  it('renders cost column for each invocation bar', async () => {
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: GEN_INVOCATIONS, total: GEN_INVOCATIONS.length },
    });
    render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);

    await waitFor(() =>
      expect(screen.getByTestId(`timeline-cost-${INV_ID_1}`)).toBeInTheDocument(),
    );

    // INV_ID_1 has cost_usd: 0.002 → $0.0020
    expect(screen.getByTestId(`timeline-cost-${INV_ID_1}`)).toHaveTextContent('$0.0020');
    // INV_ID_3 has cost_usd: 0.0 → —
    expect(screen.getByTestId(`timeline-cost-${INV_ID_3}`)).toHaveTextContent('—');
  });

  it('renders iteration cost subtotal in iteration header', async () => {
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: GEN_INVOCATIONS, total: GEN_INVOCATIONS.length },
    });
    render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);

    await waitFor(() =>
      expect(screen.getByTestId('timeline-iter-cost-1')).toBeInTheDocument(),
    );

    // Iter 1: INV_ID_1 ($0.002) + INV_ID_2 ($0.002) + INV_ID_3 ($0.0) = $0.0040
    expect(screen.getByTestId('timeline-iter-cost-1')).toHaveTextContent('$0.0040');
    // Iter 2: INV_ID_4 ($0.003) = $0.0030
    expect(screen.getByTestId('timeline-iter-cost-2')).toHaveTextContent('$0.0030');
  });

  it('does not show truncation warning when all invocations are returned', async () => {
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: GEN_INVOCATIONS, total: GEN_INVOCATIONS.length },
    });
    render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);

    await waitFor(() =>
      expect(screen.getByTestId('timeline-gantt')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('timeline-truncation-warning')).not.toBeInTheDocument();
  });
});
