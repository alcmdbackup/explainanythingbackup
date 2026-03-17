// V2 Arena functions: load entries into pool, sync results to arena, type guards.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TextVariation } from '../types';
import type { Rating } from '../core/rating';
import { toEloScale } from '../core/rating';
import type { V2Match } from './types';

// ─── Types ───────────────────────────────────────────────────────

/** TextVariation loaded from arena (fromArena flag set). */
export interface ArenaTextVariation extends TextVariation {
  fromArena: true;
}

// ─── Type guard ──────────────────────────────────────────────────

/** Check if a variant was loaded from the arena. */
export function isArenaEntry(variant: TextVariation): variant is ArenaTextVariation {
  return 'fromArena' in variant && (variant as ArenaTextVariation).fromArena === true;
}

// ─── Load arena entries ──────────────────────────────────────────

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

// ─── Sync to arena ───────────────────────────────────────────────

/**
 * Sync pipeline results to arena via sync_to_arena RPC.
 * Upserts new variants as entries, inserts match history, updates Elo.
 */
export async function syncToArena(
  runId: string,
  promptId: string,
  pool: TextVariation[],
  ratings: Map<string, Rating>,
  matchHistory: V2Match[],
  supabase: SupabaseClient,
): Promise<void> {
  // Build entries: all non-arena variants
  const newEntries = pool
    .filter((v) => !isArenaEntry(v))
    .map((v) => {
      const r = ratings.get(v.id);
      return {
        id: v.id,
        content: v.text,
        elo_rating: r ? toEloScale(r.mu) : 1200,
        mu: r?.mu ?? 25,
        sigma: r?.sigma ?? 8.333,
        match_count: 0,
        generation_method: 'pipeline',
      };
    });

  // Build match results
  const matches = matchHistory.map((m) => ({
    entry_a: m.winnerId,
    entry_b: m.loserId,
    winner: m.result === 'draw' ? 'draw' : 'a',
    confidence: m.confidence,
  }));

  const { error } = await supabase.rpc('sync_to_arena', {
    p_topic_id: promptId,
    p_run_id: runId,
    p_entries: newEntries,
    p_matches: matches,
  });

  if (error) {
    console.warn(`[V2Arena] sync_to_arena error: ${error.message}`);
  }
}
