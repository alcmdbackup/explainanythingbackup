// Resolves all inputs needed before the pipeline loop: content, strategy config, arena entries.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Variant } from '../../types';
import type { EvolutionConfig } from '../infra/types';
import type { Rating } from '../../shared/computeRatings';
import { dbToRating, _INTERNAL_DEFAULT_MU, _INTERNAL_DEFAULT_SIGMA } from '../../shared/computeRatings';
import type { EntityLogger } from '../infra/createEntityLogger';
import { createEntityLogger } from '../infra/createEntityLogger';
import { strategyConfigSchema } from '../../schemas';

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
 *
 * `excludeId`: when set, skip this row (used by buildRunContext to avoid double-loading
 * the persisted seed which already enters the pool via the seed-variant baseline path).
 */
export async function loadArenaEntries(
  promptId: string,
  supabase: SupabaseClient,
  excludeId?: string,
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
    if (excludeId && entry.id === excludeId) continue;
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
    ratings.set(entry.id, dbToRating(
      Number.isFinite(rawMu) ? rawMu! : _INTERNAL_DEFAULT_MU,
      Number.isFinite(rawSigma) ? rawSigma! : _INTERNAL_DEFAULT_SIGMA,
    ));
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
  complete(
    prompt: string,
    label: string,
    opts?: { model?: string; temperature?: number },
  ): Promise<string | { text: string; usage: { promptTokens: number; completionTokens: number; reasoningTokens?: number } }>;
};

/**
 * Persisted seed variant metadata: when present, the run's seed_variant pool entry
 * reuses this row's UUID + rating instead of creating a fresh one. Post-run rating
 * updates land back on this row via optimistic-concurrency arenaUpdates.
 *
 * Loaded by resolveContent; gated by EVOLUTION_REUSE_SEED_RATING env var.
 * The mu/sigma are kept as the original Postgres NUMERIC string (lossless) so the
 * finalize-time WHERE predicate can compare against the DB exactly.
 */
export interface SeedVariantRow {
  id: string;
  mu: number;
  sigma: number;
  arena_match_count: number;
  /** Lossless string form of mu (preserves Postgres NUMERIC precision for optimistic UPDATE). */
  muRaw: string;
  /** Lossless string form of sigma. */
  sigmaRaw: string;
}

export interface RunContext {
  /** Resolved base article text. Null when seedPrompt is set and no arena seed exists yet. */
  originalText: string | null;
  config: EvolutionConfig;
  logger: EntityLogger;
  initialPool: Array<ArenaTextVariation & { elo?: number; uncertainty?: number }>;
  /** Run-level random seed (BIGINT) for reproducible Fisher-Yates shuffles + agent tiebreaks. */
  randomSeed: bigint;
  /** Set for prompt_id runs when no arena seed exists: CreateSeedArticleAgent generates one in iter 1. */
  seedPrompt?: string;
  /** Persisted seed metadata when EVOLUTION_REUSE_SEED_RATING is on AND a seed row exists. */
  seedVariantRow?: SeedVariantRow;
}

// ─── Helpers ─────────────────────────────────────────────────────

interface ResolvedContent {
  originalText: string | null;
  seedPrompt?: string;
  seedVariantRow?: SeedVariantRow;
}

/** Read EVOLUTION_REUSE_SEED_RATING once. Defaults to true (new behavior). Set to 'false' to revert. */
function isSeedRatingReuseEnabled(): boolean {
  return process.env.EVOLUTION_REUSE_SEED_RATING !== 'false';
}

async function resolveContent(
  run: ClaimedRun,
  db: SupabaseClient,
  _llm: RawLLMProvider,
  logger?: EntityLogger,
): Promise<ResolvedContent> {
  if (run.explanation_id != null) {
    const { data, error } = await db.from('explanations').select('content').eq('id', run.explanation_id).single();
    const content = !error && typeof data?.content === 'string' ? data.content : null;
    if (!content) return { originalText: null };
    logger?.info('Content resolved from explanation', { contentLength: content.length, source: 'explanation', phaseName: 'setup' });
    return { originalText: content };
  }

  if (run.prompt_id != null) {
    const { data, error } = await db.from('evolution_prompts').select('prompt').eq('id', run.prompt_id).single();
    const promptText = !error && typeof data?.prompt === 'string' ? data.prompt : null;
    if (!promptText) return { originalText: null };

    // Use highest-rated arena seed article if one exists; otherwise defer to CreateSeedArticleAgent.
    // Read mu/sigma/arena_match_count too so we can reuse the seed's persisted rating in the run pool.
    const { data: seedEntry } = await db
      .from('evolution_variants')
      .select('id, variant_content, mu, sigma, arena_match_count, synced_to_arena')
      .eq('prompt_id', run.prompt_id)
      .eq('synced_to_arena', true)
      .eq('generation_method', 'seed')
      .is('archived_at', null)
      .order('elo_score', { ascending: false })
      .limit(1)
      .single();

    if (seedEntry?.variant_content) {
      // Belt-and-suspenders invariant: SELECT filtered on synced_to_arena=true,
      // but if a future code path returns a stale row, fall through cleanly.
      if (seedEntry.synced_to_arena !== true) {
        logger?.error('Seed row violates synced_to_arena invariant; falling through to CreateSeedArticleAgent', {
          seedId: seedEntry.id, phaseName: 'setup',
        });
        return { originalText: null, seedPrompt: promptText };
      }
      logger?.info('Content resolved from arena seed article', { contentLength: seedEntry.variant_content.length, source: 'arena_seed', phaseName: 'setup' });
      const seedVariantRow = isSeedRatingReuseEnabled() ? buildSeedVariantRow(seedEntry) : undefined;
      return { originalText: seedEntry.variant_content, seedVariantRow };
    }

    logger?.info('No arena seed found; deferring seed generation to CreateSeedArticleAgent', { promptId: run.prompt_id, phaseName: 'setup' });
    return { originalText: null, seedPrompt: promptText };
  }

  return { originalText: null };
}

/**
 * Convert a seed_variant DB row into a SeedVariantRow. mu/sigma are preserved as their
 * original string form (Postgres NUMERIC) so the finalize-time optimistic-concurrency
 * UPDATE can compare against the DB exactly without JS-float precision loss.
 */
function buildSeedVariantRow(row: {
  id: string;
  mu: number | string | null;
  sigma: number | string | null;
  arena_match_count: number | null;
}): SeedVariantRow {
  const muRaw = row.mu == null ? String(_INTERNAL_DEFAULT_MU) : String(row.mu);
  const sigmaRaw = row.sigma == null ? String(_INTERNAL_DEFAULT_SIGMA) : String(row.sigma);
  const muNum = Number(muRaw);
  const sigmaNum = Number(sigmaRaw);
  return {
    id: row.id,
    mu: Number.isFinite(muNum) ? muNum : _INTERNAL_DEFAULT_MU,
    sigma: Number.isFinite(sigmaNum) ? sigmaNum : _INTERNAL_DEFAULT_SIGMA,
    arena_match_count: row.arena_match_count ?? 0,
    muRaw,
    sigmaRaw,
  };
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
  const configParsed = strategyConfigSchema.safeParse(strategyRow.config);
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
    numVariants: stratConfig.maxVariantsToGenerateFromSeedArticle ?? 9,
    maxComparisonsPerVariant: stratConfig.maxComparisonsPerVariant ?? 15,
    // Budget floors — preprocess in schemas.ts already migrates legacy fields into
    // minBudgetAfter*Fraction. Pass all four fields through; pipeline resolves lazily.
    minBudgetAfterParallelFraction: stratConfig.minBudgetAfterParallelFraction,
    minBudgetAfterParallelAgentMultiple: stratConfig.minBudgetAfterParallelAgentMultiple,
    minBudgetAfterSequentialFraction: stratConfig.minBudgetAfterSequentialFraction,
    minBudgetAfterSequentialAgentMultiple: stratConfig.minBudgetAfterSequentialAgentMultiple,
    generationTemperature: stratConfig.generationTemperature,
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

  const { originalText, seedPrompt, seedVariantRow } = await resolveContent(claimedRun, db, llmProvider, logger);
  if (!originalText && !seedPrompt) {
    const reason = claimedRun.explanation_id != null
      ? `Explanation ${claimedRun.explanation_id} not found`
      : claimedRun.prompt_id != null
        ? `Prompt ${claimedRun.prompt_id} not found`
        : 'No content source: both explanation_id and prompt_id are null';
    return { error: reason };
  }

  // Load arena entries — exclude the seed row (it enters the pool via the seed-variant
  // baseline path with reusedFromSeed=true; double-loading would create two pool entries
  // for the same DB row with different rating provenance).
  let initialPool: Array<ArenaTextVariation & { elo?: number; uncertainty?: number }> = [];
  if (claimedRun.prompt_id) {
    try {
      const arena = await loadArenaEntries(claimedRun.prompt_id, db, seedVariantRow?.id);
      initialPool = arena.variants.map((v) => ({
        ...v,
        elo: arena.ratings.get(v.id)?.elo,
        uncertainty: arena.ratings.get(v.id)?.uncertainty,
      }));
      logger.info(`Loaded ${initialPool.length} arena entries into initial pool`, { phaseName: 'arena' });
    } catch (err) {
      logger.warn('Arena load failed (continuing without)', { phaseName: 'arena', error: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
    }
  }

  // Load existing random_seed for reproducibility, or generate and persist a new one.
  let randomSeed: bigint;
  try {
    const { data: runRow } = await db.from('evolution_runs').select('random_seed').eq('id', runId).single();
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
    context: { originalText, config, logger, initialPool, randomSeed, seedPrompt, seedVariantRow },
  };
}
