'use server';
// Server actions for the evolution pipeline admin UI.
// Provides CRUD for evolution runs, variant listing, cost breakdown, and logs.

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid, getTestStrategyIds } from './shared';
import { logger } from '@/lib/server_utilities';
import { logAdminAction } from '@/lib/services/auditLog';
import { createEntityLogger } from '@evolution/lib/pipeline/infra/createEntityLogger';
import type { EvolutionRunSummary } from '@evolution/lib/types';
import { EvolutionRunSummarySchema } from '@evolution/lib/types';
import { getMetricsForEntities } from '@evolution/lib/metrics/readMetrics';
import { getListViewMetrics } from '@evolution/lib/metrics/registry';
import type { MetricRow } from '@evolution/lib/metrics/types';
import { z } from 'zod';

// ─── Types ───────────────────────────────────────────────────────

/** V2 run shape — no total_cost_usd column, no phase column, no config JSONB.
 * Cost is sourced from `evolution_metrics` (the `cost`, `generation_cost`, `ranking_cost`
 * rows) via the `metrics` enriched field, not from a per-row aggregate. */
export interface EvolutionRun {
  id: string;
  explanation_id: number | null;
  status: string;
  budget_cap_usd: number;
  error_message: string | null;
  completed_at: string | null;
  created_at: string;
  prompt_id: string | null;
  pipeline_version: string;
  strategy_id: string;
  experiment_id: string | null;
  archived: boolean;
  run_summary: EvolutionRunSummary | null;
  runner_id: string | null;
  last_heartbeat: string | null;
  /** Enriched fields (not DB columns) */
  metrics?: MetricRow[];
  experiment_name?: string | null;
  strategy_name?: string | null;
  prompt_name?: string | null;
  explanation_title?: string | null;
}

export interface EvolutionVariant {
  id: string;
  run_id: string;
  explanation_id: number | null;
  variant_content: string;
  elo_score: number;
  generation: number;
  agent_name: string;
  match_count: number;
  is_winner: boolean;
  created_at: string;
  /** Whether this variant survived the discard rule and is part of the final pool. */
  persisted?: boolean;
}

export interface AgentCostBreakdown {
  agent: string;
  calls: number;
  costUsd: number;
}

export interface RunLogEntry {
  id: number;
  created_at: string;
  level: string;
  agent_name: string | null;
  iteration: number | null;
  variant_id: string | null;
  message: string;
  context: Record<string, unknown> | null;
}

export interface RunLogFilters {
  level?: string;
  agentName?: string;
  iteration?: number;
  variantId?: string;
  limit?: number;
  offset?: number;
}

export interface VariantListEntry {
  id: string;
  run_id: string;
  explanation_id: number | null;
  elo_score: number;
  generation: number;
  agent_name: string;
  match_count: number;
  is_winner: boolean;
  created_at: string;
  strategy_name?: string | null;
}

const listVariantsInputSchema = z.object({
  runId: z.string().uuid().optional(),
  agentName: z.string().optional(),
  isWinner: z.boolean().optional(),
  filterTestContent: z.boolean().optional(),
  /** Default false — only return variants that survived to the final pool. */
  includeDiscarded: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export type ListVariantsInput = z.input<typeof listVariantsInputSchema>;

// ─── Actions ─────────────────────────────────────────────────────

export const queueEvolutionRunAction = adminAction(
  'queueEvolutionRunAction',
  async (
    input: {
      explanationId?: number;
      budgetCapUsd?: number;
      promptId?: string;
      strategyId: string;
    },
    ctx: AdminContext,
  ): Promise<EvolutionRun> => {
    const { supabase, adminUserId } = ctx;

    if (!validateUuid(input.strategyId)) throw new Error('Invalid strategyId');
    if (input.promptId && !validateUuid(input.promptId)) throw new Error('Invalid promptId');

    if (!input.explanationId && !input.promptId) {
      throw new Error('Either explanationId or promptId is required');
    }

    if (input.promptId) {
      const { data: prompt } = await supabase
        .from('evolution_prompts')
        .select('id')
        .eq('id', input.promptId)
        .is('deleted_at', null)
        .single();
      if (!prompt) throw new Error(`Prompt not found: ${input.promptId}`);
    }

    const { data: strategy } = await supabase
      .from('evolution_strategies')
      .select('id, status')
      .eq('id', input.strategyId)
      .single();

    if (!strategy) throw new Error(`Strategy not found: ${input.strategyId}`);
    if (strategy.status === 'archived') {
      throw new Error(`Strategy "${input.strategyId}" is archived and cannot be used for new runs`);
    }

    const budgetCap = input.budgetCapUsd ?? 5.00;

    const insertRow: Record<string, unknown> = {
      budget_cap_usd: budgetCap,
      strategy_id: input.strategyId,
    };
    if (input.explanationId) insertRow.explanation_id = input.explanationId;
    if (input.promptId) insertRow.prompt_id = input.promptId;

    const { data, error } = await supabase
      .from('evolution_runs')
      .insert(insertRow)
      .select()
      .single();

    if (error) throw error;

    await logAdminAction({
      adminUserId,
      action: 'queue_evolution_run',
      entityType: 'evolution_run',
      entityId: data.id,
      details: {
        explanationId: input.explanationId,
        promptId: input.promptId,
        strategyId: input.strategyId,
        budgetCapUsd: budgetCap,
      },
    });

    const runLogger = createEntityLogger({
      entityType: 'run',
      entityId: data.id,
      runId: data.id,
      strategyId: input.strategyId,
    }, supabase);
    runLogger.info('Evolution run queued', { budgetCapUsd: budgetCap, promptId: input.promptId, explanationId: input.explanationId });

    return data as EvolutionRun;
  },
);

export const getEvolutionRunsAction = adminAction(
  'getEvolutionRunsAction',
  async (
    filters: { status?: string; promptId?: string; strategy_id?: string; includeArchived?: boolean; filterTestContent?: boolean; limit?: number; offset?: number } | undefined,
    ctx: AdminContext,
  ): Promise<{ items: EvolutionRun[]; total: number }> => {
    const { supabase } = ctx;

    const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 200);
    const offset = Math.max(filters?.offset ?? 0, 0);

    // Fetch test strategy IDs using shared helper (matches [TEST], exact "test", timestamp patterns).
    let testStrategyIds: string[] = [];
    if (filters?.filterTestContent) {
      testStrategyIds = await getTestStrategyIds(supabase);
    }

    let query = supabase
      .from('evolution_runs')
      .select('id, status, strategy_id, experiment_id, prompt_id, budget_cap_usd, error_message, created_at, completed_at, archived, pipeline_version, runner_id, run_summary, last_heartbeat', { count: 'exact' });

    if (filters?.status) query = query.eq('status', filters.status);
    if (filters?.strategy_id) {
      if (!validateUuid(filters.strategy_id)) throw new Error('Invalid strategy_id filter');
      query = query.eq('strategy_id', filters.strategy_id);
    }
    if (filters?.promptId) {
      if (!validateUuid(filters.promptId)) throw new Error('Invalid promptId filter');
      query = query.eq('prompt_id', filters.promptId);
    }
    if (filters?.filterTestContent && testStrategyIds.length > 0) {
      query = query.not('strategy_id', 'in', `(${testStrategyIds.join(',')})`);
    }

    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data: runs, error, count } = await query;
    if (error) throw error;

    const typedRuns = (runs ?? []) as EvolutionRun[];

    // Batch-fetch list-view metrics from evolution_metrics (single source of truth for cost
    // and the per-purpose generation_cost / ranking_cost split, plus other listView: true metrics).
    // Wrapped in try/catch so a transient batch-read failure degrades to "no cost shown"
    // instead of crashing the entire runs list page (which would make the admin UI unusable).
    const runIds = typedRuns.map(r => r.id);
    if (runIds.length > 0) {
      try {
        const metricNames = getListViewMetrics('run').map(d => d.name);
        const metricsByRun = await getMetricsForEntities(supabase, 'run', runIds, metricNames);
        for (const run of typedRuns) {
          run.metrics = metricsByRun.get(run.id) ?? [];
        }
      } catch (err) {
        logger.warn('getEvolutionRunsAction: metric batch fetch failed (degraded)', {
          error: err instanceof Error ? err.message : String(err),
          runCount: runIds.length,
        });
        for (const run of typedRuns) {
          run.metrics = [];
        }
      }
    }

    // Batch-fetch experiment, strategy, and explanation names
    const experimentIds = [...new Set(typedRuns.map(r => r.experiment_id).filter((id): id is string => !!id))];
    const strategyIds = [...new Set(typedRuns.map(r => r.strategy_id).filter(Boolean))];
    const explanationIds = [...new Set(typedRuns.map(r => r.explanation_id).filter((id): id is number => id != null))];

    const [experimentMap, strategyMap, explanationMap] = await Promise.all([
      experimentIds.length > 0
        ? supabase.from('evolution_experiments').select('id, name').in('id', experimentIds)
            .then(({ data, error }) => { if (error) throw error; return new Map((data ?? []).map(e => [e.id as string, e.name as string])); })
        : Promise.resolve(new Map<string, string>()),
      strategyIds.length > 0
        ? supabase.from('evolution_strategies').select('id, name').in('id', strategyIds)
            .then(({ data, error }) => { if (error) throw error; return new Map((data ?? []).map(s => [s.id as string, s.name as string])); })
        : Promise.resolve(new Map<string, string>()),
      explanationIds.length > 0
        ? supabase.from('explanations').select('id, explanation_title').in('id', explanationIds)
            .then(({ data }) => new Map((data ?? []).map(e => [String(e.id), e.explanation_title as string])))
        : Promise.resolve(new Map<string, string>()),
    ]);

    for (const run of typedRuns) {
      run.experiment_name = run.experiment_id ? experimentMap.get(run.experiment_id) ?? null : null;
      run.strategy_name = run.strategy_id ? strategyMap.get(run.strategy_id) ?? null : null;
      run.explanation_title = run.explanation_id ? explanationMap.get(String(run.explanation_id)) ?? null : null;
    }

    return { items: typedRuns, total: count ?? 0 };
  },
);

export const archiveRunAction = adminAction(
  'archiveRunAction',
  async (runId: string, ctx: AdminContext): Promise<{ archived: boolean }> => {
    if (!validateUuid(runId)) throw new Error('Invalid runId');
    const { error } = await ctx.supabase
      .from('evolution_runs')
      .update({ archived: true })
      .eq('id', runId);
    if (error) throw new Error(`Failed to archive run: ${error.message}`);
    return { archived: true };
  },
);

export const unarchiveRunAction = adminAction(
  'unarchiveRunAction',
  async (runId: string, ctx: AdminContext): Promise<{ unarchived: boolean }> => {
    if (!validateUuid(runId)) throw new Error('Invalid runId');
    const { error } = await ctx.supabase
      .from('evolution_runs')
      .update({ archived: false })
      .eq('id', runId);
    if (error) throw new Error(`Failed to unarchive run: ${error.message}`);
    return { unarchived: true };
  },
);

export const getEvolutionRunByIdAction = adminAction(
  'getEvolutionRunByIdAction',
  async (runId: string, ctx: AdminContext): Promise<EvolutionRun> => {
    if (!validateUuid(runId)) throw new Error('Invalid runId');
    const { data, error } = await ctx.supabase
      .from('evolution_runs')
      .select('*')
      .eq('id', runId)
      .single();
    if (error) throw error;

    const run = data as EvolutionRun;

    // Fetch list-view metrics (cost / generation_cost / ranking_cost / etc.) from evolution_metrics.
    // Wrapped in try/catch so a transient batch-read failure degrades to "no cost shown" instead
    // of crashing the run detail page.
    try {
      const metricNames = getListViewMetrics('run').map(d => d.name);
      const metricsByRun = await getMetricsForEntities(ctx.supabase, 'run', [runId], metricNames);
      run.metrics = metricsByRun.get(runId) ?? [];
    } catch (err) {
      logger.warn('getEvolutionRunByIdAction: metric fetch failed (degraded)', {
        error: err instanceof Error ? err.message : String(err),
        runId,
      });
      run.metrics = [];
    }

    // Fetch strategy + prompt names
    const [stratResult, promptResult] = await Promise.all([
      run.strategy_id
        ? ctx.supabase.from('evolution_strategies').select('name').eq('id', run.strategy_id).single()
        : Promise.resolve({ data: null }),
      run.prompt_id
        ? ctx.supabase.from('evolution_prompts').select('name').eq('id', run.prompt_id).single()
        : Promise.resolve({ data: null }),
    ]);
    run.strategy_name = stratResult.data?.name ?? null;
    run.prompt_name = promptResult.data?.name ?? null;

    return run;
  },
);

// ─── Iteration Snapshots ────────────────────────────────────────

export interface IterationSnapshotRow {
  iteration: number;
  iterationType: 'generate' | 'swiss';
  phase: 'start' | 'end';
  capturedAt: string;
  poolVariantIds: string[];
  ratings: Record<string, { mu: number; sigma: number }>;
  matchCounts: Record<string, number>;
  discardedVariantIds?: string[];
  discardReasons?: Record<string, { mu: number; top15Cutoff: number }>;
}

export interface SnapshotVariantInfo {
  id: string;
  agentName: string;
  persisted: boolean;
}

export interface RunSnapshotsResult {
  snapshots: IterationSnapshotRow[];
  variantInfo: Record<string, SnapshotVariantInfo>;
}

/**
 * Fetch the iteration_snapshots JSONB from the run row, plus a per-variant info map
 * (strategy + persisted) joined from evolution_variants for snapshot table display.
 */
export const getRunSnapshotsAction = adminAction(
  'getRunSnapshotsAction',
  async (runId: string, ctx: AdminContext): Promise<RunSnapshotsResult> => {
    if (!validateUuid(runId)) throw new Error('Invalid runId');
    const { data: runRow, error: runErr } = await ctx.supabase
      .from('evolution_runs')
      .select('iteration_snapshots')
      .eq('id', runId)
      .single();
    if (runErr) throw runErr;

    const rawSnapshots = (runRow?.iteration_snapshots ?? []) as IterationSnapshotRow[];
    if (!Array.isArray(rawSnapshots) || rawSnapshots.length === 0) {
      return { snapshots: [], variantInfo: {} };
    }

    // Collect every variant ID referenced across all snapshots so we can join in one query.
    const variantIds = new Set<string>();
    for (const snap of rawSnapshots) {
      for (const id of snap.poolVariantIds ?? []) variantIds.add(id);
      for (const id of snap.discardedVariantIds ?? []) variantIds.add(id);
    }

    let variantInfo: Record<string, SnapshotVariantInfo> = {};
    if (variantIds.size > 0) {
      const { data: vRows } = await ctx.supabase
        .from('evolution_variants')
        .select('id, agent_name, persisted')
        .in('id', Array.from(variantIds));
      variantInfo = Object.fromEntries(
        (vRows ?? []).map((v: { id: string; agent_name: string; persisted?: boolean | null }) => [
          v.id,
          { id: v.id, agentName: v.agent_name ?? '—', persisted: v.persisted ?? true },
        ]),
      );
    }

    return { snapshots: rawSnapshots, variantInfo };
  },
);

export const getEvolutionVariantsAction = adminAction(
  'getEvolutionVariantsAction',
  async (
    args: string | { runId: string; includeDiscarded?: boolean },
    ctx: AdminContext,
  ): Promise<EvolutionVariant[]> => {
    // Backward-compat: accept either a bare runId or { runId, includeDiscarded }.
    const runId = typeof args === 'string' ? args : args.runId;
    const includeDiscarded = typeof args === 'string' ? false : (args.includeDiscarded ?? false);
    if (!validateUuid(runId)) throw new Error('Invalid runId');
    let query = ctx.supabase
      .from('evolution_variants')
      .select('id, run_id, explanation_id, variant_content, elo_score, generation, agent_name, match_count, is_winner, created_at, persisted')
      .eq('run_id', runId);
    if (!includeDiscarded) {
      // Default behavior: only show variants that survived to the final pool.
      query = query.eq('persisted', true);
    }
    const { data, error } = await query.order('elo_score', { ascending: false });
    if (error) throw error;
    return (data ?? []) as EvolutionVariant[];
  },
);

export const getEvolutionRunSummaryAction = adminAction(
  'getEvolutionRunSummaryAction',
  async (runId: string, ctx: AdminContext): Promise<EvolutionRunSummary | null> => {
    if (!validateUuid(runId)) throw new Error('Invalid runId');
    const { data, error } = await ctx.supabase
      .from('evolution_runs')
      .select('run_summary')
      .eq('id', runId)
      .single();
    if (error) throw error;
    if (!data?.run_summary) return null;

    const parsed = EvolutionRunSummarySchema.safeParse(data.run_summary);
    if (!parsed.success) {
      logger.warn('Invalid run_summary in database', {
        runId,
        errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      return null;
    }
    return parsed.data;
  },
);

export const getEvolutionCostBreakdownAction = adminAction(
  'getEvolutionCostBreakdownAction',
  async (runId: string, ctx: AdminContext): Promise<AgentCostBreakdown[]> => {
    if (!validateUuid(runId)) throw new Error('Invalid runId');
    const { data: invocations, error } = await ctx.supabase
      .from('evolution_agent_invocations')
      .select('agent_name, cost_usd')
      .eq('run_id', runId);
    if (error) throw error;

    const costByAgent = new Map<string, { calls: number; costUsd: number }>();
    for (const inv of invocations ?? []) {
      const agent = inv.agent_name as string;
      const cost = Number(inv.cost_usd) || 0;
      const entry = costByAgent.get(agent) ?? { calls: 0, costUsd: 0 };
      entry.calls += 1;
      entry.costUsd += cost;
      costByAgent.set(agent, entry);
    }

    return Array.from(costByAgent.entries())
      .map(([agent, stats]) => ({ agent, ...stats }))
      .sort((a, b) => b.costUsd - a.costUsd);
  },
);

export const getEvolutionRunLogsAction = adminAction(
  'getEvolutionRunLogsAction',
  async (
    args: { runId: string; filters?: RunLogFilters },
    ctx: AdminContext,
  ): Promise<{ items: RunLogEntry[]; total: number }> => {
    const { runId, filters } = args;
    if (!validateUuid(runId)) throw new Error('Invalid runId');

    let query = ctx.supabase
      .from('evolution_logs')
      .select('id, created_at, level, agent_name, iteration, variant_id, message, context', { count: 'exact' })
      .eq('run_id', runId)
      .order('created_at', { ascending: true });

    if (filters?.level) query = query.eq('level', filters.level);
    if (filters?.agentName) query = query.eq('agent_name', filters.agentName);
    if (filters?.iteration !== undefined) query = query.eq('iteration', filters.iteration);
    if (filters?.variantId) query = query.eq('variant_id', filters.variantId);

    const limit = Math.max(1, Math.min(filters?.limit ?? 200, 1000));
    const offset = Math.max(0, filters?.offset ?? 0);
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return { items: (data as RunLogEntry[]) ?? [], total: count ?? 0 };
  },
);

export const killEvolutionRunAction = adminAction(
  'killEvolutionRunAction',
  async (runId: string, ctx: AdminContext): Promise<EvolutionRun> => {
    if (!validateUuid(runId)) throw new Error('Invalid runId');
    const { supabase, adminUserId } = ctx;

    const { data, error } = await supabase
      .from('evolution_runs')
      .update({
        status: 'failed',
        error_message: 'Manually killed by admin',
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId)
      .in('status', ['pending', 'claimed', 'running'])
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Cannot kill run ${runId}: run not found or already in terminal state`);
    }

    await logAdminAction({
      adminUserId,
      action: 'kill_evolution_run',
      entityType: 'evolution_run',
      entityId: runId,
    });

    const runLogger = createEntityLogger({
      entityType: 'run',
      entityId: runId,
      runId,
      experimentId: (data as EvolutionRun).experiment_id ?? undefined,
      strategyId: (data as EvolutionRun).strategy_id,
    }, supabase);
    runLogger.warn('Run cancelled by admin');

    logger.info('Evolution run killed by admin', { runId, adminUserId });
    return data as EvolutionRun;
  },
);

export const listVariantsAction = adminAction(
  'listVariantsAction',
  async (
    input: ListVariantsInput,
    ctx: AdminContext,
  ): Promise<{ items: VariantListEntry[]; total: number }> => {
    const parsed = listVariantsInputSchema.parse(input);
    const { supabase } = ctx;

    // Fetch test strategy IDs, then find their run IDs, then exclude those variants.
    // This avoids nested !inner joins which depend on FK constraints + PostgREST schema cache.
    const baseFields = 'id, run_id, explanation_id, elo_score, generation, agent_name, match_count, is_winner, created_at';
    let testRunIds: string[] = [];
    if (parsed.filterTestContent) {
      const testStrategyIds = await getTestStrategyIds(supabase);
      if (testStrategyIds.length > 0) {
        const { data: testRuns } = await supabase
          .from('evolution_runs')
          .select('id')
          .in('strategy_id', testStrategyIds);
        testRunIds = (testRuns ?? []).map(r => r.id as string);
      }
    }

    let query = supabase
      .from('evolution_variants')
      .select(baseFields, { count: 'exact' });

    if (parsed.runId) query = query.eq('run_id', parsed.runId);
    if (parsed.agentName) query = query.eq('agent_name', parsed.agentName);
    if (parsed.isWinner !== undefined) query = query.eq('is_winner', parsed.isWinner);
    if (!parsed.includeDiscarded) {
      // Default: only show variants that survived to the final pool.
      query = query.eq('persisted', true);
    }
    if (parsed.filterTestContent && testRunIds.length > 0) {
      query = query.not('run_id', 'in', `(${testRunIds.join(',')})`);
    }

    query = query.order('created_at', { ascending: false })
      .range(parsed.offset, parsed.offset + parsed.limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    const items = (data ?? []) as VariantListEntry[];

    // Post-fetch enrichment: batch-fetch strategy names via runs
    const runIds = [...new Set(items.map(v => v.run_id).filter(Boolean))];
    if (runIds.length > 0) {
      const { data: runData, error: runDataError } = await supabase
        .from('evolution_runs')
        .select('id, strategy_id')
        .in('id', runIds);
      if (runDataError) throw runDataError;

      const runMap = new Map((runData ?? []).map(r => [r.id as string, r.strategy_id as string | null]));
      const strategyIds = [...new Set((runData ?? []).map(r => r.strategy_id as string | null).filter((id): id is string => !!id))];

      const strategyMap = strategyIds.length > 0
        ? await supabase.from('evolution_strategies').select('id, name').in('id', strategyIds)
            .then(({ data: d, error: e }) => { if (e) throw e; return new Map((d ?? []).map(s => [s.id as string, s.name as string])); })
        : new Map<string, string>();

      for (const item of items) {
        const strategyId = runMap.get(item.run_id);
        item.strategy_name = strategyId ? strategyMap.get(strategyId) ?? null : null;
      }
    }

    return { items, total: count ?? 0 };
  },
);
