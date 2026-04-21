'use server';
// Server actions powering the Cost Estimates tab on the run + strategy detail pages.
// Reads live evolution_metrics rows, evolution_agent_invocations execution_detail JSONB,
// and run_summary.budgetFloorConfig to build the tab's summary cards, cost-by-agent
// breakdown, per-invocation table, error histogram, and Budget Floor Sensitivity module.

import { adminAction, type AdminContext } from './adminAction';
import { z } from 'zod';
import { DISPATCH_SAFETY_CAP } from '@evolution/lib/pipeline/loop/projectDispatchPlan';
import { resolveParallelFloor, resolveSequentialFloor, type BudgetFloorConfig } from '@evolution/lib/pipeline/loop/budgetFloorResolvers';
import { COST_ERROR_HISTOGRAM_BUCKETS } from './costEstimationConstants';

// ─── Inline dispatch-count projection (replaces projectDispatchCount.ts) ────────
// Used only by Budget Floor Sensitivity's "what if agent cost matched actuals from the
// start?" two-step projection. Matches the original projectDispatchCount() math exactly;
// formerly lived in evolution/src/lib/pipeline/loop/projectDispatchCount.ts but was
// inlined here in the final Phase 2 cleanup since this is the sole remaining caller.
interface ProjectDispatchCountsInput {
  totalBudget: number;
  numVariants: number;
  agentCost: number;
  sequentialStartingBudget: number;
  floorConfig: BudgetFloorConfig;
}
interface ProjectDispatchCounts {
  parallelFloor: number;
  parallelBudget: number;
  parallelDispatched: number;
  sequentialFloor: number;
  sequentialDispatched: number;
}
function projectDispatchCounts(input: ProjectDispatchCountsInput): ProjectDispatchCounts {
  const EMPTY = { parallelFloor: 0, parallelBudget: 0, parallelDispatched: 0, sequentialFloor: 0, sequentialDispatched: 0 };
  if (!Number.isFinite(input.agentCost) || input.agentCost <= 0) return EMPTY;
  if (!Number.isFinite(input.totalBudget) || input.totalBudget <= 0) return EMPTY;
  if (!Number.isFinite(input.numVariants) || input.numVariants <= 0) return EMPTY;

  const parallelFloor = resolveParallelFloor(input.floorConfig, input.totalBudget, input.agentCost);
  const parallelBudget = Math.max(0, input.totalBudget - parallelFloor);
  const maxAffordable = Math.max(1, Math.floor(parallelBudget / input.agentCost));
  const parallelDispatched = Math.min(input.numVariants, maxAffordable);

  const sequentialFloor = resolveSequentialFloor(input.floorConfig, input.totalBudget, input.agentCost, input.agentCost);
  const startingBudget = Number.isFinite(input.sequentialStartingBudget) && input.sequentialStartingBudget > 0
    ? input.sequentialStartingBudget : 0;
  const sequentialCapacity = (startingBudget - sequentialFloor) / input.agentCost;
  const sequentialByBudget = sequentialCapacity > 0 ? Math.floor(sequentialCapacity) : 0;
  const sequentialCeiling = Math.max(0, input.numVariants - parallelDispatched);
  const sequentialDispatched = Math.min(sequentialByBudget, sequentialCeiling);

  return { parallelFloor, parallelBudget, parallelDispatched, sequentialFloor, sequentialDispatched };
}

// ─── Types ───────────────────────────────────────────────────────

export interface CostSummary {
  totalCost: number | null;
  estimatedCost: number | null;
  absError: number | null;
  errorPct: number | null;
  budgetCap: number | null;
}

export interface CostByAgentRow {
  agentName: string;
  invocations: number;
  estimatedUsd: number | null;
  actualUsd: number;
  errorPct: number | null;
  coverage: 'est+act' | 'actual-only' | 'no-llm';
}

export interface CostInvocationRow {
  id: string;
  agentName: string;
  iteration: number | null;
  tactic: string | null;
  generationEstimate: number | null;
  generationActual: number | null;
  rankingEstimate: number | null;
  rankingActual: number | null;
  totalCost: number | null;
  estimationErrorPct: number | null;
}

export interface HistogramBucket {
  label: string;
  count: number;
}

export type BudgetFloorSensitivity =
  | { applicable: false; reasonNotApplicable: 'fraction_mode' | 'floor_unset' | 'parallel_failed' | 'no_gfsa' | 'missing_config' }
  | {
      applicable: true;
      drift: { estimate: number; actual: number; pct: number };
      config: {
        parallelMultiplier: number | null;
        sequentialMultiplier: number;
      };
      actual: {
        parallelDispatched: number;
        sequentialDispatched: number;
        sequentialWallMs: number | null;
      };
      projected: {
        parallelDispatched: number;
        sequentialDispatched: number;
        sequentialWallMs: number | null;
      };
      medianSequentialGfsaDurationMs: number | null;
      edge?: 'accurate' | 'ceiling_binding';
    };

export interface RunCostEstimates {
  runId: string;
  summary: CostSummary;
  costByAgent: CostByAgentRow[];
  invocations: CostInvocationRow[];
  histogram: HistogramBucket[];
  budgetFloorSensitivity: BudgetFloorSensitivity;
}

export interface StrategyCostEstimates {
  strategyId: string;
  summary: CostSummary & {
    runCount: number;
    runsWithEstimates: number;
  };
  runs: Array<{
    runId: string;
    status: string | null;
    createdAt: string;
    totalCost: number | null;
    estimatedCost: number | null;
    errorPct: number | null;
  }>;
  sliceBreakdown: Array<{
    tactic: string;
    generationModel: string | null;
    judgeModel: string | null;
    runs: number;
    avgActual: number | null;
    avgErrorPct: number | null;
  }>;
  histogram: HistogramBucket[];
  truncatedSlices: boolean;
}

// ─── Input schemas ──────────────────────────────────────────────

const runInput = z.object({ runId: z.string().uuid() });
const strategyInput = z.object({ strategyId: z.string().uuid() });

// ─── Shared helpers ─────────────────────────────────────────────

function bucketize(values: number[]): HistogramBucket[] {
  const buckets = COST_ERROR_HISTOGRAM_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const raw of values) {
    if (!Number.isFinite(raw)) {
      // Clamp infinite / NaN into outer buckets.
      if (Number.isNaN(raw)) continue;
      if (raw < 0) buckets[0]!.count += 1;
      else buckets[buckets.length - 1]!.count += 1;
      continue;
    }
    for (let i = 0; i < COST_ERROR_HISTOGRAM_BUCKETS.length; i++) {
      const b = COST_ERROR_HISTOGRAM_BUCKETS[i]!;
      if (raw >= b.min && raw < b.max) {
        buckets[i]!.count += 1;
        break;
      }
      // Edge inclusive at +Infinity top bucket
      if (i === COST_ERROR_HISTOGRAM_BUCKETS.length - 1 && raw >= b.min) {
        buckets[i]!.count += 1;
        break;
      }
    }
  }
  return buckets;
}

function safePct(actual: number, estimate: number): number | null {
  if (!Number.isFinite(estimate) || estimate <= 0) return null;
  if (!Number.isFinite(actual)) return null;
  return ((actual - estimate) / estimate) * 100;
}

async function fetchRunMetricMap(ctx: AdminContext, runId: string): Promise<Map<string, number>> {
  const { data } = await ctx.supabase
    .from('evolution_metrics')
    .select('metric_name, value')
    .eq('entity_type', 'run')
    .eq('entity_id', runId);
  const map = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ metric_name: string; value: number | string }>) {
    const n = Number(row.value);
    if (Number.isFinite(n)) map.set(row.metric_name, n);
  }
  return map;
}

async function fetchStrategyMetricMap(ctx: AdminContext, strategyId: string): Promise<Map<string, number>> {
  const { data } = await ctx.supabase
    .from('evolution_metrics')
    .select('metric_name, value')
    .eq('entity_type', 'strategy')
    .eq('entity_id', strategyId);
  const map = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ metric_name: string; value: number | string }>) {
    const n = Number(row.value);
    if (Number.isFinite(n)) map.set(row.metric_name, n);
  }
  return map;
}

type InvRow = {
  id: string;
  agent_name: string | null;
  iteration: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  execution_detail: Record<string, unknown> | null;
};

function buildCostByAgent(invocations: InvRow[]): CostByAgentRow[] {
  type Bucket = { actualUsd: number; estimatedUsd: number; hasAnyEstimate: boolean; count: number; errors: number[] };
  const byAgent = new Map<string, Bucket>();
  for (const inv of invocations) {
    const name = inv.agent_name ?? 'unknown';
    const bucket = byAgent.get(name) ?? { actualUsd: 0, estimatedUsd: 0, hasAnyEstimate: false, count: 0, errors: [] };
    bucket.count += 1;
    if (typeof inv.cost_usd === 'number' && Number.isFinite(inv.cost_usd)) {
      bucket.actualUsd += inv.cost_usd;
    }
    const d = inv.execution_detail ?? undefined;
    if (d && typeof d === 'object') {
      const est = (d as Record<string, unknown>).estimatedTotalCost;
      const err = (d as Record<string, unknown>).estimationErrorPct;
      if (typeof est === 'number' && Number.isFinite(est) && est >= 0) {
        bucket.estimatedUsd += est;
        bucket.hasAnyEstimate = true;
      }
      if (typeof err === 'number' && Number.isFinite(err)) {
        bucket.errors.push(err);
      }
    }
    byAgent.set(name, bucket);
  }
  const rows: CostByAgentRow[] = [];
  for (const [agentName, bucket] of byAgent) {
    let coverage: CostByAgentRow['coverage'];
    if (bucket.hasAnyEstimate) coverage = 'est+act';
    else if (bucket.actualUsd > 0) coverage = 'actual-only';
    else coverage = 'no-llm';
    const errorPct = bucket.errors.length > 0
      ? bucket.errors.reduce((a, b) => a + b, 0) / bucket.errors.length
      : null;
    rows.push({
      agentName,
      invocations: bucket.count,
      estimatedUsd: bucket.hasAnyEstimate ? bucket.estimatedUsd : null,
      actualUsd: bucket.actualUsd,
      errorPct,
      coverage,
    });
  }
  // Sort: agents with estimates first, then by actual cost desc.
  rows.sort((a, b) => {
    if (a.coverage === 'est+act' && b.coverage !== 'est+act') return -1;
    if (b.coverage === 'est+act' && a.coverage !== 'est+act') return 1;
    return b.actualUsd - a.actualUsd;
  });
  return rows;
}

function buildInvocationRows(invocations: InvRow[]): CostInvocationRow[] {
  return invocations.map((inv) => {
    const d = (inv.execution_detail ?? {}) as Record<string, unknown>;
    const gen = d.generation as Record<string, unknown> | undefined;
    const rank = d.ranking as Record<string, unknown> | undefined;
    const genEst = typeof gen?.estimatedCost === 'number' ? gen.estimatedCost as number : null;
    const genAct = typeof gen?.cost === 'number' ? gen.cost as number : null;
    const rankEst = typeof rank?.estimatedCost === 'number' ? rank.estimatedCost as number : null;
    const rankAct = typeof rank?.cost === 'number' ? rank.cost as number : null;
    const errPct = typeof d.estimationErrorPct === 'number' && Number.isFinite(d.estimationErrorPct)
      ? d.estimationErrorPct as number : null;
    const tactic = typeof d.strategy === 'string' ? d.strategy as string : null;
    return {
      id: inv.id,
      agentName: inv.agent_name ?? 'unknown',
      iteration: inv.iteration,
      tactic,
      generationEstimate: genEst,
      generationActual: genAct,
      rankingEstimate: rankEst,
      rankingActual: rankAct,
      totalCost: inv.cost_usd,
      estimationErrorPct: errPct,
    };
  });
}

interface BudgetFloorConfigLike {
  minBudgetAfterParallelFraction?: number;
  minBudgetAfterParallelAgentMultiple?: number;
  minBudgetAfterSequentialFraction?: number;
  minBudgetAfterSequentialAgentMultiple?: number;
  /** @deprecated Phase 4 replaced the per-strategy numVariants cap with the
   *  DISPATCH_SAFETY_CAP = 100 runtime constant. Field kept optional for legacy
   *  run_summary rows that still carry it; when absent, the sensitivity analysis
   *  falls back to DISPATCH_SAFETY_CAP as the ceiling. */
  numVariants?: number;
}

function computeBudgetFloorSensitivity(opts: {
  floorConfig: BudgetFloorConfigLike | null;
  totalBudget: number | null;
  initialAgentCostEstimate: number | null;
  actualAvgCostPerAgent: number | null;
  actualParallelDispatched: number | null;
  actualSequentialDispatched: number | null;
  medianSequentialGfsaDurationMs: number | null;
  hasGfsaInvocations: boolean;
}): BudgetFloorSensitivity {
  const {
    floorConfig, totalBudget, initialAgentCostEstimate, actualAvgCostPerAgent,
    actualParallelDispatched, actualSequentialDispatched, medianSequentialGfsaDurationMs,
    hasGfsaInvocations,
  } = opts;

  if (!hasGfsaInvocations) return { applicable: false, reasonNotApplicable: 'no_gfsa' };
  if (!floorConfig) return { applicable: false, reasonNotApplicable: 'missing_config' };

  // Sequential floor must be in AgentMultiple mode for the projection to move with drift.
  const seqMultiplier = floorConfig.minBudgetAfterSequentialAgentMultiple;
  if (seqMultiplier == null) {
    if (floorConfig.minBudgetAfterSequentialFraction != null) {
      return { applicable: false, reasonNotApplicable: 'fraction_mode' };
    }
    return { applicable: false, reasonNotApplicable: 'floor_unset' };
  }

  if (
    !Number.isFinite(actualAvgCostPerAgent ?? NaN) ||
    (actualAvgCostPerAgent ?? 0) <= 0 ||
    !Number.isFinite(initialAgentCostEstimate ?? NaN) ||
    (initialAgentCostEstimate ?? 0) <= 0
  ) {
    return { applicable: false, reasonNotApplicable: 'parallel_failed' };
  }

  if (!Number.isFinite(totalBudget ?? NaN) || (totalBudget ?? 0) <= 0) {
    return { applicable: false, reasonNotApplicable: 'missing_config' };
  }

  const estimate = initialAgentCostEstimate as number;
  const actual = actualAvgCostPerAgent as number;
  const driftPct = ((estimate - actual) / actual) * 100;

  // Projected scenario: use `actual` everywhere in the math. Compute expected dispatch
  // counts assuming that cost was known from the start.
  // Phase 4: numVariants was removed from config; legacy run_summary rows may still carry
  // it, so prefer the stored value if present, otherwise fall back to the new
  // DISPATCH_SAFETY_CAP = 100 runtime constant.
  const numVariants = floorConfig.numVariants ?? DISPATCH_SAFETY_CAP;
  // Projected parallel phase: re-run dispatch math using `actual` as the agent cost.
  // Projected sequential starting budget: the projected parallel batch would spend
  // projectedParallelDispatched * actual per-agent.
  const projCounts = projectDispatchCounts({
    totalBudget: totalBudget as number,
    numVariants,
    agentCost: actual,
    sequentialStartingBudget: (totalBudget as number) - 0, // recomputed after parallel below
    floorConfig,
  });
  // Replace sequentialStartingBudget with the post-parallel value under projected cost.
  const projectedSeqStart = (totalBudget as number) - projCounts.parallelDispatched * actual;
  const projected = projectDispatchCounts({
    totalBudget: totalBudget as number,
    numVariants,
    agentCost: actual,
    sequentialStartingBudget: projectedSeqStart,
    floorConfig,
  });

  const actualParallel = actualParallelDispatched ?? 0;
  const actualSequential = actualSequentialDispatched ?? 0;

  const medianDur = medianSequentialGfsaDurationMs;
  const actualSeqWallMs = medianDur != null ? actualSequential * medianDur : null;
  const projectedSeqWallMs = medianDur != null ? projected.sequentialDispatched * medianDur : null;

  const accurate = Math.abs(driftPct) < 2;
  const ceilingBinding = actualParallel + actualSequential >= numVariants
    && projected.parallelDispatched + projected.sequentialDispatched >= numVariants
    && actualSequential === projected.sequentialDispatched;

  return {
    applicable: true,
    drift: { estimate, actual, pct: driftPct },
    config: {
      parallelMultiplier: floorConfig.minBudgetAfterParallelAgentMultiple ?? null,
      sequentialMultiplier: seqMultiplier,
    },
    actual: {
      parallelDispatched: actualParallel,
      sequentialDispatched: actualSequential,
      sequentialWallMs: actualSeqWallMs,
    },
    projected: {
      parallelDispatched: projected.parallelDispatched,
      sequentialDispatched: projected.sequentialDispatched,
      sequentialWallMs: projectedSeqWallMs,
    },
    medianSequentialGfsaDurationMs: medianDur,
    ...(accurate ? { edge: 'accurate' as const }
      : ceilingBinding ? { edge: 'ceiling_binding' as const }
      : {}),
  };
}

// ─── Run Cost Estimates ─────────────────────────────────────────

export const getRunCostEstimatesAction = adminAction(
  'getRunCostEstimates',
  async (input: { runId: string }, ctx: AdminContext): Promise<RunCostEstimates> => {
    const { runId } = runInput.parse(input);

    const [runRow, metricMap, invRes] = await Promise.all([
      ctx.supabase
        .from('evolution_runs')
        .select('id, budget_cap_usd, run_summary')
        .eq('id', runId)
        .single(),
      fetchRunMetricMap(ctx, runId),
      ctx.supabase
        .from('evolution_agent_invocations')
        .select('id, agent_name, iteration, cost_usd, duration_ms, execution_detail')
        .eq('run_id', runId)
        .order('iteration', { ascending: true })
        .order('execution_order', { ascending: true }),
    ]);

    const runSummary = (runRow.data?.run_summary ?? null) as Record<string, unknown> | null;
    const budgetFloorConfig = (runSummary?.budgetFloorConfig ?? null) as BudgetFloorConfigLike | null;
    const budgetCap = typeof runRow.data?.budget_cap_usd === 'number'
      ? (runRow.data.budget_cap_usd as number)
      : runRow.data?.budget_cap_usd != null ? Number(runRow.data.budget_cap_usd) : null;

    const invocations = (invRes.data ?? []) as InvRow[];

    const summary: CostSummary = {
      totalCost: metricMap.get('cost') ?? null,
      estimatedCost: metricMap.get('estimated_cost') ?? null,
      absError: metricMap.get('estimation_abs_error_usd') ?? null,
      errorPct: metricMap.get('cost_estimation_error_pct') ?? null,
      budgetCap: Number.isFinite(budgetCap ?? NaN) ? budgetCap : null,
    };

    const costByAgent = buildCostByAgent(invocations);
    const rows = buildInvocationRows(invocations);
    const histogram = bucketize(rows
      .map((r) => r.estimationErrorPct)
      .filter((x): x is number => typeof x === 'number'));

    const hasGfsaInvocations = invocations.some((i) => i.agent_name === 'generate_from_previous_article');

    const budgetFloorSensitivity = computeBudgetFloorSensitivity({
      floorConfig: budgetFloorConfig,
      totalBudget: budgetCap,
      initialAgentCostEstimate: metricMap.get('agent_cost_projected') ?? null,
      actualAvgCostPerAgent: metricMap.get('agent_cost_actual') ?? null,
      actualParallelDispatched: metricMap.get('parallel_dispatched') ?? null,
      actualSequentialDispatched: metricMap.get('sequential_dispatched') ?? null,
      medianSequentialGfsaDurationMs: metricMap.get('median_sequential_gfsa_duration_ms') ?? null,
      hasGfsaInvocations,
    });

    return {
      runId,
      summary,
      costByAgent,
      invocations: rows,
      histogram,
      budgetFloorSensitivity,
    };
  },
);

// ─── Strategy Cost Estimates ────────────────────────────────────

export const getStrategyCostEstimatesAction = adminAction(
  'getStrategyCostEstimates',
  async (input: { strategyId: string }, ctx: AdminContext): Promise<StrategyCostEstimates> => {
    const { strategyId } = strategyInput.parse(input);

    const [stratMetricMap, runsRes] = await Promise.all([
      fetchStrategyMetricMap(ctx, strategyId),
      ctx.supabase
        .from('evolution_runs')
        .select('id, status, created_at')
        .eq('strategy_id', strategyId)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    const runList = (runsRes.data ?? []) as Array<{ id: string; status: string; created_at: string }>;
    const runIds = runList.map((r) => r.id);

    const runMetricsByRun = new Map<string, Map<string, number>>();
    if (runIds.length > 0) {
      const { data: metricRows } = await ctx.supabase
        .from('evolution_metrics')
        .select('entity_id, metric_name, value')
        .eq('entity_type', 'run')
        .in('entity_id', runIds)
        .in('metric_name', ['cost', 'estimated_cost', 'cost_estimation_error_pct']);
      for (const row of (metricRows ?? []) as Array<{ entity_id: string; metric_name: string; value: number | string }>) {
        const n = Number(row.value);
        if (!Number.isFinite(n)) continue;
        const inner = runMetricsByRun.get(row.entity_id) ?? new Map<string, number>();
        inner.set(row.metric_name, n);
        runMetricsByRun.set(row.entity_id, inner);
      }
    }

    const runs = runList.map((r) => {
      const inner = runMetricsByRun.get(r.id) ?? new Map();
      return {
        runId: r.id,
        status: r.status,
        createdAt: r.created_at,
        totalCost: inner.get('cost') ?? null,
        estimatedCost: inner.get('estimated_cost') ?? null,
        errorPct: inner.get('cost_estimation_error_pct') ?? null,
      };
    });

    const errorPctValues = runs
      .map((r) => r.errorPct)
      .filter((x): x is number => typeof x === 'number');
    const histogram = bucketize(errorPctValues);

    const runsWithEstimates = runs.filter((r) => r.errorPct != null).length;

    // Slice breakdown — query GFSA invocations for this strategy's child runs and group.
    type SliceBucket = { actuals: number[]; errors: number[]; tactic: string; generationModel: string | null; judgeModel: string | null };
    const slices = new Map<string, SliceBucket>();
    if (runIds.length > 0) {
      const { data: invs } = await ctx.supabase
        .from('evolution_agent_invocations')
        .select('agent_name, cost_usd, execution_detail, run_id')
        .in('run_id', runIds)
        .eq('agent_name', 'generate_from_previous_article');

      // Fetch strategy config once to get generation/judge model names.
      const { data: stratRow } = await ctx.supabase
        .from('evolution_strategies')
        .select('config')
        .eq('id', strategyId)
        .single();
      const stratConfig = (stratRow?.config ?? {}) as { generationModel?: string; judgeModel?: string };

      for (const inv of (invs ?? []) as Array<{ agent_name: string; cost_usd: number | null; execution_detail: Record<string, unknown> | null }>) {
        const d = inv.execution_detail ?? {};
        const tactic = typeof (d as Record<string, unknown>).strategy === 'string'
          ? ((d as Record<string, unknown>).strategy as string)
          : 'unknown';
        const key = `${tactic}|${stratConfig.generationModel ?? ''}|${stratConfig.judgeModel ?? ''}`;
        const slice = slices.get(key) ?? {
          actuals: [], errors: [],
          tactic,
          generationModel: stratConfig.generationModel ?? null,
          judgeModel: stratConfig.judgeModel ?? null,
        };
        if (typeof inv.cost_usd === 'number' && Number.isFinite(inv.cost_usd)) {
          slice.actuals.push(inv.cost_usd);
        }
        const err = (d as Record<string, unknown>).estimationErrorPct;
        if (typeof err === 'number' && Number.isFinite(err)) slice.errors.push(err);
        slices.set(key, slice);
      }
    }

    const allSliceRows = [...slices.values()].map((s) => ({
      tactic: s.tactic,
      generationModel: s.generationModel,
      judgeModel: s.judgeModel,
      runs: s.actuals.length,
      avgActual: s.actuals.length > 0 ? s.actuals.reduce((a, b) => a + b, 0) / s.actuals.length : null,
      avgErrorPct: s.errors.length > 0 ? s.errors.reduce((a, b) => a + b, 0) / s.errors.length : null,
    }));
    allSliceRows.sort((a, b) => b.runs - a.runs);
    const sliceBreakdown = allSliceRows.slice(0, 50);
    const truncatedSlices = allSliceRows.length > 50;

    return {
      strategyId,
      summary: {
        totalCost: stratMetricMap.get('total_cost') ?? null,
        estimatedCost: stratMetricMap.get('total_estimated_cost') ?? null,
        absError: stratMetricMap.get('avg_estimation_abs_error_usd') ?? null,
        errorPct: stratMetricMap.get('avg_cost_estimation_error_pct') ?? null,
        budgetCap: null,
        runCount: runs.length,
        runsWithEstimates,
      },
      runs,
      sliceBreakdown,
      histogram,
      truncatedSlices,
    };
  },
);
