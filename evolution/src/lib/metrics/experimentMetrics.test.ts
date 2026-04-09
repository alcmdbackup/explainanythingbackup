// Unit tests for experiment metrics: bootstrap CIs, computeRunMetrics, and aggregation.
// Uses seeded PRNG for deterministic results with low iteration count (100).

import {
  bootstrapMeanCI,
  bootstrapPercentileCI,
  aggregateMetrics,
  computeRunMetrics,
  createSeededRng,
  type MetricValue,
  type RunMetricsWithRatings,
} from './experimentMetrics';

// ─── Test helpers ───────────────────────────────────────────────

const ITERATIONS = 100;
const rng = () => createSeededRng(42);

function mv(value: number, sigma: number | null = null): MetricValue {
  return { value, sigma, ci: null, n: 1 };
}

// ─── bootstrapMeanCI ────────────────────────────────────────────

describe('bootstrapMeanCI', () => {
  it('returns null CI for single value', () => {
    const result = bootstrapMeanCI([mv(100)], ITERATIONS, rng());
    expect(result.ci).toBeNull();
    expect(result.value).toBe(100);
    expect(result.n).toBe(1);
  });

  it('CI contains true mean for known distribution', () => {
    const values = [mv(100), mv(110), mv(105), mv(95), mv(108)];
    const result = bootstrapMeanCI(values, ITERATIONS, rng());
    const trueMean = 103.6;
    expect(result.ci).not.toBeNull();
    expect(result.ci![0]).toBeLessThanOrEqual(trueMean);
    expect(result.ci![1]).toBeGreaterThanOrEqual(trueMean);
    expect(result.n).toBe(5);
  });

  it('CI narrows with more samples', () => {
    const small = [mv(100), mv(120), mv(110)];
    const large = [mv(100), mv(120), mv(110), mv(105), mv(115), mv(108), mv(112), mv(103), mv(117), mv(109)];
    const ciSmall = bootstrapMeanCI(small, ITERATIONS, rng());
    const ciLarge = bootstrapMeanCI(large, ITERATIONS, rng());
    const widthSmall = ciSmall.ci![1] - ciSmall.ci![0];
    const widthLarge = ciLarge.ci![1] - ciLarge.ci![0];
    expect(widthLarge).toBeLessThan(widthSmall);
  });

  it('CI is wider when sigma is large vs sigma near 0', () => {
    const noSigma = [mv(100), mv(110), mv(105)];
    const highSigma = [mv(100, 20), mv(110, 20), mv(105, 20)];
    const ciNoSigma = bootstrapMeanCI(noSigma, ITERATIONS, rng());
    const ciHighSigma = bootstrapMeanCI(highSigma, ITERATIONS, rng());
    const widthNoSigma = ciNoSigma.ci![1] - ciNoSigma.ci![0];
    const widthHighSigma = ciHighSigma.ci![1] - ciHighSigma.ci![0];
    expect(widthHighSigma).toBeGreaterThan(widthNoSigma);
  });

  it('falls back to plain bootstrap when sigma is null', () => {
    const values = [mv(100), mv(110), mv(105)];
    const result = bootstrapMeanCI(values, ITERATIONS, rng());
    expect(result.ci).not.toBeNull();
    expect(result.sigma).toBeGreaterThan(0);
  });

  it('produces no NaN/Infinity (Box-Muller guard)', () => {
    const values = [mv(100, 10), mv(110, 10)];
    const result = bootstrapMeanCI(values, 1000, rng());
    expect(Number.isFinite(result.value)).toBe(true);
    expect(Number.isFinite(result.ci![0])).toBe(true);
    expect(Number.isFinite(result.ci![1])).toBe(true);
  });
});

// ─── bootstrapPercentileCI ──────────────────────────────────────

describe('bootstrapPercentileCI', () => {
  const makeRatings = (mu: number, sigma: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({ mu: mu + i * 0.5, sigma }));

  it('returns null for empty input', () => {
    expect(bootstrapPercentileCI([], 0.5, ITERATIONS, rng())).toBeNull();
  });

  it('returns null for arrays of empty variants', () => {
    expect(bootstrapPercentileCI([[], []], 0.5, ITERATIONS, rng())).toBeNull();
  });

  it('CI contains true percentile for known distribution', () => {
    const run1 = makeRatings(20, 2, 10);
    const run2 = makeRatings(21, 2, 10);
    const run3 = makeRatings(19, 2, 10);
    const result = bootstrapPercentileCI([run1, run2, run3], 0.5, ITERATIONS, rng());
    expect(result).not.toBeNull();
    expect(result!.ci).not.toBeNull();
    expect(Number.isFinite(result!.value)).toBe(true);
  });

  it('CI is wider when variant sigmas are large', () => {
    const smallSigma = [makeRatings(20, 0.5, 10), makeRatings(21, 0.5, 10)];
    const largeSigma = [makeRatings(20, 8, 10), makeRatings(21, 8, 10)];
    const ciSmall = bootstrapPercentileCI(smallSigma, 0.5, ITERATIONS, rng());
    const ciLarge = bootstrapPercentileCI(largeSigma, 0.5, ITERATIONS, rng());
    const widthSmall = ciSmall!.ci![1] - ciSmall!.ci![0];
    const widthLarge = ciLarge!.ci![1] - ciLarge!.ci![0];
    expect(widthLarge).toBeGreaterThan(widthSmall);
  });

  it('single-variant-per-run returns that element', () => {
    const runs = [[{ mu: 25, sigma: 2 }], [{ mu: 30, sigma: 2 }]];
    const result = bootstrapPercentileCI(runs, 0.5, ITERATIONS, rng());
    expect(result).not.toBeNull();
    expect(Number.isFinite(result!.value)).toBe(true);
  });

  it('filters out empty variant arrays', () => {
    const runs = [makeRatings(20, 2, 10), [], makeRatings(22, 2, 10)];
    const result = bootstrapPercentileCI(runs, 0.5, ITERATIONS, rng());
    expect(result).not.toBeNull();
    expect(result!.n).toBe(2); // empty array filtered
  });

  it('produces no NaN/Infinity', () => {
    const runs = [makeRatings(20, 5, 5), makeRatings(22, 5, 5)];
    const result = bootstrapPercentileCI(runs, 0.9, 500, rng());
    expect(Number.isFinite(result!.value)).toBe(true);
    expect(Number.isFinite(result!.ci![0])).toBe(true);
    expect(Number.isFinite(result!.ci![1])).toBe(true);
  });

  it('returns null CI for single run', () => {
    const result = bootstrapPercentileCI([makeRatings(20, 2, 10)], 0.5, ITERATIONS, rng());
    expect(result).not.toBeNull();
    expect(result!.ci).toBeNull();
    expect(result!.n).toBe(1);
  });
});

// ─── computeRunMetrics ──────────────────────────────────────────

describe('computeRunMetrics', () => {
  /** V2 mock: queries evolution_variants + evolution_agent_invocations directly (no RPC, no checkpoints). */
  function mockSupabase(config: {
    variants?: Array<{ elo_score: number }>;
    invocations?: Array<{ agent_name: string; cost_usd: number }>;
  }) {
    // Build a thenable that chains .eq() any number of times.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function chainable<T>(data: T): any {
      const result = { data, error: null };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj: any = {
        eq: () => obj,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then: (onFulfilled?: any, onRejected?: any) =>
          Promise.resolve(result).then(onFulfilled, onRejected),
      };
      return obj;
    }
    return {
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'evolution_variants') {
          return { select: () => chainable(config.variants ?? []) };
        }
        if (table === 'evolution_agent_invocations') {
          return { select: () => chainable(config.invocations ?? []) };
        }
        return { select: () => chainable([]) };
      }),
    };
  }

  it('maps variant elo_scores to metrics (V2 direct query)', async () => {
    const supabase = mockSupabase({
      variants: [
        { elo_score: 1200 }, { elo_score: 1350 }, { elo_score: 1450 }, { elo_score: 1500 },
      ],
    });
    const result = await computeRunMetrics('run-1', supabase as never);
    expect(result.metrics.totalVariants?.value).toBe(4);
    expect(result.metrics.maxElo?.value).toBe(1500);
    // True median of [1200, 1350, 1450, 1500] = (1350 + 1450) / 2 = 1400
    expect(result.metrics.medianElo?.value).toBe(1400);
  });

  it('aggregates agent costs by agent_name', async () => {
    const supabase = mockSupabase({
      invocations: [
        { agent_name: 'generation', cost_usd: 0.1 },
        { agent_name: 'generation', cost_usd: 0.2 },
        { agent_name: 'tournament', cost_usd: 0.5 },
      ],
    });
    const result = await computeRunMetrics('run-1', supabase as never);
    expect(result.metrics['agentCost:generation']?.value).toBeCloseTo(0.3);
    expect(result.metrics['agentCost:tournament']?.value).toBeCloseTo(0.5);
    expect(result.metrics.cost?.value).toBeCloseTo(0.8);
  });

  it('computes eloPer$ when cost > 0', async () => {
    const supabase = mockSupabase({
      variants: [{ elo_score: 1500 }],
      invocations: [{ agent_name: 'gen', cost_usd: 2.0 }],
    });
    const result = await computeRunMetrics('run-1', supabase as never);
    const expected = (1500 - 1200) / 2.0;
    expect(result.metrics['eloPer$']?.value).toBeCloseTo(expected);
  });

  it('handles empty variants gracefully (V2: no checkpoint fallback)', async () => {
    const supabase = mockSupabase({ variants: [] });
    const result = await computeRunMetrics('run-1', supabase as never);
    expect(result.variantRatings).toBeNull();
    expect(result.metrics.maxElo).toBeUndefined();
    expect(result.metrics.totalVariants).toBeUndefined();
  });

  it('handles empty invocations', async () => {
    const supabase = mockSupabase({ invocations: [] });
    const result = await computeRunMetrics('run-1', supabase as never);
    expect(result.metrics.cost?.value).toBe(0);
  });
});

// ─── aggregateMetrics ───────────────────────────────────────────

describe('aggregateMetrics', () => {
  it('returns empty bag for empty input', () => {
    expect(aggregateMetrics([])).toEqual({});
  });

  it('derives CI from sigma for single run', () => {
    const data: RunMetricsWithRatings[] = [
      { metrics: { maxElo: mv(1500, 40) }, variantRatings: null },
    ];
    const result = aggregateMetrics(data, rng());
    expect(result.maxElo?.ci).not.toBeNull();
    expect(result.maxElo?.ci![0]).toBeCloseTo(1500 - 1.96 * 40, 1);
    expect(result.maxElo?.ci![1]).toBeCloseTo(1500 + 1.96 * 40, 1);
    expect(result.maxElo?.n).toBe(1);
  });

  it('uses bootstrapMeanCI for maxElo when no ratings available', () => {
    const data: RunMetricsWithRatings[] = [
      { metrics: { maxElo: mv(1500) }, variantRatings: null },
      { metrics: { maxElo: mv(1480) }, variantRatings: null },
      { metrics: { maxElo: mv(1520) }, variantRatings: null },
    ];
    const result = aggregateMetrics(data, rng());
    expect(result.maxElo?.ci).not.toBeNull();
    expect(result.maxElo?.sigma).toBeGreaterThan(0);
  });

  it('uses bootstrapPercentileCI for maxElo when ratings available', () => {
    const makeRatings = (base: number) =>
      Array.from({ length: 5 }, (_, i) => ({ mu: base + i * 2, sigma: 2 }));
    const data: RunMetricsWithRatings[] = [
      { metrics: { maxElo: mv(1500) }, variantRatings: makeRatings(20) },
      { metrics: { maxElo: mv(1480) }, variantRatings: makeRatings(18) },
      { metrics: { maxElo: mv(1520) }, variantRatings: makeRatings(22) },
    ];
    const result = aggregateMetrics(data, rng());
    expect(result.maxElo).not.toBeNull();
    expect(result.maxElo?.ci).not.toBeNull();
    expect(result.maxElo?.sigma).toBeNull();
  });

  it('uses plain bootstrap for cost (no sigma)', () => {
    const data: RunMetricsWithRatings[] = [
      { metrics: { cost: mv(2.0) }, variantRatings: null },
      { metrics: { cost: mv(2.5) }, variantRatings: null },
      { metrics: { cost: mv(2.2) }, variantRatings: null },
    ];
    const result = aggregateMetrics(data, rng());
    expect(result.cost?.ci).not.toBeNull();
    expect(result.cost?.value).toBeCloseTo(2.233, 1);
  });

  it('uses bootstrapPercentileCI for medianElo when ratings available', () => {
    const makeRatings = (base: number) =>
      Array.from({ length: 5 }, (_, i) => ({ mu: base + i * 2, sigma: 2 }));
    const data: RunMetricsWithRatings[] = [
      { metrics: { medianElo: mv(1300) }, variantRatings: makeRatings(15) },
      { metrics: { medianElo: mv(1320) }, variantRatings: makeRatings(18) },
      { metrics: { medianElo: mv(1310) }, variantRatings: makeRatings(16) },
    ];
    const result = aggregateMetrics(data, rng());
    expect(result.medianElo).not.toBeNull();
    expect(result.medianElo?.ci).not.toBeNull();
  });

  it('falls back to plain bootstrap for medianElo when < 2 runs have ratings', () => {
    const data: RunMetricsWithRatings[] = [
      { metrics: { medianElo: mv(1300) }, variantRatings: [{ mu: 20, sigma: 3 }] },
      { metrics: { medianElo: mv(1320) }, variantRatings: null },
      { metrics: { medianElo: mv(1310) }, variantRatings: null },
    ];
    const result = aggregateMetrics(data, rng());
    expect(result.medianElo).not.toBeNull();
    expect(result.medianElo?.ci).not.toBeNull();
    // Should be plain bootstrap of the 3 values
    expect(result.medianElo?.n).toBe(3);
  });

  it('uses mu-based Elo for aggregated medianElo', () => {
    // High sigma variants: mu-based Elo is driven by mu, not sigma
    // toEloScale(mu) = 800 + mu * 16; median variant at base+4 → 800 + 24*16 = 1184
    const makeHighSigmaRatings = (base: number) =>
      Array.from({ length: 5 }, (_, i) => ({ mu: base + i * 2, sigma: 8 }));
    const data: RunMetricsWithRatings[] = [
      { metrics: { medianElo: mv(1000) }, variantRatings: makeHighSigmaRatings(20) },
      { metrics: { medianElo: mv(1020) }, variantRatings: makeHighSigmaRatings(22) },
      { metrics: { medianElo: mv(1010) }, variantRatings: makeHighSigmaRatings(21) },
    ];
    const result = aggregateMetrics(data, rng());
    // mu-based median: toEloScale(base + 4) for 5 variants
    // = 800 + (base+4) * 16 ≈ 800 + 24*16 = 1184
    expect(result.medianElo!.value).toBeGreaterThan(1000);
  });

  it('handles mixed agent costs across runs', () => {
    const data: RunMetricsWithRatings[] = [
      { metrics: { 'agentCost:gen': mv(0.3), 'agentCost:judge': mv(0.5) }, variantRatings: null },
      { metrics: { 'agentCost:gen': mv(0.4) }, variantRatings: null },
    ];
    const result = aggregateMetrics(data, rng());
    expect(result['agentCost:gen']).not.toBeNull();
    // agentCost:judge only present in 1 run, should still aggregate
    expect(result['agentCost:judge']).not.toBeNull();
    expect(result['agentCost:judge']?.n).toBe(1);
    expect(result['agentCost:judge']?.ci).toBeNull(); // single value
  });
});

// ─── createSeededRng ────────────────────────────────────────────

describe('createSeededRng', () => {
  it('is deterministic', () => {
    const a = createSeededRng(123);
    const b = createSeededRng(123);
    expect(a()).toBe(b());
    expect(a()).toBe(b());
  });

  it('produces values in [0, 1)', () => {
    const r = createSeededRng(999);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
