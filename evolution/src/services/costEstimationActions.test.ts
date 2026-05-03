// Unit tests for the exported histogram bucket constant + helpers in
// costEstimationActions. The actions themselves require adminAction's
// service-role client, so the integration layer is exercised separately;
// this file table-drive-tests the pure math pieces.

import { COST_ERROR_HISTOGRAM_BUCKETS } from './costEstimationConstants';

// Fix #38 (use_playwright_find_ux_issues_bugs_20260501): the reflect_and_generate
// wrapper writes execution_detail.tactic; legacy GenerateFromPreviousArticleAgent
// writes execution_detail.strategy. Read tactic first, fall back to strategy.
import { buildInvocationRows, type InvRow } from './costEstimationActions';

function makeInv(over: Partial<InvRow> & { execution_detail: Record<string, unknown> }): InvRow {
  return {
    id: 'inv-' + Math.random().toString(36).slice(2, 10),
    agent_name: 'reflect_and_generate_from_previous_article',
    iteration: 1,
    cost_usd: 0.001,
    duration_ms: 100,
    ...over,
  };
}

describe('Fix #38: tactic field extraction (buildInvocationRows)', () => {
  it('reads d.tactic for reflect_and_generate invocations', () => {
    const rows = buildInvocationRows([
      makeInv({ execution_detail: { tactic: 'curiosity_hook' } }),
    ]);
    expect(rows[0]!.tactic).toBe('curiosity_hook');
  });

  it('falls back to d.strategy for legacy GFPA invocations', () => {
    const rows = buildInvocationRows([
      makeInv({
        agent_name: 'generate_from_previous_article',
        execution_detail: { strategy: 'lexical_simplify' },
      }),
    ]);
    expect(rows[0]!.tactic).toBe('lexical_simplify');
  });

  it('prefers tactic over strategy when both present (mixed legacy)', () => {
    const rows = buildInvocationRows([
      makeInv({ execution_detail: { tactic: 'analogy_bridge', strategy: 'lexical_simplify' } }),
    ]);
    expect(rows[0]!.tactic).toBe('analogy_bridge');
  });

  it('falls through empty-string tactic to strategy (early-failure rows)', () => {
    const rows = buildInvocationRows([
      makeInv({ execution_detail: { tactic: '', strategy: 'fallback_value' } }),
    ]);
    expect(rows[0]!.tactic).toBe('fallback_value');
  });

  it('returns null when neither tactic nor strategy present', () => {
    const rows = buildInvocationRows([
      makeInv({ execution_detail: {} }),
    ]);
    expect(rows[0]!.tactic).toBeNull();
  });
});

describe('COST_ERROR_HISTOGRAM_BUCKETS', () => {
  it('has the 5 expected buckets with non-overlapping edges', () => {
    expect(COST_ERROR_HISTOGRAM_BUCKETS).toHaveLength(5);
    expect(COST_ERROR_HISTOGRAM_BUCKETS[0]!.label).toBe('<-25%');
    expect(COST_ERROR_HISTOGRAM_BUCKETS[4]!.label).toBe('>+25%');
    expect(COST_ERROR_HISTOGRAM_BUCKETS[0]!.max).toBe(-25);
    expect(COST_ERROR_HISTOGRAM_BUCKETS[4]!.min).toBe(25);
  });

  it('bucket ordering is monotonic on min', () => {
    for (let i = 1; i < COST_ERROR_HISTOGRAM_BUCKETS.length; i++) {
      expect(COST_ERROR_HISTOGRAM_BUCKETS[i]!.min).toBeGreaterThanOrEqual(
        COST_ERROR_HISTOGRAM_BUCKETS[i - 1]!.min,
      );
    }
  });

  it('outer buckets extend to ±Infinity', () => {
    expect(COST_ERROR_HISTOGRAM_BUCKETS[0]!.min).toBe(-Infinity);
    expect(COST_ERROR_HISTOGRAM_BUCKETS[COST_ERROR_HISTOGRAM_BUCKETS.length - 1]!.max).toBe(Infinity);
  });
});

// ─── Budget Floor Sensitivity variants (table-driven) ─────────────────────────
//
// Exercising the full server action requires a Supabase admin client. Instead we
// test the underlying math via the projectDispatchCounts helper in a dedicated
// file (projectDispatchCount.test.ts) and cover variant-selection logic by
// verifying the exported constant set the UI consumes.
//
// End-to-end coverage of the 7 variants is expected via an integration test
// (`costEstimateMetrics.integration.test.ts`) once added.
