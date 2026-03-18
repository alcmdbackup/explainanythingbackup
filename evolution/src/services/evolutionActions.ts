'use server';
// Server actions for the evolution pipeline admin UI.
// Provides CRUD for evolution runs and variant listing.

import { adminAction, type AdminContext } from './adminAction';
import { UUID_V4_REGEX } from './shared';
import { logger } from '@/lib/server_utilities';
import { logAdminAction } from '@/lib/services/auditLog';
import type { EvolutionRunStatus, PipelinePhase, PipelineType, EvolutionRunSummary, EloAttribution } from '@evolution/lib/types';
import { z } from 'zod';
import { EvolutionRunSummarySchema } from '@evolution/lib/types';

// ─── Types ───────────────────────────────────────────────────────

export interface EvolutionRun {
  id: string;
  explanation_id: number | null;
  status: EvolutionRunStatus;
  phase?: string;
  total_variants?: number;
  total_cost_usd?: number;
  estimated_cost_usd?: number | null;
  current_iteration?: number;
  error_message: string | null;
  budget_cap_usd?: number;
  started_at?: string | null;
  completed_at: string | null;
  created_at: string;
  prompt_id: string | null;
  pipeline_type: PipelineType | null;
  strategy_config_id: string | null;
  experiment_id: string | null;
  archived: boolean;
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
  elo_attribution?: EloAttribution | null;
}

export interface AgentCostBreakdown {
  agent: string;
  calls: number;
  costUsd: number;
}

export interface CostEstimateResult {
  totalUsd: number;
  perAgent: Record<string, number>;
  perIteration: number;
  confidence: 'high' | 'medium' | 'low';
}

type StrategyConfig = {
  generationModel?: string;
  judgeModel?: string;
  iterations?: number;
  agentModels?: Record<string, string>;
  budgetCapUsd?: number;
  enabledAgents?: string[];
  singleArticle?: boolean;
};

type ModelType = import('@/lib/schemas/schemas').AllowedLLMModelType;

export interface RunLogEntry {
  id: number;
  created_at: string;
  level: string;
  agent_name: string | null;
  iteration: number | null;
  variant_id: string | null;
  request_id: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  message: string;
  context: Record<string, unknown> | null;
}

export interface RunLogFilters {
  level?: string;
  agentName?: string;
  iteration?: number;
  variantId?: string;
  /** Max rows to return (default 200). */
  limit?: number;
  /** Offset for pagination. */
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
  elo_attribution: EloAttribution | null;
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

export const estimateRunCostAction = adminAction(
  'estimateRunCostAction',
  async (
    input: { strategyId: string; budgetCapUsd?: number; textLength?: number },
    ctx: AdminContext,
  ): Promise<CostEstimateResult> => {
    if (!UUID_V4_REGEX.test(input.strategyId)) {
      throw new Error('Invalid strategyId: must be a valid UUID');
    }

    if (input.budgetCapUsd !== undefined &&
        (typeof input.budgetCapUsd !== 'number' || !isFinite(input.budgetCapUsd) ||
         input.budgetCapUsd < 0.01 || input.budgetCapUsd > 1.00)) {
      throw new Error('budgetCapUsd must be a number between 0.01 and 1.00');
    }

    const rawLength = typeof input.textLength === 'number' && isFinite(input.textLength) && input.textLength >= 100
      ? input.textLength
      : 5000;
    const textLength = Math.min(rawLength, 100000);

    const { data: strategy, error: stratError } = await ctx.supabase
      .from('evolution_strategy_configs')
      .select('config')
      .eq('id', input.strategyId)
      .single();

    if (stratError || !strategy) {
      throw new Error(`Strategy not found: ${input.strategyId}`);
    }

    const config = strategy.config as StrategyConfig;
    const { estimateRunCostWithAgentModels } = await import('@evolution/lib');

    return estimateRunCostWithAgentModels(
      {
        generationModel: config.generationModel as ModelType | undefined,
        judgeModel: config.judgeModel as ModelType | undefined,
        maxIterations: config.iterations,
        agentModels: config.agentModels as Record<string, ModelType> | undefined,
        enabledAgents: config.enabledAgents,
        singleArticle: config.singleArticle,
      },
      textLength,
    );
  },
);

export const queueEvolutionRunAction = adminAction(
  'queueEvolutionRunAction',
  async (
    input: {
      explanationId?: number;
      budgetCapUsd?: number;
      promptId?: string;
      strategyId?: string;
    },
    ctx: AdminContext,
  ): Promise<EvolutionRun> => {
    const { supabase, adminUserId } = ctx;

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
      if (!prompt) {
        throw new Error(`Prompt not found: ${input.promptId}`);
      }
    }

    let strategyConfig: StrategyConfig | null = null;

    if (input.strategyId) {
      const { data: strategy } = await supabase
        .from('evolution_strategy_configs')
        .select('id, config, status')
        .eq('id', input.strategyId)
        .single();

      if (!strategy) {
        throw new Error(`Strategy not found: ${input.strategyId}`);
      }

      if (strategy.status === 'archived') {
        throw new Error(`Strategy "${input.strategyId}" is archived and cannot be used for new runs`);
      }

      strategyConfig = strategy.config as StrategyConfig;
    }

    const budgetCap = input.budgetCapUsd ?? strategyConfig?.budgetCapUsd ?? 5.00;

    let estimatedCostUsd: number | null = null;
    let costEstimateDetail: Record<string, unknown> | null = null;

    if (strategyConfig) {
      try {
        // Fetch actual text length when explanationId is available; fall back to 5000
        let textLength = 5000;
        if (input.explanationId) {
          const { data: explanation } = await supabase
            .from('explanations')
            .select('content')
            .eq('id', input.explanationId)
            .single();
          if (explanation?.content) {
            textLength = Math.max(100, Math.min(100000, explanation.content.length));
          }
        }

        const { estimateRunCostWithAgentModels, RunCostEstimateSchema } = await import('@evolution/lib');
        const estimate = await estimateRunCostWithAgentModels(
          {
            generationModel: strategyConfig.generationModel as ModelType | undefined,
            judgeModel: strategyConfig.judgeModel as ModelType | undefined,
            maxIterations: strategyConfig.iterations,
            agentModels: strategyConfig.agentModels as Record<string, ModelType> | undefined,
            enabledAgents: strategyConfig.enabledAgents,
            singleArticle: strategyConfig.singleArticle,
          },
          textLength,
        );
        const parsed = RunCostEstimateSchema.safeParse(estimate);
        if (parsed.success) {
          estimatedCostUsd = parsed.data.totalUsd;
          costEstimateDetail = parsed.data as unknown as Record<string, unknown>;
        } else {
          logger.warn('Cost estimate failed Zod validation (non-blocking)', {
            strategyId: input.strategyId,
            errors: parsed.error.issues.map(i => i.message),
          });
        }
      } catch (err) {
        logger.warn('Cost estimation failed at queue time (non-blocking)', {
          strategyId: input.strategyId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (estimatedCostUsd !== null && estimatedCostUsd > budgetCap) {
      throw new Error(
        `Estimated cost $${estimatedCostUsd.toFixed(2)} exceeds budget cap $${budgetCap.toFixed(2)}. ` +
        'Increase the budget cap or use a cheaper strategy.',
      );
    }

    const source = input.explanationId ? 'explanation' : `prompt:${input.promptId}`;

    const runConfig = await buildRunConfig(strategyConfig, input.strategyId, budgetCap);

    // Create evolution_explanation row for this run's seed content
    let evoExplRow: { explanation_id?: number; prompt_id?: string; title: string; content: string; source: string };
    if (input.explanationId) {
      const { data: expl } = await supabase
        .from('explanations')
        .select('explanation_title, content')
        .eq('id', input.explanationId)
        .single();
      evoExplRow = {
        explanation_id: input.explanationId,
        title: expl?.explanation_title ?? 'Untitled',
        content: expl?.content ?? '',
        source: 'explanation',
      };
    } else {
      const { data: topic } = await supabase
        .from('evolution_arena_topics')
        .select('prompt')
        .eq('id', input.promptId!)
        .single();
      const promptText = topic?.prompt ?? '';
      evoExplRow = {
        prompt_id: input.promptId,
        title: (promptText || 'Untitled prompt').slice(0, 80),
        content: promptText,
        source: 'prompt_seed',
      };
    }

    // Create evolution_explanation (gracefully skips if table doesn't exist pre-migration)
    let evoExplId: string | undefined;
    const { data: evoExpl, error: evoExplError } = await supabase
      .from('evolution_explanations')
      .insert(evoExplRow)
      .select('id')
      .single();
    if (!evoExplError && evoExpl) {
      evoExplId = evoExpl.id;
    }
    // Silently skip if table doesn't exist (pre-migration) or insert failed for structural reasons.
    // After migration deployment, the NOT NULL constraint on evolution_runs.evolution_explanation_id
    // will enforce that this always succeeds.

    const insertRow: Record<string, unknown> = {
      pipeline_version: 'v2',
    };
    if (evoExplId) insertRow.evolution_explanation_id = evoExplId;

    if (Object.keys(runConfig).length > 0) insertRow.config = runConfig;
    if (input.explanationId) insertRow.explanation_id = input.explanationId;
    if (input.promptId) insertRow.prompt_id = input.promptId;
    if (input.strategyId) insertRow.strategy_config_id = input.strategyId;

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
    filters: { explanationId?: number; status?: EvolutionRunStatus; startDate?: string; promptId?: string; includeArchived?: boolean } | undefined,
    ctx: AdminContext,
  ): Promise<EvolutionRun[]> => {
    const { supabase } = ctx;

    // Use RPC for proper LEFT JOIN handling of archived experiment runs.
    // Falls back to direct query if RPC not yet deployed (migration pending).
    let runs: EvolutionRun[];
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_non_archived_runs', {
      p_status: filters?.status ?? null,
      p_include_archived: filters?.includeArchived ?? false,
    });

    if (rpcError && (rpcError.code === '42883' || rpcError.code === 'PGRST202')) {
      // RPC not found — fall back to direct query (pre-migration)
      let query = supabase.from('evolution_runs').select('*');
      if (filters?.status) query = query.eq('status', filters.status);
      query = query.order('created_at', { ascending: false }).limit(50);
      const { data: fallbackData, error: fallbackError } = await query;
      if (fallbackError) throw fallbackError;
      runs = (fallbackData ?? []) as EvolutionRun[];
    } else if (rpcError) {
      throw rpcError;
    } else {
      runs = (rpcData ?? []) as EvolutionRun[];
    }

    // Apply client-side filters not handled by RPC
    if (filters?.explanationId) {
      runs = runs.filter(r => r.explanation_id === filters.explanationId);
    }
    if (filters?.startDate) {
      runs = runs.filter(r => r.created_at >= filters.startDate!);
    }
    if (filters?.promptId) {
      runs = runs.filter(r => r.prompt_id === filters.promptId);
    }

    // Sort and limit
    runs.sort((a, b) => b.created_at.localeCompare(a.created_at));
    runs = runs.slice(0, 50);

    // Post-fetch enrichment: batch-fetch experiment and strategy names
    const experimentIds = [...new Set(runs.map(r => r.experiment_id).filter((id): id is string => !!id))];
    const strategyIds = [...new Set(runs.map(r => r.strategy_config_id).filter((id): id is string => !!id))];

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

    for (const run of runs) {
      run.experiment_name = run.experiment_id ? experimentMap.get(run.experiment_id) ?? null : null;
      run.strategy_name = run.strategy_config_id ? strategyMap.get(run.strategy_config_id) ?? null : null;
    }

    return runs;
  },
);

// ─── Archive / Unarchive Run ─────────────────────────────────────

export const archiveRunAction = adminAction(
  'archiveRunAction',
  async (runId: string, ctx: AdminContext): Promise<{ archived: boolean }> => {
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
    const { data, error } = await ctx.supabase
      .from('evolution_runs')
      .select('*')
      .eq('id', runId)
      .single();
    if (error) throw error;
    return data as EvolutionRun;
  },
);

export const getEvolutionVariantsAction = adminAction(
  'getEvolutionVariantsAction',
  async (runId: string, ctx: AdminContext): Promise<EvolutionVariant[]> => {
    const { data, error } = await ctx.supabase
      .from('evolution_variants')
      .select('*')
      .eq('run_id', runId)
      .order('elo_score', { ascending: false });

    if (error) throw error;

    if (data?.length) {
      return data as EvolutionVariant[];
    }

    // Fallback: reconstruct variants from checkpoint for running/failed/paused runs
    const { buildVariantsFromCheckpoint } = await import('@evolution/services/evolutionVisualizationActions');
    const result = await buildVariantsFromCheckpoint(runId);
    if (!result.success) {
      throw new Error(result.error?.message ?? 'Failed to build variants from checkpoint');
    }
    return result.data ?? [];
  },
);

// ─── Get run summary ─────────────────────────────────────────────

export const getEvolutionRunSummaryAction = adminAction(
  'getEvolutionRunSummaryAction',
  async (runId: string, ctx: AdminContext): Promise<EvolutionRunSummary | null> => {
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

// ─── Cost breakdown by agent ─────────────────────────────────────

export const getEvolutionCostBreakdownAction = adminAction(
  'getEvolutionCostBreakdownAction',
  async (runId: string, ctx: AdminContext): Promise<AgentCostBreakdown[]> => {
    const { data: invocations, error: invError } = await ctx.supabase
      .from('evolution_agent_invocations')
      .select('agent_name, cost_usd, iteration')
      .eq('run_id', runId)
      .order('iteration', { ascending: true });

    if (invError) throw invError;

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

// ─── Run Logs ─────────────────────────────────────────────────────

export const getEvolutionRunLogsAction = adminAction(
  'getEvolutionRunLogsAction',
  async (
    args: { runId: string; filters?: RunLogFilters },
    ctx: AdminContext,
  ): Promise<{ items: RunLogEntry[]; total: number }> => {
    const { runId, filters } = args;

    let query = ctx.supabase
      .from('evolution_run_logs')
      .select('id, created_at, level, agent_name, iteration, variant_id, request_id, cost_usd, duration_ms, message, context', { count: 'exact' })
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
    const { supabase, adminUserId } = ctx;

    const { data, error } = await supabase
      .from('evolution_runs')
      .update({
        status: 'failed',
        error_message: 'Manually killed by admin',
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId)
      .in('status', ['pending', 'claimed', 'running', 'continuation_pending'])
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

// ─── List Variants ──────────────────────────────────────────────

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
      .select('id, run_id, explanation_id, elo_score, generation, agent_name, match_count, is_winner, created_at, elo_attribution', { count: 'exact' });

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

// ─── Helpers (not exported as actions) ───────────────────────────

async function buildRunConfig(
  strategyConfig: StrategyConfig | null,
  strategyId?: string,
  budgetCapUsd?: number
): Promise<Record<string, unknown>> {
  if (!strategyConfig && budgetCapUsd == null) return {};
  if (!strategyConfig) return { budgetCapUsd };

  let enabledAgents: string[] | undefined;

  if (strategyConfig.enabledAgents) {
    const { enabledAgentsSchema } = await import('@evolution/lib/core/budgetRedistribution');
    const parsed = enabledAgentsSchema.safeParse(strategyConfig.enabledAgents);
    if (parsed.success && parsed.data) {
      enabledAgents = parsed.data;
    } else {
      throw new Error(
        `Invalid enabledAgents in strategy ${strategyId ?? 'unknown'}: ${parsed.error?.issues.map(i => i.message).join('; ') ?? 'unknown error'}`,
      );
    }
  }

  const runConfig: Record<string, unknown> = {};
  if (budgetCapUsd != null) runConfig.budgetCapUsd = budgetCapUsd;
  if (enabledAgents) runConfig.enabledAgents = enabledAgents;
  if (strategyConfig.singleArticle) runConfig.singleArticle = true;
  if (strategyConfig.iterations != null) runConfig.maxIterations = Math.max(1, Math.floor(strategyConfig.iterations));
  if (strategyConfig.generationModel) runConfig.generationModel = strategyConfig.generationModel;
  if (strategyConfig.judgeModel) runConfig.judgeModel = strategyConfig.judgeModel;
  const { validateStrategyConfig } = await import('@evolution/lib/core/configValidation');
  const iterations = (runConfig.maxIterations as number | undefined) ?? 15;
  const validation = validateStrategyConfig({
    generationModel: (runConfig.generationModel as string) ?? '',
    judgeModel: (runConfig.judgeModel as string) ?? '',
    iterations,
    enabledAgents: runConfig.enabledAgents as import('@evolution/lib/types').AgentName[] | undefined,
    singleArticle: strategyConfig.singleArticle,
  });

  if (!validation.valid) {
    throw new Error(`Invalid strategy config: ${validation.errors.join('; ')}`);
  }

  return runConfig;
}
