'use server';
// V2 experiment server actions — 5 actions replacing V1's 17.
// All wrapped by adminAction factory for auth + logging + error handling.

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid } from './shared';
import {
  createExperiment,
  addRunToExperiment,
  computeExperimentMetrics,
} from '@evolution/lib/pipeline/manageExperiments';

// ─── Actions ─────────────────────────────────────────────────────

/** Create a new experiment for a prompt. */
export const createExperimentAction = adminAction(
  'createExperiment',
  async (input: { name: string; promptId: string }, ctx: AdminContext) => {
    if (!validateUuid(input.promptId)) throw new Error('Invalid promptId');
    return createExperiment(input.name, input.promptId, ctx.supabase);
  },
);

/** Add a run to an experiment (auto-transitions draft→running). */
export const addRunToExperimentAction = adminAction(
  'addRunToExperiment',
  async (input: { experimentId: string; config: { strategy_id: string; budget_cap_usd: number } }, ctx: AdminContext) => {
    if (!validateUuid(input.experimentId)) throw new Error('Invalid experimentId');
    return addRunToExperiment(input.experimentId, input.config, ctx.supabase);
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
  async (input: { status?: string } | undefined, ctx: AdminContext) => {
    let query = ctx.supabase
      .from('evolution_experiments')
      .select('*, evolution_runs(id)')
      .order('created_at', { ascending: false });

    if (input?.status) {
      query = query.eq('status', input.status);
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
  async (input: { status?: string } | undefined, ctx: AdminContext) => {
    let query = ctx.supabase
      .from('evolution_prompts')
      .select('id, prompt, title, status, created_at')
      .order('created_at', { ascending: false });

    if (input?.status) {
      query = query.eq('status', input.status);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list prompts: ${error.message}`);
    return data ?? [];
  },
);

/** List active strategies (evolution_strategies) for experiment creation. */
export const getStrategiesAction = adminAction(
  'getStrategies',
  async (input: { status?: string } | undefined, ctx: AdminContext) => {
    let query = ctx.supabase
      .from('evolution_strategies')
      .select('id, name, label, description, config, config_hash, pipeline_type, status, created_by, run_count, created_at')
      .order('created_at', { ascending: false });

    if (input?.status) {
      query = query.eq('status', input.status);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list strategies: ${error.message}`);
    return data ?? [];
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
    return { cancelled: true };
  },
);
