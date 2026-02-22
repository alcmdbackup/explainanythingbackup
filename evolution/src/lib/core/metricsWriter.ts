// Metrics persistence for evolution pipeline finalization.
// Handles strategy config linking, cost prediction persistence, and per-agent cost metrics.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { getOrdinal, ordinalToEloScale, createRating } from './rating';
import { extractStrategyConfig, hashStrategyConfig, labelStrategyConfig } from './strategyConfig';
import type { ExecutionContext, EvolutionLogger } from '../types';

/** Compute final Elo score from top-rated variant. */
export function computeFinalElo(ctx: ExecutionContext): number | null {
  const topVariant = ctx.state.getTopByRating(1)[0];
  if (!topVariant) return null;
  const ordinal = getOrdinal(ctx.state.ratings.get(topVariant.id) ?? createRating());
  return ordinalToEloScale(ordinal);
}

/** Update strategy_configs aggregates via RPC. Logs on failure. */
async function updateStrategyAggregates(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  runId: string,
  strategyId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<void> {
  const finalElo = computeFinalElo(ctx);
  if (finalElo === null) return;

  const { error } = await supabase.rpc('update_strategy_aggregates', {
    p_strategy_id: strategyId,
    p_cost_usd: ctx.costTracker.getTotalSpent(),
    p_final_elo: finalElo,
  });

  if (error) {
    logger.warn('Failed to update strategy aggregates', { runId, strategyId, error: error.message });
  } else {
    logger.info('Strategy aggregates updated', { runId, strategyId, finalElo });
  }
}

/** Link run to strategy config and update aggregates for Elo optimization dashboard. */
export async function linkStrategyConfig(
  runId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<void> {
  const supabase = await createSupabaseServiceClient();

  const { data: runRow } = await supabase
    .from('evolution_runs')
    .select('strategy_config_id')
    .eq('id', runId)
    .single();

  if (runRow?.strategy_config_id) {
    await updateStrategyAggregates(supabase, runId, runRow.strategy_config_id, ctx, logger);
    return;
  }

  const stratConfig = extractStrategyConfig(ctx.payload.config, ctx.payload.config.budgetCaps ?? {});
  const configHash = hashStrategyConfig(stratConfig);

  const { data: existing } = await supabase
    .from('evolution_strategy_configs')
    .select('id')
    .eq('config_hash', configHash)
    .single();

  let strategyId: string;
  if (existing) {
    strategyId = existing.id;
  } else {
    const { data: created, error: createErr } = await supabase
      .from('evolution_strategy_configs')
      .insert({
        config_hash: configHash,
        name: `Strategy ${configHash.slice(0, 6)}`,
        label: labelStrategyConfig(stratConfig),
        config: stratConfig,
      })
      .select('id')
      .single();

    if (createErr || !created) {
      logger.warn('Failed to create strategy config', { runId, error: createErr?.message });
      return;
    }
    strategyId = created.id;
  }

  const { error: linkErr } = await supabase
    .from('evolution_runs')
    .update({ strategy_config_id: strategyId })
    .eq('id', runId);

  if (linkErr) {
    logger.warn('Failed to link run to strategy config', { runId, strategyId, error: linkErr.message });
    return;
  }

  await updateStrategyAggregates(supabase, runId, strategyId, ctx, logger);
}

/** Map a strategy name to its owning agent for cost attribution. */
export const STRATEGY_TO_AGENT: Record<string, string> = {
  structural_transform: 'generation',
  lexical_simplify: 'generation',
  grounding_enhance: 'generation',
  mutate_clarity: 'evolution',
  mutate_structure: 'evolution',
  crossover: 'evolution',
  creative_exploration: 'evolution',
  debate_synthesis: 'debate',
  original_baseline: 'original',
  outline_generation: 'outlineGeneration',
  mutate_outline: 'outlineGeneration',
};

export function getAgentForStrategy(strategy: string): string | null {
  const direct = STRATEGY_TO_AGENT[strategy];
  if (direct) return direct;
  if (strategy.startsWith('critique_edit_')) return 'iterativeEditing';
  if (strategy.startsWith('section_decomposition_')) return 'sectionDecomposition';
  return null;
}

/** Validate and persist cost prediction, then refresh agent baselines. Non-fatal on failure. */
export async function persistCostPrediction(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  runId: string,
  costEstimateDetail: unknown,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<void> {
  const { computeCostPrediction, refreshAgentCostBaselines, RunCostEstimateSchema, CostPredictionSchema } = await import('../index');

  const estimateParsed = RunCostEstimateSchema.safeParse(costEstimateDetail);
  if (!estimateParsed.success) {
    logger.warn('cost_estimate_detail failed Zod validation — skipping prediction', {
      runId, errors: estimateParsed.error.issues.map(i => i.message),
    });
    return;
  }

  // Query actual costs from invocations table (single source of truth)
  const { data: invRows, error: invErr } = await supabase
    .from('evolution_agent_invocations')
    .select('agent_name, cost_usd')
    .eq('run_id', runId);

  if (invErr) {
    logger.warn('Failed to fetch invocation costs for prediction', { runId, error: invErr.message });
    return;
  }

  const perAgentCosts: Record<string, number> = {};
  for (const row of invRows ?? []) {
    const agent = row.agent_name as string;
    perAgentCosts[agent] = (perAgentCosts[agent] ?? 0) + (Number(row.cost_usd) || 0);
  }
  const actualTotalUsd = Object.values(perAgentCosts).reduce((a, b) => a + b, 0);

  const prediction = computeCostPrediction(estimateParsed.data, actualTotalUsd, perAgentCosts);
  const parsed = CostPredictionSchema.safeParse(prediction);
  if (!parsed.success) {
    logger.warn('Cost prediction failed Zod validation — skipping write', {
      runId, errors: parsed.error.issues.map(i => i.message),
    });
    return;
  }

  const { error: predErr } = await supabase
    .from('evolution_runs')
    .update({ cost_prediction: parsed.data })
    .eq('id', runId);
  if (predErr) {
    logger.warn('Failed to persist cost_prediction', { runId, error: predErr.message });
  }

  // Refresh baselines for future estimates (best-effort, non-blocking)
  refreshAgentCostBaselines(30).catch((err: unknown) => {
    logger.warn('refreshAgentCostBaselines failed (non-blocking)', {
      runId, error: err instanceof Error ? err.message : String(err),
    });
  });
}

/** Persist per-agent cost metrics for Elo/dollar optimization analysis. */
export async function persistAgentMetrics(
  runId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<void> {
  const supabase = await createSupabaseServiceClient();
  const agentCosts = ctx.costTracker.getAllAgentCosts();

  // DB-4: Batch all agent metrics into a single upsert (was N+1 loop)
  const rows: Array<{
    run_id: string; agent_name: string; cost_usd: number;
    variants_generated: number; avg_elo: number; elo_gain: number; elo_per_dollar: number | null;
  }> = [];

  for (const [agentName, costUsd] of Object.entries(agentCosts)) {
    const variants = ctx.state.pool.filter((v) => getAgentForStrategy(v.strategy) === agentName);
    if (!variants.length) continue;

    const eloSum = variants.reduce((s, v) => s + (ctx.state.ratings.get(v.id)?.mu ?? 25), 0);
    const avgElo = eloSum / variants.length;
    const eloGain = avgElo - 25;

    rows.push({
      run_id: runId,
      agent_name: agentName,
      cost_usd: costUsd,
      variants_generated: variants.length,
      avg_elo: avgElo,
      elo_gain: eloGain,
      elo_per_dollar: costUsd > 0 ? eloGain / costUsd : null,
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase.from('evolution_run_agent_metrics').upsert(rows, { onConflict: 'run_id,agent_name' });
    if (error) {
      logger.warn('Failed to batch persist agent metrics', { runId, error: error.message });
    }
  }

  logger.info('Agent metrics persisted', { runId, agentCount: rows.length });
}
