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
import type { EvolutionRunStatus, PipelinePhase, EvolutionRunSummary } from '@/lib/evolution/types';
import { EvolutionRunSummarySchema } from '@/lib/evolution/types';

// ─── Types ───────────────────────────────────────────────────────

export interface EvolutionRun {
  id: string;
  explanation_id: number;
  status: EvolutionRunStatus;
  phase: PipelinePhase;
  total_variants: number;
  total_cost_usd: number;
  budget_cap_usd: number;
  current_iteration: number;
  variants_generated: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface EvolutionVariant {
  id: string;
  run_id: string;
  explanation_id: number;
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

// ─── Queue a new evolution run ───────────────────────────────────

const _queueEvolutionRunAction = withLogging(async (
  input: { explanationId: number; budgetCapUsd?: number }
): Promise<{ success: boolean; data: EvolutionRun | null; error: ErrorResponse | null }> => {
  try {
    const adminUserId = await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('content_evolution_runs')
      .insert({
        explanation_id: input.explanationId,
        budget_cap_usd: input.budgetCapUsd ?? 5.00,
      })
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
      details: { explanationId: input.explanationId, budgetCapUsd: input.budgetCapUsd ?? 5.00 },
    });

    return { success: true, data: data as EvolutionRun, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'queueEvolutionRunAction', { input }) };
  }
}, 'queueEvolutionRunAction');

export const queueEvolutionRunAction = serverReadRequestId(_queueEvolutionRunAction);

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

    return { success: true, data: (data ?? []) as EvolutionVariant[], error: null };
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
      .select('id, explanation_id, status, config, budget_cap_usd')
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

    // Get article content
    const { data: explanation, error: contentError } = await supabase
      .from('explanations')
      .select('id, explanation_title, content')
      .eq('id', run.explanation_id)
      .single();

    if (contentError || !explanation) {
      throw new Error(`Explanation ${run.explanation_id} not found`);
    }

    // Dynamic import to avoid loading heavy evolution code at module level
    const {
      PipelineStateImpl,
      createCostTracker,
      createEvolutionLogger,
      createEvolutionLLMClient,
      executeFullPipeline,
      resolveConfig,
      GenerationAgent,
      CalibrationRanker,
      Tournament,
      EvolutionAgent,
      ReflectionAgent,
      IterativeEditingAgent,
      DebateAgent,
      ProximityAgent,
      MetaReviewAgent,
    } = await import('@/lib/evolution');
    type PipelineAgents = import('@/lib/evolution').PipelineAgents;

    const config = resolveConfig(run.config ?? {});
    const state = new PipelineStateImpl(explanation.content);
    const costTracker = createCostTracker(config);
    const evolutionLogger = createEvolutionLogger(runId);
    const llmClient = createEvolutionLLMClient(
      'evolution-admin',
      costTracker,
      evolutionLogger,
    );

    const ctx = {
      payload: {
        originalText: explanation.content,
        title: explanation.explanation_title,
        explanationId: explanation.id,
        runId,
        config,
      },
      state,
      llmClient,
      logger: evolutionLogger,
      costTracker,
      runId,
    };

    // Full pipeline with all agents (phase-appropriate agents selected by supervisor)
    const agents: PipelineAgents = {
      generation: new GenerationAgent(),
      calibration: new CalibrationRanker(),
      tournament: new Tournament(),
      evolution: new EvolutionAgent(),
      reflection: new ReflectionAgent(),
      iterativeEditing: new IterativeEditingAgent(),
      debate: new DebateAgent(),
      proximity: new ProximityAgent(),
      metaReview: new MetaReviewAgent(),
    };
    const startMs = Date.now();

    await executeFullPipeline(runId, agents, ctx, evolutionLogger, {
      startMs,
      featureFlags,
    });

    // Variants are persisted inside executeFullPipeline via persistVariants() (upsert).

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

    // Get run time window
    const { data: run, error: runError } = await supabase
      .from('content_evolution_runs')
      .select('started_at, completed_at')
      .eq('id', runId)
      .single();

    if (runError || !run) {
      throw new Error(`Run ${runId} not found`);
    }

    // Query LLM call tracking for evolution calls within the run window
    let query = supabase
      .from('llmCallTracking')
      .select('call_source, estimated_cost_usd')
      .like('call_source', 'evolution_%');

    if (run.started_at) {
      query = query.gte('created_at', run.started_at);
    }
    if (run.completed_at) {
      query = query.lte('created_at', run.completed_at);
    }

    const { data: calls, error: callsError } = await query;

    if (callsError) {
      logger.error('Error fetching cost breakdown', { error: callsError.message });
      throw callsError;
    }

    // Group by agent name (strip 'evolution_' prefix)
    const agentMap = new Map<string, { calls: number; costUsd: number }>();
    for (const call of calls ?? []) {
      const agent = (call.call_source as string).replace(/^evolution_/, '');
      const entry = agentMap.get(agent) ?? { calls: 0, costUsd: 0 };
      entry.calls += 1;
      entry.costUsd += (call.estimated_cost_usd as number) ?? 0;
      agentMap.set(agent, entry);
    }

    const breakdown: AgentCostBreakdown[] = Array.from(agentMap.entries())
      .map(([agent, { calls: count, costUsd }]) => ({ agent, calls: count, costUsd }))
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

    // Map created_at → applied_at for the interface
    const rows: ContentHistoryRow[] = (data ?? []).map((row) => ({
      id: row.id,
      explanation_id: row.explanation_id,
      source: row.source,
      evolution_run_id: row.evolution_run_id,
      applied_by: row.applied_by,
      applied_at: row.created_at,
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
