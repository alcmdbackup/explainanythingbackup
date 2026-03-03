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

/** Resolve prompt registry IDs to prompt text. Throws if any ID is missing or deleted. */
async function resolvePromptIds(
  supabase: SupabaseService,
  promptIds: string[],
): Promise<string[]> {
  const { data, error } = await supabase
    .from('evolution_arena_topics')
    .select('id, prompt')
    .in('id', promptIds)
    .is('deleted_at', null);
  if (error || !data) throw new Error(`Failed to resolve prompts: ${error?.message}`);
  if (data.length !== promptIds.length) {
    const found = new Set(data.map((d: { id: string }) => d.id));
    const missing = promptIds.filter(id => !found.has(id));
    throw new Error(`Prompt(s) not found: ${missing.join(', ')}`);
  }
  const byId = new Map(data.map((d: { id: string; prompt: string }) => [d.id, d.prompt]));
  return promptIds.map(id => byId.get(id)!);
}

export interface ValidateExperimentInput {
  factors: Record<string, FactorInput>;
  promptIds: string[];
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
  promptIds: string[];
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
    const resolvedPrompts = await resolvePromptIds(supabase, input.promptIds);

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
        const promptCount = resolvedPrompts.length;
        const totalRunCount = result.expandedConfigs.length * promptCount;
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

    const resolvedPrompts = await resolvePromptIds(supabase, input.promptIds);
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
    const totalRunCount = design.runs.length * resolvedPrompts.length;
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
        prompts: resolvedPrompts,
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

      for (const prompt of resolvedPrompts) {
        const promptTitle = `[Exp: ${input.name}] ${prompt.slice(0, 50)}`;
        const { data: explanation, error: explError } = await supabase
          .from('explanations')
          .insert({
            explanation_title: promptTitle,
            content: prompt,
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
  prompts: string[];
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
      .select('*')
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
        prompts: exp.prompts,
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
  experimentRow: number | null;
  createdAt: string;
  completedAt: string | null;
}

const _getExperimentRunsAction = withLogging(async (
  input: { experimentId: string },
): Promise<ActionResult<ExperimentRun[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: runs } = await supabase
      .from('evolution_runs')
      .select('id, status, run_summary, total_cost_usd, config, created_at, completed_at')
      .eq('experiment_id', input.experimentId)
      .order('created_at', { ascending: true });

    const result: ExperimentRun[] = (runs ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      status: r.status as string,
      eloScore: extractTopElo(r.run_summary as Record<string, unknown> | null),
      costUsd: r.total_cost_usd ? Number(r.total_cost_usd) : null,
      experimentRow: (r.config as Record<string, unknown> | null)?._experimentRow as number ?? null,
      createdAt: r.created_at as string,
      completedAt: r.completed_at as string | null,
    }));

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
