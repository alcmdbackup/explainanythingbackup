// Extracts Hall of Fame integration logic from pipeline.ts: feeding top variants into hall_of_fame_entries,
// auto-linking prompts to runs, and resolving topics by prompt text.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { getOrdinal, ordinalToEloScale, createRating } from './rating';
import { EVOLUTION_SYSTEM_USERID } from './llmClient';
import type { EvolutionLogger, ExecutionContext } from '../types';

/** Supabase client type used across hall-of-fame helpers. */
type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/** Find a hall_of_fame_topics row by case-insensitive prompt match. Returns topic ID or null. */
export async function findTopicByPrompt(
  supabase: SupabaseClient,
  promptText: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('hall_of_fame_topics')
    .select('id')
    .ilike('prompt', promptText)
    .is('deleted_at', null)
    .single();
  return data?.id ?? null;
}

/** Link a run to a prompt (topic) by updating prompt_id on content_evolution_runs. */
export async function linkPromptToRun(
  supabase: SupabaseClient,
  runId: string,
  topicId: string,
): Promise<void> {
  await supabase.from('content_evolution_runs')
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
      .from('content_evolution_runs')
      .select('prompt_id, config')
      .eq('id', runId)
      .single();

    if (run?.prompt_id) return;

    // Try config.prompt
    const configPrompt = (run?.config as Record<string, unknown>)?.prompt;
    if (typeof configPrompt === 'string' && configPrompt.trim()) {
      const topicId = await findTopicByPrompt(supabase, configPrompt.trim());
      if (topicId) {
        await linkPromptToRun(supabase, runId, topicId);
        logger.info('Auto-linked prompt via config JSONB', { runId, promptId: topicId });
        return;
      }
    }

    // Try existing bank entry
    const { data: bankEntry } = await supabase
      .from('hall_of_fame_entries')
      .select('topic_id')
      .eq('evolution_run_id', runId)
      .limit(1)
      .single();

    if (bankEntry?.topic_id) {
      await linkPromptToRun(supabase, runId, bankEntry.topic_id);
      logger.info('Auto-linked prompt via bank entry', { runId, promptId: bankEntry.topic_id });
      return;
    }

    // Try explanation title
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
    logger.warn('Auto-link prompt failed (non-fatal)', {
      runId, error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Feed top 3 variants into hall_of_fame_entries (hall of fame). Non-fatal on failure. */
export async function feedHallOfFame(
  runId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
): Promise<void> {
  try {
    const supabase = await createSupabaseServiceClient();
    const top3 = ctx.state.getTopByRating(3);
    if (top3.length === 0) {
      logger.info('No variants to feed into hall of fame', { runId });
      return;
    }

    // Resolve topic_id: prefer prompt_id already linked on the run
    const { data: run } = await supabase
      .from('content_evolution_runs')
      .select('prompt_id')
      .eq('id', runId)
      .single();

    let topicId = run?.prompt_id ?? null;

    if (!topicId && ctx.payload.explanationId) {
      const { data: explanation } = await supabase
        .from('explanations')
        .select('explanation_title')
        .eq('id', ctx.payload.explanationId)
        .single();

      if (explanation?.explanation_title) {
        const trimmed = explanation.explanation_title.trim();
        // Select or insert topic
        const { data: existing } = await supabase
          .from('hall_of_fame_topics')
          .select('id')
          .ilike('prompt', trimmed)
          .is('deleted_at', null)
          .single();

        if (existing) {
          topicId = existing.id;
        } else {
          const { data: created } = await supabase
            .from('hall_of_fame_topics')
            .insert({ prompt: trimmed, title: ctx.payload.title })
            .select('id')
            .single();
          topicId = created?.id ?? null;
        }
      }
    }

    if (!topicId) {
      logger.warn('Cannot feed hall of fame — no topic resolved', { runId });
      return;
    }

    const model = ctx.payload.config.generationModel ?? 'deepseek-chat';
    const runCost = ctx.costTracker.getTotalSpent();
    // Split cost evenly across top 3 for per-entry attribution
    const perEntryCost = runCost / top3.length;

    // DB-5: Batch both hall-of-fame operations (was 3x2 N+1 loop -> 2 batch calls)
    const entryRows = top3.map((variant, i) => ({
      topic_id: topicId,
      content: variant.text,
      generation_method: i === 0 ? 'evolution_winner' : 'evolution_top3',
      model,
      total_cost_usd: perEntryCost,
      evolution_run_id: runId,
      evolution_variant_id: variant.id,
      rank: i + 1,
      metadata: {},
    }));

    const { data: entries, error: entryErr } = await supabase
      .from('hall_of_fame_entries')
      .upsert(entryRows, { onConflict: 'evolution_run_id,rank' })
      .select('id');

    if (entryErr || !entries || entries.length === 0) {
      logger.warn('Failed to batch upsert hall-of-fame entries', { runId, error: entryErr?.message });
    } else {
      const eloRows = entries.map((entry, i) => ({
        topic_id: topicId,
        entry_id: entry.id,
        elo_rating: ordinalToEloScale(
          getOrdinal(ctx.state.ratings.get(top3[i].id) ?? createRating()),
        ),
        match_count: 0,
      }));
      await supabase.from('hall_of_fame_elo').upsert(eloRows, { onConflict: 'topic_id,entry_id' });
    }

    logger.info('Hall of fame updated', { runId, topicId, entriesInserted: top3.length });

    // Auto re-rank after insertion (non-fatal). Dynamic import avoids circular deps.
    try {
      const { runHallOfFameComparisonInternal } = await import('@evolution/services/hallOfFameActions');
      const result = await runHallOfFameComparisonInternal(topicId, EVOLUTION_SYSTEM_USERID, 'gpt-4.1-nano', 1);
      if (result.success) {
        logger.info('Auto re-ranking completed', { runId, topicId, ...result.data });
      } else {
        logger.warn('Auto re-ranking failed', { runId, topicId, error: result.error?.message });
      }
    } catch (reRankError) {
      logger.warn('Auto re-ranking threw (non-fatal)', {
        runId, topicId, error: reRankError instanceof Error ? reRankError.message : String(reRankError),
      });
    }
  } catch (error) {
    logger.warn('Feed hall of fame failed (non-fatal)', {
      runId, error: error instanceof Error ? error.message : String(error),
    });
  }
}
