// Database persistence layer for evolution pipeline checkpoints and run status transitions.
// Handles checkpoint upsert with retry, variant persistence, and run failure/pause marking.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { serializeState, deserializeState } from './state';
import { getOrdinal, ordinalToEloScale, createRating } from './rating';
import { ComparisonCache } from './comparisonCache';
import { validateStateIntegrity } from './validation';
import type { PipelineState, EvolutionLogger, PipelinePhase, ExecutionContext, SerializedCheckpoint } from '../types';
import { BudgetExceededError, CheckpointNotFoundError, CheckpointCorruptedError } from '../types';
import type { SupervisorResumeState } from './supervisor';
import type { CachedMatch } from './comparisonCache';

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

export async function markRunFailed(runId: string, agentName: string | null, error: unknown): Promise<void> {
  const supabase = await createSupabaseServiceClient();
  const message = agentName
    ? `Agent ${agentName}: ${error instanceof Error ? error.message : String(error)}`
    : `Pipeline error: ${error instanceof Error ? error.message : String(error)}`;
  await supabase.from('content_evolution_runs').update({
    status: 'failed',
    error_message: message.substring(0, 500),
    completed_at: new Date().toISOString(),
  }).eq('id', runId).in('status', ['pending', 'claimed', 'running', 'continuation_pending']);
}

export async function markRunPaused(runId: string, error: BudgetExceededError): Promise<void> {
  const supabase = await createSupabaseServiceClient();
  await supabase.from('content_evolution_runs').update({
    status: 'paused',
    error_message: error.message,
  }).eq('id', runId).in('status', ['pending', 'claimed', 'running', 'continuation_pending']);
}

export async function checkpointAndMarkContinuationPending(
  runId: string,
  state: PipelineState,
  supervisor: { getResumeState(): SupervisorResumeState },
  phase: string,
  logger: EvolutionLogger,
  totalCostUsd: number,
  comparisonCache?: ComparisonCache,
  lastAgent: string = 'iteration_complete',
  resumeAgentNames?: string[],
): Promise<void> {
  const stateSnapshot = {
    ...serializeState(state),
    ...(totalCostUsd != null && { costTrackerTotalSpent: totalCostUsd }),
    ...(comparisonCache && comparisonCache.size > 0 && {
      comparisonCacheEntries: comparisonCache.entries(),
    }),
    supervisorState: supervisor.getResumeState(),
    ...(resumeAgentNames && resumeAgentNames.length > 0 && { resumeAgentNames }),
  };

  const supabase = await createSupabaseServiceClient();
  const { error } = await supabase.rpc('checkpoint_and_continue', {
    p_run_id: runId,
    p_iteration: state.iteration,
    p_phase: phase,
    p_state_snapshot: stateSnapshot,
    p_pool_length: state.pool.length,
    p_total_cost_usd: totalCostUsd,
    p_last_agent: lastAgent,
  });
  if (error) {
    throw new Error(`checkpoint_and_continue RPC failed: ${error.message}`);
  }

  logger.info('Checkpoint saved and run marked continuation_pending', {
    runId, iteration: state.iteration, phase, totalCostUsd, lastAgent,
    ...(resumeAgentNames && resumeAgentNames.length > 0 && { resumeAgentNames }),
  });
}

export interface CheckpointResumeData {
  state: PipelineState;
  iteration: number;
  phase: string;
  supervisorState?: SupervisorResumeState;
  costTrackerTotalSpent: number;
  comparisonCacheEntries?: Array<[string, CachedMatch]>;
  resumeAgentNames?: string[];
}

export async function loadCheckpointForResume(runId: string): Promise<CheckpointResumeData> {
  const supabase = await createSupabaseServiceClient();
  const { data: row, error } = await supabase
    .from('evolution_checkpoints')
    .select('state_snapshot, iteration, phase, last_agent')
    .eq('run_id', runId)
    .in('last_agent', ['iteration_complete', 'continuation_yield'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to query checkpoints: ${error.message}`);
  if (!row) throw new CheckpointNotFoundError(runId);

  try {
    const snapshot = row.state_snapshot as SerializedCheckpoint;

    const state = deserializeState(snapshot);

    const violations = validateStateIntegrity(state);
    if (violations.length > 0) {
      throw new CheckpointCorruptedError(runId, violations.join('; '));
    }

    return {
      state,
      iteration: row.iteration,
      phase: row.phase,
      supervisorState: snapshot.supervisorState,
      costTrackerTotalSpent: snapshot.costTrackerTotalSpent ?? 0,
      comparisonCacheEntries: snapshot.comparisonCacheEntries,
      resumeAgentNames: snapshot.resumeAgentNames,
    };
  } catch (err) {
    throw new CheckpointCorruptedError(
      runId,
      err instanceof Error ? err.message : String(err),
    );
  }
}
