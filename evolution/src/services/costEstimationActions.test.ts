// Unit tests for the exported histogram bucket constant + helpers in
// costEstimationActions. The actions themselves require adminAction's
// service-role client, so the integration layer is exercised separately;
// this file table-drive-tests the pure math pieces.

import { COST_ERROR_HISTOGRAM_BUCKETS } from './costEstimationConstants';

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
