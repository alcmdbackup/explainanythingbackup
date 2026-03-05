'use server';
// Server actions for experiment lifecycle: validation, creation, status, cancellation.
// Follows codebase server action pattern: 'use server' + withLogging + requireAdmin + serverReadRequestId.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { validateExperimentConfig, estimateBatchCostDetailed, buildL8FactorDefinitions } from '@evolution/experiments/evolution/experimentValidation';
import type { FactorInput } from '@evolution/experiments/evolution/experimentValidation';
import { computeEffectiveBudgetCaps } from '@evolution/lib/core/budgetRedistribution';
import { FACTOR_REGISTRY } from '@evolution/experiments/evolution/factorRegistry';
import { getModelPricing } from '@/config/llmPricing';
import { generateL8Design } from '@evolution/experiments/evolution/factorial';
import { resolveConfig } from '@evolution/lib/config';
import type { EvolutionRunConfig } from '@evolution/lib/types';
import { resolveOrCreateStrategyFromRunConfig } from '@evolution/services/strategyResolution';
import { callLLM } from '@/lib/services/llms';
import { extractTopElo } from '@evolution/services/experimentHelpers';
import { EVOLUTION_SYSTEM_USERID } from '@evolution/lib/core/llmClient';
import { buildExperimentReportPrompt, REPORT_MODEL } from '@evolution/services/experimentReportPrompt';

type ActionResult<T> = { success: boolean; data: T | null; error: ErrorResponse | null };
type SupabaseService = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

const TERMINAL_EXPERIMENT_STATES = ['completed', 'failed', 'cancelled'] as const;

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

export interface ValidateExperimentInput {
  factors: Record<string, FactorInput>;
  promptId: string;
  configDefaults?: Partial<EvolutionRunConfig>;
  budget?: number;
}

export interface RunPreviewRow {
  row: number;
  factors: Record<string, string | number>;
  enabledAgents: string[];
  effectiveBudgetCaps: Record<string, number>;
  estimatedCostPerPrompt: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface ValidateExperimentOutput {
  valid: boolean;
  errors: string[];
  warnings: string[];
  expandedRunCount: number;
  estimatedCost: number;
  runPreview?: RunPreviewRow[];
  perRunBudget?: number;
  budgetSufficient?: boolean;
  budgetWarning?: string;
}

export interface StartExperimentInput {
  name: string;
  factors: Record<string, FactorInput>;
  promptId: string;
  budget: number;
  target?: 'elo' | 'elo_per_dollar';
  convergenceThreshold?: number;
  configDefaults?: Partial<EvolutionRunConfig>;
}

const _validateExperimentConfigAction = withLogging(async (
  input: ValidateExperimentInput,
): Promise<ActionResult<ValidateExperimentOutput>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();
    const resolvedPrompt = await resolvePromptId(supabase, input.promptId);
    const resolvedPrompts = [resolvedPrompt];

    const result = await validateExperimentConfig(
      input.factors,
      resolvedPrompts,
      input.configDefaults,
    );

    const output: ValidateExperimentOutput = {
      valid: result.valid,
      errors: result.errors,
      warnings: result.warnings,
      expandedRunCount: result.expandedConfigs.length,
      estimatedCost: result.estimatedTotalCost,
    };

    if (result.valid && result.expandedConfigs.length > 0) {
      const runPreview: RunPreviewRow[] = result.expandedConfigs.map((ec, i) => {
        const caps = computeEffectiveBudgetCaps(
          ec.config.budgetCaps ?? {},
          ec.config.enabledAgents,
          false,
        );
        const rowCost = result.perRowCosts[i];
        return {
          row: ec.row,
          factors: ec.factors,
          enabledAgents: ec.config.enabledAgents ?? [],
          effectiveBudgetCaps: caps,
          estimatedCostPerPrompt: rowCost?.estimatedCostPerPrompt ?? 0,
          confidence: rowCost?.confidence ?? 'low',
        };
      });
      output.runPreview = runPreview;

      if (input.budget != null && input.budget > 0) {
        const totalRunCount = result.expandedConfigs.length;
        const perRunBudget = input.budget / totalRunCount;
        const maxRowCostPerPrompt = Math.max(...result.perRowCosts.map(r => r.estimatedCostPerPrompt));

        output.perRunBudget = perRunBudget;
        output.budgetSufficient = perRunBudget >= maxRowCostPerPrompt;
        if (!output.budgetSufficient) {
          output.budgetWarning = `Per-run budget $${perRunBudget.toFixed(4)} is below estimated cost $${maxRowCostPerPrompt.toFixed(4)} for the most expensive configuration. Runs will likely hit budget_exceeded errors.`;
        }
      }
    }

    return { success: true, data: output, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'validateExperimentConfigAction') };
  }
}, 'validateExperimentConfigAction');

export const validateExperimentConfigAction = serverReadRequestId(_validateExperimentConfigAction);

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

const _startExperimentAction = withLogging(async (
  input: StartExperimentInput,
): Promise<ActionResult<{ experimentId: string }>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const resolvedPrompt = await resolvePromptId(supabase, input.promptId);
    const resolvedPrompts = [resolvedPrompt];
    const validation = await validateExperimentConfig(input.factors, resolvedPrompts, input.configDefaults);
    if (!validation.valid) {
      throw new Error(`Invalid experiment config: ${validation.errors.join('; ')}`);
    }

    const l8Factors = buildL8FactorDefinitions(input.factors);
    const design = generateL8Design(l8Factors);

    // Validate budget and run count before any DB writes to avoid orphaned records
    if (input.budget <= 0) {
      throw new Error(`Budget must be positive, got ${input.budget}`);
    }
    const totalRunCount = design.runs.length;
    if (totalRunCount === 0) {
      throw new Error('Experiment produced 0 runs — cannot allocate budget');
    }
    const perRunBudget = input.budget / totalRunCount;

    const { data: experiment, error: expError } = await supabase
      .from('evolution_experiments')
      .insert({
        name: input.name,
        status: 'pending',
        optimization_target: input.target ?? 'elo',
        total_budget_usd: input.budget,
        convergence_threshold: input.convergenceThreshold ?? 10.0,
        factor_definitions: input.factors,
        prompt_id: input.promptId,
        config_defaults: input.configDefaults ?? null,
        design: 'L8',
      })
      .select('id')
      .single();
    if (expError || !experiment) throw new Error(`Failed to create experiment: ${expError?.message}`);

    const { perRow } = await estimateBatchCostDetailed(validation.expandedConfigs, resolvedPrompts);
    const maxRowCostPerPrompt = Math.max(...perRow.map(r => r.estimatedCostPerPrompt));
    if (perRunBudget < maxRowCostPerPrompt) {
      throw new Error(`Budget too low: per-run budget $${perRunBudget.toFixed(4)} is below estimated cost $${maxRowCostPerPrompt.toFixed(4)} for the most expensive configuration.`);
    }

    const topicId = await getOrCreateExperimentTopic(supabase);
    const runInserts: Record<string, unknown>[] = [];

    for (const run of design.runs) {
      const pipelineArgs = run.pipelineArgs;
      const overrides: Partial<EvolutionRunConfig> = {
        ...input.configDefaults,
        budgetCapUsd: perRunBudget,
        generationModel: pipelineArgs.model as EvolutionRunConfig['generationModel'],
        judgeModel: pipelineArgs.judgeModel as EvolutionRunConfig['judgeModel'],
        maxIterations: pipelineArgs.iterations,
        enabledAgents: pipelineArgs.enabledAgents as EvolutionRunConfig['enabledAgents'],
      };
      const resolvedConfig = resolveConfig(overrides);

      const { id: strategyConfigId } = await resolveOrCreateStrategyFromRunConfig({
        runConfig: resolvedConfig,
        defaultBudgetCaps: resolvedConfig.budgetCaps ?? {},
        createdBy: 'experiment',
      }, supabase);

      const promptTitle = `[Exp: ${input.name}] ${resolvedPrompt.slice(0, 50)}`;
      const { data: explanation, error: explError } = await supabase
        .from('explanations')
        .insert({
          explanation_title: promptTitle,
          content: resolvedPrompt,
          primary_topic_id: topicId,
          status: 'draft',
        })
        .select('id')
        .single();
      if (explError || !explanation) throw new Error(`Failed to create explanation: ${explError?.message}`);

      runInserts.push({
        explanation_id: explanation.id,
        budget_cap_usd: resolvedConfig.budgetCapUsd,
        config: { ...resolvedConfig, _experimentRow: run.row },
        experiment_id: experiment.id,
        source: `experiment:${experiment.id}`,
        strategy_config_id: strategyConfigId,
        status: 'pending',
      });
    }

    const { error: runsError } = await supabase
      .from('evolution_runs')
      .insert(runInserts);
    if (runsError) throw new Error(`Failed to create runs: ${runsError.message}`);

    await supabase.from('evolution_experiments').update({
      status: 'running',
      updated_at: new Date().toISOString(),
    }).eq('id', experiment.id);

    return { success: true, data: { experimentId: experiment.id }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'startExperimentAction') };
  }
}, 'startExperimentAction');

export const startExperimentAction = serverReadRequestId(_startExperimentAction);

export interface ExperimentStatus {
  id: string;
  name: string;
  status: string;
  optimizationTarget: string;
  totalBudgetUsd: number;
  spentUsd: number;
  convergenceThreshold: number;
  factorDefinitions: Record<string, FactorInput>;
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
        design: exp.design ?? 'L8',
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
  input?: { status?: string },
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

export interface FactorMetadata {
  key: string;
  label: string;
  type: string;
  validValues: (string | number)[];
  valuePricing?: Record<string, { inputPer1M: number; outputPer1M: number }>;
}

const _getFactorMetadataAction = withLogging(async (): Promise<ActionResult<FactorMetadata[]>> => {
  try {
    await requireAdmin();
    const metadata: FactorMetadata[] = Array.from(FACTOR_REGISTRY, ([key, def]) => {
      const orderedValues = def.orderValues(def.getValidValues());
      const valuePricing = def.type === 'model'
        ? Object.fromEntries(orderedValues.map((v) => {
            const p = getModelPricing(String(v));
            return [String(v), { inputPer1M: p.inputPer1M, outputPer1M: p.outputPer1M }];
          }))
        : undefined;
      return { key, label: def.label, type: def.type, validValues: orderedValues, valuePricing };
    });
    return { success: true, data: metadata, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getFactorMetadataAction') };
  }
}, 'getFactorMetadataAction');

export const getFactorMetadataAction = serverReadRequestId(_getFactorMetadataAction);

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

// ─── Manual Experiment Actions ──────────────────────────────────

export interface CreateManualExperimentInput {
  name: string;
  promptId: string;
  target?: 'elo' | 'elo_per_dollar';
}

const _createManualExperimentAction = withLogging(async (
  input: CreateManualExperimentInput,
): Promise<ActionResult<{ experimentId: string }>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    if (!input.name?.trim()) throw new Error('Experiment name is required');
    if (!input.promptId) throw new Error('A prompt is required');

    await resolvePromptId(supabase, input.promptId);

    const { data: experiment, error: expError } = await supabase
      .from('evolution_experiments')
      .insert({
        name: input.name.trim(),
        status: 'pending',
        optimization_target: input.target ?? 'elo',
        total_budget_usd: 0,
        factor_definitions: {},
        prompt_id: input.promptId,
        design: 'manual',
      })
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
    };
    const resolvedConfig = resolveConfig(overrides);

    const { id: strategyConfigId } = await resolveOrCreateStrategyFromRunConfig({
      runConfig: resolvedConfig,
      defaultBudgetCaps: resolvedConfig.budgetCaps ?? {},
      createdBy: 'experiment',
    }, supabase);

    const topicId = await getOrCreateExperimentTopic(supabase);

    const promptTitle = `[Exp: manual] ${promptText.slice(0, 50)}`;
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

    const { error: runsError } = await supabase
      .from('evolution_runs')
      .insert({
        explanation_id: explanation.id,
        budget_cap_usd: resolvedConfig.budgetCapUsd,
        config: resolvedConfig,
        experiment_id: exp.id,
        source: `experiment:${exp.id}`,
        strategy_config_id: strategyConfigId,
        status: 'pending',
      });
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
