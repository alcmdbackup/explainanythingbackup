/**
 * Unit tests for the Layer-3 tracking reconciliation divergence decision
 * (llm_costs_too_low_in_dash_20260623).
 */

import { evaluateDivergence } from './checkTrackingReconciliation';

describe('evaluateDivergence', () => {
  const RATIO = 1.5;
  const FLOOR = 0.5;

  it('flags divergence when invocations have cost but no tracking rows (the bug)', () => {
    const r = evaluateDivergence(22.5, 0, RATIO, FLOOR);
    expect(r.divergent).toBe(true);
    expect(r.ratio).toBe(9999); // tracking 0 → encoded as sentinel
  });

  it('flags divergence when invocations materially exceed tracking', () => {
    expect(evaluateDivergence(10, 1, RATIO, FLOOR).divergent).toBe(true); // 10x > 1.5x
  });

  it('passes when tracking matches invocations (write path healthy)', () => {
    const r = evaluateDivergence(10, 9, RATIO, FLOOR);
    expect(r.divergent).toBe(false); // 1.11x < 1.5x
    expect(r.ratio).toBeCloseTo(1.11, 2);
  });

  it('ignores tiny windows below the floor (noise suppression)', () => {
    // Invocations present but below floor, no tracking → NOT divergent.
    expect(evaluateDivergence(0.3, 0, RATIO, FLOOR).divergent).toBe(false);
  });

  it('passes cleanly when there is no spend at all', () => {
    const r = evaluateDivergence(0, 0, RATIO, FLOOR);
    expect(r.divergent).toBe(false);
    expect(r.ratio).toBe(0);
  });
});
