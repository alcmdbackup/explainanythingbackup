'use server';
// V2 experiment server actions — 5 actions replacing V1's 17.
// All wrapped by adminAction factory for auth + logging + error handling.

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid } from './shared';
import { z } from 'zod';
import {
  createExperiment,
  addRunToExperiment,
  computeExperimentMetrics,
} from '@evolution/lib/pipeline/manageExperiments';
import { createEntityLogger } from '@evolution/lib/pipeline/infra/createEntityLogger';

// ─── Schemas ──────────────────────────────────────────────────────

const addRunInputSchema = z.object({
  experimentId: z.string().uuid(),
  config: z.object({
    strategy_id: z.string().uuid(),
    budget_cap_usd: z.number().positive().max(10, 'Budget cap cannot exceed $10'),
  }),
});

const createExperimentWithRunsInputSchema = z.object({
  name: z.string().min(1).max(200),
  promptId: z.string().uuid(),
  runs: z.array(z.object({
    strategy_id: z.string().uuid(),
    budget_cap_usd: z.number().positive().max(10, 'Budget cap cannot exceed $10'),
  })).min(1).max(20),
});

// ─── Actions ─────────────────────────────────────────────────────

/** Create a new experiment for a prompt. */
export const createExperimentAction = adminAction(
  'createExperiment',
  async (input: { name: string; promptId: string }, ctx: AdminContext) => {
    if (!validateUuid(input.promptId)) throw new Error('Invalid promptId');
    const result = await createExperiment(input.name, input.promptId, ctx.supabase);
    const expLogger = createEntityLogger({
      entityType: 'experiment',
      entityId: result.id,
      experimentId: result.id,
    }, ctx.supabase);
    expLogger.info('Experiment created');
    return result;
  },
);

/** Add a run to an experiment (auto-transitions draft→running). */
export const addRunToExperimentAction = adminAction(
  'addRunToExperiment',
  async (input: { experimentId: string; config: { strategy_id: string; budget_cap_usd: number } }, ctx: AdminContext) => {
    const parsed = addRunInputSchema.parse(input);
    return addRunToExperiment(parsed.experimentId, parsed.config, ctx.supabase);
  },
);

/** Get experiment detail with runs and computed metrics. */
export const getExperimentAction = adminAction(
  'getExperiment',
  async (input: { experimentId: string }, ctx: AdminContext) => {
    if (!validateUuid(input.experimentId)) throw new Error('Invalid experimentId');

    const { data: experiment, error } = await ctx.supabase
      .from('evolution_experiments')
      .select('*, evolution_runs(*)')
      .eq('id', input.experimentId)
      .single();

    if (error || !experiment) throw new Error(`Experiment ${input.experimentId} not found`);

    const metrics = await computeExperimentMetrics(input.experimentId, ctx.supabase);

    return { ...experiment, metrics };
  },
);

/** List experiments with optional status filter. */
export const listExperimentsAction = adminAction(
  'listExperiments',
  async (input: { status?: string; filterTestContent?: boolean } | undefined, ctx: AdminContext) => {
    let query = ctx.supabase
      .from('evolution_experiments')
      .select('*, evolution_runs(id)')
      .order('created_at', { ascending: false });

    if (input?.status) {
      query = query.eq('status', input.status);
    }
    if (input?.filterTestContent) {
      query = query.not('name', 'ilike', '%[TEST]%');
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list experiments: ${error.message}`);

    return (data ?? []).map((exp: Record<string, unknown>) => ({
      ...exp,
      runCount: Array.isArray(exp.evolution_runs) ? (exp.evolution_runs as unknown[]).length : 0,
    }));
  },
);

/** List active prompts (evolution_prompts) for experiment creation. */
export const getPromptsAction = adminAction(
  'getPrompts',
  async (input: { status?: string; filterTestContent?: boolean } | undefined, ctx: AdminContext) => {
    let query = ctx.supabase
      .from('evolution_prompts')
      .select('id, prompt, title, status, created_at')
      .order('created_at', { ascending: false });

    if (input?.status) {
      query = query.eq('status', input.status);
    }
    if (input?.filterTestContent) {
      query = query.not('title', 'ilike', '%[TEST]%');
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list prompts: ${error.message}`);
    return data ?? [];
  },
);

/** List active strategies (evolution_strategies) for experiment creation. */
export const getStrategiesAction = adminAction(
  'getStrategies',
  async (input: { status?: string; filterTestContent?: boolean } | undefined, ctx: AdminContext) => {
    let query = ctx.supabase
      .from('evolution_strategies')
      .select('id, name, label, description, config, config_hash, pipeline_type, status, created_by, run_count, created_at')
      .order('created_at', { ascending: false });

    if (input?.status) {
      query = query.eq('status', input.status);
    }
    if (input?.filterTestContent) {
      query = query.not('name', 'ilike', '%[TEST]%');
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list strategies: ${error.message}`);
    return data ?? [];
  },
);

/** Create experiment with all runs in a single batch action with rollback on failure. */
export const createExperimentWithRunsAction = adminAction(
  'createExperimentWithRuns',
  async (input: { name: string; promptId: string; runs: Array<{ strategy_id: string; budget_cap_usd: number }> }, ctx: AdminContext) => {
    const parsed = createExperimentWithRunsInputSchema.parse(input);

    // Step 1: Create experiment
    const { id: experimentId } = await createExperiment(parsed.name, parsed.promptId, ctx.supabase);
    const createdRunIds: string[] = [];

    const expLogger = createEntityLogger({
      entityType: 'experiment',
      entityId: experimentId,
      experimentId,
    }, ctx.supabase);
    expLogger.info('Experiment created', { runCount: parsed.runs.length });

    try {
      // Step 2: Add all runs
      for (const runConfig of parsed.runs) {
        const { runId } = await addRunToExperiment(experimentId, runConfig, ctx.supabase);
        createdRunIds.push(runId);
      }
      return { experimentId };
    } catch (err) {
      // Step 3: Rollback — delete created runs and experiment
      for (const runId of createdRunIds) {
        await ctx.supabase.from('evolution_runs').delete().eq('id', runId);
      }
      await ctx.supabase.from('evolution_experiments').delete().eq('id', experimentId);
      throw err;
    }
  },
);

/** Cancel experiment + bulk-fail pending/claimed/running runs via RPC. */
export const cancelExperimentAction = adminAction(
  'cancelExperiment',
  async (input: { experimentId: string }, ctx: AdminContext) => {
    if (!validateUuid(input.experimentId)) throw new Error('Invalid experimentId');

    const { error } = await ctx.supabase.rpc('cancel_experiment', {
      p_experiment_id: input.experimentId,
    });

    if (error) throw new Error(`Failed to cancel experiment: ${error.message}`);

    const expLogger = createEntityLogger({
      entityType: 'experiment',
      entityId: input.experimentId,
      experimentId: input.experimentId,
    }, ctx.supabase);
    expLogger.warn('Experiment cancelled');

    return { cancelled: true };
  },
);
