'use server';
// Server actions for experiment lifecycle: validation, creation, status, cancellation.
// Follows codebase server action pattern: 'use server' + withLogging + requireAdmin + serverReadRequestId.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { resolveConfig } from '@evolution/lib/config';
import type { EvolutionRunConfig } from '@evolution/lib/types';
import { resolveOrCreateStrategyFromRunConfig } from '@evolution/services/strategyResolution';
import { callLLM } from '@/lib/services/llms';
import { extractTopElo } from '@evolution/services/experimentHelpers';
import { computeRunMetrics, aggregateMetrics } from '@evolution/experiments/evolution/experimentMetrics';
import type { ExperimentMetricsResult, StrategyMetricsResult, MetricsBag } from '@evolution/experiments/evolution/experimentMetrics';
import { EVOLUTION_SYSTEM_USERID } from '@evolution/lib/core/llmClient';
import { buildExperimentReportPrompt, REPORT_MODEL } from '@evolution/services/experimentReportPrompt';

type ActionResult<T> = { success: boolean; data: T | null; error: ErrorResponse | null };
type SupabaseService = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label: string): void {
  if (!UUID_REGEX.test(id)) {
    throw new Error(`Invalid ${label} format: ${id}`);
  }
}

const TERMINAL_EXPERIMENT_STATES = ['completed', 'failed', 'cancelled'] as const;

/** Build a human-readable label from run config (e.g. "gpt-4o / claude-3-haiku"). */
function buildConfigLabel(config: Record<string, unknown> | null): string {
  const model = (config?.generationModel as string) ?? 'unknown';
  const judge = (config?.judgeModel as string) ?? '';
  return judge ? `${model} / ${judge}` : model;
}

/** Resolve a single prompt registry ID to prompt text. Throws if ID is missing or deleted. */
async function resolvePromptId(
  supabase: SupabaseService,
  promptId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('evolution_arena_topics')
    .select('id, prompt')
    .eq('id', promptId)
    .is('deleted_at', null)
    .single();
  if (error || !data) throw new Error(`Prompt not found: ${promptId}`);
  return (data as { id: string; prompt: string }).prompt;
}

/** Get or create the "Batch Experiments" topic for temporary explanations. */
async function getOrCreateExperimentTopic(
  supabase: SupabaseService,
): Promise<number> {
  const { data: existing } = await supabase
    .from('topics')
    .select('id')
    .eq('topic_title', 'Batch Experiments')
    .single();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('topics')
    .insert({ topic_title: 'Batch Experiments', topic_description: 'Auto-generated for evolution experiments' })
    .select('id')
    .single();
  if (error || !created) throw new Error(`Failed to create topic: ${error?.message}`);
  return created.id;
}

export interface ExperimentStatus {
  id: string;
  name: string;
  status: string;
  optimizationTarget: string;
  totalBudgetUsd: number;
  spentUsd: number;
  convergenceThreshold: number;
  factorDefinitions: Record<string, unknown>;
  promptId: string;
  promptTitle: string;
  resultsSummary: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  design: string;
  analysisResults: Record<string, unknown> | null;
  runCounts: { total: number; completed: number; failed: number; pending: number };
}

const _getExperimentStatusAction = withLogging(async (
  input: { experimentId: string },
): Promise<ActionResult<ExperimentStatus>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: exp, error: expError } = await supabase
      .from('evolution_experiments')
      .select('*, evolution_arena_topics!prompt_id(prompt)')
      .eq('id', input.experimentId)
      .single();
    if (expError || !exp) throw new Error(`Experiment not found: ${expError?.message ?? input.experimentId}`);

    const runCounts = { total: 0, completed: 0, failed: 0, pending: 0 };
    const { data: runs } = await supabase
      .from('evolution_runs')
      .select('status')
      .eq('experiment_id', input.experimentId);
    for (const r of runs ?? []) {
      runCounts.total++;
      if (r.status === 'completed') runCounts.completed++;
      else if (r.status === 'failed') runCounts.failed++;
      else runCounts.pending++;
    }

    const topic = exp.evolution_arena_topics as { prompt: string } | null;

    return {
      success: true,
      data: {
        id: exp.id,
        name: exp.name,
        status: exp.status,
        optimizationTarget: exp.optimization_target,
        totalBudgetUsd: Number(exp.total_budget_usd),
        spentUsd: Number(exp.spent_usd),
        convergenceThreshold: Number(exp.convergence_threshold),
        factorDefinitions: exp.factor_definitions,
        promptId: exp.prompt_id,
        promptTitle: topic?.prompt ?? 'Unknown prompt',
        resultsSummary: exp.results_summary,
        errorMessage: exp.error_message,
        createdAt: exp.created_at,
        design: exp.design ?? 'manual',
        analysisResults: exp.analysis_results ?? null,
        runCounts,
      },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getExperimentStatusAction') };
  }
}, 'getExperimentStatusAction');

export const getExperimentStatusAction = serverReadRequestId(_getExperimentStatusAction);

export interface ExperimentSummary {
  id: string;
  name: string;
  status: string;
  totalBudgetUsd: number;
  spentUsd: number;
  createdAt: string;
}

const _listExperimentsAction = withLogging(async (
  input?: { status?: string; includeArchived?: boolean },
): Promise<ActionResult<ExperimentSummary[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    let query = supabase
      .from('evolution_experiments')
      .select('id, name, status, total_budget_usd, spent_usd, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (input?.status) {
      query = query.eq('status', input.status);
    } else if (!input?.includeArchived) {
      query = query.neq('status', 'archived');
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list experiments: ${error.message}`);

    const summaries: ExperimentSummary[] = (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      name: row.name as string,
      status: row.status as string,
      totalBudgetUsd: Number(row.total_budget_usd),
      spentUsd: Number(row.spent_usd),
      createdAt: row.created_at as string,
    }));

    return { success: true, data: summaries, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'listExperimentsAction') };
  }
}, 'listExperimentsAction');

export const listExperimentsAction = serverReadRequestId(_listExperimentsAction);

const _cancelExperimentAction = withLogging(async (
  input: { experimentId: string },
): Promise<ActionResult<{ cancelled: boolean }>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: exp, error: fetchError } = await supabase
      .from('evolution_experiments')
      .select('id, status')
      .eq('id', input.experimentId)
      .single();
    if (fetchError || !exp) throw new Error(`Experiment not found: ${input.experimentId}`);

    if ((TERMINAL_EXPERIMENT_STATES as readonly string[]).includes(exp.status)) {
      throw new Error(`Experiment already in terminal state: ${exp.status}`);
    }

    await supabase
      .from('evolution_experiments')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', input.experimentId);

    await supabase
      .from('evolution_runs')
      .update({ status: 'failed', error_message: 'Experiment cancelled' })
      .eq('experiment_id', input.experimentId)
      .in('status', ['pending', 'claimed']);

    return { success: true, data: { cancelled: true }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'cancelExperimentAction') };
  }
}, 'cancelExperimentAction');

export const cancelExperimentAction = serverReadRequestId(_cancelExperimentAction);

// ─── Archive experiment ──────────────────────────────────────────

const _archiveExperimentAction = withLogging(async (
  input: { experimentId: string },
): Promise<ActionResult<{ archived: boolean }>> => {
  try {
    await requireAdmin();
    validateUuid(input.experimentId, 'experimentId');
    const supabase = await createSupabaseServiceClient();

    const { error } = await supabase.rpc('archive_experiment', { p_experiment_id: input.experimentId });
    if (error) throw new Error(`Failed to archive experiment: ${error.message}`);
    return { success: true, data: { archived: true }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'archiveExperimentAction') };
  }
}, 'archiveExperimentAction');

export const archiveExperimentAction = serverReadRequestId(_archiveExperimentAction);

// ─── Unarchive experiment ────────────────────────────────────────

const _unarchiveExperimentAction = withLogging(async (
  input: { experimentId: string },
): Promise<ActionResult<{ unarchived: boolean }>> => {
  try {
    await requireAdmin();
    validateUuid(input.experimentId, 'experimentId');
    const supabase = await createSupabaseServiceClient();

    const { error } = await supabase.rpc('unarchive_experiment', { p_experiment_id: input.experimentId });
    if (error) throw new Error(`Failed to unarchive experiment: ${error.message}`);
    return { success: true, data: { unarchived: true }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'unarchiveExperimentAction') };
  }
}, 'unarchiveExperimentAction');

export const unarchiveExperimentAction = serverReadRequestId(_unarchiveExperimentAction);

export interface ExperimentRun {
  id: string;
  status: string;
  eloScore: number | null;
  costUsd: number | null;
  budgetCapUsd: number | null;
  experimentRow: number | null;
  strategyConfigId: string | null;
  createdAt: string;
  completedAt: string | null;
  generationModel: string | null;
  judgeModel: string | null;
}

const _getExperimentRunsAction = withLogging(async (
  input: { experimentId: string },
): Promise<ActionResult<ExperimentRun[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: runs } = await supabase
      .from('evolution_runs')
      .select('id, status, run_summary, total_cost_usd, budget_cap_usd, config, created_at, completed_at, strategy_config_id')
      .eq('experiment_id', input.experimentId)
      .order('created_at', { ascending: true });

    const result: ExperimentRun[] = (runs ?? []).map((r: Record<string, unknown>) => {
      const config = r.config as Record<string, unknown> | null;
      return {
        id: r.id as string,
        status: r.status as string,
        eloScore: extractTopElo(r.run_summary as Record<string, unknown> | null),
        costUsd: r.total_cost_usd ? Number(r.total_cost_usd) : null,
        budgetCapUsd: r.budget_cap_usd ? Number(r.budget_cap_usd) : null,
        experimentRow: config?._experimentRow as number ?? null,
        strategyConfigId: (r.strategy_config_id as string) ?? null,
        createdAt: r.created_at as string,
        completedAt: r.completed_at as string | null,
        generationModel: config?.generationModel as string ?? null,
        judgeModel: config?.judgeModel as string ?? null,
      };
    });

    return { success: true, data: result, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getExperimentRunsAction') };
  }
}, 'getExperimentRunsAction');

export const getExperimentRunsAction = serverReadRequestId(_getExperimentRunsAction);

export interface ExperimentReportData {
  report: string;
  generatedAt: string;
  model: string;
}

const _regenerateExperimentReportAction = withLogging(async (
  input: { experimentId: string },
): Promise<ActionResult<ExperimentReportData>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: exp } = await supabase
      .from('evolution_experiments')
      .select('*')
      .eq('id', input.experimentId)
      .single();
    if (!exp) throw new Error('Experiment not found');

    const { data: runs } = await supabase
      .from('evolution_runs')
      .select('id, status, run_summary, total_cost_usd, config')
      .eq('experiment_id', input.experimentId);

    const runIds = (runs ?? []).map((r: Record<string, unknown>) => r.id as string);
    const { data: agentMetrics } = runIds.length > 0
      ? await supabase
          .from('evolution_run_agent_metrics')
          .select('agent_name, cost_usd, elo_gain, elo_per_dollar, variants_generated')
          .in('run_id', runIds)
      : { data: [] as Record<string, unknown>[] };

    const prompt = buildExperimentReportPrompt({
      experiment: exp,
      runs: (runs ?? []) as Record<string, unknown>[],
      agentMetrics: (agentMetrics ?? []) as Record<string, unknown>[],
      resultsSummary: exp.results_summary,
    });

    const reportText = await callLLM(
      prompt,
      'experiment_report_generation',
      EVOLUTION_SYSTEM_USERID,
      REPORT_MODEL,
      false,
      null,
    );

    const reportMeta = {
      text: reportText,
      generatedAt: new Date().toISOString(),
      model: REPORT_MODEL,
    };
    const updatedSummary = { ...(exp.results_summary ?? {}), report: reportMeta };
    await supabase
      .from('evolution_experiments')
      .update({ results_summary: updatedSummary })
      .eq('id', input.experimentId);

    return {
      success: true,
      data: {
        report: reportText,
        generatedAt: reportMeta.generatedAt,
        model: REPORT_MODEL,
      },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'regenerateExperimentReportAction') };
  }
}, 'regenerateExperimentReportAction');

export const regenerateExperimentReportAction = serverReadRequestId(_regenerateExperimentReportAction);

// ─── Get experiment name by ID ──────────────────────────────────

const _getExperimentNameAction = withLogging(async (
  id: string,
): Promise<ActionResult<string>> => {
  try {
    await requireAdmin();
    validateUuid(id, 'experiment ID');
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('evolution_experiments')
      .select('name')
      .eq('id', id)
      .single();

    if (error || !data) throw new Error(`Experiment not found: ${id}`);
    return { success: true, data: data.name as string, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getExperimentNameAction') };
  }
}, 'getExperimentNameAction');

export const getExperimentNameAction = serverReadRequestId(_getExperimentNameAction);

// ─── Manual Experiment Actions ──────────────────────────────────

export interface CreateManualExperimentInput {
  name: string;
  promptId: string;
}

const _createManualExperimentAction = withLogging(async (
  input: CreateManualExperimentInput,
): Promise<ActionResult<{ experimentId: string }>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    if (!input.name?.trim()) throw new Error('Experiment name is required');
    if (!input.promptId) throw new Error('A prompt is required');

    const promptText = await resolvePromptId(supabase, input.promptId);

    // Create evolution_explanation for this experiment's prompt (gracefully skips pre-migration)
    let evoExplId: string | undefined;
    const { data: evoExpl, error: evoExplError } = await supabase
      .from('evolution_explanations')
      .insert({
        prompt_id: input.promptId,
        title: promptText.slice(0, 80) || 'Untitled experiment prompt',
        content: promptText,
        source: 'prompt_seed',
      })
      .select('id')
      .single();
    if (!evoExplError && evoExpl) {
      evoExplId = evoExpl.id;
    }
    // Silently skip if table doesn't exist (pre-migration).
    // After migration, NOT NULL constraint enforces this always succeeds.

    const expInsert: Record<string, unknown> = {
      name: input.name.trim(),
      status: 'pending',
      optimization_target: 'elo',
      total_budget_usd: 0,
      factor_definitions: {},
      prompt_id: input.promptId,
      design: 'manual',
    };
    if (evoExplId) expInsert.evolution_explanation_id = evoExplId;

    const { data: experiment, error: expError } = await supabase
      .from('evolution_experiments')
      .insert(expInsert)
      .select('id')
      .single();
    if (expError || !experiment) throw new Error(`Failed to create experiment: ${expError?.message}`);

    return { success: true, data: { experimentId: experiment.id }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'createManualExperimentAction') };
  }
}, 'createManualExperimentAction');

export const createManualExperimentAction = serverReadRequestId(_createManualExperimentAction);

export interface AddRunToExperimentInput {
  experimentId: string;
  config: {
    generationModel: string;
    judgeModel: string;
    enabledAgents?: string[];
    budgetCapUsd: number;
    maxIterations?: number;
  };
}

const _addRunToExperimentAction = withLogging(async (
  input: AddRunToExperimentInput,
): Promise<ActionResult<{ runCount: number }>> => {
  try {
    await requireAdmin();
    const { MAX_RUN_BUDGET_USD, MAX_EXPERIMENT_BUDGET_USD } = await import('@evolution/lib/config');
    const supabase = await createSupabaseServiceClient();

    // Validate budget cap
    if (input.config.budgetCapUsd < 0.01 || input.config.budgetCapUsd > MAX_RUN_BUDGET_USD) {
      throw new Error(`budgetCapUsd must be between $0.01 and $${MAX_RUN_BUDGET_USD.toFixed(2)}`);
    }

    // Fetch experiment
    const { data: exp, error: fetchError } = await supabase
      .from('evolution_experiments')
      .select('id, status, total_budget_usd, prompt_id, evolution_arena_topics!prompt_id(prompt)')
      .eq('id', input.experimentId)
      .single();
    if (fetchError || !exp) throw new Error(`Experiment not found: ${input.experimentId}`);
    if (exp.status !== 'pending' && exp.status !== 'running') {
      throw new Error(`Cannot add runs to experiment in '${exp.status}' state`);
    }

    const promptText: string = (exp as Record<string, unknown>).evolution_arena_topics
      ? ((exp as Record<string, unknown>).evolution_arena_topics as Record<string, string>).prompt
      : '';
    const budgetIncrement = input.config.budgetCapUsd;
    const newTotal = Number(exp.total_budget_usd) + budgetIncrement;
    if (newTotal > MAX_EXPERIMENT_BUDGET_USD) {
      throw new Error(`Adding this run would exceed the $${MAX_EXPERIMENT_BUDGET_USD.toFixed(2)} experiment budget cap (current: $${Number(exp.total_budget_usd).toFixed(2)}, adding: $${budgetIncrement.toFixed(2)})`);
    }

    // Build run config
    const overrides: Partial<EvolutionRunConfig> = {
      budgetCapUsd: input.config.budgetCapUsd,
      generationModel: input.config.generationModel as EvolutionRunConfig['generationModel'],
      judgeModel: input.config.judgeModel as EvolutionRunConfig['judgeModel'],
      enabledAgents: input.config.enabledAgents as EvolutionRunConfig['enabledAgents'],
      ...(input.config.maxIterations != null && { maxIterations: input.config.maxIterations }),
    };
    const resolvedConfig = resolveConfig(overrides);

    const { id: strategyConfigId } = await resolveOrCreateStrategyFromRunConfig({
      runConfig: resolvedConfig,
      createdBy: 'experiment',
    }, supabase);

    const topicId = await getOrCreateExperimentTopic(supabase);

    const promptTitle = promptText.slice(0, 80) || 'Untitled experiment prompt';
    const { data: explanation, error: explError } = await supabase
      .from('explanations')
      .insert({
        explanation_title: promptTitle,
        content: promptText,
        primary_topic_id: topicId,
        status: 'draft',
      })
      .select('id')
      .single();
    if (explError || !explanation) throw new Error(`Failed to create explanation: ${explError?.message}`);

    // Create evolution_explanation row for the run's seed content (gracefully skips pre-migration)
    let evoExplId: string | undefined;
    const { data: evoExpl, error: evoExplError } = await supabase
      .from('evolution_explanations')
      .insert({
        explanation_id: explanation.id,
        title: promptTitle,
        content: promptText,
        source: 'explanation',
      })
      .select('id')
      .single();
    if (!evoExplError && evoExpl) {
      evoExplId = evoExpl.id;
    }
    // Silently skip if table doesn't exist (pre-migration).
    // After migration, NOT NULL constraint enforces this always succeeds.

    const runInsert: Record<string, unknown> = {
      explanation_id: explanation.id,
      budget_cap_usd: resolvedConfig.budgetCapUsd,
      config: resolvedConfig,
      experiment_id: exp.id,
      source: `experiment:${exp.id}`,
      strategy_config_id: strategyConfigId,
      status: 'pending',
    };
    if (evoExplId) runInsert.evolution_explanation_id = evoExplId;

    const { error: runsError } = await supabase
      .from('evolution_runs')
      .insert(runInsert);
    if (runsError) throw new Error(`Failed to create run: ${runsError.message}`);

    // Update experiment budget
    await supabase.from('evolution_experiments')
      .update({ total_budget_usd: newTotal })
      .eq('id', exp.id);

    return { success: true, data: { runCount: 1 }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'addRunToExperimentAction') };
  }
}, 'addRunToExperimentAction');

export const addRunToExperimentAction = serverReadRequestId(_addRunToExperimentAction);

const _startManualExperimentAction = withLogging(async (
  input: { experimentId: string },
): Promise<ActionResult<{ started: boolean }>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: exp } = await supabase
      .from('evolution_experiments')
      .select('id, status')
      .eq('id', input.experimentId)
      .single();
    if (!exp) throw new Error(`Experiment not found: ${input.experimentId}`);
    if (exp.status !== 'pending') throw new Error(`Experiment must be pending to start, got '${exp.status}'`);

    // Verify at least 1 run exists
    const { count } = await supabase
      .from('evolution_runs')
      .select('id', { count: 'exact', head: true })
      .eq('experiment_id', input.experimentId);
    if (!count || count === 0) throw new Error('Cannot start experiment with 0 runs');

    await supabase.from('evolution_experiments')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', input.experimentId);

    return { success: true, data: { started: true }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'startManualExperimentAction') };
  }
}, 'startManualExperimentAction');

export const startManualExperimentAction = serverReadRequestId(_startManualExperimentAction);

const _deleteExperimentAction = withLogging(async (
  input: { experimentId: string },
): Promise<ActionResult<{ deleted: boolean }>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: exp } = await supabase
      .from('evolution_experiments')
      .select('id, status')
      .eq('id', input.experimentId)
      .single();
    if (!exp) throw new Error(`Experiment not found: ${input.experimentId}`);
    if (exp.status !== 'pending') throw new Error(`Only pending experiments can be deleted, got '${exp.status}'`);

    // Delete runs first (FK constraint prevents experiment deletion otherwise)
    await supabase.from('evolution_runs')
      .delete()
      .eq('experiment_id', input.experimentId);

    await supabase.from('evolution_experiments')
      .delete()
      .eq('id', input.experimentId);

    return { success: true, data: { deleted: true }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'deleteExperimentAction') };
  }
}, 'deleteExperimentAction');

export const deleteExperimentAction = serverReadRequestId(_deleteExperimentAction);

// Re-export types for consumers
export type { ExperimentMetricsResult, StrategyMetricsResult, MetricsBag };

// ─── Experiment Metrics Action ──────────────────────────────────

const _getExperimentMetricsAction = withLogging(async (
  input: { experimentId: string },
): Promise<ActionResult<ExperimentMetricsResult>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: runs, error: runsError } = await supabase
      .from('evolution_runs')
      .select('id, status, total_cost_usd, run_summary, config, strategy_config_id')
      .eq('experiment_id', input.experimentId)
      .order('created_at', { ascending: true });

    if (runsError) throw new Error(`Failed to fetch runs: ${runsError.message}`);

    const warnings: string[] = [];
    const completedRuns = (runs ?? []).filter((r: Record<string, unknown>) => r.status === 'completed');
    const totalRuns = (runs ?? []).length;

    if (completedRuns.length < totalRuns) {
      warnings.push(`${totalRuns - completedRuns.length} of ${totalRuns} runs incomplete`);
    }

    const runResults = await Promise.all(
      (runs ?? []).map(async (r: Record<string, unknown>) => {
        let metrics: MetricsBag = {};

        if (r.status === 'completed') {
          try {
            const result = await computeRunMetrics(r.id as string, supabase as never);
            metrics = result.metrics;
          } catch {
            warnings.push(`Failed to compute metrics for run ${(r.id as string).slice(0, 8)}`);
          }
        }

        return {
          runId: r.id as string,
          status: r.status as string,
          configLabel: buildConfigLabel(r.config as Record<string, unknown> | null),
          strategyConfigId: (r.strategy_config_id as string) ?? null,
          metrics,
        };
      }),
    );

    return {
      success: true,
      data: {
        runs: runResults,
        completedRuns: completedRuns.length,
        totalRuns,
        warnings,
      },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getExperimentMetricsAction') };
  }
}, 'getExperimentMetricsAction');

export const getExperimentMetricsAction = serverReadRequestId(_getExperimentMetricsAction);

// ─── Strategy Metrics Action ────────────────────────────────────

const _getStrategyMetricsAction = withLogging(async (
  input: { strategyConfigId: string },
): Promise<ActionResult<StrategyMetricsResult>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: runs, error: runsError } = await supabase
      .from('evolution_runs')
      .select('id, status, total_cost_usd, run_summary, config')
      .eq('strategy_config_id', input.strategyConfigId)
      .order('created_at', { ascending: true });

    if (runsError) throw new Error(`Failed to fetch runs: ${runsError.message}`);

    const completedRuns = (runs ?? []).filter((r: Record<string, unknown>) => r.status === 'completed');

    const runDataEntries = await Promise.all(
      completedRuns.map(async (r: Record<string, unknown>) => {
        const result = await computeRunMetrics(r.id as string, supabase as never);
        return {
          run: {
            runId: r.id as string,
            status: r.status as string,
            configLabel: buildConfigLabel(r.config as Record<string, unknown> | null),
            metrics: result.metrics,
          },
          metricsWithRatings: result,
        };
      }),
    );

    const aggregate = runDataEntries.length > 0
      ? aggregateMetrics(runDataEntries.map((e) => e.metricsWithRatings))
      : {};

    return {
      success: true,
      data: {
        aggregate,
        runs: runDataEntries.map((e) => e.run),
      },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getStrategyMetricsAction') };
  }
}, 'getStrategyMetricsAction');

export const getStrategyMetricsAction = serverReadRequestId(_getStrategyMetricsAction);

// ─── Run Metrics ─────────────────────────────────────────────────

export type { RunMetricsWithRatings } from '@evolution/experiments/evolution/experimentMetrics';

export interface RunMetricsResult {
  metrics: MetricsBag;
  agentBreakdown: Array<{ agent: string; costUsd: number; calls: number }>;
}

const _getRunMetricsAction = withLogging(async (
  runId: string,
): Promise<ActionResult<RunMetricsResult>> => {
  try {
    await requireAdmin();
    validateUuid(runId, 'runId');
    const supabase = await createSupabaseServiceClient();

    const result = await computeRunMetrics(runId, supabase as never);

    // Build agent cost breakdown from agentCost:* metric keys
    const agentBreakdown: RunMetricsResult['agentBreakdown'] = [];
    for (const [key, val] of Object.entries(result.metrics)) {
      if (key.startsWith('agentCost:') && val) {
        agentBreakdown.push({
          agent: key.replace('agentCost:', ''),
          costUsd: val.value,
          calls: val.n,
        });
      }
    }
    agentBreakdown.sort((a, b) => b.costUsd - a.costUsd);

    return { success: true, data: { metrics: result.metrics, agentBreakdown }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getRunMetricsAction', { runId }) };
  }
}, 'getRunMetricsAction');

export const getRunMetricsAction = serverReadRequestId(_getRunMetricsAction);

// ─── Action Distribution (aggregate action counts from invocations) ────

export interface ActionDistributionResult {
  counts: Record<string, number>;
  totalInvocations: number;
}

/** Aggregate action counts across invocations filtered by experiment, strategy, or prompt. */
const _getActionDistributionAction = withLogging(async (
  input: { experimentId?: string; strategyConfigId?: string; promptId?: string },
): Promise<ActionResult<ActionDistributionResult>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    // Resolve run IDs based on the filter
    const runQuery = supabase.from('evolution_runs').select('id');
    let runIds: string[] = [];
    if (input.experimentId) {
      const { data } = await runQuery.eq('experiment_id', input.experimentId);
      runIds = (data ?? []).map((r: Record<string, unknown>) => r.id as string);
    } else if (input.strategyConfigId) {
      const { data } = await runQuery.eq('strategy_config_id', input.strategyConfigId);
      runIds = (data ?? []).map((r: Record<string, unknown>) => r.id as string);
    } else if (input.promptId) {
      const { data: experiments } = await supabase
        .from('evolution_experiments')
        .select('id')
        .eq('prompt_id', input.promptId);
      const expIds = (experiments ?? []).map((e: Record<string, unknown>) => e.id as string);
      if (expIds.length > 0) {
        const { data } = await runQuery.in('experiment_id', expIds);
        runIds = (data ?? []).map((r: Record<string, unknown>) => r.id as string);
      }
    }

    if (runIds.length === 0) {
      return { success: true, data: { counts: {}, totalInvocations: 0 }, error: null };
    }

    // Fetch execution_detail for all invocations in these runs
    const { data: invocations } = await supabase
      .from('evolution_agent_invocations')
      .select('execution_detail')
      .in('run_id', runIds);

    const counts: Record<string, number> = {};
    let totalInvocations = 0;
    for (const inv of invocations ?? []) {
      const detail = inv.execution_detail as Record<string, unknown> | null;
      const actions = detail?._actions;
      if (Array.isArray(actions) && actions.length > 0) {
        totalInvocations++;
        for (const action of actions) {
          const a = action as Record<string, unknown>;
          const type = a.type as string;
          if (type) counts[type] = (counts[type] ?? 0) + 1;
        }
      }
    }

    return { success: true, data: { counts, totalInvocations }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getActionDistributionAction') };
  }
}, 'getActionDistributionAction');

export const getActionDistributionAction = serverReadRequestId(_getActionDistributionAction);

// ─── Rename experiment ────────────────────────────────────────

const _renameExperimentAction = withLogging(async (
  input: { experimentId: string; name: string },
): Promise<ActionResult<{ id: string; name: string }>> => {
  try {
    await requireAdmin();
    validateUuid(input.experimentId, 'experimentId');
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error('Experiment name cannot be empty');
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('evolution_experiments')
      .update({ name: trimmed })
      .eq('id', input.experimentId)
      .select('id, name')
      .single();

    if (error) throw new Error(`Failed to rename experiment: ${error.message}`);
    if (!data) throw new Error(`Experiment not found: ${input.experimentId}`);
    return { success: true, data: data as { id: string; name: string }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'renameExperimentAction') };
  }
}, 'renameExperimentAction');

export const renameExperimentAction = serverReadRequestId(_renameExperimentAction);
