'use server';
// V2 experiment server actions — 5 actions replacing V1's 17.
// All wrapped by adminAction factory for auth + logging + error handling.

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid, applyTestContentNameFilter } from './shared';
import { z } from 'zod';
import {
  createExperiment,
  addRunToExperiment,
  computeExperimentMetrics,
} from '@evolution/lib/pipeline/manageExperiments';
import { createEntityLogger } from '@evolution/lib/pipeline/infra/createEntityLogger';
import { getMetricsForEntities } from '@evolution/lib/metrics/readMetrics';
import { getListViewMetrics } from '@evolution/lib/metrics/registry';
import type { MetricRow } from '@evolution/lib/metrics/types';

/** Shape returned by listExperimentsAction; the page renders this directly. */
export interface ExperimentSummary {
  id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at?: string;
  runCount: number;
  /** List-view metric rows from evolution_metrics (cost split, elo, etc.). */
  metrics: MetricRow[];
}

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
    expLogger.info('Experiment created', { name: input.name, promptId: input.promptId });
    return result;
  },
);

/** Add a run to an experiment (auto-transitions draft→running). */
export const addRunToExperimentAction = adminAction(
  'addRunToExperiment',
  async (input: { experimentId: string; config: { strategy_id: string; budget_cap_usd: number } }, ctx: AdminContext) => {
    const parsed = addRunInputSchema.parse(input);
    const result = await addRunToExperiment(parsed.experimentId, parsed.config, ctx.supabase);
    const expLogger = createEntityLogger({
      entityType: 'experiment',
      entityId: parsed.experimentId,
      experimentId: parsed.experimentId,
    }, ctx.supabase);
    expLogger.info('Run added to experiment', { runId: result.runId });
    return result;
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

    let metrics;
    try {
      metrics = await computeExperimentMetrics(input.experimentId, ctx.supabase);
    } catch {
      // Metrics computation can fail (e.g., no completed runs with winners yet).
      // Don't block the entire detail page.
      metrics = { maxElo: null, totalCost: 0, runs: [] };
    }

    return { ...experiment, metrics };
  },
);

/** List experiments with optional status filter. */
export const listExperimentsAction = adminAction(
  'listExperiments',
  async (input: { status?: string; filterTestContent?: boolean } | undefined, ctx: AdminContext): Promise<ExperimentSummary[]> => {
    let query = ctx.supabase
      .from('evolution_experiments')
      .select('*, evolution_runs(id)')
      .order('created_at', { ascending: false });

    if (input?.status) {
      query = query.eq('status', input.status);
    }
    if (input?.filterTestContent) {
      query = applyTestContentNameFilter(query);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list experiments: ${error.message}`);

    const items = (data ?? []).map((exp: Record<string, unknown>) => ({
      ...exp,
      runCount: Array.isArray(exp.evolution_runs) ? (exp.evolution_runs as unknown[]).length : 0,
    })) as Array<ExperimentSummary & Record<string, unknown>>;

    // Batch-fetch list-view metrics from evolution_metrics (propagated cost split, elo, etc.).
    const metricNames = getListViewMetrics('experiment').map(d => d.name);
    if (items.length > 0 && metricNames.length > 0) {
      const metricsByExp = await getMetricsForEntities(
        ctx.supabase, 'experiment', items.map(e => e.id), metricNames,
      );
      for (const exp of items) {
        exp.metrics = metricsByExp.get(exp.id) ?? [];
      }
    } else {
      for (const exp of items) exp.metrics = [];
    }

    return items as ExperimentSummary[];
  },
);

/** List active prompts (evolution_prompts) for experiment creation. */
export const getPromptsAction = adminAction(
  'getPrompts',
  async (input: { status?: string; filterTestContent?: boolean } | undefined, ctx: AdminContext) => {
    let query = ctx.supabase
      .from('evolution_prompts')
      .select('id, prompt, name, status, created_at')
      .order('created_at', { ascending: false });

    if (input?.status) {
      query = query.eq('status', input.status);
    }
    if (input?.filterTestContent) {
      query = applyTestContentNameFilter(query);
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
      .select('id, name, label, description, config, config_hash, pipeline_type, status, created_by, created_at')
      .order('created_at', { ascending: false });

    if (input?.status) {
      query = query.eq('status', input.status);
    }
    if (input?.filterTestContent) {
      query = applyTestContentNameFilter(query);
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
      expLogger.error('Batch run creation failed, rolling back', {
        createdRunCount: createdRunIds.length,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      });
      const orphanedIds: string[] = [];
      for (const runId of createdRunIds) {
        const { error: delErr } = await ctx.supabase.from('evolution_runs').delete().eq('id', runId);
        if (delErr) {
          orphanedIds.push(runId);
          expLogger.error('Rollback failed: could not delete run', { runId, error: delErr.message });
        }
      }
      const { error: expDelErr } = await ctx.supabase.from('evolution_experiments').delete().eq('id', experimentId);
      if (expDelErr) {
        expLogger.error('Rollback failed: could not delete experiment', { experimentId, error: expDelErr.message });
      }
      if (orphanedIds.length > 0) {
        expLogger.error('Manual cleanup needed for orphaned runs', { orphanedIds });
      }
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
    expLogger.warn('Experiment cancelled', { experimentId: input.experimentId });

    // Revalidate the experiment detail page so server component re-fetches
    const { revalidatePath } = await import('next/cache');
    revalidatePath(`/admin/evolution/experiments/${input.experimentId}`);
    revalidatePath('/admin/evolution/experiments');

    return { cancelled: true };
  },
);
