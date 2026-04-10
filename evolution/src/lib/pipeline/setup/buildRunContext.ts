// Resolves all inputs needed before the pipeline loop: content, strategy config, arena entries.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Variant } from '../../types';
import type { EvolutionConfig, V2StrategyConfig } from '../infra/types';
import type { Rating } from '../../shared/computeRatings';
import { DEFAULT_MU, DEFAULT_SIGMA } from '../../shared/computeRatings';
import type { EntityLogger } from '../infra/createEntityLogger';
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
  /** Resolved base article text. Null when seedPrompt is set and no arena seed exists yet. */
  originalText: string | null;
  config: EvolutionConfig;
  logger: EntityLogger;
  initialPool: Array<ArenaTextVariation & { mu?: number; sigma?: number }>;
  /** Run-level random seed (BIGINT) for reproducible Fisher-Yates shuffles + agent tiebreaks. */
  randomSeed: bigint;
  /** Set for prompt_id runs when no arena seed exists: CreateSeedArticleAgent generates one in iter 1. */
  seedPrompt?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

interface ResolvedContent {
  originalText: string | null;
  seedPrompt?: string;
}

async function resolveContent(
  run: ClaimedRun,
  db: SupabaseClient,
  _llm: RawLLMProvider,
  logger?: EntityLogger,
): Promise<ResolvedContent> {
  if (run.explanation_id != null) {
    const { data, error } = await db
      .from('explanations')
      .select('content')
      .eq('id', run.explanation_id)
      .single();
    if (error || !data?.content) return { originalText: null };
    const content = typeof data.content === 'string' ? data.content : null;
    if (!content) return { originalText: null };
    logger?.info('Content resolved from explanation', { contentLength: content.length, source: 'explanation', phaseName: 'setup' });
    return { originalText: content };
  }

  if (run.prompt_id != null) {
    const { data, error } = await db
      .from('evolution_prompts')
      .select('prompt')
      .eq('id', run.prompt_id)
      .single();
    if (error || !data?.prompt) return { originalText: null };
    const promptText = typeof data.prompt === 'string' ? data.prompt : null;
    if (!promptText) return { originalText: null };

    // Check for existing designated seed article in arena (generation_method='seed', not archived).
    // Pick the highest-rated one so each run builds on the best-known starting point.
    const { data: seedEntry } = await db
      .from('evolution_variants')
      .select('variant_content')
      .eq('prompt_id', run.prompt_id)
      .eq('synced_to_arena', true)
      .eq('generation_method', 'seed')
      .is('archived_at', null)
      .order('elo_score', { ascending: false })
      .limit(1)
      .single();

    if (seedEntry?.variant_content) {
      logger?.info('Content resolved from arena seed article', { contentLength: seedEntry.variant_content.length, source: 'arena_seed', phaseName: 'setup' });
      return { originalText: seedEntry.variant_content };
    }

    // No arena seed — defer generation to CreateSeedArticleAgent in iteration 1.
    logger?.info('No arena seed found; deferring seed generation to CreateSeedArticleAgent', { promptId: run.prompt_id, phaseName: 'setup' });
    return { originalText: null, seedPrompt: promptText };
  }

  return { originalText: null };
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

  const { originalText, seedPrompt } = await resolveContent(claimedRun, db, llmProvider, logger);
  if (!originalText && !seedPrompt) {
    let reason: string;
    if (claimedRun.explanation_id != null) {
      reason = `Explanation ${claimedRun.explanation_id} not found`;
    } else if (claimedRun.prompt_id != null) {
      reason = `Prompt ${claimedRun.prompt_id} not found`;
    } else {
      reason = 'No content source: both explanation_id and prompt_id are null';
    }
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

  // Load existing random_seed for run reproduction, or auto-generate and persist a new one.
  let randomSeed: bigint;
  try {
    const { data: runRow } = await db
      .from('evolution_runs')
      .select('random_seed')
      .eq('id', runId)
      .single();
    const existing = runRow?.random_seed as string | number | null | undefined;
    if (existing != null && existing !== '') {
      randomSeed = BigInt(existing);
    } else {
      // 63-bit seed: high 31 bits (signed-safe) + low 32 bits fits in PostgreSQL BIGINT.
      const high = BigInt(Math.floor(Math.random() * 0x7fffffff));
      const low = BigInt(Math.floor(Math.random() * 0xffffffff));
      randomSeed = (high << BigInt(32)) | low;
      await db.from('evolution_runs').update({ random_seed: randomSeed.toString() }).eq('id', runId);
    }
  } catch (err) {
    logger.warn('random_seed read/write failed; using fallback constant', {
      phaseName: 'setup',
      error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    });
    randomSeed = BigInt(42);
  }

  return {
    context: { originalText, config, logger, initialPool, randomSeed, seedPrompt },
  };
}
