// V2 experiment core functions: create, add runs, compute metrics, cancel.

import type { SupabaseClient } from '@supabase/supabase-js';
import { evolutionExperimentInsertSchema, evolutionRunInsertSchema } from '../schemas';
import { createEntityLogger } from './infra/createEntityLogger';

// ─── Types ───────────────────────────────────────────────────────

export interface ExperimentMetrics {
  maxElo: number | null;
  totalCost: number;
  runs: Array<{
    runId: string;
    elo: number | null;
    cost: number;
    eloPerDollar: number | null;
  }>;
}

// ─── Core functions ──────────────────────────────────────────────

/** Create a new experiment. */
export async function createExperiment(
  name: string,
  promptId: string,
  db: SupabaseClient,
): Promise<{ id: string }> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 200) {
    throw new Error('Experiment name must be 1-200 characters');
  }

  // Dedup: append incrementing suffix if name already exists
  let finalName = trimmed;
  const { count } = await db
    .from('evolution_experiments')
    .select('id', { count: 'exact', head: true })
    .eq('name', trimmed);
  if (count && count > 0) {
    finalName = `${trimmed} (${count + 1})`;
  }

  const expPayload = evolutionExperimentInsertSchema.parse({ name: finalName, prompt_id: promptId });
  const { data, error } = await db
    .from('evolution_experiments')
    .insert(expPayload)
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create experiment: ${error.message}`);

  const expLogger = createEntityLogger({
    entityType: 'experiment',
    entityId: data.id,
    experimentId: data.id,
  }, db);
  expLogger.info('Experiment created', { name: trimmed, promptId });

  return { id: data.id };
}

/** Add a run to an experiment. Auto-transitions draft→running on first run. */
export async function addRunToExperiment(
  experimentId: string,
  config: { strategy_id: string; budget_cap_usd: number },
  db: SupabaseClient,
): Promise<{ runId: string }> {
  const { data: exp, error: expError } = await db
    .from('evolution_experiments')
    .select('id, status, prompt_id')
    .eq('id', experimentId)
    .single();

  if (expError || !exp) throw new Error(`Experiment ${experimentId} not found`);
  if (exp.status === 'completed' || exp.status === 'cancelled') {
    throw new Error(`Cannot add runs to ${exp.status} experiment`);
  }

  const runPayload = evolutionRunInsertSchema.parse({
    experiment_id: experimentId,
    prompt_id: exp.prompt_id,
    strategy_id: config.strategy_id,
    budget_cap_usd: config.budget_cap_usd,
    status: 'pending',
  });
  const { data: run, error: runError } = await db
    .from('evolution_runs')
    .insert(runPayload)
    .select('id')
    .single();

  if (runError) throw new Error(`Failed to create run: ${runError.message}`);

  if (exp.status === 'draft') {
    await db
      .from('evolution_experiments')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', experimentId)
      .eq('status', 'draft');

    const expLogger = createEntityLogger({
      entityType: 'experiment',
      entityId: experimentId,
      experimentId,
    }, db);
    expLogger.info('Experiment transitioned draft→running', { firstRunId: run.id });
  }

  return { runId: run.id };
}

/** Compute experiment metrics synchronously from completed runs. */
export async function computeExperimentMetrics(
  experimentId: string,
  db: SupabaseClient,
): Promise<ExperimentMetrics> {
  const { data: rows, error } = await db
    .from('evolution_runs')
    .select(`
      id,
      run_summary,
      evolution_variants!inner(elo_score)
    `)
    .eq('experiment_id', experimentId)
    .eq('status', 'completed')
    .eq('evolution_variants.is_winner', true);

  if (error || !rows) {
    return { maxElo: null, totalCost: 0, runs: [] };
  }

  const runs = rows.map((row) => {
    const variants = row.evolution_variants as unknown as Array<{ elo_score: number }>;
    const elo = variants?.[0]?.elo_score ?? null;
    const summary = row.run_summary as Record<string, unknown> | null;
    const cost = typeof summary?.totalCost === 'number' ? summary.totalCost : 0;
    const eloPerDollar = elo !== null && cost > 0 ? elo / cost : null;

    return { runId: row.id as string, elo, cost, eloPerDollar };
  });

  const elos = runs.map((r) => r.elo).filter((e): e is number => e !== null);
  const maxElo = elos.length > 0 ? Math.max(...elos) : null;
  const totalCost = runs.reduce((sum, r) => sum + r.cost, 0);

  return { maxElo, totalCost, runs };
}
