// Shared Arena insertion logic for CLI scripts.
// Handles topic upsert, entry creation, and OpenSkill rating initialization via direct Supabase client.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createRating, toEloScale, computeEloPerDollar } from '../../../src/lib/core/rating';

export interface ArenaInsertParams {
  prompt: string;
  title?: string;
  content: string;
  generation_method: 'oneshot' | 'evolution_winner' | 'evolution_baseline' | 'evolution_top3' | 'evolution_ranked' | 'evolution';
  model: string;
  total_cost_usd?: number | null;
  evolution_run_id?: string | null;
  evolution_variant_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ArenaInsertResult {
  topic_id: string;
  entry_id: string;
}

/** Upsert topic by prompt, insert entry, initialize Elo. Returns topic_id and entry_id. */
export async function addEntryToArena(
  supabase: SupabaseClient,
  params: ArenaInsertParams,
): Promise<ArenaInsertResult> {
  // Step 1: Upsert topic (find-first-then-insert with retry on unique constraint race)
  const trimmedPrompt = params.prompt.trim();
  let topicId: string | null = null;

  for (let attempt = 0; attempt <= 2; attempt++) {
    const { data: existing } = await supabase
      .from('evolution_arena_topics')
      .select('id')
      .ilike('prompt', trimmedPrompt)
      .is('deleted_at', null)
      .single();

    if (existing) { topicId = existing.id; break; }

    const { data: newTopic, error: insertError } = await supabase
      .from('evolution_arena_topics')
      .insert({ prompt: trimmedPrompt, title: params.title ?? null })
      .select('id')
      .single();

    if (newTopic) { topicId = newTopic.id; break; }

    // Unique constraint violation → concurrent insert won; retry select
    if (insertError?.code === '23505' && attempt < 2) continue;
    throw new Error(`Failed to upsert topic: ${insertError?.message ?? 'unknown'}`);
  }

  if (!topicId) throw new Error('Topic upsert exhausted retries');

  // Step 2: Insert entry
  const cost = params.total_cost_usd ?? null;
  const { data: entry, error: entryError } = await supabase
    .from('evolution_arena_entries')
    .insert({
      topic_id: topicId,
      content: params.content,
      generation_method: params.generation_method,
      model: params.model,
      total_cost_usd: cost,
      evolution_run_id: params.evolution_run_id ?? null,
      evolution_variant_id: params.evolution_variant_id ?? null,
      metadata: params.metadata ?? {},
    })
    .select('id')
    .single();

  if (entryError || !entry) {
    throw new Error(`Failed to insert entry: ${entryError?.message ?? 'unknown'}`);
  }

  // Step 3: Initialize OpenSkill rating
  const initRating = createRating();
  await supabase.from('evolution_arena_elo').insert({
    topic_id: topicId,
    entry_id: entry.id,
    mu: initRating.mu,
    sigma: initRating.sigma,
    ordinal: 0,  // dummy for deploy-safety until migration drops the column
    elo_rating: toEloScale(initRating.mu),
    elo_per_dollar: computeEloPerDollar(initRating.mu, cost),
    match_count: 0,
  });

  return { topic_id: topicId, entry_id: entry.id };
}
