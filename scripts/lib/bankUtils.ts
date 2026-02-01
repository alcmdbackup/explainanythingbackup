// Shared article bank insertion logic for CLI scripts.
// Handles topic upsert, entry creation, and Elo initialization via direct Supabase client.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface BankInsertParams {
  prompt: string;
  title?: string;
  content: string;
  generation_method: 'oneshot' | 'evolution_winner' | 'evolution_baseline';
  model: string;
  total_cost_usd?: number | null;
  evolution_run_id?: string | null;
  evolution_variant_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface BankInsertResult {
  topic_id: string;
  entry_id: string;
}

const INITIAL_ELO = 1200;

function computeEloPerDollar(eloRating: number, cost: number | null): number | null {
  if (cost === null || cost === 0) return null;
  return (eloRating - INITIAL_ELO) / cost;
}

/** Upsert topic by prompt, insert entry, initialize Elo. Returns topic_id and entry_id. */
export async function addEntryToBank(
  supabase: SupabaseClient,
  params: BankInsertParams,
): Promise<BankInsertResult> {
  // Step 1: Upsert topic (case-insensitive match on trimmed prompt)
  let topicId: string;

  const { data: upserted, error: upsertError } = await supabase
    .from('article_bank_topics')
    .upsert(
      { prompt: params.prompt.trim(), title: params.title ?? null },
      { onConflict: 'idx_article_bank_topics_prompt_unique' },
    )
    .select('id')
    .single();

  if (upsertError || !upserted) {
    // Fallback: find existing topic by prompt
    const { data: existing, error: findError } = await supabase
      .from('article_bank_topics')
      .select('id')
      .ilike('prompt', params.prompt.trim())
      .is('deleted_at', null)
      .single();

    if (findError || !existing) {
      throw new Error(`Failed to upsert topic: ${upsertError?.message ?? findError?.message ?? 'not found'}`);
    }
    topicId = existing.id;
  } else {
    topicId = upserted.id;
  }

  // Step 2: Insert entry
  const cost = params.total_cost_usd ?? null;
  const { data: entry, error: entryError } = await supabase
    .from('article_bank_entries')
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

  // Step 3: Initialize Elo
  await supabase.from('article_bank_elo').insert({
    topic_id: topicId,
    entry_id: entry.id,
    elo_rating: INITIAL_ELO,
    elo_per_dollar: computeEloPerDollar(INITIAL_ELO, cost),
    match_count: 0,
  });

  return { topic_id: topicId, entry_id: entry.id };
}
