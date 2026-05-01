// Core metrics computation for evolution experiments: per-run stats, bootstrap CIs, and aggregation.
// Shared by experiment detail, strategy detail, cron analysis, and backfill script.

import { writeMetric } from './writeMetrics';
import type { MetricName as RegistryMetricName } from './types';
import type { SupabaseClient as RealSupabaseClient } from '@supabase/supabase-js';
import { ATTRIBUTION_EXTRACTORS } from './attributionExtractors';
// NOTE: ATTRIBUTION_EXTRACTORS is populated at module-load time by side-effect imports
// at the bottom of each agent file (`registerAttributionExtractor(...)` calls).
// Production callers of `computeEloAttributionMetrics` reach this aggregator via
// `claimAndExecuteRun` → `persistRunResults` → `computeRunMetrics` → here. That call
// chain transitively loads `agentRegistry.ts` and the GFPA / wrapper agent files
// via `runIterationLoop`, so registration always fires before this aggregator runs.
//
// Worker-context safeguard: if a future entry point reaches this aggregator WITHOUT
// going through agentRegistry / runIterationLoop, it should explicitly import
// `evolution/src/lib/core/agents` (the eager-import barrel) at its own top-level
// to ensure the registry is populated. We don't import it from this file because
// that would create a circular dependency: experimentMetrics → agents → Agent →
// createEvolutionLLMClient → writeMetrics → registry → propagation → experimentMetrics.

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
  uncertainty: number | null;
  ci: [number, number] | null;
  n: number;
}

/** Flat map of all metrics for a run or aggregate. */
export type MetricsBag = { [K in MetricName]?: MetricValue | null };

/** Per-run metrics plus variant ratings for percentile uncertainty propagation. */
export interface RunMetricsWithRatings {
  metrics: MetricsBag;
  variantRatings: Array<{ elo: number; uncertainty: number }> | null;
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

interface ChainableQuery extends Promise<{ data: unknown[]; error: unknown }> {
  eq: (col: string, val: unknown) => ChainableQuery;
  /** Phase 5: used by computeEloAttributionMetrics to filter non-null FKs. */
  not: (col: string, op: string, val: unknown) => ChainableQuery;
  /** Phase 5: used to batch-fetch invocations + parents by id list. */
  in: (col: string, values: readonly unknown[]) => ChainableQuery;
  order?: (col: string, opts: { ascending: boolean }) => {
    limit: (n: number) => {
      maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
    };
  };
}
interface SupabaseClient {
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  from: (table: string) => {
    select: (columns: string) => ChainableQuery;
  };
}

// ─── Helpers ────────────────────────────────────────────────────

/** Shorthand for a single-observation metric with no uncertainty. */
function scalar(value: number, uncertainty: number | null = null): MetricValue {
  return { value, uncertainty, ci: null, n: 1 };
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
 * Bootstrap CI for scalar metrics. Auto-detects uncertainty presence for uncertainty propagation.
 * When uncertainty > 0, draws from Normal(value, uncertainty) via Box-Muller per resample.
 */
export function bootstrapMeanCI(
  values: MetricValue[],
  iterations = 1000,
  rng: () => number = Math.random,
): MetricValue {
  if (values.length < 2) {
    const v = values[0];
    const s = v?.uncertainty ?? null;
    const val = v?.value ?? 0;
    return {
      value: val,
      uncertainty: s,
      ci: s != null ? [val - 1.96 * s, val + 1.96 * s] : null,
      n: values.length,
    };
  }

  const hasUncertainty = values.some((v) => v.uncertainty != null && v.uncertainty > 0);
  const means: number[] = [];
  const n = values.length;

  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(rng() * n);
      const v = values[idx]!;
      // B045: always consume two RNG draws per iteration, even when the sample has no
      // uncertainty. Previously the else branch consumed zero draws, so mixed-uncertainty
      // inputs desynchronized the seeded RNG across iterations — resample order changed
      // the output under a given seed. Draws are always consumed; the normal-deviate is
      // only *used* when uncertainty > 0.
      const u1 = Math.max(Number.EPSILON, rng());
      const u2 = rng();
      if (hasUncertainty && v.uncertainty != null && v.uncertainty > 0) {
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        sum += v.value + v.uncertainty * z;
      } else {
        sum += v.value;
      }
    }
    means.push(sum / n);
  }

  means.sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v.value, 0) / n;
  const bootstrapSE = Math.sqrt(means.reduce((s, m) => s + (m - mean) ** 2, 0) / (iterations - 1));

  return {
    value: mean,
    uncertainty: bootstrapSE,
    ci: [means[Math.floor(iterations * 0.025)]!, means[Math.floor(iterations * 0.975)]!],
    n,
  };
}

/**
 * Bootstrap CI for percentile metrics across runs, propagating within-run rating uncertainty.
 * Each iteration resamples runs, draws variant skills from Normal(elo, uncertainty), computes percentile.
 * Ratings are already in Elo scale — no conversion needed.
 */
export function bootstrapPercentileCI(
  allRunRatings: Array<Array<{ elo: number; uncertainty: number }>>,
  percentile: number,
  iterations = 1000,
  rng: () => number = Math.random,
): MetricValue | null {
  const validRuns = allRunRatings.filter((variants) => variants.length > 0);
  if (validRuns.length === 0) return null;

  const nRuns = validRuns.length;
  const percentileValues: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let r = 0; r < nRuns; r++) {
      const runIdx = Math.floor(rng() * nRuns);
      const variants = validRuns[runIdx]!;
      const sampledElos: number[] = [];
      for (const v of variants) {
        const u1 = Math.max(Number.EPSILON, rng());
        const u2 = rng();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        sampledElos.push(v.elo + v.uncertainty * z);
      }
      sampledElos.sort((a, b) => a - b);
      const idx = Math.min(
        Math.floor(percentile * sampledElos.length),
        sampledElos.length - 1,
      );
      sum += sampledElos[idx]!;
    }
    percentileValues.push(sum / nRuns);
  }
  percentileValues.sort((a, b) => a - b);

  const actuals = validRuns.map((variants) => {
    const elos = variants.map((v) => v.elo).sort((a, b) => a - b);
    return elos[Math.min(Math.floor(percentile * elos.length), elos.length - 1)]!;
  });
  const mean = actuals.reduce((s, v) => s + v, 0) / actuals.length;

  return {
    value: mean,
    uncertainty: null,
    ci: nRuns < 2
      ? null
      : [
          percentileValues[Math.floor(iterations * 0.025)]!,
          percentileValues[Math.floor(iterations * 0.975)]!,
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

  const PERCENTILE_METRICS: Record<string, number> = { medianElo: 0.5, p90Elo: 0.9, maxElo: 1.0 };

  for (const key of allKeys) {
    const metricName = key as MetricName;

    if (metricName in PERCENTILE_METRICS && runsWithRatings.length >= 2) {
      const pct = PERCENTILE_METRICS[metricName]!;
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

/**
 * Compute metrics for a single evolution run from DB data.
 *
 * When called from the production finalize path (persistRunResults.ts), pass
 * `opts.strategyId` and `opts.experimentId` so attribution metrics
 * (`eloAttrDelta:*` / `eloAttrDeltaHist:*`) are persisted to `evolution_metrics`
 * at run/strategy/experiment entity levels. Without opts, attribution rows are
 * still populated in the returned in-memory bag but NOT written to the DB —
 * this preserves the existing test-only call pattern.
 *
 * Writes are non-fatal from the caller's perspective; individual `writeMetric`
 * calls inside `computeEloAttributionMetrics` throw on DB failure, so the
 * caller must wrap this in try/catch if it wants to tolerate attribution
 * failures without aborting finalize.
 */
export async function computeRunMetrics(
  runId: string,
  supabase: SupabaseClient,
  opts?: { strategyId?: string; experimentId?: string },
): Promise<RunMetricsWithRatings> {
  const metrics: MetricsBag = {};
  // V2: query evolution_variants directly (no checkpoints, no compute_run_variant_stats RPC)
  // Filter persisted=true: discarded variants are excluded from run metrics. Their generation
  // cost lives on invocation rows, not on this aggregate.
  const variantsQuery = supabase
    .from('evolution_variants')
    .select('elo_score')
    .eq('run_id', runId)
    .eq('persisted', true);
  const variantsResult = (await variantsQuery) as unknown as { data: Array<{ elo_score: number }> | null };
  const variants = variantsResult?.data;

  if (variants && variants.length > 0) {
    const elos = variants.map((v: { elo_score: number }) => v.elo_score).sort((a: number, b: number) => a - b);
    metrics.totalVariants = scalar(elos.length);
    // Proper median: average of two middle values for even-length arrays
    const mid = Math.floor(elos.length / 2);
    const median = elos.length % 2 === 1 ? elos[mid]! : (elos[mid - 1]! + elos[mid]!) / 2;
    metrics.medianElo = scalar(median);
    // Nearest-rank P90: ceil(0.9 * n) - 1, clamped to valid range
    metrics.p90Elo = scalar(elos[Math.min(Math.ceil(elos.length * 0.9) - 1, elos.length - 1)]!);
    metrics.maxElo = scalar(elos[elos.length - 1]!);
  }

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
      metrics[`agentCost:${agent}` as MetricName] = scalar(cost);
    }
  }

  metrics.cost = scalar(totalCost);

  const maxEloValue = metrics.maxElo?.value;
  if (maxEloValue != null && totalCost > 0) {
    metrics['eloPer$'] = scalar((maxEloValue - 1200) / totalCost);
  }

  // ─── Phase 5: ELO attribution by (agent, dimension) ────────────────
  // Group variants produced by each invocation by (agent_name, execution_detail.strategy)
  // and emit eloAttrDelta:<agent>:<dim> + eloAttrDeltaHist:<agent>:<bucket> rows.
  // When opts.strategyId / opts.experimentId are set, rows are ALSO persisted to
  // evolution_metrics at those entity levels (Blocker 2 fix, 2026-04-22).
  await computeEloAttributionMetrics(runId, metrics, supabase, opts);

  return { metrics, variantRatings: null };
}

// ─── Phase 5: ELO attribution helpers ────────────────────────────

/** Fixed 10-ELO histogram buckets. Bucket keys are `[lo, hi)` half-open. */
const HISTOGRAM_BUCKETS: Array<[number, number]> = [
  [-Infinity, -40],
  [-40, -30], [-30, -20], [-20, -10], [-10, 0],
  [0, 10], [10, 20], [20, 30], [30, 40],
  [40, Infinity],
];

function bucketLabel(lo: number, hi: number): string {
  const loLabel = lo === -Infinity ? 'ltmin' : String(lo);
  const hiLabel = hi === Infinity ? 'gtmax' : String(hi);
  return `${loLabel}:${hiLabel}`;
}

/**
 * Phase 5 aggregation: for every (agent_name, dimension) group in this run,
 * compute mean ELO delta across produced variants and emit:
 *   - eloAttrDelta:<agentName>:<dimensionValue> (scalar mean)
 *   - eloAttrDeltaHist:<agentName>:<lo>:<hi>    (fraction per bucket)
 *
 * Dimension value is read from invocation.execution_detail.strategy (the current
 * attribution dimension for generate_from_previous_article). Variants without an
 * agent_invocation_id or without a parent are excluded.
 */
async function computeEloAttributionMetrics(
  runId: string,
  metrics: MetricsBag,
  supabase: SupabaseClient,
  opts?: { strategyId?: string; experimentId?: string },
): Promise<void> {
  type AttrVariantRow = {
    id: string; mu: number | null; elo_score: number; parent_variant_id: string | null;
    agent_invocation_id: string | null; persisted: boolean | null;
    // B052: agent_name is used as the attribution group key when agent_invocation_id is
    // NULL (historic + seed variants) so these rows still contribute to per-tactic
    // attribution instead of being silently dropped.
    agent_name: string | null;
  };
  // B052: previously excluded rows with null agent_invocation_id via
  // `.not('agent_invocation_id', 'is', null)`. That silently dropped legacy + seed
  // variants from attribution metrics. We now pull them in and route via
  // `parent_variant_id` + `agent_name`; the per-invocation dimension path is still
  // preferred when available.
  const { data: variantsData } = await supabase
    .from('evolution_variants')
    .select('id, mu, elo_score, parent_variant_id, agent_invocation_id, persisted, agent_name')
    .eq('run_id', runId)
    .not('parent_variant_id', 'is', null);
  const variants = (variantsData ?? []) as unknown as AttrVariantRow[];

  if (variants.length === 0) return;

  const invocationIds = [...new Set(variants.map(v => v.agent_invocation_id).filter((x): x is string => !!x))];
  const parentIds = [...new Set(variants.map(v => v.parent_variant_id).filter((x): x is string => !!x))];

  type AttrInvocationRow = {
    id: string; agent_name: string; execution_detail: Record<string, unknown> | null;
  };
  const { data: invocationsData } = invocationIds.length > 0
    ? await supabase
        .from('evolution_agent_invocations')
        .select('id, agent_name, execution_detail')
        .in('id', invocationIds)
    : { data: [] };
  const invocations = (invocationsData ?? []) as unknown as AttrInvocationRow[];

  type AttrParentRow = { id: string; mu: number | null; elo_score: number };
  const { data: parentsData } = parentIds.length > 0
    ? await supabase
        .from('evolution_variants')
        .select('id, mu, elo_score')
        .in('id', parentIds)
    : { data: [] };
  const parents = (parentsData ?? []) as unknown as AttrParentRow[];

  const invMap = new Map(invocations.map(i => [i.id, i]));
  const parentMap = new Map(parents.map(p => [p.id, p]));

  // Group deltas by (agent_name, dimension_value).
  const groups = new Map<string, { agent: string; dim: string; deltas: number[] }>();
  for (const v of variants) {
    // Phase 8 of develop_reflection_and_generateFromParentArticle_agent_evolution_20260430:
    // Mutually-exclusive dispatch — registry hit OR legacy fallback, NEVER both.
    // (1) When agent_invocation_id is set AND a registered extractor exists for
    //     inv.agent_name, use the extractor's output (e.g., GFPA returns detail.tactic;
    //     reflect_and_generate returns detail.tactic too — naturally separated by
    //     agent_name in the eloAttrDelta key).
    // (2) When extractor is missing (unknown agent_name) OR returns null, fall back to
    //     the legacy hardcoded `execution_detail.strategy` read.
    // (3) When agent_invocation_id is null (legacy / seed variants), use
    //     v.agent_name + 'legacy' so they still contribute under their own bucket.
    // B052: this branch is the long-standing fallback for legacy variants.
    const inv = v.agent_invocation_id ? invMap.get(v.agent_invocation_id) : undefined;
    let dim: string | undefined;
    let agentName: string | undefined;
    if (inv) {
      agentName = inv.agent_name;
      const extractor = ATTRIBUTION_EXTRACTORS[inv.agent_name];
      if (extractor) {
        const extracted = extractor(inv.execution_detail);
        if (typeof extracted === 'string' && extracted.length > 0 && !extracted.includes(':')) {
          dim = extracted;
        }
      } else {
        // Legacy fallback path — only fires for agent_names without a registered extractor.
        const d = (inv.execution_detail as { strategy?: unknown })?.strategy;
        if (typeof d === 'string' && d.length > 0 && !d.includes(':')) dim = d;
      }
    } else if (v.agent_name) {
      agentName = v.agent_name;
      dim = 'legacy';
    }
    if (!agentName || !dim) continue;

    const parent = v.parent_variant_id ? parentMap.get(v.parent_variant_id) : undefined;
    if (!parent) continue;
    const childElo = v.mu ?? v.elo_score;
    const parentElo = parent.mu ?? parent.elo_score;
    const delta = childElo - parentElo;
    if (!Number.isFinite(delta)) continue;

    const key = `${agentName}::${dim}`;
    const group = groups.get(key) ?? { agent: agentName, dim, deltas: [] };
    group.deltas.push(delta);
    groups.set(key, group);
  }

  // If opts are set, we persist to evolution_metrics at all 3 levels (Blocker 2 fix).
  // The local SupabaseClient interface is minimal; cast to the real client type that
  // writeMetric expects. Chainable mocks in tests satisfy both shapes.
  const dbForWrite = opts ? (supabase as unknown as RealSupabaseClient) : null;

  for (const { agent, dim, deltas } of groups.values()) {
    if (deltas.length === 0) continue;
    const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    if (!Number.isFinite(mean)) continue; // defensive — upstream filter catches per-delta non-finite
    const variance = deltas.length > 1
      ? deltas.reduce((s, d) => s + (d - mean) ** 2, 0) / (deltas.length - 1)
      : 0;
    const sd = Math.sqrt(variance);
    // For n>=2 use a basic normal-approx 95% CI; for n==1 leave CI null.
    const ci: [number, number] | null = deltas.length >= 2
      ? [mean - 1.96 * sd / Math.sqrt(deltas.length), mean + 1.96 * sd / Math.sqrt(deltas.length)]
      : null;
    metrics[`eloAttrDelta:${agent}:${dim}` as MetricName] = {
      value: mean,
      uncertainty: deltas.length >= 2 ? sd : null,
      ci,
      n: deltas.length,
    };

    if (dbForWrite) {
      const deltaMetricName = `eloAttrDelta:${agent}:${dim}` as RegistryMetricName;
      const deltaOpts = {
        uncertainty: deltas.length >= 2 ? sd : undefined,
        ci_lower: ci?.[0],
        ci_upper: ci?.[1],
        n: deltas.length,
      };
      await writeMetric(dbForWrite, 'run', runId, deltaMetricName, mean, 'at_finalization', deltaOpts);
      if (opts?.strategyId) {
        await writeMetric(dbForWrite, 'strategy', opts.strategyId, deltaMetricName, mean, 'at_finalization', deltaOpts);
      }
      if (opts?.experimentId) {
        await writeMetric(dbForWrite, 'experiment', opts.experimentId, deltaMetricName, mean, 'at_finalization', deltaOpts);
      }
    }

    // Histogram: fraction per bucket.
    const bucketCounts = new Map<string, number>();
    for (const d of deltas) {
      for (const [lo, hi] of HISTOGRAM_BUCKETS) {
        if (d >= lo && d < hi) {
          const label = bucketLabel(lo, hi);
          bucketCounts.set(label, (bucketCounts.get(label) ?? 0) + 1);
          break;
        }
      }
    }
    for (const [label, count] of bucketCounts) {
      const fraction = count / deltas.length;
      metrics[`eloAttrDeltaHist:${agent}:${dim}:${label}` as MetricName] = {
        value: fraction,
        uncertainty: null,
        ci: null,
        n: count,
      };

      if (dbForWrite && Number.isFinite(fraction)) {
        const histMetricName = `eloAttrDeltaHist:${agent}:${dim}:${label}` as RegistryMetricName;
        const histOpts = { n: count };
        await writeMetric(dbForWrite, 'run', runId, histMetricName, fraction, 'at_finalization', histOpts);
        if (opts?.strategyId) {
          await writeMetric(dbForWrite, 'strategy', opts.strategyId, histMetricName, fraction, 'at_finalization', histOpts);
        }
        if (opts?.experimentId) {
          await writeMetric(dbForWrite, 'experiment', opts.experimentId, histMetricName, fraction, 'at_finalization', histOpts);
        }
      }
    }
  }
}

