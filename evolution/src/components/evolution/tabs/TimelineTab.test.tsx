// Tests for TimelineTab: loading, empty, populated with generate/swiss iterations, and run outcome.

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
    topVariants: [{ id: VARIANT_ID, tactic: 'structural_transform', elo: 31.5, isSeedVariant: false }],
    seedVariantRank: 2,
    seedVariantElo: 22.4,
    tacticEffectiveness: {},
    metaFeedback: null,
  },
  runner_id: null,
  last_heartbeat: null,
};

// Generate iteration: 2 parallel Generate agents + 1 Merge agent.
// Fixtures use snake_case agent_name strings (matches real production data per
// staging query in fixes_to_evolution_admin_dashboard__20260503 research).
const GEN_INVOCATIONS: InvocationListEntry[] = [
  {
    id: INV_ID_1,
    run_id: RUN_ID,
    agent_name: 'generate_from_previous_article',
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
    agent_name: 'generate_from_previous_article',
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
    agent_name: 'merge_ratings',
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
    agent_name: 'swiss_ranking',
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

  it('renders iteration cards and expandable gantt bars', async () => {
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: GEN_INVOCATIONS, total: GEN_INVOCATIONS.length },
    });
    render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);

    await waitFor(() =>
      expect(screen.getByTestId('timeline-tab')).toBeInTheDocument(),
    );

    // Both iteration cards present
    expect(screen.getByTestId('timeline-iter-1')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-iter-2')).toBeInTheDocument();

    // Generate iteration header shows agent count
    expect(screen.getByTestId('timeline-iter-1')).toHaveTextContent('2 agents');

    // Swiss iteration header shows agent type badge
    expect(screen.getByTestId('timeline-iter-2')).toHaveTextContent('swiss');

    // Bars are hidden until expanded — expand both iterations
    fireEvent.click(screen.getByTestId('timeline-iter-1').querySelector('button')!);
    fireEvent.click(screen.getByTestId('timeline-iter-2').querySelector('button')!);

    // One bar per invocation after expansion
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

  it('wraps each invocation row in a Link to invocation detail (label+bar both clickable)', async () => {
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: GEN_INVOCATIONS, total: GEN_INVOCATIONS.length },
    });
    render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);

    await waitFor(() =>
      expect(screen.getByTestId('timeline-iter-1')).toBeInTheDocument(),
    );

    // Expand iteration 1 to reveal bars
    fireEvent.click(screen.getByTestId('timeline-iter-1').querySelector('button')!);

    // The row itself IS the <a> (next/link renders <a>) so we assert href on the row.
    const row = screen.getByTestId(`timeline-inv-${INV_ID_1}`);
    expect(row).toHaveAttribute('href', `/admin/evolution/invocations/${INV_ID_1}`);
    expect(row.tagName.toLowerCase()).toBe('a');

    // Guard B: nested-anchor regression check — no <a> descendants inside the row
    // (would cause React hydration warning + broken click bubbling).
    expect(row.querySelectorAll('a').length).toBe(0);
  });

  it('shows full agent_name (not just kind label) in invocation row', async () => {
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: GEN_INVOCATIONS, total: GEN_INVOCATIONS.length },
    });
    render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);

    await waitFor(() =>
      expect(screen.getByTestId('timeline-iter-1')).toBeInTheDocument(),
    );

    // Expand iteration 1 to reveal bars
    fireEvent.click(screen.getByTestId('timeline-iter-1').querySelector('button')!);

    // Row label shows the snake_case agent_name verbatim, NOT the coarse "Generate" bucket.
    const row = screen.getByTestId(`timeline-inv-${INV_ID_1}`);
    expect(row).toHaveTextContent('generate_from_previous_article');
    expect(row).toHaveTextContent('#0'); // execution_order on second line
    // Title attribute carries the full agent_name for hover-discovery of long names.
    const labelSpan = row.querySelector('[title]');
    expect(labelSpan).toHaveAttribute('title', 'generate_from_previous_article');
  });

  it('handles long agent_name (50 chars) without breaking layout', async () => {
    const longInv: InvocationListEntry = {
      ...GEN_INVOCATIONS[0]!,
      id: 'aaaaaaaa-1111-1111-1111-111111111111',
      agent_name: 'evaluate_criteria_then_generate_from_previous_article',
    };
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: [longInv], total: 1 },
    });
    render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);

    await waitFor(() =>
      expect(screen.getByTestId('timeline-iter-1')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('timeline-iter-1').querySelector('button')!);

    // Full agent_name lives in the title attribute (visible label may truncate via CSS).
    const row = screen.getByTestId(`timeline-inv-${longInv.id}`);
    const labelSpan = row.querySelector('[title]');
    expect(labelSpan).toHaveAttribute('title', 'evaluate_criteria_then_generate_from_previous_article');
  });

  it('does not render outcome section when run_summary is null', async () => {
    (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { items: GEN_INVOCATIONS, total: GEN_INVOCATIONS.length },
    });
    const runNoSummary = { ...BASE_RUN, run_summary: null };
    render(<TimelineTab runId={RUN_ID} run={runNoSummary} />);

    await waitFor(() =>
      expect(screen.getByTestId('timeline-tab')).toBeInTheDocument(),
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
      expect(screen.getByTestId('timeline-iter-1')).toBeInTheDocument(),
    );

    // Expand iteration to reveal bars
    fireEvent.click(screen.getByTestId('timeline-iter-1').querySelector('button')!);

    expect(screen.getByTestId(`timeline-bar-${nullDuration.id}`)).toBeInTheDocument();
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
      expect(screen.getByTestId('timeline-iter-1')).toBeInTheDocument(),
    );

    // Expand iteration to reveal bars
    fireEvent.click(screen.getByTestId('timeline-iter-1').querySelector('button')!);

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
      expect(screen.getByTestId('timeline-tab')).toBeInTheDocument(),
    );

    // Expand iteration 2 to reveal bars
    fireEvent.click(screen.getByTestId('timeline-iter-2').querySelector('button')!);

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
      expect(screen.getByTestId('timeline-iter-1')).toBeInTheDocument(),
    );

    // Expand iteration 1 to reveal cost columns
    fireEvent.click(screen.getByTestId('timeline-iter-1').querySelector('button')!);

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
      expect(screen.getByTestId('timeline-tab')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('timeline-truncation-warning')).not.toBeInTheDocument();
  });

  // Fix #22 (use_playwright_find_ux_issues_bugs_20260501): reflect_and_generate
  // wrapper iterations must show the new "Reflect+Gen" badge in both the legend
  // and the iteration card header (instead of falling through to "Generate").
  describe('Fix #22: reflect_and_generate badge', () => {
    const REFLECT_INV: InvocationListEntry = {
      id: 'dddddddd-0000-0000-0000-000000000001',
      run_id: RUN_ID,
      agent_name: 'reflect_and_generate_from_previous_article',
      iteration: 1,
      execution_order: 0,
      success: true,
      cost_usd: 0.003,
      duration_ms: 5000,
      error_message: null,
      created_at: '2026-04-10T00:00:05Z',
    };

    it('renders Reflect+Gen badge in the legend when wrapper iterations exist', async () => {
      (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
        success: true,
        data: { items: [REFLECT_INV], total: 1 },
      });
      render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);
      await waitFor(() => expect(screen.getByTestId('timeline-tab')).toBeInTheDocument());
      // Legend always renders all four kinds
      expect(screen.getByText('Reflect+Gen')).toBeInTheDocument();
    });

    it('renders reflect+gen iteration badge (not generate) for wrapper iterations', async () => {
      (invocationActions.listInvocationsAction as jest.Mock).mockResolvedValue({
        success: true,
        data: { items: [REFLECT_INV], total: 1 },
      });
      render(<TimelineTab runId={RUN_ID} run={BASE_RUN} />);
      await waitFor(() => expect(screen.getByTestId('timeline-tab')).toBeInTheDocument());
      // The iteration card displays "reflect+gen" (lowercased), NOT "generate"
      const reflectBadges = screen.getAllByText(/reflect\+gen/i);
      expect(reflectBadges.length).toBeGreaterThanOrEqual(2); // legend + iter card
    });
  });
});
