// Hall of Fame integration: feeds top variants into evolution_hall_of_fame_entries,
// auto-links prompts to runs, and resolves topics by prompt text.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { computeEloPerDollar, createRating, getOrdinal, ordinalToEloScale } from './rating';
import { EVOLUTION_DEFAULT_MODEL, EVOLUTION_SYSTEM_USERID } from './llmClient';
import type { EvolutionLogger, ExecutionContext } from '../types';

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/** Format an unknown error value into a loggable message string. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Find a evolution_hall_of_fame_topics row by case-insensitive prompt match. Returns topic ID or null. */
export async function findTopicByPrompt(
  supabase: SupabaseClient,
  promptText: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('evolution_hall_of_fame_topics')
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
    .from('evolution_hall_of_fame_topics')
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

    // Strategy 2: resolve from existing hall-of-fame entry
    const { data: bankEntry } = await supabase
      .from('evolution_hall_of_fame_entries')
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

/** Feed top 2 variants into evolution_hall_of_fame_entries. Non-fatal on failure. */
export async function feedHallOfFame(
  runId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<void> {
  try {
    const supabase = await createSupabaseServiceClient();
    const top2 = ctx.state.getTopByRating(2);
    if (top2.length === 0) {
      logger.info('No variants to feed into hall of fame', { runId });
      return;
    }

    const topicId = await resolveTopicId(supabase, runId, ctx);
    if (!topicId) {
      logger.warn('Cannot feed hall of fame — no topic resolved', { runId });
      return;
    }

    const model = ctx.payload.config.generationModel ?? EVOLUTION_DEFAULT_MODEL;
    const perEntryCost = ctx.costTracker.getTotalSpent() / top2.length;

    const entryRows = top2.map((variant, i) => ({
      topic_id: topicId,
      content: variant.text,
      // 'evolution_top3' label kept despite top-2 — changing DB CHECK constraint not worth migration risk
      generation_method: i === 0 ? 'evolution_winner' : 'evolution_top3',
      model,
      total_cost_usd: perEntryCost,
      evolution_run_id: runId,
      evolution_variant_id: variant.id,
      rank: i + 1,
      metadata: {},
    }));

    const { data: entries, error: entryErr } = await supabase
      .from('evolution_hall_of_fame_entries')
      .upsert(entryRows, { onConflict: 'evolution_run_id,rank' })
      .select('id');

    if (entryErr || !entries || entries.length === 0) {
      logger.warn('Failed to batch upsert hall-of-fame entries', { runId, error: entryErr?.message });
      return;
    }

    await upsertEloRatings(supabase, entries, top2, ctx, topicId, perEntryCost);
    logger.info('Hall of fame updated', { runId, topicId, entriesInserted: entries.length });
    await triggerAutoReRank(topicId, runId, logger);
  } catch (error) {
    logger.warn('Feed hall of fame failed (non-fatal)', { runId, error: errorMessage(error) });
  }
}

// ─── Private helpers for feedHallOfFame ─────────────────────────

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

/** Batch upsert Elo ratings for newly inserted hall-of-fame entries. */
async function upsertEloRatings(
  supabase: SupabaseClient,
  entries: { id: string }[],
  top2: { id: string }[],
  ctx: ExecutionContext,
  topicId: string,
  perEntryCost: number,
): Promise<void> {
  const eloRows = entries.map((entry, i) => {
    const rating = ctx.state.ratings.get(top2[i].id) ?? createRating();
    const ord = getOrdinal(rating);
    return {
      topic_id: topicId,
      entry_id: entry.id,
      mu: rating.mu,
      sigma: rating.sigma,
      ordinal: ord,
      elo_rating: ordinalToEloScale(ord),
      elo_per_dollar: computeEloPerDollar(ord, perEntryCost),
      match_count: 0,
    };
  });
  await supabase.from('evolution_hall_of_fame_elo').upsert(eloRows, { onConflict: 'topic_id,entry_id' });
}

/** Trigger auto re-ranking after hall-of-fame insertion. Non-fatal on failure. Dynamic import avoids circular deps. */
async function triggerAutoReRank(
  topicId: string,
  runId: string,
  logger: EvolutionLogger,
): Promise<void> {
  try {
    const { runHallOfFameComparisonInternal } = await import('@evolution/services/hallOfFameActions');
    const result = await runHallOfFameComparisonInternal(topicId, EVOLUTION_SYSTEM_USERID, 'gpt-4.1-nano', 1);
    if (result.success) {
      logger.info('Auto re-ranking completed', { runId, topicId, ...result.data });
    } else {
      logger.warn('Auto re-ranking failed', { runId, topicId, error: result.error?.message });
    }
  } catch (error) {
    logger.warn('Auto re-ranking threw (non-fatal)', { runId, topicId, error: errorMessage(error) });
  }
}
