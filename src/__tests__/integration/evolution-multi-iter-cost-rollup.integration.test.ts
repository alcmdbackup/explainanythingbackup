// Phase 12 integration test (analyze_effectiveness_paragraph_recombine_20260530):
// asserts that when two iterations on the same run tracker spend under overlapping
// AgentName labels, the run-cumulative phase-cost accumulator captures the SUM, not
// the MAX. Pre-Phase-12 this silently shadowed the smaller per-iter contribution.
//
// Scope: exercises real createCostTracker + createIterationBudgetTracker (no mocks).
// Mocks only the metric-write boundary so we can capture writeMetricMax payloads
// without a real DB. The kill-switch tristate is covered by trackBudget.test.ts;
// here we assert the contract end-to-end through the tracker shape.

import {
  createCostTracker,
  createIterationBudgetTracker,
  createAgentCostScope,
} from '@evolution/lib/pipeline/infra/trackBudget';

describe('Phase 12 multi-iter cost-rollup integration (run-cumulative phase costs)', () => {
  const ORIGINAL = process.env.EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED;
  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED;
    } else {
      process.env.EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED = ORIGINAL;
    }
  });

  it('iter 2 ranking_cost spend ACCUMULATES with iter 1 (run-cumulative; SUM not MAX)', () => {
    delete process.env.EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED;
    const run = createCostTracker(1.0);

    // Iteration 1: GFPA-style spend on 'ranking' label.
    const iter1 = createIterationBudgetTracker(0.6, run, 0);
    const scope1 = createAgentCostScope(iter1);
    const m1 = scope1.reserve('ranking', 0.01);
    scope1.recordSpend('ranking', 0.009, m1);

    // Iteration 2: paragraph_recombine-style spend on the SAME 'ranking' label,
    // smaller than iter 1's contribution. The pre-Phase-12 bug was: writeMetricMax
    // sees iter2's per-iter cumulative ($0.003) < iter1's already-recorded ($0.009),
    // so GREATEST keeps $0.009 and the $0.003 is silently dropped.
    const iter2 = createIterationBudgetTracker(0.4, run, 1);
    const scope2 = createAgentCostScope(iter2);
    const m2 = scope2.reserve('ranking', 0.005);
    scope2.recordSpend('ranking', 0.003, m2);

    // Run-cumulative: each iter's getPhaseCosts() sees the SUM of both spends.
    // This is the load-bearing semantic for writeMetricMax to capture both contributions.
    expect(scope1.getPhaseCosts()['ranking']).toBeCloseTo(0.012);
    expect(scope2.getPhaseCosts()['ranking']).toBeCloseTo(0.012);

    // Alias must move in lockstep.
    expect(scope2.getSubagentCosts?.()['ranking']).toBeCloseTo(0.012);

    // getIterationPhaseCosts preserves per-iter shape for callers that need it.
    expect(iter1.getIterationPhaseCosts?.()['ranking']).toBeCloseTo(0.009);
    expect(iter2.getIterationPhaseCosts?.()['ranking']).toBeCloseTo(0.003);

    // Sanity: run-level totals match.
    expect(run.getTotalSpent()).toBeCloseTo(0.012);
    expect(scope1.getOwnSpent()).toBeCloseTo(0.009);
    expect(scope2.getOwnSpent()).toBeCloseTo(0.003);
  });

  it('kill switch reverts to per-iter (legacy behavior; smaller contribution shadowed under MAX)', () => {
    process.env.EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED = 'false';
    const run = createCostTracker(1.0);

    const iter1 = createIterationBudgetTracker(0.6, run, 0);
    const m1 = iter1.reserve('ranking', 0.01);
    iter1.recordSpend('ranking', 0.009, m1);

    const iter2 = createIterationBudgetTracker(0.4, run, 1);
    const m2 = iter2.reserve('ranking', 0.005);
    iter2.recordSpend('ranking', 0.003, m2);

    // Under the kill switch, iter2's getPhaseCosts() returns ONLY iter2's spend.
    // Under writeMetricMax(GREATEST), MAX($0.009, $0.003) = $0.009 — the $0.003 is lost.
    expect(iter2.getPhaseCosts()['ranking']).toBeCloseTo(0.003);
    expect(iter2.getSubagentCosts?.()['ranking']).toBeCloseTo(0.003);
  });
});
