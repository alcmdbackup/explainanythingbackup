// V2 run execution lifecycle: claim → resolve content → evolveArticle → persist → complete.

import type { SupabaseClient } from '@supabase/supabase-js';
// toEloScale handled by finalizeRun
import type { EvolutionConfig } from './types';
import { hashStrategyConfig, labelStrategyConfig } from './strategy';
import { evolveArticle } from './evolve-article';
import { generateSeedArticle } from './seed-article';
import { finalizeRun } from './finalize';
import { loadArenaEntries, syncToArena } from './arena';
import { createRunLogger } from './run-logger';
import type { V2StrategyConfig } from './types';

// ─── Types ───────────────────────────────────────────────────────

export interface ClaimedRun {
  id: string;
  explanation_id: number | null;
  prompt_id: string | null;
  experiment_id: string | null;
  config: Record<string, unknown>;
  strategy_config_id?: string | null;
}

type RawLLMProvider = {
  complete(prompt: string, label: string, opts?: { model?: string }): Promise<string>;
};

// ─── Config resolution ───────────────────────────────────────────

function resolveConfig(raw: Record<string, unknown>): EvolutionConfig {
  return {
    iterations: (raw.maxIterations as number) ?? 5,
    budgetUsd: (raw.budgetCapUsd as number) ?? 1.0,
    judgeModel: (raw.judgeModel as string) ?? 'gpt-4.1-nano',
    generationModel: (raw.generationModel as string) ?? 'gpt-4.1-mini',
    strategiesPerRound: 3,
    calibrationOpponents: 5,
    tournamentTopK: 5,
  };
}

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
      .from('evolution_arena_topics')
      .select('prompt')
      .eq('id', run.prompt_id)
      .single();
    if (error || !data?.prompt) return null;
    const seed = await generateSeedArticle(data.prompt as string, llm);
    return seed.content;
  }

  return null;
}

async function upsertStrategy(
  db: SupabaseClient,
  config: EvolutionConfig,
): Promise<string | null> {
  const v2Config: V2StrategyConfig = {
    generationModel: config.generationModel,
    judgeModel: config.judgeModel,
    iterations: config.iterations,
  };
  const hash = hashStrategyConfig(v2Config);
  const label = labelStrategyConfig(v2Config);
  const name = `Strategy ${hash.slice(0, 6)} (${config.generationModel.split('-').pop()}, ${config.iterations}it)`;

  try {
    const { data, error } = await db
      .from('evolution_strategy_configs')
      .upsert(
        { name, label, config: v2Config, config_hash: hash },
        { onConflict: 'config_hash' },
      )
      .select('id')
      .single();
    if (error) {
      console.warn(`[V2Runner] Strategy upsert error: ${error.message}`);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.warn(`[V2Runner] Strategy upsert exception:`, err);
    return null;
  }
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
    // Mark as running
    await db
      .from('evolution_runs')
      .update({ status: 'running' })
      .eq('id', runId);

    // Resolve config
    const config = resolveConfig(claimedRun.config);
    const logger = createRunLogger(runId, db);

    // Resolve content
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

    // Strategy linking
    const strategyId = await upsertStrategy(db, config);

    if (strategyId) {
      await db
        .from('evolution_runs')
        .update({ strategy_config_id: strategyId })
        .eq('id', runId);
    }

    // Load arena entries if prompt-based run
    if (claimedRun.prompt_id) {
      try {
        const arena = await loadArenaEntries(claimedRun.prompt_id, db);
        // Arena entries are available for future initialPool integration
        logger.info(`Loaded ${arena.variants.length} arena entries`, { phaseName: 'arena' });
      } catch (err) {
        logger.warn(`Arena load failed (continuing without): ${err}`, { phaseName: 'arena' });
      }
    }

    // Run pipeline
    const result = await evolveArticle(originalText, llmProvider, db, runId, config, { logger });

    // Persist results via finalizeRun (V1-compatible)
    const durationSeconds = (Date.now() - startTime) / 1000;
    await finalizeRun(runId, result, {
      experiment_id: claimedRun.experiment_id,
      explanation_id: claimedRun.explanation_id,
      strategy_config_id: strategyId,
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

export { markRunFailed, startHeartbeat, resolveConfig };
