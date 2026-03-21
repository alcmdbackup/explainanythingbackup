// Thin orchestrator: claim a pending run, build context, run pipeline, persist results.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { callLLM } from '@/lib/services/llms';
import type { AllowedLLMModelType } from '@/lib/schemas/schemas';
import { buildRunContext, type ClaimedRun } from './setup/buildRunContext';
import { evolveArticle } from './loop/runIterationLoop';
import { finalizeRun } from './finalize/persistRunResults';
import { syncToArena } from './finalize/persistRunResults';

export type { ClaimedRun } from './setup/buildRunContext';

/** System UUID for evolution pipeline LLM calls (llmCallTracking.userid is uuid NOT NULL). */
const EVOLUTION_SYSTEM_USERID = '00000000-0000-4000-8000-000000000001';

const DEFAULT_MAX_CONCURRENT_RUNS = 5;

// ─── Types ───────────────────────────────────────────────────────

export interface RunnerOptions {
  runnerId: string;
  maxDurationMs?: number;
  targetRunId?: string;
}

export interface RunnerResult {
  claimed: boolean;
  runId?: string;
  stopReason?: string;
  durationMs?: number;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

function startHeartbeat(db: SupabaseClient, runId: string): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      await db
        .from('evolution_runs')
        .update({ last_heartbeat: new Date().toISOString() })
        .eq('id', runId);
    } catch (err) {
      logger.warn('Heartbeat update failed', { runId, error: String(err) });
    }
  }, 30_000);
}

async function markRunFailed(
  db: SupabaseClient,
  runId: string,
  errorMessage: string,
): Promise<void> {
  const truncated = errorMessage.slice(0, 2000);
  try {
    await db
      .from('evolution_runs')
      .update({
        status: 'failed',
        error_message: truncated,
        completed_at: new Date().toISOString(),
        runner_id: null,
      })
      .eq('id', runId)
      .in('status', ['pending', 'claimed', 'running']);
  } catch (err) {
    console.error(`[V2Runner] Failed to mark run ${runId} as failed:`, err);
  }
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Claim a pending evolution run from the queue and execute it end-to-end.
 * Handles: concurrent limits → claim → heartbeat → setup → pipeline → finalize → cleanup.
 */
export async function claimAndExecuteRun(
  options: RunnerOptions,
): Promise<RunnerResult> {
  const supabase = await createSupabaseServiceClient();
  const startMs = Date.now();

  // Check concurrent run limit
  const maxConcurrent = parseInt(process.env.EVOLUTION_MAX_CONCURRENT_RUNS ?? '', 10) || DEFAULT_MAX_CONCURRENT_RUNS;
  const { count: activeCount, error: countError } = await supabase
    .from('evolution_runs')
    .select('id', { count: 'exact', head: true })
    .in('status', ['claimed', 'running']);

  if (countError) {
    logger.error('Failed to check concurrent run count', { error: countError.message });
    return { claimed: false, error: `Failed to check concurrent runs: ${countError.message}` };
  }

  if ((activeCount ?? 0) >= maxConcurrent) {
    logger.info('Concurrent run limit reached', { activeCount, maxConcurrent });
    return { claimed: false };
  }

  // Claim a run
  const { data: claimedRows, error: claimError } = await supabase
    .rpc('claim_evolution_run', {
      p_runner_id: options.runnerId,
      ...(options.targetRunId ? { p_run_id: options.targetRunId } : {}),
    });

  if (claimError) {
    logger.error('Evolution runner claim RPC error', { error: claimError.message, runnerId: options.runnerId });
    return { claimed: false, error: `Failed to claim run: ${claimError.message}` };
  }

  const claimedRow = claimedRows?.[0];
  if (!claimedRow) {
    return { claimed: false };
  }

  const runId = claimedRow.id;
  const claimedRun: ClaimedRun = {
    id: runId,
    explanation_id: claimedRow.explanation_id ?? null,
    prompt_id: claimedRow.prompt_id ?? null,
    experiment_id: claimedRow.experiment_id ?? null,
    strategy_config_id: claimedRow.strategy_config_id,
    budget_cap_usd: Number(claimedRow.budget_cap_usd) || 1.0,
  };

  let heartbeatInterval: NodeJS.Timeout | null = null;
  logger.info('Claimed evolution run', { runId, runnerId: options.runnerId });

  try {
    // Create LLM provider
    const llmProvider = {
      async complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> {
        return callLLM(
          prompt,
          `evolution_${label}`,
          EVOLUTION_SYSTEM_USERID,
          (opts?.model ?? 'deepseek-chat') as AllowedLLMModelType,
          false,
          null,
          null,
          null,
          false,
          {},
        );
      },
    };

    heartbeatInterval = startHeartbeat(supabase, runId);

    // Set status to running
    await supabase
      .from('evolution_runs')
      .update({ status: 'running' })
      .eq('id', runId);

    // Build run context (strategy, content, arena)
    const contextResult = await buildRunContext(runId, claimedRun, supabase, llmProvider);
    if ('error' in contextResult) {
      await markRunFailed(supabase, runId, contextResult.error);
      return { claimed: true, runId, error: contextResult.error, durationMs: Date.now() - startMs };
    }

    const { originalText, config, logger: runLogger, initialPool } = contextResult.context;

    // Run pipeline
    const result = await evolveArticle(originalText, llmProvider, supabase, runId, config, {
      logger: runLogger,
      initialPool: initialPool.length > 0 ? initialPool : undefined,
    });

    // Persist results
    const durationSeconds = (Date.now() - startMs) / 1000;
    await finalizeRun(runId, result, {
      experiment_id: claimedRun.experiment_id,
      explanation_id: claimedRun.explanation_id,
      strategy_config_id: claimedRun.strategy_config_id,
    }, supabase, durationSeconds, runLogger);

    // Sync to arena if prompt-based run
    if (claimedRun.prompt_id) {
      try {
        await syncToArena(runId, claimedRun.prompt_id, result.pool, result.ratings, result.matchHistory, supabase);
        runLogger.info('Arena sync complete', { phaseName: 'arena' });
      } catch (err) {
        runLogger.warn(`Arena sync failed: ${err}`, { phaseName: 'arena' });
      }
    }

    console.warn(`[V2Runner] Run ${runId} completed: ${result.stopReason}, ${result.iterationsRun} iterations, $${result.totalCost.toFixed(4)}`);
    return { claimed: true, runId, stopReason: 'completed', durationMs: Date.now() - startMs };
  } catch (error) {
    const msg = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    logger.error('Evolution pipeline failed', { runId, error: msg });
    await markRunFailed(supabase, runId, msg);
    return { claimed: true, runId, error: msg, durationMs: Date.now() - startMs };
  } finally {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
  }
}

// ─── Bridge for batch runner scripts (removed in Phase 3) ────────

type RawLLMProvider = {
  complete(prompt: string, label: string, opts?: { model?: string }): Promise<string>;
};

/**
 * Execute a V2 run with an externally-provided db and llmProvider.
 * Used by batch runner scripts that handle claiming themselves.
 * @deprecated Use claimAndExecuteRun instead. Will be removed in Phase 3.
 */
export async function executeV2Run(
  runId: string,
  claimedRun: ClaimedRun,
  db: SupabaseClient,
  llmProvider: RawLLMProvider,
): Promise<void> {
  const heartbeatInterval = startHeartbeat(db, runId);
  const startTime = Date.now();

  try {
    await db
      .from('evolution_runs')
      .update({ status: 'running' })
      .eq('id', runId);

    const contextResult = await buildRunContext(runId, claimedRun, db, llmProvider);
    if ('error' in contextResult) {
      await markRunFailed(db, runId, contextResult.error);
      return;
    }

    const { originalText, config, logger: runLogger, initialPool } = contextResult.context;

    const result = await evolveArticle(originalText, llmProvider, db, runId, config, {
      logger: runLogger,
      initialPool: initialPool.length > 0 ? initialPool : undefined,
    });

    const durationSeconds = (Date.now() - startTime) / 1000;
    await finalizeRun(runId, result, {
      experiment_id: claimedRun.experiment_id,
      explanation_id: claimedRun.explanation_id,
      strategy_config_id: claimedRun.strategy_config_id,
    }, db, durationSeconds, runLogger);

    if (claimedRun.prompt_id) {
      try {
        await syncToArena(runId, claimedRun.prompt_id, result.pool, result.ratings, result.matchHistory, db);
        runLogger.info('Arena sync complete', { phaseName: 'arena' });
      } catch (err) {
        runLogger.warn(`Arena sync failed: ${err}`, { phaseName: 'arena' });
      }
    }

    console.warn(`[V2Runner] Run ${runId} completed: ${result.stopReason}, ${result.iterationsRun} iterations, $${result.totalCost.toFixed(4)}`);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    await markRunFailed(db, runId, message);
    console.error(`[V2Runner] Run ${runId} failed:`, message);
  } finally {
    clearInterval(heartbeatInterval);
  }
}
