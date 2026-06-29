// Resolves all inputs needed before the pipeline loop: content, strategy config, arena entries.

import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Variant } from '../../types';
import type { EvolutionConfig } from '../infra/types';
import type { Rating } from '../../shared/computeRatings';
import { dbToRating, _INTERNAL_DEFAULT_MU, _INTERNAL_DEFAULT_SIGMA } from '../../shared/computeRatings';
import { getJudgeRubricForEvaluation } from '../../../services/judgeRubricActions';
import type { ResolvedJudgeRubric } from '../../shared/rubricJudge';
import { resolveEnsembleConfig } from '../../shared/judgeEnsemble/chainRegistry';
import type { EntityLogger } from '../infra/createEntityLogger';
import { createEntityLogger } from '../infra/createEntityLogger';
import { strategyConfigSchema, styleFingerprintTraitsSchema, type StyleFingerprintTraits } from '../../schemas';
import { renderFingerprintProse } from './renderFingerprintProse';

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
 * Optional cap params for loadArenaEntries. Per D15 of rank_individual_paragraphs_evolution_20260525.
 *
 * For paragraph topics (per D10) the pool can accumulate many entries over invocations;
 * a topK cap (default 20) keeps the binary-search ranking pool focused on the strongest
 * existing entries. `alwaysIncludeIds` guarantees the original-paragraph variant is loaded
 * regardless of its current Elo rank — so the original always competes against rewrites.
 *
 * For article-level callers, omit `opts` entirely — behavior is byte-identical to the
 * pre-D15 implementation.
 */
export interface LoadArenaEntriesOpts {
  /** When set, ORDER BY elo_score DESC LIMIT topK after applying the alwaysIncludeIds union. */
  topK?: number;
  /** Variant IDs guaranteed to be loaded regardless of elo_score rank. */
  alwaysIncludeIds?: readonly string[];
}

/**
 * Load active (non-archived) arena entries for a topic into the pool.
 * Returns Variant[] with fromArena=true and preset ratings.
 *
 * `excludeId`: when set, skip this row (used by buildRunContext to avoid double-loading
 * the persisted seed which already enters the pool via the seed-variant baseline path).
 *
 * `opts.topK`: when set, cap the load to top-K by elo_score (paragraph_recombine per D15).
 * `opts.alwaysIncludeIds`: when set, guarantee these IDs are loaded (e.g. original-paragraph
 *                          variant for paragraph topics).
 *
 * **NOTE on sort column**: when `opts.topK` is set we use elo_score DESC, NOT mu DESC.
 * elo_score is the uncertainty-adjusted projection used elsewhere in the leaderboard;
 * raw mu can rank a new variant with high sigma above a battle-tested low-sigma one.
 */
export async function loadArenaEntries(
  promptId: string,
  supabase: SupabaseClient,
  excludeId?: string,
  opts?: LoadArenaEntriesOpts,
): Promise<{ variants: ArenaTextVariation[]; ratings: Map<string, Rating> }> {
  // For paragraph topics with topK cap, we run TWO queries to guarantee
  // alwaysIncludeIds get loaded regardless of elo_score rank:
  //   (1) the top-K by elo_score DESC
  //   (2) the alwaysIncludeIds rows by id
  // Then UNION the results (dedup by id). Article-level callers (no opts) skip
  // this branch and use the existing unbounded query for backward compatibility.

  type ArenaRow = {
    id: string;
    variant_content: string;
    mu: number | null;
    sigma: number | null;
    arena_match_count: number | null;
    generation_method: string | null;
  };
  let combinedRows: ArenaRow[] = [];

  if (opts?.topK !== undefined) {
    // Branch (a): topK + alwaysIncludeIds union.
    const { data: topRows, error: topErr } = await supabase
      .from('evolution_variants')
      .select('id, variant_content, mu, sigma, arena_match_count, generation_method')
      .eq('prompt_id', promptId)
      .eq('synced_to_arena', true)
      .is('archived_at', null)
      .order('elo_score', { ascending: false })
      .limit(opts.topK);
    if (topErr || !topRows) {
      return { variants: [], ratings: new Map() };
    }
    combinedRows = topRows;

    if (opts.alwaysIncludeIds && opts.alwaysIncludeIds.length > 0) {
      const existingIds = new Set(combinedRows.map((r) => r.id));
      const missingIds = opts.alwaysIncludeIds.filter((id) => !existingIds.has(id));
      if (missingIds.length > 0) {
        const { data: includeRows } = await supabase
          .from('evolution_variants')
          .select('id, variant_content, mu, sigma, arena_match_count, generation_method')
          .eq('prompt_id', promptId)
          .eq('synced_to_arena', true)
          .is('archived_at', null)
          .in('id', missingIds);
        if (includeRows) {
          combinedRows = [...combinedRows, ...includeRows];
        }
      }
    }

    // Emit topic-size growth warn-log (D15) when the topic has accumulated past 50
    // non-archived variants. Fire-and-forget COUNT query — no need to block on it.
    void supabase
      .from('evolution_variants')
      .select('id', { count: 'exact', head: true })
      .eq('prompt_id', promptId)
      .eq('synced_to_arena', true)
      .is('archived_at', null)
      .then(({ count }) => {
        if ((count ?? 0) > 50) {
          // eslint-disable-next-line no-console
          console.warn('[topic_arena_growth_warn] paragraph topic exceeds 50 non-archived variants', {
            promptId,
            count,
          });
        }
      });
  } else {
    // Branch (b): existing unbounded query — backward compatible for article-level callers.
    const { data, error } = await supabase
      .from('evolution_variants')
      .select('id, variant_content, mu, sigma, arena_match_count, generation_method')
      .eq('prompt_id', promptId)
      .eq('synced_to_arena', true)
      .is('archived_at', null);
    if (error || !data) {
      return { variants: [], ratings: new Map() };
    }
    combinedRows = data;
  }
  // Re-alias for the existing variable name used downstream.
  const data = combinedRows;

  const variants: ArenaTextVariation[] = [];
  const ratings = new Map<string, Rating>();

  for (const entry of data) {
    if (excludeId && entry.id === excludeId) continue;
    // B017-S1: coerce via Number() first so Postgres NUMERIC values returned as strings
    // ('25.0') are recognized as finite. Without this, all string-typed mu/sigma rows
    // silently fall back to _INTERNAL_DEFAULT_MU/SIGMA.
    const rawMu = entry.mu == null ? null : Number(entry.mu);
    const rawSigma = entry.sigma == null ? null : Number(entry.sigma);
    variants.push({
      id: entry.id,
      text: entry.variant_content,
      version: 0,
      parentIds: [],
      tactic: `arena_${entry.generation_method ?? 'unknown'}`,
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
  /** Run-source provenance (migration 20260627000004). Threaded into
   *  AgentContext.runSource so paragraph topics inherit it via upsertSlotTopic. */
  run_source?: string;
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
  /** Phase 5 / 5a-1: when 'random' and the topic has multiple seeds, pick a
   *  deterministic per-run seed via SHA-256(run.id). Default 'highest_elo'
   *  preserves pre-Phase-5 single-seed behavior. */
  seedSelection?: 'highest_elo' | 'random',
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

    const mode = seedSelection ?? 'highest_elo';
    let seedEntry: {
      id: string;
      variant_content: string;
      mu: number | string | null;
      sigma: number | string | null;
      arena_match_count: number | null;
      synced_to_arena: boolean;
    } | null = null;

    if (mode === 'random') {
      // Phase 5 / 5a-1: deterministic random seed selection across the multi-seed
      // pool. Stable ordering on `id` ASC makes the array index reproducible across
      // runs; SHA-256 of run.id (UUIDv4, 122 bits entropy) → uniform distribution
      // over the pool. Same run.id always picks the same seed so a retried run is
      // not a different experiment. Single-seed topics degrade gracefully to that
      // one seed; zero-seed topics fall through to CreateSeedArticleAgent below.
      const { data: seedRows } = await db
        .from('evolution_variants')
        .select('id, variant_content, mu, sigma, arena_match_count, synced_to_arena')
        .eq('prompt_id', run.prompt_id)
        .eq('synced_to_arena', true)
        .eq('generation_method', 'seed')
        .is('archived_at', null)
        .order('id', { ascending: true });
      if (seedRows && seedRows.length > 0) {
        const hashed = createHash('sha256').update(run.id).digest().readUInt32BE(0);
        seedEntry = seedRows[hashed % seedRows.length] ?? null;
      }
    } else {
      // Pre-Phase-5 / default 'highest_elo': pick the single highest-elo seed.
      // Preserves the exact byte-identical query the pre-Phase-5 code used,
      // including `.single()` semantics (returns { data: null } when no row).
      const { data } = await db
        .from('evolution_variants')
        .select('id, variant_content, mu, sigma, arena_match_count, synced_to_arena')
        .eq('prompt_id', run.prompt_id)
        .eq('synced_to_arena', true)
        .eq('generation_method', 'seed')
        .is('archived_at', null)
        .order('elo_score', { ascending: false })
        .limit(1)
        .single();
      seedEntry = data ?? null;
    }

    if (seedEntry?.variant_content) {
      // Belt-and-suspenders invariant: SELECT filtered on synced_to_arena=true,
      // but if a future code path returns a stale row, fall through cleanly.
      if (seedEntry.synced_to_arena !== true) {
        logger?.error('Seed row violates synced_to_arena invariant; falling through to CreateSeedArticleAgent', {
          seedId: seedEntry.id, phaseName: 'setup',
        });
        return { originalText: null, seedPrompt: promptText };
      }
      logger?.info('Content resolved from arena seed article', {
        contentLength: seedEntry.variant_content.length, source: 'arena_seed',
        seedSelection: mode, phaseName: 'setup',
      });
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
    // Surface the specific Zod issues (path: message) so skew/misconfig is diagnosable
    // from the run's error_message — not a generic "invalid config". Capped to the first
    // few issues + a hard length clamp (markRunFailed also truncates at 2000).
    const issues = configParsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
      .slice(0, 1500);
    return { error: `Strategy ${claimedRun.strategy_id} has invalid config: ${issues}` };
  }
  const stratConfig = configParsed.data;

  // Validate tactic names in generationGuidance against code registry (strategy-level + per-iteration).
  const { isValidTactic } = await import('../../core/tactics');
  if (stratConfig.generationGuidance) {
    for (const entry of stratConfig.generationGuidance) {
      if (!isValidTactic(entry.tactic)) {
        return { error: `Unknown tactic '${entry.tactic}' in strategy-level generationGuidance` };
      }
    }
  }
  for (let i = 0; i < stratConfig.iterationConfigs.length; i++) {
    const ic = stratConfig.iterationConfigs[i]!;
    if (ic.generationGuidance) {
      for (const entry of ic.generationGuidance) {
        if (!isValidTactic(entry.tactic)) {
          return { error: `Unknown tactic '${entry.tactic}' in iterationConfigs[${i}].generationGuidance` };
        }
      }
    }
  }

  // Rubric-based judging (structured_judging_evolution_20260610): resolve the
  // strategy's judgeRubricId to dimensions + normalized weights once per run.
  // Kill switch EVOLUTION_RUBRIC_JUDGING_ENABLED='false' skips resolution → all
  // ranking judges fall back to holistic without a redeploy. A rubric that no
  // longer resolves (deleted / all dims archived) returns null → holistic too.
  const rubricEnabled = process.env.EVOLUTION_RUBRIC_JUDGING_ENABLED !== 'false';
  const judgeRubric =
    rubricEnabled && stratConfig.judgeRubricId
      ? (await getJudgeRubricForEvaluation(db, stratConfig.judgeRubricId)) ?? undefined
      : undefined;

  // investigate_sequential_paragraph_recombine_performance_20260615 Phase 1d (Fix 5b):
  // Resolve the strategy's paragraphJudgeRubricId the same way as the article rubric.
  // Same kill switch — flipping EVOLUTION_RUBRIC_JUDGING_ENABLED='false' disables BOTH.
  // If the id is set but resolution returns null (rubric was deleted/archived between
  // strategy create and run time), log a warn and fall back to the hardcoded paragraph
  // rubric so the run still proceeds rather than failing.
  let paragraphJudgeRubric: ResolvedJudgeRubric | undefined;
  if (rubricEnabled && stratConfig.paragraphJudgeRubricId) {
    const resolved = await getJudgeRubricForEvaluation(db, stratConfig.paragraphJudgeRubricId);
    if (resolved) {
      paragraphJudgeRubric = resolved;
    } else {
      // TOCTOU silent-fallback observability — operator sees the fallback in logs.
      // Without this, a deleted rubric would silently revert to the hardcoded one
      // with no signal to the operator.
      console.warn(
        '[buildRunContext] paragraphJudgeRubricId set but rubric did not resolve; ' +
        'falling back to hardcoded paragraph rubric',
        { paragraphJudgeRubricId: stratConfig.paragraphJudgeRubricId, runId: claimedRun.id },
      );
    }
  }

  // Multi-judge escalation in the PROD ranking path (judge_escalation_prod_wiring_phase4). DEFAULT ON
  // (per-strategy opt-in via ensembleConfigId): resolve the chain + rule when the strategy author
  // sets `ensembleConfigId`. A strategy that doesn't set it → undefined → byte-identical single-judge
  // ranking. The kill switch EVOLUTION_JUDGE_ESCALATION_ENABLED='false' is an emergency lever that
  // disables escalation for ALL strategies without a redeploy; unset/anything-else = enabled.
  const ensembleEnabled = process.env.EVOLUTION_JUDGE_ESCALATION_ENABLED !== 'false';
  const ensemble =
    ensembleEnabled && stratConfig.ensembleConfigId
      ? resolveEnsembleConfig(stratConfig.ensembleConfigId) ?? undefined
      : undefined;

  // generate_enforce_style_fingerprint_evolution_20260620: per-strategy opt-in style enforcement.
  // Resolve the referenced fingerprint, render the article-shaped prose, snapshot it onto the run
  // (so later fingerprint edits never change what this run was generated/judged against), and carry
  // it on the config for generation (AgentContext) + judging. Missing/soft-deleted fingerprint or
  // no traits ⇒ clean no-op.
  let styleFingerprint: { prose: string; traits: StyleFingerprintTraits } | undefined;
  if (stratConfig.styleFingerprintEnabled && stratConfig.styleFingerprintId) {
    const { data: fpRow } = await db
      .from('evolution_style_fingerprints')
      .select('fingerprint')
      .eq('id', stratConfig.styleFingerprintId)
      .is('deleted_at', null)
      .maybeSingle();
    const traitsParsed = styleFingerprintTraitsSchema.safeParse(fpRow?.fingerprint);
    if (traitsParsed.success) {
      const traits = traitsParsed.data;
      styleFingerprint = { prose: renderFingerprintProse(traits, 'article'), traits };
      await db
        .from('evolution_runs')
        .update({ style_fingerprint_id: stratConfig.styleFingerprintId, style_fingerprint_snapshot: { traits } })
        .eq('id', claimedRun.id);
    } else {
      console.warn(
        '[buildRunContext] styleFingerprintEnabled but fingerprint missing or has no computed traits; ' +
        'proceeding with no style enforcement',
        { styleFingerprintId: stratConfig.styleFingerprintId, runId: claimedRun.id },
      );
    }
  }

  const config: EvolutionConfig = {
    iterationConfigs: stratConfig.iterationConfigs,
    styleFingerprint,
    budgetUsd: claimedRun.budget_cap_usd ?? 1.0,
    judgeModel: stratConfig.judgeModel,
    judgeRubricId: stratConfig.judgeRubricId,
    judgeRubric,
    paragraphJudgeRubricId: stratConfig.paragraphJudgeRubricId,
    paragraphJudgeRubric,
    ensembleConfigId: stratConfig.ensembleConfigId,
    ensemble,
    generationModel: stratConfig.generationModel,
    // Phase 4d (investigate_sequential_paragraph_recombine_performance_20260615) +
    // pre-existing editingModel/approverModel: these optional model-override fields
    // are read off ctx.config at the agent layer (mirroring IterativeEditingAgent.ts:155-167
    // pattern). They MUST be propagated from stratConfig here or the cast on the
    // agent side resolves to undefined → silent fallback to generationModel — which
    // was the canary-B-failure root cause observed on 2026-06-19.
    coordinatorModel: stratConfig.coordinatorModel,
    editingModel: stratConfig.editingModel,
    approverModel: stratConfig.approverModel,
    calibrationOpponents: 5,
    tournamentTopK: 5,
    generationGuidance: stratConfig.generationGuidance,
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
    iterationCount: config.iterationConfigs.length, budgetUsd: config.budgetUsd,
    generationModel: config.generationModel, judgeModel: config.judgeModel,
    phaseName: 'setup',
  });

  const { originalText, seedPrompt, seedVariantRow } = await resolveContent(
    claimedRun, db, llmProvider, logger, stratConfig.seedSelection,
  );
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
