'use server';
// Server actions for the evolution pipeline admin UI.
// Provides CRUD for evolution runs, variant listing, cost breakdown, and logs.

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid } from './shared';
import { logger } from '@/lib/server_utilities';
import { logAdminAction } from '@/lib/services/auditLog';
import type { EvolutionRunSummary } from '@evolution/lib/types';
import { EvolutionRunSummarySchema } from '@evolution/lib/types';
import { z } from 'zod';

// ─── Types ───────────────────────────────────────────────────────

/** V2 run shape — no total_cost_usd column, no phase column, no config JSONB. */
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
  strategy_config_id: string;
  experiment_id: string | null;
  archived: boolean;
  run_summary: EvolutionRunSummary | null;
  runner_id: string | null;
  last_heartbeat: string | null;
  /** Enriched fields (not DB columns) */
  total_cost_usd?: number;
  experiment_name?: string | null;
  strategy_name?: string | null;
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
        .from('evolution_arena_topics')
        .select('id')
        .eq('id', input.promptId)
        .is('deleted_at', null)
        .single();
      if (!prompt) throw new Error(`Prompt not found: ${input.promptId}`);
    }

    const { data: strategy } = await supabase
      .from('evolution_strategy_configs')
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
      strategy_config_id: input.strategyId,
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

    return data as EvolutionRun;
  },
);

export const getEvolutionRunsAction = adminAction(
  'getEvolutionRunsAction',
  async (
    filters: { status?: string; promptId?: string; includeArchived?: boolean } | undefined,
    ctx: AdminContext,
  ): Promise<EvolutionRun[]> => {
    const { supabase } = ctx;

    let query = supabase
      .from('evolution_runs')
      .select('*');

    if (filters?.status) query = query.eq('status', filters.status);
    if (!filters?.includeArchived) query = query.eq('archived', false);
    if (filters?.promptId) {
      if (!validateUuid(filters.promptId)) throw new Error('Invalid promptId filter');
      query = query.eq('prompt_id', filters.promptId);
    }

    query = query.order('created_at', { ascending: false }).limit(50);

    const { data: runs, error } = await query;
    if (error) throw error;

    const typedRuns = (runs ?? []) as EvolutionRun[];

    // Batch-fetch costs from view
    const runIds = typedRuns.map(r => r.id);
    if (runIds.length > 0) {
      const { data: costs } = await supabase
        .from('evolution_run_costs')
        .select('run_id, total_cost_usd')
        .in('run_id', runIds);

      const costMap = new Map((costs ?? []).map(c => [c.run_id as string, Number(c.total_cost_usd) || 0]));
      for (const run of typedRuns) {
        run.total_cost_usd = costMap.get(run.id) ?? 0;
      }
    }

    // Batch-fetch experiment and strategy names
    const experimentIds = [...new Set(typedRuns.map(r => r.experiment_id).filter((id): id is string => !!id))];
    const strategyIds = [...new Set(typedRuns.map(r => r.strategy_config_id).filter(Boolean))];

    const [experimentMap, strategyMap] = await Promise.all([
      experimentIds.length > 0
        ? supabase.from('evolution_experiments').select('id, name').in('id', experimentIds)
            .then(({ data }) => new Map((data ?? []).map(e => [e.id as string, e.name as string])))
        : Promise.resolve(new Map<string, string>()),
      strategyIds.length > 0
        ? supabase.from('evolution_strategy_configs').select('id, name').in('id', strategyIds)
            .then(({ data }) => new Map((data ?? []).map(s => [s.id as string, s.name as string])))
        : Promise.resolve(new Map<string, string>()),
    ]);

    for (const run of typedRuns) {
      run.experiment_name = run.experiment_id ? experimentMap.get(run.experiment_id) ?? null : null;
      run.strategy_name = run.strategy_config_id ? strategyMap.get(run.strategy_config_id) ?? null : null;
    }

    return typedRuns;
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

    // Fetch cost
    const { data: costData } = await ctx.supabase.rpc('get_run_total_cost', { p_run_id: runId });
    run.total_cost_usd = Number(costData) || 0;

    // Fetch strategy name
    if (run.strategy_config_id) {
      const { data: strat } = await ctx.supabase
        .from('evolution_strategy_configs')
        .select('name')
        .eq('id', run.strategy_config_id)
        .single();
      run.strategy_name = strat?.name ?? null;
    }

    return run;
  },
);

export const getEvolutionVariantsAction = adminAction(
  'getEvolutionVariantsAction',
  async (runId: string, ctx: AdminContext): Promise<EvolutionVariant[]> => {
    if (!validateUuid(runId)) throw new Error('Invalid runId');
    const { data, error } = await ctx.supabase
      .from('evolution_variants')
      .select('id, run_id, explanation_id, variant_content, elo_score, generation, agent_name, match_count, is_winner, created_at')
      .eq('run_id', runId)
      .order('elo_score', { ascending: false });
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
      .from('evolution_run_logs')
      .select('id, created_at, level, agent_name, iteration, variant_id, message, context', { count: 'exact' })
      .eq('run_id', runId)
      .order('created_at', { ascending: true });

    if (filters?.level) query = query.eq('level', filters.level);
    if (filters?.agentName) query = query.eq('agent_name', filters.agentName);
    if (filters?.iteration !== undefined) query = query.eq('iteration', filters.iteration);
    if (filters?.variantId) query = query.eq('variant_id', filters.variantId);

    const limit = filters?.limit ?? 200;
    const offset = filters?.offset ?? 0;
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

    let query = supabase
      .from('evolution_variants')
      .select('id, run_id, explanation_id, elo_score, generation, agent_name, match_count, is_winner, created_at', { count: 'exact' });

    if (parsed.runId) query = query.eq('run_id', parsed.runId);
    if (parsed.agentName) query = query.eq('agent_name', parsed.agentName);
    if (parsed.isWinner !== undefined) query = query.eq('is_winner', parsed.isWinner);

    query = query.order('created_at', { ascending: false })
      .range(parsed.offset, parsed.offset + parsed.limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    const items = (data ?? []) as VariantListEntry[];

    // Post-fetch enrichment: batch-fetch strategy names via runs
    const runIds = [...new Set(items.map(v => v.run_id).filter(Boolean))];
    if (runIds.length > 0) {
      const { data: runData } = await supabase
        .from('evolution_runs')
        .select('id, strategy_config_id')
        .in('id', runIds);

      const runMap = new Map((runData ?? []).map(r => [r.id as string, r.strategy_config_id as string | null]));
      const strategyIds = [...new Set((runData ?? []).map(r => r.strategy_config_id as string | null).filter((id): id is string => !!id))];

      const strategyMap = strategyIds.length > 0
        ? await supabase.from('evolution_strategy_configs').select('id, name').in('id', strategyIds)
            .then(({ data: d }) => new Map((d ?? []).map(s => [s.id as string, s.name as string])))
        : new Map<string, string>();

      for (const item of items) {
        const strategyId = runMap.get(item.run_id);
        item.strategy_name = strategyId ? strategyMap.get(strategyId) ?? null : null;
      }
    }

    return { items, total: count ?? 0 };
  },
);
