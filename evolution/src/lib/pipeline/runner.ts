// V2 run execution: resolve content, run evolveArticle, persist results.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EvolutionConfig, V2StrategyConfig } from './types';
import { evolveArticle } from './evolve-article';
import { generateSeedArticle } from './seed-article';
import { finalizeRun } from './finalize';
import { loadArenaEntries, syncToArena } from './arena';
import { createRunLogger } from './run-logger';

// ─── Types ───────────────────────────────────────────────────────

export interface ClaimedRun {
  id: string;
  explanation_id: number | null;
  prompt_id: string | null;
  experiment_id: string | null;
  strategy_id: string;
  budget_cap_usd: number;
}

type RawLLMProvider = {
  complete(prompt: string, label: string, opts?: { model?: string }): Promise<string>;
};

// ─── Helpers ─────────────────────────────────────────────────────

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
      })
      .eq('id', runId)
      .in('status', ['pending', 'claimed', 'running']);
  } catch (err) {
    console.error(`[V2Runner] Failed to mark run ${runId} as failed:`, err);
  }
}

function startHeartbeat(db: SupabaseClient, runId: string): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      await db
        .from('evolution_runs')
        .update({ last_heartbeat: new Date().toISOString() })
        .eq('id', runId);
    } catch (err) {
      console.warn(`[V2Runner] Heartbeat error for ${runId}:`, err);
    }
  }, 30_000);
}

async function resolveContent(
  run: ClaimedRun,
  db: SupabaseClient,
  llm: RawLLMProvider,
): Promise<string | null> {
  if (run.explanation_id != null) {
    const { data, error } = await db
      .from('explanations')
      .select('content')
      .eq('id', run.explanation_id)
      .single();
    if (error || !data?.content) return null;
    return data.content as string;
  }

  if (run.prompt_id != null) {
    const { data, error } = await db
      .from('evolution_prompts')
      .select('prompt')
      .eq('id', run.prompt_id)
      .single();
    if (error || !data?.prompt) return null;
    const seed = await generateSeedArticle(data.prompt as string, llm);
    return seed.content;
  }

  return null;
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Execute a single V2 evolution run: resolve content → run pipeline → persist results.
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

    const { data: strategyRow, error: stratError } = await db
      .from('evolution_strategies')
      .select('config')
      .eq('id', claimedRun.strategy_id)
      .single();
    if (stratError || !strategyRow) {
      await markRunFailed(db, runId, `Strategy ${claimedRun.strategy_id} not found: ${stratError?.message ?? 'missing'}`);
      return;
    }
    const stratConfig = strategyRow.config as V2StrategyConfig | null;
    if (!stratConfig?.generationModel || !stratConfig?.judgeModel || !stratConfig?.iterations) {
      await markRunFailed(db, runId, `Strategy ${claimedRun.strategy_id} has invalid config`);
      return;
    }
    const config: EvolutionConfig = {
      iterations: stratConfig.iterations,
      budgetUsd: claimedRun.budget_cap_usd ?? 1.0,
      judgeModel: stratConfig.judgeModel,
      generationModel: stratConfig.generationModel,
      strategiesPerRound: stratConfig.strategiesPerRound ?? 3,
      calibrationOpponents: 5,
      tournamentTopK: 5,
    };
    const logger = createRunLogger(runId, db);

    const originalText = await resolveContent(claimedRun, db, llmProvider);
    if (!originalText) {
      const reason = claimedRun.explanation_id != null
        ? `Explanation ${claimedRun.explanation_id} not found`
        : claimedRun.prompt_id != null
          ? `Prompt ${claimedRun.prompt_id} not found`
          : 'No content source: both explanation_id and prompt_id are null';
      await markRunFailed(db, runId, reason);
      return;
    }

    // Load arena entries and inject into initial pool
    let initialPool: Array<import('./arena').ArenaTextVariation & { mu?: number; sigma?: number }> = [];
    if (claimedRun.prompt_id) {
      try {
        const arena = await loadArenaEntries(claimedRun.prompt_id, db);
        initialPool = arena.variants.map((v) => ({
          ...v,
          mu: arena.ratings.get(v.id)?.mu,
          sigma: arena.ratings.get(v.id)?.sigma,
        }));
        logger.info(`Loaded ${initialPool.length} arena entries into initial pool`, { phaseName: 'arena' });
      } catch (err) {
        logger.warn(`Arena load failed (continuing without): ${err}`, { phaseName: 'arena' });
      }
    }

    // Run pipeline with arena entries in initial pool
    const result = await evolveArticle(originalText, llmProvider, db, runId, config, {
      logger,
      initialPool: initialPool.length > 0 ? initialPool : undefined,
    });

    // Persist results
    const durationSeconds = (Date.now() - startTime) / 1000;
    await finalizeRun(runId, result, {
      experiment_id: claimedRun.experiment_id,
      explanation_id: claimedRun.explanation_id,
      strategy_id: claimedRun.strategy_id,
    }, db, durationSeconds, logger);

    // Sync to arena if prompt-based run
    if (claimedRun.prompt_id) {
      try {
        await syncToArena(runId, claimedRun.prompt_id, result.pool, result.ratings, result.matchHistory, db);
        logger.info('Arena sync complete', { phaseName: 'arena' });
      } catch (err) {
        logger.warn(`Arena sync failed: ${err}`, { phaseName: 'arena' });
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

