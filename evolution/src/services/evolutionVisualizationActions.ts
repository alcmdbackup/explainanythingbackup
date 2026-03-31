'use server';
// Server actions for the evolution dashboard and visualization pages.
// V2 rewrite: uses run_summary JSONB, cost view, and variant lineage instead of checkpoints.

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid, getTestStrategyIds } from './shared';
import { EvolutionRunSummarySchema } from '@evolution/lib/types';

export interface DashboardData {
  activeRuns: number;
  queueDepth: number;
  completedRuns: number;
  failedRuns: number;
  totalCostUsd: number | null;
  avgCostPerRun: number | null;
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
  mu: number;
  /** Top-K mu values for this iteration (when available from V3 run_summary). */
  mus?: number[];
}

export interface LineageNode {
  id: string;
  generation: number;
  agentName: string;
  eloScore: number;
  isWinner: boolean;
  parentId: string | null;
}

/** V2 lineage data format compatible with LineageGraph component. */
export interface LineageData {
  nodes: {
    id: string;
    shortId: string;
    strategy: string;
    elo: number;
    iterationBorn: number;
    isWinner: boolean;
    treeDepth?: number | null;
    revisionAction?: string | null;
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

    // Fetch test strategy IDs first (small set), then exclude their runs.
    // Uses shared helper that matches [TEST], exact "test"/"Test", and timestamp patterns.
    let testStrategyIds: string[] = [];
    if (filterTest) {
      testStrategyIds = await getTestStrategyIds(supabase);
    }

    // Build queries — status needs id for cost metric lookup
    let statusQuery = supabase.from('evolution_runs').select('id, status');
    if (filterTest && testStrategyIds.length > 0) {
      statusQuery = statusQuery.not('strategy_id', 'in', `(${testStrategyIds.join(',')})`);
    }

    let recentQuery = supabase.from('evolution_runs')
      .select('id, status, strategy_id, budget_cap_usd, explanation_id, error_message, created_at, completed_at')
      .order('created_at', { ascending: false })
      .limit(10);
    if (filterTest && testStrategyIds.length > 0) {
      recentQuery = recentQuery.not('strategy_id', 'in', `(${testStrategyIds.join(',')})`);
    }

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
    if (filteredRunIds.length > 0) {
      try {
        const { data: costMetrics } = await supabase
          .from('evolution_metrics')
          .select('value')
          .eq('entity_type', 'run')
          .eq('metric_name', 'cost')
          .in('entity_id', filteredRunIds);
        totalCostUsd = (costMetrics ?? []).reduce((sum, m) => sum + (Number(m.value) || 0), 0);

        // Fallback: if metrics-based cost is $0, use evolution_run_costs view
        // which aggregates directly from evolution_agent_invocations.cost_usd
        if (totalCostUsd === 0) {
          const { data: viewCosts } = await supabase
            .from('evolution_run_costs')
            .select('total_cost_usd')
            .in('run_id', filteredRunIds);
          totalCostUsd = (viewCosts ?? []).reduce((sum, c) => sum + (Number(c.total_cost_usd) || 0), 0);
        }
      } catch (err) {
        console.error('[Dashboard] Cost aggregation failed:', err);
        totalCostUsd = null;
      }
    }
    const runCount = completedRuns + failedRuns;
    const avgCostPerRun = runCount > 0 && totalCostUsd != null ? totalCostUsd / runCount : null;

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
      totalCostUsd,
      avgCostPerRun,
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

/** Get Elo/mu history for a run from run_summary.muHistory. */
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

    return (parsed.data.muHistory ?? []).map((mus, i) => ({
      iteration: i + 1,
      mu: mus[0] ?? 0,
      mus: mus.length > 1 ? mus : undefined,
    }));
  },
);

/** Get variant lineage graph for a run. */
export const getEvolutionRunLineageAction = adminAction(
  'getEvolutionRunLineage',
  async (runId: string, ctx: AdminContext): Promise<LineageNode[]> => {
    if (!validateUuid(runId)) throw new Error('Invalid runId');

    const { data, error } = await ctx.supabase
      .from('evolution_variants')
      .select('id, generation, agent_name, elo_score, is_winner, parent_variant_id')
      .eq('run_id', runId)
      .order('generation', { ascending: true });

    if (error) throw error;

    return (data ?? []).map(v => ({
      id: v.id,
      generation: v.generation,
      agentName: v.agent_name,
      eloScore: v.elo_score,
      isWinner: v.is_winner,
      parentId: v.parent_variant_id,
    }));
  },
);
