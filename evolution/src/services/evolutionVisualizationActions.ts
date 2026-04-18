'use server';
// Server actions for the evolution dashboard and visualization pages.
// V2 rewrite: uses run_summary JSONB, cost view, and variant lineage instead of checkpoints.

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid, applyNonTestStrategyFilter } from './shared';
import { EvolutionRunSummarySchema } from '@evolution/lib/types';
import { dbToRating } from '@evolution/lib/shared/computeRatings';

export interface DashboardData {
  activeRuns: number;
  queueDepth: number;
  completedRuns: number;
  failedRuns: number;
  totalRuns: number;
  totalCostUsd: number | null;
  avgCostPerRun: number | null;
  /** Standard error of the mean run cost across completed+failed runs. Null when n<2. Phase 4d. */
  seCostPerRun?: number | null;
  recentRuns: Array<{
    id: string;
    status: string;
    strategy_name: string | null;
    total_cost_usd: number;
    budget_cap_usd: number;
    explanation_id: number | null;
    error_message: string | null;
    created_at: string;
    completed_at: string | null;
  }>;
}

export interface EloHistoryPoint {
  iteration: number;
  elo: number;
  /** Top-K Elo values for this iteration (when available from V3 run_summary). */
  elos?: number[];
  /** Phase 4b: parallel array of per-top-K rating uncertainties. EloTab renders a band when present. */
  uncertainties?: number[];
}

export interface LineageNode {
  id: string;
  generation: number;
  agentName: string;
  eloScore: number;
  /** Elo-scale rating uncertainty (lifted from mu/sigma). Optional — legacy rows omit it. Phase 4b. */
  uncertainty?: number;
  isWinner: boolean;
  parentId: string | null;
  /** False = discarded by owning generate agent. Defaults true for legacy variants. */
  persisted?: boolean;
}

/** V2 lineage data format compatible with LineageGraph component. */
export interface LineageData {
  nodes: {
    id: string;
    shortId: string;
    tactic: string;
    elo: number;
    /** Elo-scale rating uncertainty (lifted from mu/sigma). Optional — legacy rows omit it. Phase 4b. */
    uncertainty?: number;
    iterationBorn: number;
    isWinner: boolean;
    treeDepth?: number | null;
    revisionAction?: string | null;
    /** False = discarded variant — rendered with reduced opacity / dashed border. */
    persisted?: boolean;
  }[];
  edges: { source: string; target: string }[];
  treeSearchPath?: string[];
}

/** Aggregate dashboard metrics from runs, invocations, and cost view. */
export const getEvolutionDashboardDataAction = adminAction(
  'getEvolutionDashboardData',
  async (input: { filterTestContent?: boolean } | undefined, ctx: AdminContext): Promise<DashboardData> => {
    const { supabase } = ctx;
    const filterTest = input?.filterTestContent ?? false;

    // Exclude test runs via PostgREST embedded !inner join against evolution_strategies.is_test_content.
    // Replaces the prior .not.in(testStrategyIds) path that silently returned empty when
    // the IN list grew past PostgREST URL limits.
    let statusQuery = filterTest
      ? supabase.from('evolution_runs').select('id, status, evolution_strategies!inner(is_test_content)')
      : supabase.from('evolution_runs').select('id, status');
    if (filterTest) statusQuery = applyNonTestStrategyFilter(statusQuery);

    let recentQuery = filterTest
      ? supabase.from('evolution_runs')
          .select('id, status, strategy_id, budget_cap_usd, explanation_id, error_message, created_at, completed_at, evolution_strategies!inner(is_test_content)')
          .order('created_at', { ascending: false })
          .limit(10)
      : supabase.from('evolution_runs')
          .select('id, status, strategy_id, budget_cap_usd, explanation_id, error_message, created_at, completed_at')
          .order('created_at', { ascending: false })
          .limit(10);
    if (filterTest) recentQuery = applyNonTestStrategyFilter(recentQuery);

    const [statusResult, recentResult] = await Promise.all([
      statusQuery,
      recentQuery,
    ]);

    // Count by status
    const runs = statusResult.data ?? [];
    const filteredRunIds = runs.map(r => (r as Record<string, unknown>).id as string).filter(Boolean);
    const activeRuns = runs.filter(r => r.status === 'running' || r.status === 'claimed').length;
    const queueDepth = runs.filter(r => r.status === 'pending').length;
    const completedRuns = runs.filter(r => r.status === 'completed').length;
    const failedRuns = runs.filter(r => r.status === 'failed').length;

    // Total cost from evolution_metrics, with fallback to evolution_run_costs view.
    // Returns null on query failure to distinguish errors from genuinely $0.00.
    let totalCostUsd: number | null = 0;
    let perRunCosts: number[] = []; // Phase 4d: per-run sample for SE computation
    if (filteredRunIds.length > 0) {
      try {
        const { data: costMetrics } = await supabase
          .from('evolution_metrics')
          .select('value')
          .eq('entity_type', 'run')
          .eq('metric_name', 'cost')
          .in('entity_id', filteredRunIds);
        perRunCosts = (costMetrics ?? []).map((m) => Number(m.value) || 0);
        totalCostUsd = perRunCosts.reduce((sum, v) => sum + v, 0);

        // Fallback: if metrics-based cost is $0, use evolution_run_costs view
        // which aggregates directly from evolution_agent_invocations.cost_usd
        if (totalCostUsd === 0) {
          const { data: viewCosts } = await supabase
            .from('evolution_run_costs')
            .select('total_cost_usd')
            .in('run_id', filteredRunIds);
          perRunCosts = (viewCosts ?? []).map((c) => Number(c.total_cost_usd) || 0);
          totalCostUsd = perRunCosts.reduce((sum, v) => sum + v, 0);
        }
      } catch (err) {
        console.error('[Dashboard] Cost aggregation failed:', err);
        totalCostUsd = null;
      }
    }
    const runCount = completedRuns + failedRuns;
    const avgCostPerRun = runCount > 0 && totalCostUsd != null ? totalCostUsd / runCount : null;

    // Phase 4d: SE of the mean run cost across the sampled runs. Only computed when we
    // have ≥2 data points; enables the dashboard to render the aggregate with a
    // confidence band rather than a point estimate.
    let seCostPerRun: number | null = null;
    if (perRunCosts.length >= 2 && avgCostPerRun != null) {
      const n = perRunCosts.length;
      const variance = perRunCosts.reduce((acc, c) => acc + (c - avgCostPerRun) ** 2, 0) / (n - 1);
      seCostPerRun = Math.sqrt(variance / n);
    }

    // Enrich recent runs with strategy names and costs
    const recentRuns = (recentResult.data ?? []) as unknown as Array<{
      id: string; status: string; strategy_id: string | null;
      error_message: string | null;
      created_at: string; completed_at: string | null;
    }>;
    const strategyIds = [...new Set(recentRuns.map(r => r.strategy_id).filter((id): id is string => !!id))];
    const runIds = recentRuns.map(r => r.id);

    const [stratMap, costMap] = await Promise.all([
      strategyIds.length > 0
        ? supabase.from('evolution_strategies').select('id, name').in('id', strategyIds)
            .then(({ data, error }) => { if (error) throw error; return new Map((data ?? []).map(s => [s.id as string, s.name as string])); })
        : Promise.resolve(new Map<string, string>()),
      runIds.length > 0
        ? supabase.from('evolution_metrics').select('entity_id, value')
            .eq('entity_type', 'run').eq('metric_name', 'cost').in('entity_id', runIds)
            .then(async ({ data, error }) => {
              if (error) throw error;
              const map = new Map((data ?? []).map(c => [c.entity_id as string, Number(c.value) || 0]));
              // Fallback: fill missing costs from evolution_run_costs view
              const missingIds = runIds.filter(id => !map.has(id) || map.get(id) === 0);
              if (missingIds.length > 0) {
                const { data: viewCosts } = await supabase
                  .from('evolution_run_costs')
                  .select('run_id, total_cost_usd')
                  .in('run_id', missingIds);
                for (const c of viewCosts ?? []) {
                  const cost = Number(c.total_cost_usd) || 0;
                  if (cost > 0) map.set(c.run_id as string, cost);
                }
              }
              return map;
            })
        : Promise.resolve(new Map<string, number>()),
    ]);

    return {
      activeRuns,
      queueDepth,
      completedRuns,
      failedRuns,
      totalRuns: runs.length,
      totalCostUsd,
      avgCostPerRun,
      seCostPerRun,
      recentRuns: recentRuns.map(r => ({
        id: r.id,
        status: r.status,
        strategy_name: stratMap.get(r.strategy_id ?? '') ?? null,
        total_cost_usd: costMap.get(r.id) ?? 0,
        budget_cap_usd: Number((r as Record<string, unknown>).budget_cap_usd) || 0,
        explanation_id: ((r as Record<string, unknown>).explanation_id as number | null) ?? null,
        error_message: r.error_message ?? null,
        created_at: r.created_at,
        completed_at: r.completed_at,
      })),
    };
  },
);

/** Get Elo history for a run from run_summary.eloHistory (legacy muHistory normalized via schema preprocess). */
export const getEvolutionRunEloHistoryAction = adminAction(
  'getEvolutionRunEloHistory',
  async (runId: string, ctx: AdminContext): Promise<EloHistoryPoint[]> => {
    if (!validateUuid(runId)) throw new Error('Invalid runId');

    const { data, error } = await ctx.supabase
      .from('evolution_runs')
      .select('run_summary')
      .eq('id', runId)
      .single();

    if (error) throw error;
    if (!data?.run_summary) return [];

    const parsed = EvolutionRunSummarySchema.safeParse(data.run_summary);
    if (!parsed.success) return [];

    // eloHistory stores Elo values for new runs; legacy runs stored TrueSkill mu (~25-50).
    // Heuristic: values < 100 are mu-scale; convert to Elo via 1200 + (mu-25)*16.
    const toElo = (v: number): number => (v < 100 ? 1200 + (v - 25) * 16 : v);
    // Phase 4b: parallel uncertaintyHistory (optional). Already on Elo scale.
    const uncertaintyArr = parsed.data.uncertaintyHistory;
    return (parsed.data.eloHistory ?? []).map((vals, i) => {
      const elos = vals.map(toElo);
      const uncertainties = uncertaintyArr?.[i];
      return {
        iteration: i + 1,
        elo: elos[0] ?? 0,
        elos: elos.length > 1 ? elos : undefined,
        ...(uncertainties && uncertainties.length > 0 ? { uncertainties } : {}),
      };
    });
  },
);

/** Get variant lineage graph for a run. */
export const getEvolutionRunLineageAction = adminAction(
  'getEvolutionRunLineage',
  async (runId: string, ctx: AdminContext): Promise<LineageNode[]> => {
    if (!validateUuid(runId)) throw new Error('Invalid runId');

    const { data, error } = await ctx.supabase
      .from('evolution_variants')
      .select('id, generation, agent_name, elo_score, mu, sigma, is_winner, parent_variant_id, persisted')
      .eq('run_id', runId)
      .order('generation', { ascending: true });

    if (error) throw error;

    return (data ?? []).map(v => {
      const row = v as { mu?: number | null; sigma?: number | null };
      const uncertainty = row.mu != null && row.sigma != null
        ? dbToRating(row.mu, row.sigma).uncertainty
        : undefined;
      return {
        id: v.id,
        generation: v.generation,
        agentName: v.agent_name,
        eloScore: v.elo_score,
        ...(uncertainty != null ? { uncertainty } : {}),
        isWinner: v.is_winner,
        parentId: v.parent_variant_id,
        // Default true for legacy rows that pre-date the persisted column.
        persisted: (v as { persisted?: boolean | null }).persisted ?? true,
      };
    });
  },
);
