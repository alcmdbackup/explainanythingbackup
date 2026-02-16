// Database persistence layer for evolution pipeline checkpoints and run status transitions.
// Handles checkpoint upsert with retry, variant persistence, and run failure/pause marking.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { serializeState } from './state';
import { getOrdinal, ordinalToEloScale, createRating } from './rating';
import { ComparisonCache } from './comparisonCache';
import type { PipelineState, EvolutionLogger, PipelinePhase, ExecutionContext } from '../types';
import { BudgetExceededError } from '../types';

/** Persist checkpoint to DB with retry. */
export async function persistCheckpoint(
  runId: string,
  state: PipelineState,
  agentName: string,
  phase: PipelinePhase,
  logger: EvolutionLogger,
  maxRetries = 3,
  totalCostUsd?: number,
  comparisonCache?: ComparisonCache,
): Promise<void> {
  const checkpoint = {
    run_id: runId,
    iteration: state.iteration,
    phase,
    last_agent: agentName,
    state_snapshot: {
      ...serializeState(state),
      ...(totalCostUsd != null && { costTrackerTotalSpent: totalCostUsd }),
      ...(comparisonCache && comparisonCache.size > 0 && { comparisonCacheEntries: comparisonCache.entries() }),
    },
  };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const supabase = await createSupabaseServiceClient();
      const [, runUpdate] = await Promise.all([
        supabase.from('evolution_checkpoints').upsert(checkpoint, {
          onConflict: 'run_id,iteration,last_agent',
        }),
        supabase.from('content_evolution_runs').update({
          current_iteration: state.iteration,
          phase,
          last_heartbeat: new Date().toISOString(),
          runner_agents_completed: state.pool.length,
          ...(totalCostUsd != null && { total_cost_usd: totalCostUsd }),
        }).eq('id', runId),
      ]);

      if (runUpdate.error) throw runUpdate.error;
      return;
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      logger.warn('Checkpoint write failed, retrying', { attempt, error: String(error) });
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

/** Persist all pool variants to content_evolution_variants. Best-effort — errors are logged, not thrown. */
export async function persistVariants(
  runId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<void> {
  const supabase = await createSupabaseServiceClient();
  const topVariant = ctx.state.getTopByRating(1)[0];

  const rows = ctx.state.pool.map((v) => ({
    id: v.id,
    run_id: runId,
    explanation_id: ctx.payload.explanationId || null,
    variant_content: v.text,
    elo_score: ordinalToEloScale(getOrdinal(ctx.state.ratings.get(v.id) ?? createRating())),
    generation: v.version,
    parent_variant_id: v.parentIds.length > 0 ? v.parentIds[0] : null,
    agent_name: v.strategy,
    match_count: ctx.state.matchCounts.get(v.id) ?? 0,
    is_winner: topVariant ? v.id === topVariant.id : false,
  }));

  if (rows.length === 0) return;

  const { error } = await supabase
    .from('content_evolution_variants')
    .upsert(rows, { onConflict: 'id' });

  if (error) {
    logger.warn('Failed to persist variants (non-fatal)', { runId, error: error.message });
  } else {
    logger.info('Variants persisted', { runId, count: rows.length });
  }
}

/** Mark run as failed in DB. Only transitions from non-terminal states. */
export async function markRunFailed(runId: string, agentName: string | null, error: unknown): Promise<void> {
  const supabase = await createSupabaseServiceClient();
  const message = agentName
    ? `Agent ${agentName}: ${error instanceof Error ? error.message : String(error)}`
    : `Pipeline error: ${error instanceof Error ? error.message : String(error)}`;
  await supabase.from('content_evolution_runs').update({
    status: 'failed',
    error_message: message.substring(0, 500),
    completed_at: new Date().toISOString(),
  }).eq('id', runId).in('status', ['pending', 'claimed', 'running']);
}

/** Mark run as paused (budget exceeded). */
export async function markRunPaused(runId: string, error: BudgetExceededError): Promise<void> {
  const supabase = await createSupabaseServiceClient();
  await supabase.from('content_evolution_runs').update({
    status: 'paused',
    error_message: error.message,
  }).eq('id', runId);
}
