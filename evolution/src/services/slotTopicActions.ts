// Slot-topic + per-slot-match persistence helpers for paragraph_recombine.
// Per D10 + D14 + Phase 3 of rank_individual_paragraphs_evolution_20260525.
//
// upsertSlotTopic — idempotent creation of a per-(parent, slot) arena topic in
//   evolution_prompts, plus the slot's original-paragraph variant in
//   evolution_variants. Uses ON CONFLICT (prompt) DO NOTHING against the partial
//   unique index from migration 20260527000002.
//
// persistSlotMatches — bulk INSERT to evolution_arena_comparisons with the slot's
//   prompt_id. Required because sync_to_arena RPC's p_matches is DEPRECATED (per
//   20260331000002) and MergeRatingsAgent writes with ctx.promptId = run's
//   article-level promptId — which would misroute per-slot match rows.
//   Mirrors MergeRatingsAgent.ts:277-334 row construction but parameterized on
//   slotTopicId.

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatSlotTopicName } from '@evolution/lib/shared/paragraphLabels';
import { ratingToDb, type Rating } from '@evolution/lib/shared/computeRatings';
import type { V2Match } from '@evolution/lib/pipeline/infra/types';

export interface UpsertSlotTopicResult {
  /** UUID of the slot's arena topic row in evolution_prompts. */
  topicId: string;
  /** True iff this call CREATED the topic (false on idempotent re-creation). */
  isNew: boolean;
  /** UUID of the slot's original-paragraph variant in evolution_variants. */
  originalSlotVariantId: string;
}

/**
 * Upsert the arena topic for a paragraph (or future granularity) slot. Idempotent
 * via the partial unique index `uq_evolution_prompts_paragraph_topic` (from
 * migration 20260527000002): re-calls with the same args return the existing topic.
 *
 * Also upserts the slot's original-paragraph variant so it always competes in the
 * arena (gets a stable variant ID across re-runs).
 *
 * @param kind Granularity discriminator. v1 only calls with 'paragraph'; the param
 *             is here from day one per D14 so future sentence/section helpers can
 *             share the same code path with kind='sentence' or 'section'.
 * @param parentVariantId UUID of the parent article variant being decomposed.
 * @param slotIndex 0-based paragraph slot index within the parent.
 * @param originalSlotText Original paragraph text (used as the original variant's content).
 */
export async function upsertSlotTopic(
  db: SupabaseClient,
  kind: 'paragraph',
  parentVariantId: string,
  slotIndex: number,
  originalSlotText: string,
): Promise<UpsertSlotTopicResult> {
  const topicName = formatSlotTopicName(parentVariantId, slotIndex, kind === 'paragraph' ? 'para' : kind);

  // Try INSERT first; on conflict (partial unique index hit), SELECT the existing row.
  // We can't use a simple ON CONFLICT DO NOTHING + .select() because Supabase's
  // returning clause is empty on conflict; we need a two-step.
  const { data: insertedTopic, error: insertError } = await db
    .from('evolution_prompts')
    .insert({
      prompt: topicName,
      name: topicName,
      prompt_kind: 'paragraph',
      status: 'active',
    })
    .select('id')
    .maybeSingle();

  let topicId: string;
  let isNew: boolean;
  if (insertedTopic) {
    topicId = insertedTopic.id;
    isNew = true;
  } else if (insertError && insertError.code === '23505') {
    // Unique violation on the partial index — topic already exists. Fetch it.
    const { data: existing, error: selectError } = await db
      .from('evolution_prompts')
      .select('id')
      .eq('prompt', topicName)
      .eq('prompt_kind', 'paragraph')
      .maybeSingle();
    if (!existing || selectError) {
      throw new Error(`upsertSlotTopic: failed to fetch existing topic '${topicName}': ${selectError?.message}`);
    }
    topicId = existing.id;
    isNew = false;
  } else {
    throw new Error(`upsertSlotTopic: insert failed for '${topicName}': ${insertError?.message}`);
  }

  // Upsert the original-paragraph variant. We look up first because there's no
  // deterministic-id pattern for this (variant UUIDs are gen_random_uuid()). If a
  // prior invocation already inserted the original for this slot+content, reuse it.
  // For now: insert if no row exists with (prompt_id, agent_name='paragraph_original').
  const { data: existingOriginal } = await db
    .from('evolution_variants')
    .select('id')
    .eq('prompt_id', topicId)
    .eq('agent_name', 'paragraph_original')
    .eq('variant_kind', 'paragraph')
    .maybeSingle();

  let originalSlotVariantId: string;
  if (existingOriginal) {
    originalSlotVariantId = existingOriginal.id;
  } else {
    const { data: insertedOriginal, error: originalErr } = await db
      .from('evolution_variants')
      .insert({
        prompt_id: topicId,
        variant_content: originalSlotText,
        agent_name: 'paragraph_original',
        variant_kind: 'paragraph',
        synced_to_arena: true,
        generation_method: 'paragraph_original',
      })
      .select('id')
      .single();
    if (!insertedOriginal || originalErr) {
      throw new Error(`upsertSlotTopic: failed to insert original variant for slot ${slotIndex}: ${originalErr?.message}`);
    }
    originalSlotVariantId = insertedOriginal.id;
  }

  return { topicId, isNew, originalSlotVariantId };
}

/**
 * Per-slot match snapshot: maps a (winnerId, loserId) pair to its before/after Rating
 * snapshots (Rating = {elo, uncertainty}, Elo-scale). Populated by paragraph_recombine's
 * per-slot ranking loop from rankResult.detail.comparisons[*] (see Phase 4).
 */
export type BeforeAfterRatingsMap = Map<string, { aBefore: Rating; aAfter: Rating; bBefore: Rating; bAfter: Rating }>;

/** Canonical pair key for beforeAfterRatings — lexicographically-sorted IDs. */
export function makeMatchKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

export interface PersistSlotMatchesResult {
  /** Number of rows inserted. Less than slotMatches.length on partial failure (best-effort). */
  inserted: number;
  /** Set when the bulk INSERT failed entirely. Best-effort: caller logs and continues. */
  error?: string;
}

/**
 * Bulk INSERT per-slot match rows to evolution_arena_comparisons with the slot's
 * prompt_id. Per D10 of rank_individual_paragraphs_evolution_20260525.
 *
 * Required because sync_to_arena's p_matches is DEPRECATED (since 20260331000002)
 * and MergeRatingsAgent writes with ctx.promptId = run's article-level promptId.
 * Per-slot match rows would never reach the slot topic without this dedicated
 * write path.
 *
 * Row construction mirrors MergeRatingsAgent.ts:277-334 — same columns, same
 * winner-slot derivation, same status='completed' default. The only difference:
 * prompt_id is parameterized (slotTopicId) instead of pulled from ctx.promptId.
 *
 * Best-effort: errors are caught and reported in the result. Caller should log
 * and continue (the slot still produces a winner from in-memory state). The
 * new paragraph_slot_match_persist_failures metric (Phase 2) is meant to be
 * incremented by the caller when this returns an error.
 */
export async function persistSlotMatches(
  db: SupabaseClient,
  slotTopicId: string,
  runId: string,
  invocationId: string,
  iteration: number,
  slotMatches: V2Match[],
  beforeAfterRatings: BeforeAfterRatingsMap,
): Promise<PersistSlotMatchesResult> {
  if (slotMatches.length === 0) {
    return { inserted: 0 };
  }

  const arenaRows = slotMatches
    .filter((m) => m.confidence > 0) // Skip failed comparisons (matches MergeRatingsAgent precedent).
    .map((match) => {
      // Determine canonical entry_a/entry_b ordering. For draws, normalize to sorted order
      // to prevent duplicate match records (matches MergeRatingsAgent line 281).
      let entryA: string;
      let entryB: string;
      let winnerSlot: 'a' | 'b' | 'draw';
      if (match.result === 'draw') {
        const [first, second] = [match.winnerId, match.loserId].sort();
        entryA = first!;
        entryB = second!;
        winnerSlot = 'draw';
      } else {
        // entry_a = winnerId, so winner is always 'a' by construction.
        entryA = match.winnerId;
        entryB = match.loserId;
        winnerSlot = 'a';
      }

      // Look up before/after ratings for this match. The key uses the canonical
      // sorted form so the map is order-invariant. Missing key → leave columns NULL
      // (logged as a recoverable warning rather than failing the whole batch).
      const ratings = beforeAfterRatings.get(makeMatchKey(entryA, entryB));
      let aBeforeDb, aAfterDb, bBeforeDb, bAfterDb;
      if (ratings) {
        aBeforeDb = ratingToDb(ratings.aBefore);
        aAfterDb = ratingToDb(ratings.aAfter);
        bBeforeDb = ratingToDb(ratings.bBefore);
        bAfterDb = ratingToDb(ratings.bAfter);
      }

      return {
        run_id: runId,
        prompt_id: slotTopicId,
        entry_a: entryA,
        entry_b: entryB,
        winner: winnerSlot,
        confidence: match.confidence,
        iteration,
        invocation_id: invocationId === '' ? null : invocationId,
        entry_a_mu_before: aBeforeDb?.mu ?? null,
        entry_a_sigma_before: aBeforeDb?.sigma ?? null,
        entry_b_mu_before: bBeforeDb?.mu ?? null,
        entry_b_sigma_before: bBeforeDb?.sigma ?? null,
        entry_a_mu_after: aAfterDb?.mu ?? null,
        entry_a_sigma_after: aAfterDb?.sigma ?? null,
        entry_b_mu_after: bAfterDb?.mu ?? null,
        entry_b_sigma_after: bAfterDb?.sigma ?? null,
        status: 'completed' as const,
      };
    });

  if (arenaRows.length === 0) {
    return { inserted: 0 };
  }

  try {
    const { error } = await db.from('evolution_arena_comparisons').insert(arenaRows);
    if (error) {
      return { inserted: 0, error: error.message };
    }
    return { inserted: arenaRows.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { inserted: 0, error: msg };
  }
}
