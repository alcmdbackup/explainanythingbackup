'use server';
// Server actions for experiment lifecycle: validation, creation, status, cancellation.
// Follows codebase server action pattern: 'use server' + withLogging + requireAdmin + serverReadRequestId.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { validateExperimentConfig } from '@evolution/experiments/evolution/experimentValidation';
import type { FactorInput } from '@evolution/experiments/evolution/experimentValidation';
import { FACTOR_REGISTRY } from '@evolution/experiments/evolution/factorRegistry';
import { getModelPricing } from '@/config/llmPricing';
import { generateL8Design } from '@evolution/experiments/evolution/factorial';
import type { FactorDefinition } from '@evolution/experiments/evolution/factorial';
import { resolveConfig } from '@evolution/lib/config';
import type { EvolutionRunConfig } from '@evolution/lib/types';

type ActionResult<T> = { success: boolean; data: T | null; error: ErrorResponse | null };
type SupabaseService = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

const TERMINAL_EXPERIMENT_STATES = ['converged', 'budget_exhausted', 'max_rounds', 'failed', 'cancelled'] as const;

/** Resolve prompt registry IDs to prompt text. Throws if any ID is missing or deleted. */
async function resolvePromptIds(
  supabase: SupabaseService,
  promptIds: string[],
): Promise<string[]> {
  const { data, error } = await supabase
    .from('evolution_hall_of_fame_topics')
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

// ─── Types ────────────────────────────────────────────────────────

export interface ValidateExperimentInput {
  factors: Record<string, FactorInput>;
  promptIds: string[];
  configDefaults?: Partial<EvolutionRunConfig>;
}

export interface ValidateExperimentOutput {
  valid: boolean;
  errors: string[];
  warnings: string[];
  expandedRunCount: number;
  estimatedCost: number;
}

export interface StartExperimentInput {
  name: string;
  factors: Record<string, FactorInput>;
  promptIds: string[];
  budget: number;
  target?: 'elo' | 'elo_per_dollar';
  maxRounds?: number;
  convergenceThreshold?: number;
  configDefaults?: Partial<EvolutionRunConfig>;
}

// ─── Validate Experiment Config ──────────────────────────────────

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

    return {
      success: true,
      data: {
        valid: result.valid,
        errors: result.errors,
        warnings: result.warnings,
        expandedRunCount: result.expandedConfigs.length,
        estimatedCost: result.estimatedTotalCost,
      },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'validateExperimentConfigAction') };
  }
}, 'validateExperimentConfigAction');

export const validateExperimentConfigAction = serverReadRequestId(_validateExperimentConfigAction);

// ─── Start Experiment ────────────────────────────────────────────

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

    // 0. Resolve prompt IDs → text
    const resolvedPrompts = await resolvePromptIds(supabase, input.promptIds);

    // 1. Validate config
    const validation = await validateExperimentConfig(input.factors, resolvedPrompts, input.configDefaults);
    if (!validation.valid) {
      throw new Error(`Invalid experiment config: ${validation.errors.join('; ')}`);
    }

    // 2. Build L8 factor definitions
    const l8Factors: Record<string, FactorDefinition> = {};
    const letters = 'ABCDEFG';
    const factorKeys = Object.keys(input.factors);
    for (let i = 0; i < factorKeys.length; i++) {
      const key = factorKeys[i];
      l8Factors[letters[i]] = {
        name: key,
        label: FACTOR_REGISTRY.get(key)!.label,
        low: input.factors[key].low,
        high: input.factors[key].high,
      };
    }

    // 3. Generate L8 design
    const design = generateL8Design(l8Factors);

    // 4. INSERT experiment
    const { data: experiment, error: expError } = await supabase
      .from('evolution_experiments')
      .insert({
        name: input.name,
        status: 'pending',
        optimization_target: input.target ?? 'elo',
        total_budget_usd: input.budget,
        max_rounds: input.maxRounds ?? 5,
        convergence_threshold: input.convergenceThreshold ?? 10.0,
        factor_definitions: input.factors,
        prompts: resolvedPrompts,
        config_defaults: input.configDefaults ?? null,
      })
      .select('id')
      .single();
    if (expError || !experiment) throw new Error(`Failed to create experiment: ${expError?.message}`);

    // 5. INSERT batch run
    const { data: batch, error: batchError } = await supabase
      .from('evolution_batch_runs')
      .insert({
        name: `${input.name} — Round 1`,
        config: { factors: input.factors, design: 'L8', round: 1 },
        status: 'pending',
        total_budget_usd: input.budget,
        runs_planned: design.runs.length * resolvedPrompts.length,
      })
      .select('id')
      .single();
    if (batchError || !batch) throw new Error(`Failed to create batch: ${batchError?.message}`);

    // 6. INSERT experiment round
    const { error: roundError } = await supabase
      .from('evolution_experiment_rounds')
      .insert({
        experiment_id: experiment.id,
        round_number: 1,
        type: 'screening',
        design: 'L8',
        factor_definitions: l8Factors,
        batch_run_id: batch.id,
        status: 'pending',
      });
    if (roundError) throw new Error(`Failed to create round: ${roundError.message}`);

    // 7. INSERT evolution_runs for each L8 row × prompt
    const totalRunCount = design.runs.length * resolvedPrompts.length;
    if (totalRunCount === 0) {
      throw new Error('Experiment produced 0 runs — cannot allocate budget');
    }
    const perRunBudget = input.budget / totalRunCount;

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

      for (const prompt of resolvedPrompts) {
        // Create explanation for this prompt (same pattern as run-batch.ts)
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
          batch_run_id: batch.id,
          source: `experiment:${experiment.id}`,
          status: 'pending',
        });
      }
    }

    // Bulk insert all runs
    const { error: runsError } = await supabase
      .from('evolution_runs')
      .insert(runInserts);
    if (runsError) throw new Error(`Failed to create runs: ${runsError.message}`);

    // 8. Update statuses to running
    await supabase.from('evolution_experiments').update({
      status: 'round_running',
      current_round: 1,
      updated_at: new Date().toISOString(),
    }).eq('id', experiment.id);

    await supabase.from('evolution_experiment_rounds').update({
      status: 'running',
    }).eq('experiment_id', experiment.id).eq('round_number', 1);

    await supabase.from('evolution_batch_runs').update({
      status: 'running',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', batch.id);

    return { success: true, data: { experimentId: experiment.id }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'startExperimentAction') };
  }
}, 'startExperimentAction');

export const startExperimentAction = serverReadRequestId(_startExperimentAction);

// ─── Get Experiment Status ───────────────────────────────────────

export interface ExperimentStatus {
  id: string;
  name: string;
  status: string;
  optimizationTarget: string;
  totalBudgetUsd: number;
  spentUsd: number;
  maxRounds: number;
  currentRound: number;
  convergenceThreshold: number;
  factorDefinitions: Record<string, FactorInput>;
  prompts: string[];
  resultsSummary: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  rounds: {
    roundNumber: number;
    type: string;
    design: string;
    status: string;
    batchRunId: string | null;
    analysisResults: Record<string, unknown> | null;
    completedAt: string | null;
    runCounts: { total: number; completed: number; failed: number; pending: number };
  }[];
}

const _getExperimentStatusAction = withLogging(async (
  input: { experimentId: string },
): Promise<ActionResult<ExperimentStatus>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    // Fetch experiment
    const { data: exp, error: expError } = await supabase
      .from('evolution_experiments')
      .select('*')
      .eq('id', input.experimentId)
      .single();
    if (expError || !exp) throw new Error(`Experiment not found: ${expError?.message ?? input.experimentId}`);

    // Fetch rounds
    const { data: rounds, error: roundsError } = await supabase
      .from('evolution_experiment_rounds')
      .select('*')
      .eq('experiment_id', input.experimentId)
      .order('round_number', { ascending: true });
    if (roundsError) throw new Error(`Failed to fetch rounds: ${roundsError.message}`);

    // Fetch run counts per batch
    const roundsWithCounts = await Promise.all(
      (rounds ?? []).map(async (round: Record<string, unknown>) => {
        const runCounts = { total: 0, completed: 0, failed: 0, pending: 0 };
        if (round.batch_run_id) {
          const { data: runs } = await supabase
            .from('evolution_runs')
            .select('status')
            .eq('batch_run_id', round.batch_run_id as string);
          if (runs) {
            runCounts.total = runs.length;
            for (const r of runs) {
              switch ((r as { status: string }).status) {
                case 'completed': runCounts.completed++; break;
                case 'failed': runCounts.failed++; break;
                case 'pending': case 'claimed': case 'running': runCounts.pending++; break;
              }
            }
          }
        }
        return {
          roundNumber: round.round_number as number,
          type: round.type as string,
          design: round.design as string,
          status: round.status as string,
          batchRunId: round.batch_run_id as string | null,
          analysisResults: round.analysis_results as Record<string, unknown> | null,
          completedAt: round.completed_at as string | null,
          runCounts,
        };
      }),
    );

    return {
      success: true,
      data: {
        id: exp.id,
        name: exp.name,
        status: exp.status,
        optimizationTarget: exp.optimization_target,
        totalBudgetUsd: Number(exp.total_budget_usd),
        spentUsd: Number(exp.spent_usd),
        maxRounds: exp.max_rounds,
        currentRound: exp.current_round,
        convergenceThreshold: Number(exp.convergence_threshold),
        factorDefinitions: exp.factor_definitions,
        prompts: exp.prompts,
        resultsSummary: exp.results_summary,
        errorMessage: exp.error_message,
        createdAt: exp.created_at,
        rounds: roundsWithCounts,
      },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getExperimentStatusAction') };
  }
}, 'getExperimentStatusAction');

export const getExperimentStatusAction = serverReadRequestId(_getExperimentStatusAction);

// ─── List Experiments ────────────────────────────────────────────

export interface ExperimentSummary {
  id: string;
  name: string;
  status: string;
  currentRound: number;
  maxRounds: number;
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
      .select('id, name, status, current_round, max_rounds, total_budget_usd, spent_usd, created_at')
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
      currentRound: row.current_round as number,
      maxRounds: row.max_rounds as number,
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

// ─── Cancel Experiment ───────────────────────────────────────────

const _cancelExperimentAction = withLogging(async (
  input: { experimentId: string },
): Promise<ActionResult<{ cancelled: boolean }>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    // Verify experiment exists and is cancellable
    const { data: exp, error: fetchError } = await supabase
      .from('evolution_experiments')
      .select('id, status')
      .eq('id', input.experimentId)
      .single();
    if (fetchError || !exp) throw new Error(`Experiment not found: ${input.experimentId}`);

    if ((TERMINAL_EXPERIMENT_STATES as readonly string[]).includes(exp.status)) {
      throw new Error(`Experiment already in terminal state: ${exp.status}`);
    }

    // Cancel experiment
    await supabase
      .from('evolution_experiments')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', input.experimentId);

    // Cancel pending runs in associated batches
    const { data: rounds } = await supabase
      .from('evolution_experiment_rounds')
      .select('batch_run_id')
      .eq('experiment_id', input.experimentId);

    for (const round of rounds ?? []) {
      if (round.batch_run_id) {
        await supabase
          .from('evolution_runs')
          .update({ status: 'failed', error_message: 'Experiment cancelled' })
          .eq('batch_run_id', round.batch_run_id)
          .in('status', ['pending', 'claimed']);
      }
    }

    return { success: true, data: { cancelled: true }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'cancelExperimentAction') };
  }
}, 'cancelExperimentAction');

export const cancelExperimentAction = serverReadRequestId(_cancelExperimentAction);

// ─── Get Factor Metadata (for UI population) ────────────────────

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
