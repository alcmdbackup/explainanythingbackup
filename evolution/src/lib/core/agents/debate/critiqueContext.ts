// Critique-context helper for DebateAgent.
// (bring_back_debate_agent_20260506 Phase 2.4.)
//
// Fetches last K wins + K losses for a variant from evolution_arena_comparisons.
// Filters by variant id (NOT strategy_id — verified against database.types.ts:385-419
// to confirm the table has no strategy_id column; per-variant scope already implies
// per-strategy scope since each variant_id is unique to one run/strategy).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CritiqueContextBlock } from './promptBuilders';

const DEFAULT_K = 3;
const WINDOW_DAYS = 14;

/**
 * Build a critique-context block for a single variant.
 *
 * @param variantId Target variant.
 * @param db Supabase client (admin scope — selecting from evolution_arena_comparisons).
 * @param k Top-K wins + top-K losses to fetch (default 3).
 * @returns Block with pastWins + pastLosses arrays. Empty arrays when no data in window.
 */
export async function buildCritiqueContext(
  variantId: string,
  db: SupabaseClient,
  k: number = DEFAULT_K,
): Promise<CritiqueContextBlock> {
  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Wins: rows where this variant won (entry_a + winner='A' OR entry_b + winner='B').
  // Losses: inverse.
  // Ties (winner='tie') excluded per Decision §13: ties don't count as either.
  const { data: wins } = await db
    .from('evolution_arena_comparisons')
    .select('id, entry_a, entry_b, winner, confidence, created_at')
    .or(`and(entry_a.eq.${variantId},winner.eq.A),and(entry_b.eq.${variantId},winner.eq.B)`)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(k);

  const { data: losses } = await db
    .from('evolution_arena_comparisons')
    .select('id, entry_a, entry_b, winner, confidence, created_at')
    .or(`and(entry_a.eq.${variantId},winner.eq.B),and(entry_b.eq.${variantId},winner.eq.A)`)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(k);

  return {
    pastWins: (wins ?? []).map((row) => ({
      summary: summarizeComparison(row, variantId, 'win'),
    })),
    pastLosses: (losses ?? []).map((row) => ({
      summary: summarizeComparison(row, variantId, 'loss'),
    })),
  };
}

interface ComparisonRow {
  entry_a: string;
  entry_b: string;
  winner: string;
  confidence: number | null;
}

/** Compact one-line summary for the prompt — no LLM-generated text yet (V1 had ReflectionAgent
 *  helpers that summarized matches; V2 replaces with raw entry IDs + outcome until a
 *  helper is added in a follow-up). Format: "vs <opponent>: <outcome> (conf <X.XX>)". */
function summarizeComparison(row: ComparisonRow, variantId: string, outcome: 'win' | 'loss'): string {
  const opponent = row.entry_a === variantId ? row.entry_b : row.entry_a;
  const conf = typeof row.confidence === 'number' ? row.confidence.toFixed(2) : 'n/a';
  return `vs ${opponent.slice(0, 8)}: ${outcome} (conf ${conf})`;
}
