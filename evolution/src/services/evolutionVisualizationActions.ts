'use server';
// Server actions for the evolution dashboard and visualization pages.
// V2 rewrite: uses run_summary JSONB, cost view, and variant lineage instead of checkpoints.

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid } from './shared';
import { EvolutionRunSummarySchema } from '@evolution/lib/types';

export interface DashboardData {
  activeRuns: number;
  queueDepth: number;
  completedRuns: number;
  failedRuns: number;
  totalCostUsd: number;
  avgCostPerRun: number;
  recentRuns: Array<{
    id: string;
    status: string;
    strategy_name: string | null;
    total_cost_usd: number;
    created_at: string;
    completed_at: string | null;
  }>;
}

export interface EloHistoryPoint {
  iteration: number;
  mu: number;
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
    // This avoids !inner joins which depend on FK constraints + PostgREST schema cache.
    let testStrategyIds: string[] = [];
    if (filterTest) {
      const { data: testStrategies } = await supabase
        .from('evolution_strategies')
        .select('id')
        .ilike('name', '%[TEST]%');
      testStrategyIds = (testStrategies ?? []).map(s => s.id as string);
    }

    // Build queries — order matters for deterministic mock testing: status, cost, recent.
    let statusQuery = supabase.from('evolution_runs').select('status');
    if (filterTest && testStrategyIds.length > 0) {
      statusQuery = statusQuery.not('strategy_id', 'in', `(${testStrategyIds.join(',')})`);
    }

    const costQuery = supabase.from('evolution_run_costs').select('total_cost_usd');

    let recentQuery = supabase.from('evolution_runs')
      .select('id, status, strategy_id, created_at, completed_at')
      .eq('archived', false)
      .order('created_at', { ascending: false })
      .limit(10);
    if (filterTest && testStrategyIds.length > 0) {
      recentQuery = recentQuery.not('strategy_id', 'in', `(${testStrategyIds.join(',')})`);
    }

    // Parallel queries for status counts, costs, and recent runs
    const [statusResult, costResult, recentResult] = await Promise.all([
      statusQuery,
      costQuery,
      recentQuery,
    ]);

    // Count by status
    const runs = (statusResult.data ?? []) as unknown as Array<{ status: string }>;
    const activeRuns = runs.filter(r => r.status === 'running' || r.status === 'claimed').length;
    const queueDepth = runs.filter(r => r.status === 'pending').length;
    const completedRuns = runs.filter(r => r.status === 'completed').length;
    const failedRuns = runs.filter(r => r.status === 'failed').length;

    // Total cost — when filtering, exclude test run costs
    let totalCostUsd: number;
    const allCosts = costResult.data ?? [];
    if (filterTest && testStrategyIds.length > 0) {
      const { data: filteredRuns } = await supabase
        .from('evolution_runs')
        .select('id')
        .not('strategy_id', 'in', `(${testStrategyIds.join(',')})`);
      const filteredRunIds = (filteredRuns ?? []).map(r => r.id as string);
      if (filteredRunIds.length > 0) {
        const { data: filteredCosts } = await supabase
          .from('evolution_run_costs')
          .select('total_cost_usd')
          .in('run_id', filteredRunIds);
        totalCostUsd = (filteredCosts ?? []).reduce(
          (sum: number, c: { total_cost_usd: string | number }) => sum + (Number(c.total_cost_usd) || 0), 0,
        );
      } else {
        totalCostUsd = 0;
      }
    } else {
      totalCostUsd = allCosts.reduce(
        (sum, c) => sum + (Number(c.total_cost_usd) || 0), 0,
      );
    }

    const runCount = completedRuns + failedRuns;
    const avgCostPerRun = runCount > 0 ? totalCostUsd / runCount : 0;

    // Enrich recent runs with strategy names and costs
    const recentRuns = (recentResult.data ?? []) as unknown as Array<{
      id: string; status: string; strategy_id: string | null;
      created_at: string; completed_at: string | null;
    }>;
    const strategyIds = [...new Set(recentRuns.map(r => r.strategy_id).filter((id): id is string => !!id))];
    const runIds = recentRuns.map(r => r.id);

    const [stratMap, costMap] = await Promise.all([
      strategyIds.length > 0
        ? supabase.from('evolution_strategies').select('id, name').in('id', strategyIds)
            .then(({ data }) => new Map((data ?? []).map(s => [s.id as string, s.name as string])))
        : Promise.resolve(new Map<string, string>()),
      runIds.length > 0
        ? supabase.from('evolution_run_costs').select('run_id, total_cost_usd').in('run_id', runIds)
            .then(({ data }) => new Map((data ?? []).map(c => [c.run_id as string, Number(c.total_cost_usd) || 0])))
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

    return (parsed.data.muHistory ?? []).map((mus, i) => ({ iteration: i + 1, mu: mus[0] ?? 0 }));
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
