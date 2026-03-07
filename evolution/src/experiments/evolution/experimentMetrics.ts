// Core metrics computation for evolution experiments: per-run stats, bootstrap CIs, and aggregation.
// Shared by experiment detail, strategy detail, cron analysis, and backfill script.

import { ordinalToEloScale, getOrdinal } from '@evolution/lib/core/rating';

// ─── Types ──────────────────────────────────────────────────────

/** Canonical metric names. Agent costs use template literal pattern. */
export type MetricName =
  | 'totalVariants'
  | 'medianElo'
  | 'p90Elo'
  | 'maxElo'
  | 'cost'
  | 'eloPer$'
  | `agentCost:${string}`;

/** A single metric measurement with optional uncertainty and CI. */
export interface MetricValue {
  value: number;
  sigma: number | null;
  ci: [number, number] | null;
  n: number;
}

/** Flat map of all metrics for a run or aggregate. */
export type MetricsBag = { [K in MetricName]?: MetricValue | null };

/** Per-run metrics plus variant ratings for percentile uncertainty propagation. */
export interface RunMetricsWithRatings {
  metrics: MetricsBag;
  variantRatings: Array<{ mu: number; sigma: number }> | null;
}

/** Experiment-level metrics result (per-run, no cross-run CIs). */
export interface ExperimentMetricsResult {
  runs: Array<{
    runId: string;
    status: string;
    configLabel: string;
    strategyConfigId: string | null;
    metrics: MetricsBag;
  }>;
  completedRuns: number;
  totalRuns: number;
  warnings: string[];
}

/** Strategy-level metrics result (per-run + aggregated with bootstrap CIs). */
export interface StrategyMetricsResult {
  aggregate: MetricsBag;
  runs: Array<{
    runId: string;
    status: string;
    configLabel: string;
    metrics: MetricsBag;
  }>;
}

// ─── Supabase type (minimal interface for testability) ──────────

interface SupabaseClient {
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  from: (table: string) => {
    select: (columns: string) => {
      eq: (col: string, val: unknown) => {
        order?: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => {
            maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
          };
        };
        [key: string]: unknown;
      } & Promise<{ data: unknown[]; error: unknown }>;
    };
  };
}

// ─── Seeded PRNG ────────────────────────────────────────────────

/** Seedable PRNG (Numerical Recipes LCG) for deterministic testing. */
export function createSeededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

// ─── Bootstrap Functions ────────────────────────────────────────

/**
 * Bootstrap CI for scalar metrics. Auto-detects sigma presence for uncertainty propagation.
 * When sigma > 0, draws from Normal(value, sigma) via Box-Muller per resample.
 */
export function bootstrapMeanCI(
  values: MetricValue[],
  iterations = 1000,
  rng: () => number = Math.random,
): MetricValue {
  if (values.length < 2) {
    const v = values[0];
    return {
      value: v?.value ?? 0,
      sigma: v?.sigma ?? null,
      ci: null,
      n: values.length,
    };
  }

  const hasSigma = values.some((v) => v.sigma != null && v.sigma > 0);
  const means: number[] = [];
  const n = values.length;

  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(rng() * n);
      const v = values[idx];
      if (hasSigma && v.sigma != null && v.sigma > 0) {
        const u1 = Math.max(Number.EPSILON, rng());
        const u2 = rng();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        sum += v.value + v.sigma * z;
      } else {
        sum += v.value;
      }
    }
    means.push(sum / n);
  }

  means.sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v.value, 0) / n;

  return {
    value: mean,
    sigma: null,
    ci: [means[Math.floor(iterations * 0.025)], means[Math.floor(iterations * 0.975)]],
    n,
  };
}

/**
 * Bootstrap CI for percentile metrics across runs, propagating within-run rating uncertainty.
 * Each iteration resamples runs, draws variant skills from Normal(mu, sigma), computes percentile.
 * Uses posterior mean (mu) for Elo conversion, not conservative ordinal.
 */
export function bootstrapPercentileCI(
  allRunRatings: Array<Array<{ mu: number; sigma: number }>>,
  percentile: number,
  iterations = 1000,
  rng: () => number = Math.random,
): MetricValue | null {
  const validRuns = allRunRatings.filter((variants) => variants.length > 0);
  if (validRuns.length === 0) return null;

  const nRuns = validRuns.length;
  const muToElo = (mu: number) => ordinalToEloScale(mu);

  const percentileValues: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let r = 0; r < nRuns; r++) {
      const runIdx = Math.floor(rng() * nRuns);
      const variants = validRuns[runIdx];
      const sampledElos: number[] = [];
      for (const v of variants) {
        const u1 = Math.max(Number.EPSILON, rng());
        const u2 = rng();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        sampledElos.push(muToElo(v.mu + v.sigma * z));
      }
      sampledElos.sort((a, b) => a - b);
      const idx = Math.min(
        Math.floor(percentile * sampledElos.length),
        sampledElos.length - 1,
      );
      sum += sampledElos[idx];
    }
    percentileValues.push(sum / nRuns);
  }
  percentileValues.sort((a, b) => a - b);

  // Point estimate: mean of actual (non-resampled) percentile values across runs
  const actuals = validRuns.map((variants) => {
    const elos = variants.map((v) => muToElo(v.mu));
    elos.sort((a, b) => a - b);
    return elos[Math.min(Math.floor(percentile * elos.length), elos.length - 1)];
  });
  const mean = actuals.reduce((s, v) => s + v, 0) / actuals.length;

  return {
    value: mean,
    sigma: null,
    ci: nRuns < 2
      ? null
      : [
          percentileValues[Math.floor(iterations * 0.025)],
          percentileValues[Math.floor(iterations * 0.975)],
        ],
    n: nRuns,
  };
}

// ─── Aggregation ────────────────────────────────────────────────

/** Aggregate per-run metrics with bootstrap CIs, routing each metric to appropriate bootstrap. */
export function aggregateMetrics(
  runData: RunMetricsWithRatings[],
  rng: () => number = Math.random,
): MetricsBag {
  if (runData.length === 0) return {};

  const bag: MetricsBag = {};

  // Collect all metric keys across runs
  const allKeys = new Set<string>();
  for (const rd of runData) {
    for (const key of Object.keys(rd.metrics)) {
      allKeys.add(key);
    }
  }

  // Runs with valid variant ratings for percentile bootstrap
  const runsWithRatings = runData.filter(
    (rd) => rd.variantRatings != null && rd.variantRatings.length > 0,
  );

  for (const key of allKeys) {
    const metricName = key as MetricName;

    // Percentile metrics: use bootstrapPercentileCI when enough runs have ratings
    if (
      (metricName === 'medianElo' || metricName === 'p90Elo') &&
      runsWithRatings.length >= 2
    ) {
      const pct = metricName === 'medianElo' ? 0.5 : 0.9;
      const allRatings = runsWithRatings.map((rd) => rd.variantRatings!);
      const result = bootstrapPercentileCI(allRatings, pct, 1000, rng);
      if (result) {
        bag[metricName] = result;
        continue;
      }
    }

    // All other metrics (and fallback for percentile metrics): bootstrapMeanCI
    const values: MetricValue[] = [];
    for (const rd of runData) {
      const mv = rd.metrics[metricName];
      if (mv != null) values.push(mv);
    }
    if (values.length > 0) {
      bag[metricName] = bootstrapMeanCI(values, 1000, rng);
    }
  }

  return bag;
}

// ─── Per-Run Metrics Computation ────────────────────────────────

/** Compute metrics for a single evolution run from DB data. */
export async function computeRunMetrics(
  runId: string,
  supabase: SupabaseClient,
): Promise<RunMetricsWithRatings> {
  const metrics: MetricsBag = {};
  let variantRatings: Array<{ mu: number; sigma: number }> | null = null;

  // 1. Variant stats via RPC
  const { data: statsData, error: statsError } = await supabase.rpc(
    'compute_run_variant_stats',
    { p_run_id: runId },
  );

  type StatsRow = {
    total_variants: number;
    median_elo: number | null;
    p90_elo: number | null;
    max_elo: number | null;
  };

  // RPC returns a single row (aggregation without GROUP BY)
  const stats: StatsRow | null = statsError
    ? null
    : Array.isArray(statsData)
      ? (statsData[0] as StatsRow | undefined) ?? null
      : (statsData as StatsRow | null);

  // 2. Load checkpoint for variant ratings (sigma extraction)
  const checkpointQuery = supabase
    .from('evolution_checkpoints')
    .select('state_snapshot')
    .eq('run_id', runId);

  const checkpointResult = await (checkpointQuery as unknown as {
    order: (col: string, opts: { ascending: boolean }) => {
      limit: (n: number) => {
        maybeSingle: () => Promise<{ data: { state_snapshot: unknown } | null; error: unknown }>;
      };
    };
  })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const snapshot = checkpointResult.data?.state_snapshot as
    | { ratings?: Record<string, { mu: number; sigma: number }> }
    | null;

  if (snapshot?.ratings && Object.keys(snapshot.ratings).length > 0) {
    variantRatings = Object.values(snapshot.ratings);
  }

  // 3. Populate variant stats - with checkpoint fallback
  if (stats && stats.total_variants > 0) {
    metrics.totalVariants = { value: stats.total_variants, sigma: null, ci: null, n: 1 };
    if (stats.median_elo != null) {
      metrics.medianElo = { value: stats.median_elo, sigma: null, ci: null, n: 1 };
    }
    if (stats.p90_elo != null) {
      metrics.p90Elo = { value: stats.p90_elo, sigma: null, ci: null, n: 1 };
    }
    if (stats.max_elo != null) {
      // Find top variant's sigma from ratings
      let topSigmaEloScale: number | null = null;
      if (variantRatings && variantRatings.length > 0) {
        // Top variant = highest ordinal
        const sorted = [...variantRatings].sort(
          (a, b) => getOrdinal(b) - getOrdinal(a),
        );
        topSigmaEloScale = sorted[0].sigma * (400 / 25); // sigma in Elo scale
      }
      metrics.maxElo = {
        value: stats.max_elo,
        sigma: topSigmaEloScale,
        ci: null,
        n: 1,
      };
    }
  } else if (variantRatings && variantRatings.length > 0) {
    // Checkpoint fallback: reconstruct from ratings when DB has no variant rows
    const elos = variantRatings.map((r) =>
      ordinalToEloScale(getOrdinal(r)),
    );
    elos.sort((a, b) => a - b);

    metrics.totalVariants = { value: elos.length, sigma: null, ci: null, n: 1 };
    metrics.medianElo = {
      value: elos[Math.min(Math.floor(0.5 * elos.length), elos.length - 1)],
      sigma: null,
      ci: null,
      n: 1,
    };
    metrics.p90Elo = {
      value: elos[Math.min(Math.floor(0.9 * elos.length), elos.length - 1)],
      sigma: null,
      ci: null,
      n: 1,
    };

    const maxElo = elos[elos.length - 1];
    const sorted = [...variantRatings].sort(
      (a, b) => getOrdinal(b) - getOrdinal(a),
    );
    const topSigmaEloScale = sorted[0].sigma * (400 / 25);
    metrics.maxElo = { value: maxElo, sigma: topSigmaEloScale, ci: null, n: 1 };
  }

  // 4. Agent costs via standard query + client-side GROUP BY
  const { data: invocations } = (await supabase
    .from('evolution_agent_invocations')
    .select('agent_name, cost_usd')
    .eq('run_id', runId)) as { data: Array<{ agent_name: string; cost_usd: number }> | null };

  let totalCost = 0;
  if (invocations && invocations.length > 0) {
    const agentCosts = new Map<string, number>();
    for (const inv of invocations) {
      const cost = Number(inv.cost_usd) || 0;
      agentCosts.set(inv.agent_name, (agentCosts.get(inv.agent_name) ?? 0) + cost);
      totalCost += cost;
    }
    for (const [agent, cost] of agentCosts) {
      metrics[`agentCost:${agent}` as MetricName] = {
        value: cost,
        sigma: null,
        ci: null,
        n: 1,
      };
    }
  }

  metrics.cost = { value: totalCost, sigma: null, ci: null, n: 1 };

  // Elo/$
  const maxEloValue = metrics.maxElo?.value;
  if (maxEloValue != null && totalCost > 0) {
    metrics['eloPer$'] = {
      value: (maxEloValue - 1200) / totalCost,
      sigma: null,
      ci: null,
      n: 1,
    };
  }

  return { metrics, variantRatings };
}
