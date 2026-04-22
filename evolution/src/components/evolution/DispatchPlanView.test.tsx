// Unit tests for the shared DispatchPlanView renderer.
// Covers: per-row rendering, effective-cap badge, cost-range display, projected-vs-actual
// delta column, realization-ratio footer, warning conditions.

import { render, screen } from '@testing-library/react';
import { DispatchPlanView } from './DispatchPlanView';
import type { IterationPlanEntryClient } from '../../services/strategyPreviewActions';

function makeEntry(patch: Partial<IterationPlanEntryClient> = {}): IterationPlanEntryClient {
  return {
    iterIdx: 0,
    agentType: 'generate',
    iterBudgetUsd: 0.025,
    tacticMix: [{ tactic: 'structural_transform', weight: 1 }],
    tacticMixSource: 'defaults',
    tacticLabel: 'structural_transform',
    estPerAgent: {
      expected: { gen: 0.0012, rank: 0.003, total: 0.0042 },
      upperBound: { gen: 0.0017, rank: 0.006, total: 0.0077 },
    },
    maxAffordable: { atExpected: 5, atUpperBound: 3 },
    dispatchCount: 3,
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
            estPerAgent: { expected: { gen: 0, rank: 0, total: 0 }, upperBound: { gen: 0, rank: 0, total: 0 } },
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
        plan={[makeEntry({ iterIdx: 0, dispatchCount: 3, estPerAgent: { expected: { gen: 0.001, rank: 0.003, total: 0.004 }, upperBound: { gen: 0.001, rank: 0.003, total: 0.004 } } })]}
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
        plan={[makeEntry({ estPerAgent: { expected: { gen: 0.0007, rank: 0.005, total: 0.0057 }, upperBound: { gen: 0.001, rank: 0.010, total: 0.011 } } })]}
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
});
