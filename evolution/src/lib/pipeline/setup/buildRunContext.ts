// Resolves all inputs needed before the pipeline loop: content, strategy config, arena entries.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Variant } from '../../types';
import type { EvolutionConfig, V2StrategyConfig } from '../infra/types';
import type { Rating } from '../../shared/computeRatings';
import { DEFAULT_MU, DEFAULT_SIGMA } from '../../shared/computeRatings';
import type { EntityLogger } from '../infra/createEntityLogger';
import { generateSeedArticle } from './generateSeedArticle';
import { createEntityLogger } from '../infra/createEntityLogger';
import { v2StrategyConfigSchema } from '../../schemas';

// ─── Arena Types ────────────────────────────────────────────────

/** Variant loaded from arena (fromArena flag set). */
export interface ArenaTextVariation extends Variant {
  fromArena: true;
  /** Cumulative arena match count loaded from DB, used for absolute-count sync. */
  arenaMatchCount?: number;
}

// ─── Arena Type guard ───────────────────────────────────────────

/** Check if a variant was loaded from the arena. */
export function isArenaEntry(variant: Variant): variant is ArenaTextVariation {
  return 'fromArena' in variant && (variant as ArenaTextVariation).fromArena === true;
}

// ─── Load arena entries ─────────────────────────────────────────

/**
 * Load active (non-archived) arena entries for a topic into the pool.
 * Returns Variant[] with fromArena=true and preset ratings.
 */
export async function loadArenaEntries(
  promptId: string,
  supabase: SupabaseClient,
): Promise<{ variants: ArenaTextVariation[]; ratings: Map<string, Rating> }> {
  const { data, error } = await supabase
    .from('evolution_variants')
    .select('id, variant_content, mu, sigma, arena_match_count, generation_method')
    .eq('prompt_id', promptId)
    .eq('synced_to_arena', true)
    .is('archived_at', null);

  if (error || !data) {
    return { variants: [], ratings: new Map() };
  }

  const variants: ArenaTextVariation[] = [];
  const ratings = new Map<string, Rating>();

  for (const entry of data) {
    const rawMu = entry.mu as number | null;
    const rawSigma = entry.sigma as number | null;
    variants.push({
      id: entry.id,
      text: entry.variant_content,
      version: 0,
      parentIds: [],
      strategy: `arena_${entry.generation_method ?? 'unknown'}`,
      createdAt: Date.now() / 1000,
      iterationBorn: 0,
      fromArena: true,
      arenaMatchCount: entry.arena_match_count ?? 0,
    });
    ratings.set(entry.id, {
      mu: Number.isFinite(rawMu) ? rawMu! : DEFAULT_MU,
      sigma: Number.isFinite(rawSigma) ? rawSigma! : DEFAULT_SIGMA,
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
  strategy_id: string;
  budget_cap_usd: number;
}

type RawLLMProvider = {
  complete(prompt: string, label: string, opts?: { model?: string }): Promise<string>;
};

export interface RunContext {
  originalText: string;
  config: EvolutionConfig;
  logger: EntityLogger;
  initialPool: Array<ArenaTextVariation & { mu?: number; sigma?: number }>;
  /** Run-level random seed (BIGINT) for reproducible Fisher-Yates shuffles + agent tiebreaks. */
  randomSeed: bigint;
}

// ─── Helpers ─────────────────────────────────────────────────────

async function resolveContent(
  run: ClaimedRun,
  db: SupabaseClient,
  llm: RawLLMProvider,
  logger?: EntityLogger,
  generationModel?: string,
): Promise<string | null> {
  if (run.explanation_id != null) {
    const { data, error } = await db
      .from('explanations')
      .select('content')
      .eq('id', run.explanation_id)
      .single();
    if (error || !data?.content) return null;
    const content = typeof data.content === 'string' ? data.content : null;
    if (!content) return null;
    logger?.info('Content resolved from explanation', { contentLength: content.length, source: 'explanation', phaseName: 'setup' });
    return content;
  }

  if (run.prompt_id != null) {
    const { data, error } = await db
      .from('evolution_prompts')
      .select('prompt')
      .eq('id', run.prompt_id)
      .single();
    if (error || !data?.prompt) return null;
    const promptText = typeof data.prompt === 'string' ? data.prompt : null;
    if (!promptText) return null;
    // Pass generationModel so the seed step uses the strategy's configured model
    // instead of falling through to the raw provider's deepseek-chat default.
    const seed = await generateSeedArticle(promptText, llm, logger, generationModel);
    logger?.info('Content resolved from seed generation', { contentLength: seed.content.length, source: 'prompt', phaseName: 'setup' });
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
    .from('evolution_strategies')
    .select('config')
    .eq('id', claimedRun.strategy_id)
    .single();
  if (stratError || !strategyRow) {
    return { error: `Strategy ${claimedRun.strategy_id} not found: ${stratError?.message ?? 'missing'}` };
  }
  const configParsed = v2StrategyConfigSchema.safeParse(strategyRow.config);
  if (!configParsed.success) {
    return { error: `Strategy ${claimedRun.strategy_id} has invalid config` };
  }
  const stratConfig = configParsed.data;
  const config: EvolutionConfig = {
    iterations: stratConfig.iterations,
    budgetUsd: claimedRun.budget_cap_usd ?? 1.0,
    judgeModel: stratConfig.judgeModel,
    generationModel: stratConfig.generationModel,
    strategiesPerRound: stratConfig.strategiesPerRound ?? 3,
    calibrationOpponents: 5,
    tournamentTopK: 5,
    generationGuidance: stratConfig.generationGuidance,
  };

  const logger = createEntityLogger({
    entityType: 'run',
    entityId: runId,
    runId,
    experimentId: claimedRun.experiment_id ?? undefined,
    strategyId: claimedRun.strategy_id,
  }, db);

  logger.info('Strategy config resolved', {
    iterations: config.iterations, budgetUsd: config.budgetUsd,
    generationModel: config.generationModel, judgeModel: config.judgeModel,
    phaseName: 'setup',
  });

  // Resolve content (pass generationModel so seed-article LLM calls use the strategy's
  // configured model rather than the raw provider's deepseek-chat default).
  const originalText = await resolveContent(claimedRun, db, llmProvider, logger, config.generationModel);
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
      logger.warn('Arena load failed (continuing without)', { phaseName: 'arena', error: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
    }
  }

  // Read existing random_seed if present (e.g., for reproducing a prior run), otherwise generate.
  let randomSeed: bigint;
  try {
    const { data: runRow } = await db
      .from('evolution_runs')
      .select('random_seed')
      .eq('id', runId)
      .single();
    const existing = runRow?.random_seed as string | number | null | undefined;
    if (existing !== null && existing !== undefined && existing !== '') {
      randomSeed = BigInt(existing);
    } else {
      // Auto-generate a 63-bit seed (signed BIGINT range). Math.random is fine here —
      // only the initial seed needs to be unpredictable; downstream RNGs are
      // deterministic from this. We cap the high half at 31 bits so the combined
      // 63-bit value always fits in PostgreSQL signed BIGINT (max 2^63 - 1).
      const high = BigInt(Math.floor(Math.random() * 0x7fffffff)); // 31 bits, signed-safe
      const low = BigInt(Math.floor(Math.random() * 0xffffffff));   // 32 bits unsigned
      randomSeed = (high << BigInt(32)) | low;
      // Persist it back to the run row so reproduction is possible.
      await db
        .from('evolution_runs')
        .update({ random_seed: randomSeed.toString() })
        .eq('id', runId);
    }
  } catch (err) {
    logger.warn('random_seed read/write failed; using fallback constant', {
      phaseName: 'setup',
      error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    });
    randomSeed = BigInt(42);
  }

  return {
    context: { originalText, config, logger, initialPool, randomSeed },
  };
}
