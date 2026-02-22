'use server';
// Server actions for the evolution pipeline admin UI.
// Provides CRUD for evolution runs and variant listing.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { logger } from '@/lib/server_utilities';
import { logAdminAction } from '@/lib/services/auditLog';
import type { EvolutionRunStatus, PipelinePhase, PipelineType, EvolutionRunSummary } from '@evolution/lib/types';
import { EvolutionRunSummarySchema } from '@evolution/lib/types';

// ─── Types ───────────────────────────────────────────────────────

export interface EvolutionRun {
  id: string;
  explanation_id: number | null;
  status: EvolutionRunStatus;
  phase: PipelinePhase;
  total_variants: number;
  total_cost_usd: number;
  estimated_cost_usd: number | null;
  budget_cap_usd: number;
  current_iteration: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  prompt_id: string | null;
  pipeline_type: PipelineType | null;
  strategy_config_id: string | null;
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
  budgetCaps?: Record<string, number>;
};

type ModelType = import('@/lib/schemas/schemas').AllowedLLMModelType;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const _estimateRunCostAction = withLogging(async (
  input: { strategyId: string; budgetCapUsd?: number; textLength?: number }
): Promise<{ success: boolean; data: CostEstimateResult | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();

    if (!UUID_RE.test(input.strategyId)) {
      throw new Error('Invalid strategyId: must be a valid UUID');
    }

    if (input.budgetCapUsd !== undefined &&
        (typeof input.budgetCapUsd !== 'number' || !isFinite(input.budgetCapUsd) ||
         input.budgetCapUsd < 0.01 || input.budgetCapUsd > 100)) {
      throw new Error('budgetCapUsd must be a number between 0.01 and 100');
    }

    const rawLength = typeof input.textLength === 'number' && isFinite(input.textLength) && input.textLength >= 100
      ? input.textLength
      : 5000;
    const textLength = Math.min(rawLength, 100000);

    const supabase = await createSupabaseServiceClient();

    const { data: strategy, error: stratError } = await supabase
      .from('evolution_strategy_configs')
      .select('config')
      .eq('id', input.strategyId)
      .single();

    if (stratError || !strategy) {
      throw new Error(`Strategy not found: ${input.strategyId}`);
    }

    const config = strategy.config as StrategyConfig;
    const { estimateRunCostWithAgentModels } = await import('@evolution/lib');

    const estimate = await estimateRunCostWithAgentModels(
      {
        generationModel: config.generationModel as ModelType | undefined,
        judgeModel: config.judgeModel as ModelType | undefined,
        maxIterations: config.iterations,
        agentModels: config.agentModels as Record<string, ModelType> | undefined,
      },
      textLength,
    );

    return { success: true, data: estimate, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'estimateRunCostAction', { input }) };
  }
}, 'estimateRunCostAction');

export const estimateRunCostAction = serverReadRequestId(_estimateRunCostAction);

const _queueEvolutionRunAction = withLogging(async (
  input: {
    explanationId?: number;
    budgetCapUsd?: number;
    promptId?: string;
    strategyId?: string;
  }
): Promise<{ success: boolean; data: EvolutionRun | null; error: ErrorResponse | null }> => {
  try {
    const adminUserId = await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    if (!input.explanationId && !input.promptId) {
      throw new Error('Either explanationId or promptId is required');
    }

    if (input.promptId) {
      const { data: prompt } = await supabase
        .from('evolution_hall_of_fame_topics')
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
        .select('id, config')
        .eq('id', input.strategyId)
        .single();

      if (!strategy) {
        throw new Error(`Strategy not found: ${input.strategyId}`);
      }

      strategyConfig = strategy.config as StrategyConfig;
    }

    const budgetCap = input.budgetCapUsd ?? strategyConfig?.budgetCapUsd ?? 5.00;

    let estimatedCostUsd: number | null = null;
    let costEstimateDetail: Record<string, unknown> | null = null;

    if (strategyConfig) {
      try {
        const { estimateRunCostWithAgentModels, RunCostEstimateSchema } = await import('@evolution/lib');
        const estimate = await estimateRunCostWithAgentModels(
          {
            generationModel: strategyConfig.generationModel as ModelType | undefined,
            judgeModel: strategyConfig.judgeModel as ModelType | undefined,
            maxIterations: strategyConfig.iterations,
            agentModels: strategyConfig.agentModels as Record<string, ModelType> | undefined,
          },
          5000,
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

    const runConfig = await buildRunConfig(strategyConfig, input.strategyId);

    const insertRow: Record<string, unknown> = {
      budget_cap_usd: budgetCap,
      estimated_cost_usd: estimatedCostUsd,
      cost_estimate_detail: costEstimateDetail,
      source,
    };

    if (Object.keys(runConfig).length > 0) insertRow.config = runConfig;
    if (input.explanationId) insertRow.explanation_id = input.explanationId;
    if (input.promptId) insertRow.prompt_id = input.promptId;
    if (input.strategyId) insertRow.strategy_config_id = input.strategyId;

    const { data, error } = await supabase
      .from('evolution_runs')
      .insert(insertRow)
      .select()
      .single();

    if (error) {
      logger.error('Error queuing evolution run', { error: error.message });
      throw error;
    }

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

    return { success: true, data: data as EvolutionRun, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'queueEvolutionRunAction', { input }) };
  }
}, 'queueEvolutionRunAction');

export const queueEvolutionRunAction = serverReadRequestId(_queueEvolutionRunAction);

async function buildRunConfig(
  strategyConfig: StrategyConfig | null,
  strategyId?: string
): Promise<Record<string, unknown>> {
  if (!strategyConfig) return {};

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
  if (enabledAgents) runConfig.enabledAgents = enabledAgents;
  if (strategyConfig.singleArticle) runConfig.singleArticle = true;
  if (strategyConfig.iterations != null) runConfig.maxIterations = Math.max(1, Math.floor(strategyConfig.iterations));
  if (strategyConfig.generationModel) runConfig.generationModel = strategyConfig.generationModel;
  if (strategyConfig.judgeModel) runConfig.judgeModel = strategyConfig.judgeModel;
  if (strategyConfig.budgetCaps && Object.keys(strategyConfig.budgetCaps).length > 0) {
    runConfig.budgetCaps = { ...strategyConfig.budgetCaps };
  }

  const { validateStrategyConfig } = await import('@evolution/lib/core/configValidation');
  const iterations = ((runConfig.maxIterations as number) ?? null) as unknown as number;
  const validation = validateStrategyConfig({
    generationModel: (runConfig.generationModel as string) ?? '',
    judgeModel: (runConfig.judgeModel as string) ?? '',
    iterations,
    budgetCaps: (runConfig.budgetCaps as Record<string, number>) ?? {},
    enabledAgents: runConfig.enabledAgents as import('@evolution/lib/types').AgentName[] | undefined,
    singleArticle: strategyConfig.singleArticle,
  });

  if (!validation.valid) {
    throw new Error(`Invalid strategy config: ${validation.errors.join('; ')}`);
  }

  return runConfig;
}

const _getEvolutionRunsAction = withLogging(async (
  filters?: { explanationId?: number; status?: EvolutionRunStatus; startDate?: string }
): Promise<{ success: boolean; data: EvolutionRun[] | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    let query = supabase
      .from('evolution_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (filters?.explanationId) {
      query = query.eq('explanation_id', filters.explanationId);
    }
    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.startDate) {
      query = query.gte('created_at', filters.startDate);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Error fetching evolution runs', { error: error.message });
      throw error;
    }

    return { success: true, data: (data ?? []) as EvolutionRun[], error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionRunsAction', { filters }) };
  }
}, 'getEvolutionRunsAction');

export const getEvolutionRunsAction = serverReadRequestId(_getEvolutionRunsAction);

const _getEvolutionRunByIdAction = withLogging(async (
  runId: string
): Promise<{ success: boolean; data: EvolutionRun | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();
    const { data, error } = await supabase
      .from('evolution_runs')
      .select('*')
      .eq('id', runId)
      .single();
    if (error) throw error;
    return { success: true, data: data as EvolutionRun, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionRunByIdAction', { runId }) };
  }
}, 'getEvolutionRunByIdAction');

export const getEvolutionRunByIdAction = serverReadRequestId(_getEvolutionRunByIdAction);

const _getEvolutionVariantsAction = withLogging(async (
  runId: string
): Promise<{ success: boolean; data: EvolutionVariant[] | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('evolution_variants')
      .select('*')
      .eq('run_id', runId)
      .order('elo_score', { ascending: false });

    if (error) {
      logger.error('Error fetching evolution variants', { error: error.message });
      throw error;
    }

    if (data?.length) {
      return { success: true, data: data as EvolutionVariant[], error: null };
    }

    // Fallback: reconstruct variants from checkpoint for running/failed/paused runs
    const { buildVariantsFromCheckpoint } = await import('@evolution/services/evolutionVisualizationActions');
    return buildVariantsFromCheckpoint(runId);
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionVariantsAction', { runId }) };
  }
}, 'getEvolutionVariantsAction');

export const getEvolutionVariantsAction = serverReadRequestId(_getEvolutionVariantsAction);

// ─── Get run summary ─────────────────────────────────────────────

const _getEvolutionRunSummaryAction = withLogging(async (
  runId: string
): Promise<{ success: boolean; data: EvolutionRunSummary | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('evolution_runs')
      .select('run_summary')
      .eq('id', runId)
      .single();

    if (error) {
      logger.error('Error fetching run summary', { error: error.message });
      throw error;
    }

    if (!data?.run_summary) return { success: true, data: null, error: null };

    const parsed = EvolutionRunSummarySchema.safeParse(data.run_summary);
    if (!parsed.success) {
      logger.warn('Invalid run_summary in database', {
        runId,
        errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      return { success: true, data: null, error: null };
    }

    return { success: true, data: parsed.data, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionRunSummaryAction', { runId }) };
  }
}, 'getEvolutionRunSummaryAction');

export const getEvolutionRunSummaryAction = serverReadRequestId(_getEvolutionRunSummaryAction);

// ─── Cost breakdown by agent ─────────────────────────────────────

const _getEvolutionCostBreakdownAction = withLogging(async (
  runId: string
): Promise<{ success: boolean; data: AgentCostBreakdown[] | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: invocations, error: invError } = await supabase
      .from('evolution_agent_invocations')
      .select('agent_name, cost_usd, iteration')
      .eq('run_id', runId)
      .order('iteration', { ascending: true });

    if (invError) {
      logger.error('Error fetching cost breakdown', { error: invError.message });
      throw invError;
    }

    const agentMap = new Map<string, { invocations: number; totalCost: number }>();
    for (const inv of invocations ?? []) {
      const agent = inv.agent_name as string;
      const cost = Number(inv.cost_usd) || 0;
      const entry = agentMap.get(agent) ?? { invocations: 0, totalCost: 0 };
      entry.invocations += 1;
      entry.totalCost += cost;
      agentMap.set(agent, entry);
    }

    const breakdown: AgentCostBreakdown[] = Array.from(agentMap.entries())
      .map(([agent, { invocations: count, totalCost }]) => ({ agent, calls: count, costUsd: totalCost }))
      .sort((a, b) => b.costUsd - a.costUsd);

    return { success: true, data: breakdown, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionCostBreakdownAction', { runId }) };
  }
}, 'getEvolutionCostBreakdownAction');

export const getEvolutionCostBreakdownAction = serverReadRequestId(_getEvolutionCostBreakdownAction);

// ─── Run Logs ─────────────────────────────────────────────────────

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

const _getEvolutionRunLogsAction = withLogging(async (
  runId: string,
  filters?: RunLogFilters,
): Promise<{ success: boolean; data: RunLogEntry[] | null; total: number | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    let query = supabase
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

    if (error) {
      logger.error('Error fetching run logs', { error: error.message, runId });
      throw error;
    }

    return { success: true, data: (data as RunLogEntry[]) ?? [], total: count, error: null };
  } catch (error) {
    return { success: false, data: null, total: null, error: handleError(error, 'getEvolutionRunLogsAction', { runId }) };
  }
}, 'getEvolutionRunLogsAction');

export const getEvolutionRunLogsAction = serverReadRequestId(_getEvolutionRunLogsAction);

const _killEvolutionRunAction = withLogging(async (
  runId: string
): Promise<{ success: boolean; data: EvolutionRun | null; error: ErrorResponse | null }> => {
  try {
    const adminUserId = await requireAdmin();
    const supabase = await createSupabaseServiceClient();

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

    return { success: true, data: data as EvolutionRun, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'killEvolutionRunAction', { runId }) };
  }
}, 'killEvolutionRunAction');

export const killEvolutionRunAction = serverReadRequestId(_killEvolutionRunAction);
