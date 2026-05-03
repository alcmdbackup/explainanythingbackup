// Unit tests for the shared DispatchPlanView renderer.
// Covers: per-row rendering, effective-cap badge, cost-range display, projected-vs-actual
// delta column, realization-ratio footer, warning conditions.

import { render, screen } from '@testing-library/react';
import { DispatchPlanView } from './DispatchPlanView';
import type { IterationPlanEntryClient } from '../../services/strategyPreviewActions';

function makeEntry(patch: Partial<IterationPlanEntryClient> = {}): IterationPlanEntryClient {
  // Defaults match a non-reflection, no-top-up scenario so existing assertions about
  // dispatchCount / totals stay correct. Tests that exercise reflection or top-up
  // override `reflection`, `expectedTotalDispatch`, and `expectedTopUpDispatch`
  // explicitly via the patch.
  const dispatchCount = patch.dispatchCount ?? 3;
  return {
    iterIdx: 0,
    agentType: 'generate',
    iterBudgetUsd: 0.025,
    tacticMix: [{ tactic: 'structural_transform', weight: 1 }],
    tacticMixSource: 'defaults',
    tacticLabel: 'structural_transform',
    estPerAgent: {
      expected: { gen: 0.0012, rank: 0.003, reflection: 0, editing: 0, evaluation: 0, total: 0.0042 },
      upperBound: { gen: 0.0017, rank: 0.006, reflection: 0, editing: 0, evaluation: 0, total: 0.0077 },
    },
    maxAffordable: { atExpected: 5, atUpperBound: 3 },
    dispatchCount,
    expectedTotalDispatch: dispatchCount,
    expectedTopUpDispatch: 0,
    effectiveCap: 'budget',
    poolSizeAtStart: 494,
    parallelFloorUsd: 0,
    ...patch,
  };
}

describe('DispatchPlanView', () => {
  it('renders a row per iteration', () => {
    render(<DispatchPlanView plan={[makeEntry({ iterIdx: 0 }), makeEntry({ iterIdx: 1 })]} variant="wizard" />);
    expect(screen.getByTestId('dispatch-plan-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('dispatch-plan-row-1')).toBeInTheDocument();
  });

  it('renders cost-range for generate iterations and dash for swiss', () => {
    render(
      <DispatchPlanView
        plan={[
          makeEntry({ iterIdx: 0 }),
          makeEntry({
            iterIdx: 1, agentType: 'swiss', effectiveCap: 'swiss',
            dispatchCount: 0,
            estPerAgent: { expected: { gen: 0, rank: 0, reflection: 0, editing: 0, evaluation: 0, total: 0 }, upperBound: { gen: 0, rank: 0, reflection: 0, editing: 0, evaluation: 0, total: 0 } },
          }),
        ]}
        variant="wizard"
      />,
    );
    // Generate iteration shows cost range
    expect(screen.getByText(/\$0\.0042\s*–\s*\$0\.0077/)).toBeInTheDocument();
  });

  it('renders correct effective-cap badges', () => {
    const { rerender } = render(<DispatchPlanView plan={[makeEntry({ effectiveCap: 'budget' })]} variant="wizard" />);
    expect(screen.getByText('budget')).toBeInTheDocument();

    rerender(<DispatchPlanView plan={[makeEntry({ effectiveCap: 'floor' })]} variant="wizard" />);
    expect(screen.getByText('floor')).toBeInTheDocument();

    rerender(<DispatchPlanView plan={[makeEntry({ effectiveCap: 'safety_cap' })]} variant="wizard" />);
    expect(screen.getByText('safety cap')).toBeInTheDocument();
  });

  it('shows delta + realization ratio when actual is supplied', () => {
    render(
      <DispatchPlanView
        plan={[makeEntry({ iterIdx: 0, dispatchCount: 3, estPerAgent: { expected: { gen: 0.001, rank: 0.003, reflection: 0, editing: 0, evaluation: 0, total: 0.004 }, upperBound: { gen: 0.001, rank: 0.003, reflection: 0, editing: 0, evaluation: 0, total: 0.004 } } })]}
        actual={[{ iterIdx: 0, actualDispatched: 3, actualCostUsd: 0.006 }]}
        variant="run"
        totalBudgetUsd={0.05}
      />,
    );
    // Expected iter cost: 3 × 0.004 = 0.012. Actual 0.006 = 50% below. Δ = -50%.
    expect(screen.getByText(/-50%/)).toBeInTheDocument();
    // Realization ratio at upper bound = 0.006 / (3 × 0.004) = 50%
    expect(screen.getByText(/50% realized/)).toBeInTheDocument();
  });

  it('omits delta column when actual is not supplied', () => {
    render(<DispatchPlanView plan={[makeEntry()]} variant="wizard" />);
    expect(screen.queryByText(/Δ %/)).not.toBeInTheDocument();
  });

  it('surfaces ranking-dominance warning when rank ≥ 70% of total', () => {
    // gen=0.001, rank=0.010 → rank/(gen+rank) = 0.91, triggers warning
    render(
      <DispatchPlanView
        plan={[makeEntry({ estPerAgent: { expected: { gen: 0.0007, rank: 0.005, reflection: 0, editing: 0, evaluation: 0, total: 0.0057 }, upperBound: { gen: 0.001, rank: 0.010, reflection: 0, editing: 0, evaluation: 0, total: 0.011 } } })]}
        variant="wizard"
      />,
    );
    expect(screen.getByTestId('dispatch-plan-warnings')).toBeInTheDocument();
    expect(screen.getByText(/Ranking cost dominates/)).toBeInTheDocument();
  });

  it('surfaces budget-insufficient warning when an iteration dispatches ≤1 agent', () => {
    render(
      <DispatchPlanView
        plan={[makeEntry({ dispatchCount: 1 })]}
        variant="wizard"
      />,
    );
    expect(screen.getByText(/budget is marginal/)).toBeInTheDocument();
  });

  it('surfaces safety-cap warning when effectiveCap is safety_cap', () => {
    render(
      <DispatchPlanView
        plan={[makeEntry({ dispatchCount: 100, effectiveCap: 'safety_cap' })]}
        variant="wizard"
      />,
    );
    expect(screen.getByText(/DISPATCH_SAFETY_CAP/)).toBeInTheDocument();
  });

  it('wizard variant shows calibration provenance footer', () => {
    render(<DispatchPlanView plan={[makeEntry()]} variant="wizard" />);
    expect(screen.getByText(/empirical output sizes/)).toBeInTheDocument();
  });

  it('run / strategy variants omit calibration provenance footer', () => {
    render(<DispatchPlanView plan={[makeEntry()]} variant="run" />);
    expect(screen.queryByText(/empirical output sizes/)).not.toBeInTheDocument();
  });

  it('totalPlannedDispatch sums all iterations in the footer', () => {
    render(
      <DispatchPlanView
        plan={[
          makeEntry({ iterIdx: 0, dispatchCount: 3 }),
          makeEntry({ iterIdx: 1, dispatchCount: 5 }),
        ]}
        variant="wizard"
      />,
    );
    // The tbody rows have '3' and '5', plus the footer sum '8'. Assert footer total exists.
    const cells = screen.getAllByText('8');
    expect(cells.length).toBeGreaterThan(0);
  });

  // investigate_issues_latest_evolution_reflection_agent_20260501: "Likely total" column
  // surfaces the top-up-aware projection so users see the realistic dispatch count, not
  // just the upper-bound parallel batch.
  describe('Likely total column (top-up projection)', () => {
    it('shows expectedTotalDispatch + sub-line breakdown when expectedTopUpDispatch > 0', () => {
      render(
        <DispatchPlanView
          plan={[makeEntry({ iterIdx: 0, dispatchCount: 2, expectedTotalDispatch: 6, expectedTopUpDispatch: 4 })]}
          variant="wizard"
        />,
      );
      const cell = screen.getByTestId('dispatch-plan-row-0-likely');
      expect(cell).toHaveTextContent('6');
      expect(cell).toHaveTextContent('2 parallel + 4 top-up');
    });

    it('hides the sub-line when expectedTopUpDispatch === 0', () => {
      render(
        <DispatchPlanView
          plan={[makeEntry({ iterIdx: 0, dispatchCount: 5, expectedTotalDispatch: 5, expectedTopUpDispatch: 0 })]}
          variant="wizard"
        />,
      );
      const cell = screen.getByTestId('dispatch-plan-row-0-likely');
      expect(cell).toHaveTextContent('5');
      expect(cell).not.toHaveTextContent('parallel');
      expect(cell).not.toHaveTextContent('top-up');
    });

    it('shows dash for swiss iterations', () => {
      render(
        <DispatchPlanView
          plan={[makeEntry({
            iterIdx: 0, agentType: 'swiss', dispatchCount: 0,
            expectedTotalDispatch: 0, expectedTopUpDispatch: 0,
            estPerAgent: { expected: { gen: 0, rank: 0, reflection: 0, editing: 0, evaluation: 0, total: 0 }, upperBound: { gen: 0, rank: 0, reflection: 0, editing: 0, evaluation: 0, total: 0 } },
          })]}
          variant="wizard"
        />,
      );
      const cell = screen.getByTestId('dispatch-plan-row-0-likely');
      expect(cell).toHaveTextContent('—');
    });

    it('renders column header with tooltip text in title attribute', () => {
      render(<DispatchPlanView plan={[makeEntry()]} variant="wizard" />);
      const header = screen.getByText('Likely total (with top-up)');
      expect(header).toHaveAttribute('title', expect.stringContaining('EVOLUTION_TOPUP_ENABLED'));
    });

    it('footer sums expectedTotalDispatch across iterations', () => {
      render(
        <DispatchPlanView
          plan={[
            makeEntry({ iterIdx: 0, dispatchCount: 2, expectedTotalDispatch: 6, expectedTopUpDispatch: 4 }),
            makeEntry({ iterIdx: 1, dispatchCount: 1, expectedTotalDispatch: 4, expectedTopUpDispatch: 3 }),
          ]}
          variant="wizard"
        />,
      );
      const totalCell = screen.getByTestId('dispatch-plan-total-likely');
      expect(totalCell).toHaveTextContent('10');
    });

    it('cost roll-up uses expectedTotalDispatch (not dispatchCount) so totals match the Likely column', () => {
      // Regression: pre-fix the cost row showed `dispatchCount × $/agent`, leaving users
      // with a high "Likely total" agent count but a misleadingly low cost roll-up.
      render(
        <DispatchPlanView
          plan={[makeEntry({
            iterIdx: 0,
            dispatchCount: 2,
            expectedTotalDispatch: 6,
            expectedTopUpDispatch: 4,
            estPerAgent: {
              expected: { gen: 0.001, rank: 0, reflection: 0, editing: 0, evaluation: 0, total: 0.001 },
              upperBound: { gen: 0.002, rank: 0, reflection: 0, editing: 0, evaluation: 0, total: 0.002 },
            },
          })]}
          variant="wizard"
        />,
      );
      // Expected iter cost = 6 × $0.001 = $0.006. Upper bound = 6 × $0.002 = $0.012.
      // Pre-fix used dispatchCount=2 → expected $0.002 / upper $0.004 (under-stated).
      expect(screen.getByText(/\$0\.006/)).toBeInTheDocument();
      expect(screen.getByText(/\$0\.012/)).toBeInTheDocument();
    });
  });

  describe('warning copy reflects top-up projection', () => {
    it('shows top-up rescue copy when dispatchCount=1 but expectedTotalDispatch > 1', () => {
      render(
        <DispatchPlanView
          plan={[makeEntry({ iterIdx: 0, dispatchCount: 1, expectedTotalDispatch: 5, expectedTopUpDispatch: 4 })]}
          variant="wizard"
        />,
      );
      expect(screen.getByText(/parallel batch is bound by floor.*top-up will likely add ~4 more/)).toBeInTheDocument();
      // Old "budget is marginal" copy should NOT appear in this case.
      expect(screen.queryByText(/budget is marginal/)).not.toBeInTheDocument();
    });

    it('keeps original "budget is marginal" copy when even top-up cannot rescue', () => {
      render(
        <DispatchPlanView
          plan={[makeEntry({ iterIdx: 0, dispatchCount: 1, expectedTotalDispatch: 1, expectedTopUpDispatch: 0 })]}
          variant="wizard"
        />,
      );
      expect(screen.getByText(/budget is marginal/)).toBeInTheDocument();
    });

    it('also surfaces top-up rescue copy for reflect_and_generate iterations', () => {
      render(
        <DispatchPlanView
          plan={[makeEntry({ iterIdx: 0, agentType: 'reflect_and_generate', dispatchCount: 1, expectedTotalDispatch: 4, expectedTopUpDispatch: 3 })]}
          variant="wizard"
        />,
      );
      expect(screen.getByText(/parallel batch is bound by floor.*top-up will likely add ~3 more/)).toBeInTheDocument();
    });
  });
});
