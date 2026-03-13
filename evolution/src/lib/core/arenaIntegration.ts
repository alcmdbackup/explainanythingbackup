// Arena integration: feeds top variants into evolution_arena_entries,
// auto-links prompts to runs, and resolves topics by prompt text.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { computeEloPerDollar, toEloScale } from './rating';
import { EVOLUTION_DEFAULT_MODEL } from './llmClient';
import type { EvolutionLogger, ExecutionContext, TextVariation } from '../types';
import type { PipelineStateImpl } from './state';

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/** Format an unknown error value into a loggable message string. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Load existing Arena entries into the pipeline state at start.
 * Pre-seeds pool, ratings, and matchCounts so in-run ranking includes Arena history.
 * Returns the resolved topicId or null if no topic found.
 */
export async function loadArenaEntries(
  runId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<string | null> {
  const supabase = await createSupabaseServiceClient();
  const topicId = await resolveTopicId(supabase, runId, ctx);
  if (!topicId) {
    logger.info('No Arena topic resolved — skipping Arena load', { runId });
    return null;
  }

  const { data: rows, error } = await supabase
    .from('evolution_arena_entries')
    .select('id, content, generation_method, model, total_cost_usd, metadata, evolution_arena_elo!inner(mu, sigma, match_count)')
    .eq('topic_id', topicId)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to load Arena entries: ${error.message}`);
  }

  if (!rows || rows.length === 0) {
    logger.info('Arena topic has no entries', { runId, topicId });
    return topicId;
  }

  const state = ctx.state as PipelineStateImpl;
  let loaded = 0;

  for (const row of rows) {
    if (state.poolIds.has(row.id)) continue;

    const elo = Array.isArray(row.evolution_arena_elo) ? row.evolution_arena_elo[0] : row.evolution_arena_elo;
    if (!elo) continue;

    const variant: TextVariation = {
      id: row.id,
      text: row.content,
      version: 0,
      parentIds: [],
      strategy: row.generation_method ?? 'arena',
      createdAt: Date.now() / 1000,
      iterationBorn: 0,
      fromArena: true,
    };

    // Push directly to pool (avoids polluting newEntrantsThisIteration)
    state.pool.push(variant);
    state.poolIds.add(variant.id);

    // Pre-seed ratings and match counts from stored elo
    state.ratings.set(row.id, { mu: Number(elo.mu), sigma: Number(elo.sigma) });
    state.matchCounts.set(row.id, Number(elo.match_count));
    loaded++;
  }

  if (loaded > 0) {
    state.rebuildIdMap();
    state.invalidateCache();
  }

  logger.info('Arena entries loaded into pool', { runId, topicId, loaded, totalPool: state.pool.length });
  return topicId;
}

/** Find a evolution_arena_topics row by case-insensitive prompt match. Returns topic ID or null. */
export async function findTopicByPrompt(
  supabase: SupabaseClient,
  promptText: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('evolution_arena_topics')
    .select('id')
    .ilike('prompt', promptText)
    .is('deleted_at', null)
    .single();
  return data?.id ?? null;
}

/** Find existing topic by prompt or create a new one. Returns topic ID or null. */
async function findOrCreateTopic(
  supabase: SupabaseClient,
  promptText: string,
  title: string,
): Promise<string | null> {
  const existingId = await findTopicByPrompt(supabase, promptText);
  if (existingId) return existingId;

  const { data: created } = await supabase
    .from('evolution_arena_topics')
    .insert({ prompt: promptText, title })
    .select('id')
    .single();
  return created?.id ?? null;
}

/** Link a run to a prompt (topic) by updating prompt_id on evolution_runs. */
export async function linkPromptToRun(
  supabase: SupabaseClient,
  runId: string,
  topicId: string,
): Promise<void> {
  await supabase.from('evolution_runs')
    .update({ prompt_id: topicId })
    .eq('id', runId);
}

/** Auto-link run to prompt by resolving from config or explanation title. Non-fatal on failure. */
export async function autoLinkPrompt(
  runId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<void> {
  try {
    const supabase = await createSupabaseServiceClient();

    const { data: run } = await supabase
      .from('evolution_runs')
      .select('prompt_id, config')
      .eq('id', runId)
      .single();

    if (run?.prompt_id) return;

    // Strategy 1: resolve from config.prompt JSONB field
    const configPrompt = (run?.config as Record<string, unknown>)?.prompt;
    if (typeof configPrompt === 'string' && configPrompt.trim()) {
      const topicId = await findTopicByPrompt(supabase, configPrompt.trim());
      if (topicId) {
        await linkPromptToRun(supabase, runId, topicId);
        logger.info('Auto-linked prompt via config JSONB', { runId, promptId: topicId });
        return;
      }
    }

    // Strategy 2: resolve from existing arena entry
    const { data: bankEntry } = await supabase
      .from('evolution_arena_entries')
      .select('topic_id')
      .eq('evolution_run_id', runId)
      .limit(1)
      .single();

    if (bankEntry?.topic_id) {
      await linkPromptToRun(supabase, runId, bankEntry.topic_id);
      logger.info('Auto-linked prompt via bank entry', { runId, promptId: bankEntry.topic_id });
      return;
    }

    // Strategy 3: resolve from explanation title
    if (ctx.payload.explanationId) {
      const { data: explanation } = await supabase
        .from('explanations')
        .select('explanation_title')
        .eq('id', ctx.payload.explanationId)
        .single();

      if (explanation?.explanation_title) {
        const topicId = await findTopicByPrompt(supabase, explanation.explanation_title.trim());
        if (topicId) {
          await linkPromptToRun(supabase, runId, topicId);
          logger.info('Auto-linked prompt via explanation title', { runId, promptId: topicId });
          return;
        }
      }
    }

    logger.warn('Could not auto-link prompt_id (no match found)', { runId });
  } catch (error) {
    logger.warn('Auto-link prompt failed (non-fatal)', { runId, error: errorMessage(error) });
  }
}

/** Sync all pipeline variants, matches, and ratings to Arena via atomic RPC. Non-fatal on failure.
 *  @param matchStartIndex - Index into matchHistory from which to send comparisons (watermark). Default 0 = send all. */
export async function syncToArena(
  runId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
  matchStartIndex = 0,
): Promise<void> {
  try {
    const newVariants = ctx.state.pool.filter((v) => !v.fromArena);
    if (newVariants.length === 0) {
      logger.info('No new variants to sync to Arena', { runId });
      return;
    }

    const supabase = await createSupabaseServiceClient();

    // Use pre-resolved topicId from loadArenaEntries, or resolve now
    const topicId = ctx.arenaTopicId ?? await resolveTopicId(supabase, runId, ctx);
    if (!topicId) {
      logger.warn('Cannot sync to Arena — no topic resolved', { runId });
      return;
    }

    const model = ctx.payload.config.generationModel ?? EVOLUTION_DEFAULT_MODEL;
    const totalCost = ctx.costTracker.getTotalSpent();
    const perEntryCost = newVariants.length > 0 ? totalCost / newVariants.length : 0;

    // Build entry rows for new variants
    const entries = newVariants.map((v) => ({
      id: v.id,
      content: v.text,
      generation_method: 'evolution' as const,
      model,
      total_cost_usd: v.costUsd ?? perEntryCost,
      evolution_variant_id: v.id,
      metadata: { strategy: v.strategy, iterationBorn: v.iterationBorn },
    }));

    // Build match records from match history (only unsent matches from watermark onward)
    const poolIds = new Set(ctx.state.pool.map((v) => v.id));
    const matches = ctx.state.matchHistory
      .slice(matchStartIndex)
      .filter((m) => poolIds.has(m.variationA) && poolIds.has(m.variationB))
      .map((m) => ({
        entry_a_id: m.variationA,
        entry_b_id: m.variationB,
        winner_id: m.confidence === 0 ? null : m.winner,
        confidence: m.confidence,
        judge_model: ctx.payload.config.judgeModel ?? 'gpt-4.1-nano',
        dimension_scores: m.dimensionScores ?? null,
      }));

    // Build elo rows for ALL pool entries (new + updated Arena entries)
    const eloRows = ctx.state.pool
      .filter((v) => ctx.state.ratings.has(v.id))
      .map((v) => {
        const rating = ctx.state.ratings.get(v.id)!;
        const cost = v.fromArena ? 0 : (v.costUsd ?? perEntryCost);
        return {
          entry_id: v.id,
          mu: rating.mu,
          sigma: rating.sigma,
          ordinal: 0,  // dummy for deploy-safety until migration drops the column
          elo_rating: toEloScale(rating.mu),
          elo_per_dollar: computeEloPerDollar(rating.mu, cost),
          match_count: ctx.state.matchCounts.get(v.id) ?? 0,
        };
      });

    const { data: result, error: rpcErr } = await supabase.rpc('sync_to_arena', {
      p_topic_id: topicId,
      p_run_id: runId,
      p_entries: entries,
      p_matches: matches,
      p_elo_rows: eloRows,
    });

    if (rpcErr) {
      logger.warn('sync_to_arena RPC failed (non-fatal)', { runId, topicId, error: rpcErr.message });
      return;
    }

    logger.info('Arena synced', { runId, topicId, result });
  } catch (error) {
    logger.warn('syncToArena failed (non-fatal)', { runId, error: errorMessage(error) });
  }
}

// ─── Private helpers ─────────────────────────────────────

/** Resolve topic ID from run's prompt_id or explanation title fallback. */
async function resolveTopicId(
  supabase: SupabaseClient,
  runId: string,
  ctx: ExecutionContext,
): Promise<string | null> {
  const { data: run } = await supabase
    .from('evolution_runs')
    .select('prompt_id')
    .eq('id', runId)
    .single();

  if (run?.prompt_id) return run.prompt_id;

  if (!ctx.payload.explanationId) return null;

  const { data: explanation } = await supabase
    .from('explanations')
    .select('explanation_title')
    .eq('id', ctx.payload.explanationId)
    .single();

  if (!explanation?.explanation_title) return null;

  return findOrCreateTopic(supabase, explanation.explanation_title.trim(), ctx.payload.title);
}
