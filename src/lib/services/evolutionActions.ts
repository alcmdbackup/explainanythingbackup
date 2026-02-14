'use server';
// Server actions for the evolution pipeline admin UI.
// Provides CRUD for evolution runs, variant listing, and winner application.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { logger } from '@/lib/server_utilities';
import { logAdminAction } from '@/lib/services/auditLog';
import type { EvolutionRunStatus, PipelinePhase, PipelineType, EvolutionRunSummary } from '@/lib/evolution/types';
import { EvolutionRunSummarySchema } from '@/lib/evolution/types';

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
  variants_generated: number;
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

export interface ContentHistoryRow {
  id: number;
  explanation_id: number;
  source: string;
  evolution_run_id: string | null;
  applied_by: string | null;
  applied_at: string;
}

// ─── Estimate run cost ──────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CostEstimateResult {
  totalUsd: number;
  perAgent: Record<string, number>;
  perIteration: number;
  confidence: 'high' | 'medium' | 'low';
}

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

    const isValidTextLength = typeof input.textLength === 'number' &&
                              isFinite(input.textLength) &&
                              input.textLength >= 100;
    const textLength = Math.min(isValidTextLength ? input.textLength! : 5000, 100000);

    const supabase = await createSupabaseServiceClient();

    const { data: strategy, error: stratError } = await supabase
      .from('strategy_configs')
      .select('config')
      .eq('id', input.strategyId)
      .single();

    if (stratError || !strategy) {
      throw new Error(`Strategy not found: ${input.strategyId}`);
    }

    type ModelType = import('@/lib/schemas/schemas').AllowedLLMModelType;
    const config = strategy.config as {
      generationModel?: string;
      judgeModel?: string;
      iterations?: number;
      agentModels?: Record<string, string>;
    };

    const { estimateRunCostWithAgentModels } = await import('@/lib/evolution');

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

// ─── Queue a new evolution run ───────────────────────────────────

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
        .from('hall_of_fame_topics')
        .select('id')
        .eq('id', input.promptId)
        .is('deleted_at', null)
        .single();
      if (!prompt) throw new Error(`Prompt not found: ${input.promptId}`);
    }

    let strategyConfig: QueueStrategyConfig | null = null;

    if (input.strategyId) {
      const { data: strategy } = await supabase
        .from('strategy_configs')
        .select('id, config')
        .eq('id', input.strategyId)
        .single();
      if (!strategy) throw new Error(`Strategy not found: ${input.strategyId}`);
      strategyConfig = strategy.config as QueueStrategyConfig;
    }

    const budgetCap = input.budgetCapUsd ?? strategyConfig?.budgetCapUsd ?? 5.00;

    // Require at least explanationId or promptId
    if (!input.explanationId && !input.promptId) {
      throw new Error('Either explanationId or promptId is required');
    }


    let estimatedCostUsd: number | null = null;
    let costEstimateDetail: Record<string, unknown> | null = null;
    if (strategyConfig) {
      try {
        type ModelType = import('@/lib/schemas/schemas').AllowedLLMModelType;
        const { estimateRunCostWithAgentModels, RunCostEstimateSchema } = await import('@/lib/evolution');
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
      .from('content_evolution_runs')
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

// ─── Helper: Build run config from strategy ──────────────────────

type QueueStrategyConfig = {
  generationModel?: string;
  judgeModel?: string;
  iterations?: number;
  agentModels?: Record<string, string>;
  budgetCapUsd?: number;
  enabledAgents?: string[];
  singleArticle?: boolean;
  budgetCaps?: Record<string, number>;
};

async function buildRunConfig(
  strategyConfig: QueueStrategyConfig | null,
  strategyId?: string
): Promise<Record<string, unknown>> {
  const runConfig: Record<string, unknown> = {};

  if (!strategyConfig) return runConfig;

  if (strategyConfig.enabledAgents) {
    const { enabledAgentsSchema } = await import('@/lib/evolution/core/budgetRedistribution');
    const parsed = enabledAgentsSchema.safeParse(strategyConfig.enabledAgents);
    if (parsed.success && parsed.data) {
      runConfig.enabledAgents = parsed.data;
    } else {
      logger.warn('Invalid enabledAgents in strategy config (ignored)', {
        strategyId,
        raw: strategyConfig.enabledAgents,
      });
    }
  }

  if (strategyConfig.singleArticle) {
    runConfig.singleArticle = true;
  }

  if (strategyConfig.iterations != null) {
    runConfig.maxIterations = Math.max(1, Math.floor(strategyConfig.iterations));
  }

  if (strategyConfig.generationModel) {
    runConfig.generationModel = strategyConfig.generationModel;
  }

  if (strategyConfig.judgeModel) {
    runConfig.judgeModel = strategyConfig.judgeModel;
  }

  const hasBudgetCaps = strategyConfig.budgetCaps != null &&
                        typeof strategyConfig.budgetCaps === 'object' &&
                        !Array.isArray(strategyConfig.budgetCaps) &&
                        Object.keys(strategyConfig.budgetCaps).length > 0;
  if (hasBudgetCaps) {
    runConfig.budgetCaps = { ...strategyConfig.budgetCaps };
  }

  return runConfig;
}

// ─── List evolution runs ─────────────────────────────────────────

const _getEvolutionRunsAction = withLogging(async (
  filters?: { explanationId?: number; status?: EvolutionRunStatus; startDate?: string }
): Promise<{ success: boolean; data: EvolutionRun[] | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    let query = supabase
      .from('content_evolution_runs')
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

// ─── Get single evolution run by ID (lightweight polling) ────────

const _getEvolutionRunByIdAction = withLogging(async (
  runId: string
): Promise<{ success: boolean; data: EvolutionRun | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();
    const { data, error } = await supabase
      .from('content_evolution_runs')
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

// ─── Get variants for a run ──────────────────────────────────────

const _getEvolutionVariantsAction = withLogging(async (
  runId: string
): Promise<{ success: boolean; data: EvolutionVariant[] | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('content_evolution_variants')
      .select('*')
      .eq('run_id', runId)
      .order('elo_score', { ascending: false });

    if (error) {
      logger.error('Error fetching evolution variants', { error: error.message });
      throw error;
    }

    if (data && data.length > 0) {
      return { success: true, data: data as EvolutionVariant[], error: null };
    }

    const { buildVariantsFromCheckpoint } = await import('@/lib/services/evolutionVisualizationActions');
    return buildVariantsFromCheckpoint(runId);
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionVariantsAction', { runId }) };
  }
}, 'getEvolutionVariantsAction');

export const getEvolutionVariantsAction = serverReadRequestId(_getEvolutionVariantsAction);

// ─── Apply winner ────────────────────────────────────────────────

const _applyWinnerAction = withLogging(async (
  input: { explanationId: number; variantId: string; runId: string }
): Promise<{ success: boolean; error: ErrorResponse | null }> => {
  try {
    const adminUserId = await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    // Get current content
    const { data: current, error: fetchError } = await supabase
      .from('explanations')
      .select('content')
      .eq('id', input.explanationId)
      .single();

    if (fetchError || !current) {
      throw new Error(`Explanation ${input.explanationId} not found`);
    }

    // Get winning variant content
    const { data: variant, error: variantError } = await supabase
      .from('content_evolution_variants')
      .select('variant_content')
      .eq('id', input.variantId)
      .single();

    if (variantError || !variant) {
      throw new Error(`Variant ${input.variantId} not found`);
    }

    // Save history FIRST (for rollback)
    const { error: historyError } = await supabase
      .from('content_history')
      .insert({
        explanation_id: input.explanationId,
        previous_content: current.content,
        new_content: variant.variant_content,
        source: 'evolution_pipeline',
        evolution_run_id: input.runId,
        applied_by: adminUserId,
      });

    if (historyError) {
      logger.error('Error saving content history', { error: historyError.message });
      throw historyError;
    }

    // Update article
    const { error: updateError } = await supabase
      .from('explanations')
      .update({ content: variant.variant_content })
      .eq('id', input.explanationId);

    if (updateError) {
      logger.error('Error applying winner', { error: updateError.message });
      throw updateError;
    }

    // Mark variant as winner
    await supabase
      .from('content_evolution_variants')
      .update({ is_winner: true })
      .eq('id', input.variantId);

    await logAdminAction({
      adminUserId,
      action: 'apply_evolution_winner',
      entityType: 'explanation',
      entityId: String(input.explanationId),
      details: { variantId: input.variantId, runId: input.runId },
    });

    logger.info('Applied evolution winner', {
      explanationId: input.explanationId,
      variantId: input.variantId,
      runId: input.runId,
    });

    // Phase E: Auto-trigger quality eval on the updated article (fire-and-forget)
    triggerPostEvolutionEval(input.explanationId, variant.variant_content).catch((err) => {
      logger.warn('Post-evolution eval trigger failed (non-blocking)', {
        explanationId: input.explanationId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: handleError(error, 'applyWinnerAction', { input }) };
  }
}, 'applyWinnerAction');

export const applyWinnerAction = serverReadRequestId(_applyWinnerAction);

// ─── Trigger inline evolution run (admin manual) ─────────────────

const _triggerEvolutionRunAction = withLogging(async (
  runId: string
): Promise<{ success: boolean; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    // Verify run exists and is pending
    const { data: run, error: fetchError } = await supabase
      .from('content_evolution_runs')
      .select('id, explanation_id, prompt_id, status, config, budget_cap_usd')
      .eq('id', runId)
      .single();

    if (fetchError || !run) {
      throw new Error(`Run ${runId} not found`);
    }
    if (run.status !== 'pending') {
      throw new Error(`Run ${runId} is not pending (status: ${run.status})`);
    }

    // Check dry-run feature flag
    const { fetchEvolutionFeatureFlags } = await import('@/lib/evolution/core/featureFlags');
    const featureFlags = await fetchEvolutionFeatureFlags(supabase);
    if (featureFlags.dryRunOnly) {
      logger.info('Evolution dry-run mode active via feature flag', { runId });
      await supabase.from('content_evolution_runs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        error_message: 'dry-run: execution skipped (feature flag)',
      }).eq('id', runId);
      return { success: true, error: null };
    }

    let originalText: string;
    let title: string;
    let explanationId: number | null = run.explanation_id;

    if (run.explanation_id !== null) {
      const { data: explanation, error: contentError } = await supabase
        .from('explanations')
        .select('id, explanation_title, content')
        .eq('id', run.explanation_id)
        .single();

      if (contentError || !explanation) {
        throw new Error(`Explanation ${run.explanation_id} not found`);
      }

      originalText = explanation.content;
      title = explanation.explanation_title;
      explanationId = explanation.id;
    } else if (run.prompt_id) {
      if (featureFlags.promptBasedEvolutionEnabled === false) {
        throw new Error('Prompt-based evolution is temporarily disabled');
      }

      const { data: topic, error: topicError } = await supabase
        .from('hall_of_fame_topics')
        .select('prompt')
        .eq('id', run.prompt_id)
        .single();

      if (topicError || !topic) {
        throw new Error(`Prompt ${run.prompt_id} not found`);
      }

      const { generateSeedArticle } = await import('@/lib/evolution/core/seedArticle');
      const { createEvolutionLLMClient } = await import('@/lib/evolution');
      const { createCostTracker } = await import('@/lib/evolution/core/costTracker');
      const { createEvolutionLogger } = await import('@/lib/evolution/core/logger');
      const { resolveConfig } = await import('@/lib/evolution/config');

      const seedConfig = resolveConfig(run.config ?? {});
      const seedCostTracker = createCostTracker(seedConfig);
      const seedLogger = createEvolutionLogger(runId);
      const seedLlmClient = createEvolutionLLMClient('evolution-admin-seed', seedCostTracker, seedLogger);

      const seed = await generateSeedArticle(topic.prompt, seedLlmClient, seedLogger);
      originalText = seed.content;
      title = seed.title;
      explanationId = null;

      logger.info('Generated seed article from prompt', { runId, title, promptId: run.prompt_id });
    } else {
      throw new Error('Run has no explanation_id and no prompt_id');
    }

    const { executeFullPipeline, preparePipelineRun } = await import('@/lib/evolution');

    const { ctx, agents } = preparePipelineRun({
      runId,
      originalText,
      title,
      explanationId,
      configOverrides: run.config ?? {},
      llmClientId: 'evolution-admin',
    });

    await executeFullPipeline(runId, agents, ctx, ctx.logger, {
      startMs: Date.now(),
      featureFlags,
    });

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: handleError(error, 'triggerEvolutionRunAction', { runId }) };
  }
}, 'triggerEvolutionRunAction');

export const triggerEvolutionRunAction = serverReadRequestId(_triggerEvolutionRunAction);

// ─── Get run summary ─────────────────────────────────────────────

const _getEvolutionRunSummaryAction = withLogging(async (
  runId: string
): Promise<{ success: boolean; data: EvolutionRunSummary | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('content_evolution_runs')
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

    // Query run-scoped invocation table (no time-window correlation needed)
    const { data: invocations, error: invError } = await supabase
      .from('evolution_agent_invocations')
      .select('agent_name, cost_usd, iteration')
      .eq('run_id', runId)
      .order('iteration', { ascending: true });

    if (invError) {
      logger.error('Error fetching cost breakdown', { error: invError.message });
      throw invError;
    }

    const agentMap = new Map<string, { invocations: number; maxCost: number }>();
    for (const inv of invocations ?? []) {
      const agent = inv.agent_name as string;
      const cost = Number(inv.cost_usd) || 0;
      const entry = agentMap.get(agent) ?? { invocations: 0, maxCost: 0 };
      entry.invocations += 1;
      entry.maxCost = Math.max(entry.maxCost, cost);
      agentMap.set(agent, entry);
    }

    const breakdown: AgentCostBreakdown[] = Array.from(agentMap.entries())
      .map(([agent, { invocations: count, maxCost }]) => ({ agent, calls: count, costUsd: maxCost }))
      .sort((a, b) => b.costUsd - a.costUsd);

    return { success: true, data: breakdown, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionCostBreakdownAction', { runId }) };
  }
}, 'getEvolutionCostBreakdownAction');

export const getEvolutionCostBreakdownAction = serverReadRequestId(_getEvolutionCostBreakdownAction);

// ─── Evolution content history ───────────────────────────────────

const _getEvolutionHistoryAction = withLogging(async (
  explanationId: number
): Promise<{ success: boolean; data: ContentHistoryRow[] | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('content_history')
      .select('id, explanation_id, source, evolution_run_id, applied_by, created_at')
      .eq('explanation_id', explanationId)
      .eq('source', 'evolution_pipeline')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching evolution history', { error: error.message });
      throw error;
    }

    const rows: ContentHistoryRow[] = (data ?? []).map((row) => ({
      id: row.id,
      explanation_id: row.explanation_id,
      source: row.source,
      evolution_run_id: row.evolution_run_id,
      applied_by: row.applied_by,
      applied_at: row.created_at, // DB uses created_at; interface uses applied_at
    }));

    return { success: true, data: rows, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionHistoryAction', { explanationId }) };
  }
}, 'getEvolutionHistoryAction');

export const getEvolutionHistoryAction = serverReadRequestId(_getEvolutionHistoryAction);

// ─── Rollback evolution ──────────────────────────────────────────

const _rollbackEvolutionAction = withLogging(async (
  input: { explanationId: number; historyId: number }
): Promise<{ success: boolean; error: ErrorResponse | null }> => {
  try {
    const adminUserId = await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    // Fetch the history entry to rollback to
    const { data: historyRow, error: historyError } = await supabase
      .from('content_history')
      .select('id, explanation_id, previous_content')
      .eq('id', input.historyId)
      .eq('explanation_id', input.explanationId)
      .single();

    if (historyError || !historyRow) {
      throw new Error(`Content history #${input.historyId} not found for explanation #${input.explanationId}`);
    }

    // Get current article content
    const { data: current, error: currentError } = await supabase
      .from('explanations')
      .select('content')
      .eq('id', input.explanationId)
      .single();

    if (currentError || !current) {
      throw new Error(`Explanation #${input.explanationId} not found`);
    }

    // Save current→previous as rollback history entry
    const { error: saveError } = await supabase
      .from('content_history')
      .insert({
        explanation_id: input.explanationId,
        previous_content: current.content,
        new_content: historyRow.previous_content,
        source: 'manual_edit',
        applied_by: adminUserId,
      });

    if (saveError) {
      logger.error('Error saving rollback history', { error: saveError.message });
      throw saveError;
    }

    // Restore previous content
    const { error: updateError } = await supabase
      .from('explanations')
      .update({ content: historyRow.previous_content })
      .eq('id', input.explanationId);

    if (updateError) {
      logger.error('Error rolling back content', { error: updateError.message });
      throw updateError;
    }

    await logAdminAction({
      adminUserId,
      action: 'rollback_evolution',
      entityType: 'explanation',
      entityId: String(input.explanationId),
      details: { historyId: input.historyId },
    });

    logger.info('Rolled back evolution content', {
      explanationId: input.explanationId,
      historyId: input.historyId,
    });

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: handleError(error, 'rollbackEvolutionAction', { input }) };
  }
}, 'rollbackEvolutionAction');

export const rollbackEvolutionAction = serverReadRequestId(_rollbackEvolutionAction);

// ─── Phase E: Post-evolution eval trigger (fire-and-forget) ──────

/**
 * After a winner is applied, evaluate the new content quality.
 * Uses dynamic import to avoid loading eval code unless needed.
 */
async function triggerPostEvolutionEval(
  explanationId: number,
  newContent: string,
): Promise<void> {
  const supabase = await createSupabaseServiceClient();

  // Check feature flag — skip if eval not enabled
  const { data: flag } = await supabase
    .from('feature_flags')
    .select('enabled')
    .eq('name', 'content_quality_eval_enabled')
    .single();

  if (!flag?.enabled) {
    logger.debug('Post-evolution eval skipped: feature flag disabled', { explanationId });
    return;
  }

  // Get title for the eval prompt
  const { data: explanation } = await supabase
    .from('explanations')
    .select('explanation_title')
    .eq('id', explanationId)
    .single();

  if (!explanation) return;

  const { evaluateAndSaveContentQuality } = await import('./contentQualityEval');

  await evaluateAndSaveContentQuality(
    explanationId,
    explanation.explanation_title,
    newContent,
    'evolution-post-apply',
  );

  logger.info('Post-evolution eval completed', { explanationId });
}

// ─── Run Logs ─────────────────────────────────────────────────────

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
