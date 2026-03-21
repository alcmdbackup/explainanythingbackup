// Resolves all inputs needed before the pipeline loop: content, strategy config, arena entries.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TextVariation } from '../../types';
import type { EvolutionConfig, V2StrategyConfig } from '../infra/types';
import type { Rating } from '../../shared/computeRatings';
import type { RunLogger } from '../infra/createRunLogger';
import { generateSeedArticle } from './generateSeedArticle';
import { createRunLogger } from '../infra/createRunLogger';

// ─── Arena Types ────────────────────────────────────────────────

/** TextVariation loaded from arena (fromArena flag set). */
export interface ArenaTextVariation extends TextVariation {
  fromArena: true;
}

// ─── Arena Type guard ───────────────────────────────────────────

/** Check if a variant was loaded from the arena. */
export function isArenaEntry(variant: TextVariation): variant is ArenaTextVariation {
  return 'fromArena' in variant && (variant as ArenaTextVariation).fromArena === true;
}

// ─── Load arena entries ─────────────────────────────────────────

/**
 * Load active (non-archived) arena entries for a topic into the pool.
 * Returns TextVariation[] with fromArena=true and preset ratings.
 */
export async function loadArenaEntries(
  promptId: string,
  supabase: SupabaseClient,
): Promise<{ variants: ArenaTextVariation[]; ratings: Map<string, Rating> }> {
  const { data, error } = await supabase
    .from('evolution_arena_entries')
    .select('id, content, elo_rating, mu, sigma, match_count, generation_method')
    .eq('topic_id', promptId)
    .is('archived_at', null);

  if (error || !data) {
    return { variants: [], ratings: new Map() };
  }

  const variants: ArenaTextVariation[] = [];
  const ratings = new Map<string, Rating>();

  for (const entry of data) {
    variants.push({
      id: entry.id,
      text: entry.content,
      version: 0,
      parentIds: [],
      strategy: `arena_${entry.generation_method ?? 'unknown'}`,
      createdAt: Date.now() / 1000,
      iterationBorn: 0,
      fromArena: true,
    });
    ratings.set(entry.id, {
      mu: entry.mu ?? 25,
      sigma: entry.sigma ?? 8.333,
    });
  }

  return { variants, ratings };
}

// ─── Types ───────────────────────────────────────────────────────

export interface ClaimedRun {
  id: string;
  explanation_id: number | null;
  prompt_id: string | null;
  experiment_id: string | null;
  strategy_config_id: string;
  budget_cap_usd: number;
}

type RawLLMProvider = {
  complete(prompt: string, label: string, opts?: { model?: string }): Promise<string>;
};

export interface RunContext {
  originalText: string;
  config: EvolutionConfig;
  logger: RunLogger;
  initialPool: Array<ArenaTextVariation & { mu?: number; sigma?: number }>;
}

// ─── Helpers ─────────────────────────────────────────────────────

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

// ─── Public API ──────────────────────────────────────────────────

/**
 * Build a RunContext from a claimed run: resolve strategy config, content, and arena entries.
 * Returns null with an error reason if any required input cannot be resolved.
 */
export async function buildRunContext(
  runId: string,
  claimedRun: ClaimedRun,
  db: SupabaseClient,
  llmProvider: RawLLMProvider,
): Promise<{ context: RunContext } | { error: string }> {
  // Resolve strategy config
  const { data: strategyRow, error: stratError } = await db
    .from('evolution_strategy_configs')
    .select('config')
    .eq('id', claimedRun.strategy_config_id)
    .single();
  if (stratError || !strategyRow) {
    return { error: `Strategy ${claimedRun.strategy_config_id} not found: ${stratError?.message ?? 'missing'}` };
  }
  const stratConfig = strategyRow.config as V2StrategyConfig | null;
  if (!stratConfig?.generationModel || !stratConfig?.judgeModel || !stratConfig?.iterations) {
    return { error: `Strategy ${claimedRun.strategy_config_id} has invalid config` };
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

  // Resolve content
  const originalText = await resolveContent(claimedRun, db, llmProvider);
  if (!originalText) {
    const reason = claimedRun.explanation_id != null
      ? `Explanation ${claimedRun.explanation_id} not found`
      : claimedRun.prompt_id != null
        ? `Prompt ${claimedRun.prompt_id} not found`
        : 'No content source: both explanation_id and prompt_id are null';
    return { error: reason };
  }

  // Load arena entries
  let initialPool: Array<ArenaTextVariation & { mu?: number; sigma?: number }> = [];
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

  return {
    context: { originalText, config, logger, initialPool },
  };
}
