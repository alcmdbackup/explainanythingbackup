'use server';
// Server actions for the article bank: CRUD operations, Elo-based comparison,
// and cross-topic aggregation for the persistent cross-method comparison system.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { compareWithBiasMitigation, type ComparisonResult } from '@/lib/evolution/comparison';
import { callLLMModel, type LLMUsageMetadata } from '@/lib/services/llms';
import { createTitlePrompt, createExplanationPrompt } from '@/lib/prompts';
import {
  titleQuerySchema,
  addToHallOfFameInputSchema as addToBankInputSchema,
  generateAndAddInputSchema,
  runHallOfFameComparisonInputSchema as runBankComparisonInputSchema,
  type AllowedLLMModelType,
  type HallOfFameGenerationMethod as BankGenerationMethod,
} from '@/lib/schemas/schemas';

type ActionResult<T> = { success: boolean; data: T | null; error: ErrorResponse | null };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label: string): void {
  if (!UUID_REGEX.test(id)) {
    throw new Error(`Invalid ${label} format: ${id}`);
  }
}

// ─── Elo math (stateless, operates on DB-fetched values) ────────

const INITIAL_ELO = 1200;
const ELO_K = 32;

function computeEloUpdate(
  ratingA: number, ratingB: number, scoreA: number, k: number = ELO_K,
): [number, number] {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;
  const newA = Math.max(0, ratingA + k * (scoreA - expectedA));
  const newB = Math.max(0, ratingB + k * (1 - scoreA - expectedB));
  return [newA, newB];
}

function computeEloPerDollar(eloRating: number, totalCostUsd: number | null): number | null {
  if (totalCostUsd === null || totalCostUsd === 0) return null;
  return (eloRating - INITIAL_ELO) / totalCostUsd;
}

// ─── Types ──────────────────────────────────────────────────────

export type { BankGenerationMethod };

export interface BankTopic {
  id: string;
  prompt: string;
  title: string | null;
  created_at: string;
}

export interface BankEntry {
  id: string;
  topic_id: string;
  content: string;
  generation_method: BankGenerationMethod;
  model: string;
  total_cost_usd: number | null;
  evolution_run_id: string | null;
  evolution_variant_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface BankEloEntry {
  id: string;
  entry_id: string;
  elo_rating: number;
  elo_per_dollar: number | null;
  match_count: number;
  generation_method: BankGenerationMethod;
  model: string;
  total_cost_usd: number | null;
  created_at: string;
}

export interface BankComparison {
  id: string;
  topic_id: string;
  entry_a_id: string;
  entry_b_id: string;
  winner_id: string | null;
  confidence: number | null;
  judge_model: string;
  dimension_scores: Record<string, unknown> | null;
  created_at: string;
}

export interface CrossTopicMethodSummary {
  generation_method: BankGenerationMethod;
  avg_elo: number;
  avg_cost: number | null;
  avg_elo_per_dollar: number | null;
  win_rate: number;
  entry_count: number;
}

export type AddToBankInput = {
  prompt: string;
  title?: string;
  content: string;
  generation_method: BankGenerationMethod;
  model: string;
  total_cost_usd?: number | null;
  evolution_run_id?: string | null;
  evolution_variant_id?: string | null;
  metadata?: Record<string, unknown>;
};

// ─── Actions ────────────────────────────────────────────────────

/** Select-or-insert topic with retry on unique constraint race. */
async function upsertTopicByPrompt(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  trimmedPrompt: string,
  title: string | null,
  maxRetries = 2,
): Promise<string> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { data: existing } = await supabase
      .from('article_bank_topics')
      .select('id')
      .ilike('prompt', trimmedPrompt)
      .is('deleted_at', null)
      .single();

    if (existing) return existing.id;

    const { data: newTopic, error: insertError } = await supabase
      .from('article_bank_topics')
      .insert({ prompt: trimmedPrompt, title })
      .select('id')
      .single();

    if (newTopic) return newTopic.id;

    // Unique constraint violation → concurrent insert won; retry select
    const isUniqueViolation = insertError?.code === '23505';
    if (isUniqueViolation && attempt < maxRetries) continue;

    throw new Error(`Failed to create topic: ${insertError?.message ?? 'unknown'}`);
  }
  throw new Error('Topic upsert exhausted retries');
}

/** Upsert topic by prompt and insert entry atomically. */
const _addToBankAction = withLogging(async (
  input: AddToBankInput,
): Promise<ActionResult<{ topic_id: string; entry_id: string }>> => {
  try {
    await requireAdmin();
    const validated = addToBankInputSchema.parse(input);
    const supabase = await createSupabaseServiceClient();
    const trimmedPrompt = validated.prompt.trim();

    const topicId = await upsertTopicByPrompt(supabase, trimmedPrompt, validated.title ?? null);

    // Insert entry under topic
    const { data: entry, error: entryError } = await supabase
      .from('article_bank_entries')
      .insert({
        topic_id: topicId,
        content: validated.content,
        generation_method: validated.generation_method,
        model: validated.model,
        total_cost_usd: validated.total_cost_usd ?? null,
        evolution_run_id: validated.evolution_run_id ?? null,
        evolution_variant_id: validated.evolution_variant_id ?? null,
        metadata: validated.metadata ?? {},
      })
      .select('id')
      .single();

    if (entryError || !entry) throw new Error(`Failed to insert entry: ${entryError?.message}`);

    // Initialize Elo for new entry
    await supabase.from('article_bank_elo').insert({
      topic_id: topicId,
      entry_id: entry.id,
      elo_rating: INITIAL_ELO,
      elo_per_dollar: computeEloPerDollar(INITIAL_ELO, validated.total_cost_usd ?? null),
      match_count: 0,
    });

    return { success: true, data: { topic_id: topicId, entry_id: entry.id }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'addToBankAction') };
  }
}, 'addToBankAction');

export const addToBankAction = serverReadRequestId(_addToBankAction);

/** Get a single topic by ID. */
const _getBankTopicAction = withLogging(async (
  topicId: string,
): Promise<ActionResult<BankTopic>> => {
  try {
    await requireAdmin();
    validateUuid(topicId, 'topic ID');
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('article_bank_topics')
      .select('id, prompt, title, created_at')
      .eq('id', topicId)
      .is('deleted_at', null)
      .single();

    if (error || !data) throw new Error(`Topic not found: ${topicId}`);
    return { success: true, data, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getBankTopicAction') };
  }
}, 'getBankTopicAction');

export const getBankTopicAction = serverReadRequestId(_getBankTopicAction);

/** Get all active entries for a topic. */
const _getBankEntriesAction = withLogging(async (
  topicId: string,
): Promise<ActionResult<BankEntry[]>> => {
  try {
    await requireAdmin();
    validateUuid(topicId, 'topic ID');
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('article_bank_entries')
      .select('*')
      .eq('topic_id', topicId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch entries: ${error.message}`);
    return { success: true, data: data ?? [], error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getBankEntriesAction') };
  }
}, 'getBankEntriesAction');

export const getBankEntriesAction = serverReadRequestId(_getBankEntriesAction);

/** Get full entry detail including metadata. */
const _getBankEntryDetailAction = withLogging(async (
  entryId: string,
): Promise<ActionResult<BankEntry>> => {
  try {
    await requireAdmin();
    validateUuid(entryId, 'entry ID');
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('article_bank_entries')
      .select('*')
      .eq('id', entryId)
      .is('deleted_at', null)
      .single();

    if (error || !data) throw new Error(`Entry not found: ${entryId}`);
    return { success: true, data, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getBankEntryDetailAction') };
  }
}, 'getBankEntryDetailAction');

export const getBankEntryDetailAction = serverReadRequestId(_getBankEntryDetailAction);

/** Get Elo-ranked leaderboard for a topic. Joins entries to get method/model/cost. */
const _getBankLeaderboardAction = withLogging(async (
  topicId: string,
): Promise<ActionResult<BankEloEntry[]>> => {
  try {
    await requireAdmin();
    validateUuid(topicId, 'topic ID');
    const supabase = await createSupabaseServiceClient();

    const { data: eloRows, error: eloError } = await supabase
      .from('article_bank_elo')
      .select('id, entry_id, elo_rating, elo_per_dollar, match_count, updated_at')
      .eq('topic_id', topicId)
      .order('elo_rating', { ascending: false });

    if (eloError) throw new Error(`Failed to fetch leaderboard: ${eloError.message}`);
    if (!eloRows || eloRows.length === 0) return { success: true, data: [], error: null };

    // Fetch associated entries for method/model/cost
    const entryIds = eloRows.map((r) => r.entry_id);
    const { data: entries, error: entryError } = await supabase
      .from('article_bank_entries')
      .select('id, generation_method, model, total_cost_usd, created_at')
      .in('id', entryIds)
      .is('deleted_at', null);

    if (entryError) throw new Error(`Failed to fetch entry details: ${entryError.message}`);

    const entryMap = new Map((entries ?? []).map((e) => [e.id, e]));

    const leaderboard: BankEloEntry[] = eloRows
      .filter((r) => entryMap.has(r.entry_id))
      .map((r) => {
        const entry = entryMap.get(r.entry_id)!;
        return {
          id: r.id,
          entry_id: r.entry_id,
          elo_rating: r.elo_rating,
          elo_per_dollar: r.elo_per_dollar,
          match_count: r.match_count,
          generation_method: entry.generation_method,
          model: entry.model,
          total_cost_usd: entry.total_cost_usd,
          created_at: entry.created_at,
        };
      });

    return { success: true, data: leaderboard, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getBankLeaderboardAction') };
  }
}, 'getBankLeaderboardAction');

export const getBankLeaderboardAction = serverReadRequestId(_getBankLeaderboardAction);

/** Run bias-mitigated comparisons between all entry pairs for a topic. Updates Elo. */
const _runBankComparisonAction = withLogging(async (
  topicId: string,
  judgeModel: AllowedLLMModelType = 'gpt-4.1-nano',
  rounds: number = 1,
): Promise<ActionResult<{ comparisons_run: number; entries_updated: number }>> => {
  try {
    const adminUserId = await requireAdmin();
    const { topicId: vTopicId, judgeModel: vJudgeModel, rounds: vRounds } =
      runBankComparisonInputSchema.parse({ topicId, judgeModel, rounds });
    const supabase = await createSupabaseServiceClient();

    // Fetch active entries
    const { data: entries, error: entriesError } = await supabase
      .from('article_bank_entries')
      .select('id, content, total_cost_usd')
      .eq('topic_id', vTopicId)
      .is('deleted_at', null);

    if (entriesError) throw new Error(`Failed to fetch entries: ${entriesError.message}`);
    if (!entries || entries.length < 2) {
      return { success: true, data: { comparisons_run: 0, entries_updated: 0 }, error: null };
    }

    // Fetch current Elo state
    const { data: eloRows } = await supabase
      .from('article_bank_elo')
      .select('entry_id, elo_rating, match_count')
      .eq('topic_id', vTopicId);

    const eloMap = new Map<string, { rating: number; matchCount: number }>();
    for (const row of eloRows ?? []) {
      eloMap.set(row.entry_id, { rating: row.elo_rating, matchCount: row.match_count });
    }

    // Initialize missing Elo entries
    for (const entry of entries) {
      if (!eloMap.has(entry.id)) {
        eloMap.set(entry.id, { rating: INITIAL_ELO, matchCount: 0 });
      }
    }

    // Build callLLM wrapper for comparison
    const callLLM = async (prompt: string): Promise<string> => {
      return callLLMModel(prompt, 'bank_comparison', adminUserId, vJudgeModel, false, null);
    };

    // Comparison cache for this run
    const cache = new Map<string, ComparisonResult>();
    let comparisonsRun = 0;

    // Swiss-style pairing: sort by Elo, pair adjacent entries. O(N/2) per round
    // instead of all-pairs O(N²). With small entry counts this falls back gracefully.
    // vRounds already clamped 1-10 by schema
    const effectiveRounds = vRounds;
    const comparedPairs = new Set<string>();

    for (let round = 0; round < effectiveRounds; round++) {
      // Sort entries by current Elo (descending) for Swiss pairing
      const sorted = [...entries].sort((a, b) => {
        const eloA = eloMap.get(a.id)?.rating ?? INITIAL_ELO;
        const eloB = eloMap.get(b.id)?.rating ?? INITIAL_ELO;
        return eloB - eloA;
      });

      // Build pairs: match adjacent entries, skip already-compared pairs
      const pairs: [typeof entries[0], typeof entries[0]][] = [];
      const used = new Set<number>();
      for (let i = 0; i < sorted.length; i++) {
        if (used.has(i)) continue;
        for (let j = i + 1; j < sorted.length; j++) {
          if (used.has(j)) continue;
          const pairKey = [sorted[i].id, sorted[j].id].sort().join(':');
          if (!comparedPairs.has(pairKey)) {
            pairs.push([sorted[i], sorted[j]]);
            comparedPairs.add(pairKey);
            used.add(i);
            used.add(j);
            break;
          }
        }
      }

      // If no new pairs found (all compared), fall back to re-matching adjacent
      if (pairs.length === 0 && sorted.length >= 2) {
        for (let i = 0; i + 1 < sorted.length; i += 2) {
          pairs.push([sorted[i], sorted[i + 1]]);
        }
      }

      for (const [entryA, entryB] of pairs) {
        const result = await compareWithBiasMitigation(
          entryA.content, entryB.content, callLLM, cache,
        );

        // Map result to winner entry ID
        let winnerId: string | null = null;
        if (result.winner === 'A') winnerId = entryA.id;
        else if (result.winner === 'B') winnerId = entryB.id;
        // TIE: winnerId stays null

        // Insert comparison record
        await supabase.from('article_bank_comparisons').insert({
          topic_id: vTopicId,
          entry_a_id: entryA.id,
          entry_b_id: entryB.id,
          winner_id: winnerId,
          confidence: result.confidence,
          judge_model: vJudgeModel,
          dimension_scores: null,
        });

        // Update Elo ratings in memory
        const eloA = eloMap.get(entryA.id)!;
        const eloB = eloMap.get(entryB.id)!;

        let scoreA: number;
        if (result.winner === 'A') scoreA = 0.5 + 0.5 * result.confidence;
        else if (result.winner === 'B') scoreA = 0.5 - 0.5 * result.confidence;
        else scoreA = 0.5; // TIE

        const [newRatingA, newRatingB] = computeEloUpdate(
          eloA.rating, eloB.rating, scoreA,
        );

        eloA.rating = newRatingA;
        eloA.matchCount += 1;
        eloB.rating = newRatingB;
        eloB.matchCount += 1;

        comparisonsRun++;
      }
    } // end rounds loop

    // Persist updated Elo ratings
    const costMap = new Map(entries.map((e) => [e.id, e.total_cost_usd]));

    for (const [entryId, elo] of eloMap) {
      const cost = costMap.get(entryId) ?? null;
      await supabase
        .from('article_bank_elo')
        .upsert({
          topic_id: vTopicId,
          entry_id: entryId,
          elo_rating: Math.round(elo.rating * 100) / 100,
          elo_per_dollar: computeEloPerDollar(elo.rating, cost),
          match_count: elo.matchCount,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'topic_id,entry_id' });
    }

    return {
      success: true,
      data: { comparisons_run: comparisonsRun, entries_updated: eloMap.size },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'runBankComparisonAction') };
  }
}, 'runBankComparisonAction');

export const runBankComparisonAction = serverReadRequestId(_runBankComparisonAction);

/** Aggregate stats across all topics by generation method. */
const _getCrossTopicSummaryAction = withLogging(async (): Promise<ActionResult<CrossTopicMethodSummary[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    // Fetch all active entries with their Elo
    const { data: entries, error: entriesError } = await supabase
      .from('article_bank_entries')
      .select('id, topic_id, generation_method, total_cost_usd')
      .is('deleted_at', null);

    if (entriesError) throw new Error(`Failed to fetch entries: ${entriesError.message}`);
    if (!entries || entries.length === 0) return { success: true, data: [], error: null };

    const entryIds = entries.map((e) => e.id);
    const { data: eloRows, error: eloError } = await supabase
      .from('article_bank_elo')
      .select('entry_id, elo_rating, elo_per_dollar')
      .in('entry_id', entryIds);

    if (eloError) throw new Error(`Failed to fetch Elo data: ${eloError.message}`);

    const eloMap = new Map((eloRows ?? []).map((r) => [r.entry_id, r]));

    // Find best method per topic (highest Elo)
    const topicBest = new Map<string, { method: BankGenerationMethod; elo: number }>();
    for (const entry of entries) {
      const elo = eloMap.get(entry.id);
      if (!elo) continue;
      const current = topicBest.get(entry.topic_id);
      if (!current || elo.elo_rating > current.elo) {
        topicBest.set(entry.topic_id, { method: entry.generation_method, elo: elo.elo_rating });
      }
    }
    const totalTopics = topicBest.size;

    // Aggregate by method
    const methodStats = new Map<BankGenerationMethod, {
      eloSum: number; costSum: number; epdSum: number;
      count: number; costCount: number; epdCount: number; wins: number;
    }>();

    for (const entry of entries) {
      const elo = eloMap.get(entry.id);
      if (!elo) continue;

      const stats = methodStats.get(entry.generation_method) ?? {
        eloSum: 0, costSum: 0, epdSum: 0,
        count: 0, costCount: 0, epdCount: 0, wins: 0,
      };

      stats.eloSum += elo.elo_rating;
      stats.count += 1;
      if (entry.total_cost_usd !== null) {
        stats.costSum += entry.total_cost_usd;
        stats.costCount += 1;
      }
      if (elo.elo_per_dollar !== null) {
        stats.epdSum += elo.elo_per_dollar;
        stats.epdCount += 1;
      }

      methodStats.set(entry.generation_method, stats);
    }

    // Count wins per method
    for (const best of topicBest.values()) {
      const stats = methodStats.get(best.method);
      if (stats) stats.wins += 1;
    }

    const summary: CrossTopicMethodSummary[] = [];
    for (const [method, stats] of methodStats) {
      summary.push({
        generation_method: method,
        avg_elo: stats.count > 0 ? Math.round((stats.eloSum / stats.count) * 100) / 100 : 0,
        avg_cost: stats.costCount > 0 ? Math.round((stats.costSum / stats.costCount) * 1e6) / 1e6 : null,
        avg_elo_per_dollar: stats.epdCount > 0 ? Math.round((stats.epdSum / stats.epdCount) * 100) / 100 : null,
        win_rate: totalTopics > 0 ? Math.round((stats.wins / totalTopics) * 1000) / 1000 : 0,
        entry_count: stats.count,
      });
    }

    return { success: true, data: summary, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getCrossTopicSummaryAction') };
  }
}, 'getCrossTopicSummaryAction');

export const getCrossTopicSummaryAction = serverReadRequestId(_getCrossTopicSummaryAction);

/** Soft-delete an entry and hard-delete its comparisons/Elo rows. */
const _deleteBankEntryAction = withLogging(async (
  entryId: string,
): Promise<ActionResult<{ deleted: boolean }>> => {
  try {
    await requireAdmin();
    validateUuid(entryId, 'entry ID');
    const supabase = await createSupabaseServiceClient();

    // Soft-delete the entry
    const { error: softError } = await supabase
      .from('article_bank_entries')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', entryId);

    if (softError) throw new Error(`Failed to soft-delete entry: ${softError.message}`);

    // Hard-delete comparisons involving this entry
    await supabase
      .from('article_bank_comparisons')
      .delete()
      .or(`entry_a_id.eq.${entryId},entry_b_id.eq.${entryId}`);

    // Hard-delete Elo row for this entry
    await supabase
      .from('article_bank_elo')
      .delete()
      .eq('entry_id', entryId);

    return { success: true, data: { deleted: true }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'deleteBankEntryAction') };
  }
}, 'deleteBankEntryAction');

export const deleteBankEntryAction = serverReadRequestId(_deleteBankEntryAction);

/** Soft-delete a topic, hard-delete comparisons/Elo, soft-delete all entries. */
const _deleteBankTopicAction = withLogging(async (
  topicId: string,
): Promise<ActionResult<{ deleted: boolean }>> => {
  try {
    await requireAdmin();
    validateUuid(topicId, 'topic ID');
    const supabase = await createSupabaseServiceClient();

    // Soft-delete the topic
    const { error: topicError } = await supabase
      .from('article_bank_topics')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', topicId);

    if (topicError) throw new Error(`Failed to soft-delete topic: ${topicError.message}`);

    // Hard-delete all comparisons for this topic
    await supabase
      .from('article_bank_comparisons')
      .delete()
      .eq('topic_id', topicId);

    // Hard-delete all Elo rows for this topic
    await supabase
      .from('article_bank_elo')
      .delete()
      .eq('topic_id', topicId);

    // Soft-delete all entries for this topic
    await supabase
      .from('article_bank_entries')
      .update({ deleted_at: new Date().toISOString() })
      .eq('topic_id', topicId);

    return { success: true, data: { deleted: true }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'deleteBankTopicAction') };
  }
}, 'deleteBankTopicAction');

export const deleteBankTopicAction = serverReadRequestId(_deleteBankTopicAction);

// ─── Generate and add to bank ──────────────────────────────────

export interface GenerateAndAddInput {
  prompt: string;
  model: AllowedLLMModelType;
}

/** Generate a new article via LLM and add it to the bank as a 1-shot entry. */
const _generateAndAddToBankAction = withLogging(async (
  input: GenerateAndAddInput,
): Promise<ActionResult<{ topic_id: string; entry_id: string; title: string; content: string }>> => {
  try {
    const adminUserId = await requireAdmin();
    const validated = generateAndAddInputSchema.parse(input);

    // Accumulate cost from both LLM calls via onUsage callbacks
    let totalCostUsd = 0;
    const onUsage = (usage: LLMUsageMetadata) => { totalCostUsd += usage.estimatedCostUsd; };

    // Step 1: Generate title
    const titlePrompt = createTitlePrompt(validated.prompt);
    const titleResponse = await callLLMModel(
      titlePrompt, 'bank_generate_title', adminUserId, validated.model, false, null,
      null, null, true, { onUsage },
    );

    let title: string;
    try {
      const parsed = titleQuerySchema.parse(JSON.parse(titleResponse));
      title = parsed.title1;
    } catch {
      title = titleResponse.replace(/["\n]/g, '').trim().slice(0, 200);
    }

    // Step 2: Generate article content
    const explanationPrompt = createExplanationPrompt(title, []);
    const content = await callLLMModel(
      explanationPrompt, 'bank_generate_article', adminUserId, validated.model, false, null,
      null, null, true, { onUsage },
    );

    if (!content || content.trim().length === 0) {
      throw new Error('LLM returned empty content');
    }

    // Step 3: Add to bank
    const supabase = await createSupabaseServiceClient();
    const topicId = await upsertTopicByPrompt(supabase, validated.prompt.trim(), title);

    // Insert entry
    const { data: entry, error: entryError } = await supabase
      .from('article_bank_entries')
      .insert({
        topic_id: topicId,
        content,
        generation_method: 'oneshot',
        model: validated.model,
        total_cost_usd: totalCostUsd > 0 ? totalCostUsd : null,
        metadata: { call_source: `oneshot_${validated.model}`, generated_title: title },
      })
      .select('id')
      .single();

    if (entryError || !entry) throw new Error(`Failed to insert entry: ${entryError?.message}`);

    // Initialize Elo
    const entryCost = totalCostUsd > 0 ? totalCostUsd : null;
    await supabase.from('article_bank_elo').insert({
      topic_id: topicId,
      entry_id: entry.id,
      elo_rating: INITIAL_ELO,
      elo_per_dollar: computeEloPerDollar(INITIAL_ELO, entryCost),
      match_count: 0,
    });

    return { success: true, data: { topic_id: topicId, entry_id: entry.id, title, content }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'generateAndAddToBankAction') };
  }
}, 'generateAndAddToBankAction');

export const generateAndAddToBankAction = serverReadRequestId(_generateAndAddToBankAction);

// ─── Topic list with aggregated stats ────────────────────────────

export interface BankTopicWithStats extends BankTopic {
  entry_count: number;
  elo_min: number | null;
  elo_max: number | null;
  total_cost: number | null;
  best_method: BankGenerationMethod | null;
}

/** List all active topics with aggregated entry/Elo stats. */
const _getBankTopicsAction = withLogging(async (): Promise<ActionResult<BankTopicWithStats[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: topics, error: topicsError } = await supabase
      .from('article_bank_topics')
      .select('id, prompt, title, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (topicsError) throw new Error(`Failed to fetch topics: ${topicsError.message}`);
    if (!topics || topics.length === 0) return { success: true, data: [], error: null };

    const topicIds = topics.map((t) => t.id);

    // Fetch entries for counts and costs
    const { data: entries } = await supabase
      .from('article_bank_entries')
      .select('id, topic_id, generation_method, total_cost_usd')
      .in('topic_id', topicIds)
      .is('deleted_at', null);

    // Fetch Elo data for ranges
    const { data: eloRows } = await supabase
      .from('article_bank_elo')
      .select('topic_id, entry_id, elo_rating')
      .in('topic_id', topicIds);

    // Build lookup maps
    const entryMap = new Map<string, typeof entries>();
    for (const entry of entries ?? []) {
      const list = entryMap.get(entry.topic_id) ?? [];
      list.push(entry);
      entryMap.set(entry.topic_id, list);
    }

    const eloByTopic = new Map<string, { entry_id: string; elo_rating: number; generation_method?: string }[]>();
    for (const row of eloRows ?? []) {
      const list = eloByTopic.get(row.topic_id) ?? [];
      list.push(row);
      eloByTopic.set(row.topic_id, list);
    }

    // Build entry method lookup for best method
    const entryMethodMap = new Map<string, BankGenerationMethod>();
    for (const entry of entries ?? []) {
      entryMethodMap.set(entry.id, entry.generation_method);
    }

    const result: BankTopicWithStats[] = topics.map((topic) => {
      const topicEntries = entryMap.get(topic.id) ?? [];
      const topicElos = eloByTopic.get(topic.id) ?? [];
      const eloValues = topicElos.map((e) => e.elo_rating);

      // Best method = method of highest Elo entry
      let bestMethod: BankGenerationMethod | null = null;
      if (topicElos.length > 0) {
        const bestElo = topicElos.reduce((a, b) => a.elo_rating > b.elo_rating ? a : b);
        bestMethod = entryMethodMap.get(bestElo.entry_id) ?? null;
      }

      const totalCost = topicEntries.reduce((sum, e) => sum + (e.total_cost_usd ?? 0), 0);

      return {
        ...topic,
        entry_count: topicEntries.length,
        elo_min: eloValues.length > 0 ? Math.min(...eloValues) : null,
        elo_max: eloValues.length > 0 ? Math.max(...eloValues) : null,
        total_cost: topicEntries.length > 0 ? totalCost : null,
        best_method: bestMethod,
      };
    });

    return { success: true, data: result, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getBankTopicsAction') };
  }
}, 'getBankTopicsAction');

export const getBankTopicsAction = serverReadRequestId(_getBankTopicsAction);

/** Get match history (comparisons) for a topic. */
const _getBankMatchHistoryAction = withLogging(async (
  topicId: string,
): Promise<ActionResult<BankComparison[]>> => {
  try {
    await requireAdmin();
    validateUuid(topicId, 'topic ID');
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('article_bank_comparisons')
      .select('*')
      .eq('topic_id', topicId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch comparisons: ${error.message}`);
    return { success: true, data: data ?? [], error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getBankMatchHistoryAction') };
  }
}, 'getBankMatchHistoryAction');

export const getBankMatchHistoryAction = serverReadRequestId(_getBankMatchHistoryAction);

// ─── Prompt Bank Coverage + Method Summary ──────────────────────

import { PROMPT_BANK, type MethodConfig } from '@/config/promptBankConfig';

export interface PromptBankCoverageCell {
  exists: boolean;
  entryId?: string;
  elo?: number;
  costUsd?: number;
  matchCount?: number;
}

export interface PromptBankCoverageRow {
  prompt: string;
  difficulty: string;
  domain: string;
  topicId: string | null;
  entryCount: number;
  methods: Record<string, PromptBankCoverageCell>;
}

/** Get coverage matrix showing which prompt × method combinations exist. */
const _getPromptBankCoverageAction = withLogging(async (): Promise<ActionResult<PromptBankCoverageRow[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const allLabels = expandMethodLabels(PROMPT_BANK.methods);
    const rows: PromptBankCoverageRow[] = [];

    for (const p of PROMPT_BANK.prompts) {
      const normalizedPrompt = p.prompt.trim().toLowerCase();

      const { data: topic } = await supabase
        .from('article_bank_topics')
        .select('id')
        .ilike('prompt', normalizedPrompt)
        .is('deleted_at', null)
        .single();

      const methodCoverage: Record<string, PromptBankCoverageCell> = {};
      for (const label of allLabels) {
        methodCoverage[label] = { exists: false };
      }

      let entryCount = 0;

      if (topic) {
        const { data: entries } = await supabase
          .from('article_bank_entries')
          .select('id, generation_method, model, metadata')
          .eq('topic_id', topic.id)
          .is('deleted_at', null);

        const { data: eloRows } = await supabase
          .from('article_bank_elo')
          .select('entry_id, elo_rating, match_count')
          .eq('topic_id', topic.id);

        const eloMap = new Map((eloRows ?? []).map((r) => [r.entry_id, r]));
        entryCount = entries?.length ?? 0;

        for (const entry of entries ?? []) {
          const elo = eloMap.get(entry.id);
          for (const m of PROMPT_BANK.methods) {
            if (m.type === 'oneshot' && entry.generation_method === 'oneshot' && entry.model === m.model) {
              methodCoverage[m.label] = {
                exists: true,
                entryId: entry.id,
                elo: elo?.elo_rating,
                matchCount: elo?.match_count ?? 0,
              };
            } else if (m.type === 'evolution' && entry.generation_method === 'evolution_winner') {
              const meta = entry.metadata as Record<string, unknown> | null;
              const iterations = meta?.iterations;
              if (typeof iterations === 'number' && m.checkpoints.includes(iterations)) {
                const label = `${m.label}_${iterations}iter`;
                methodCoverage[label] = {
                  exists: true,
                  entryId: entry.id,
                  elo: elo?.elo_rating,
                  matchCount: elo?.match_count ?? 0,
                };
              }
            }
          }
        }
      }

      rows.push({
        prompt: p.prompt,
        difficulty: p.difficulty,
        domain: p.domain,
        topicId: topic?.id ?? null,
        entryCount,
        methods: methodCoverage,
      });
    }

    return { success: true, data: rows, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getPromptBankCoverageAction') };
  }
}, 'getPromptBankCoverageAction');

export const getPromptBankCoverageAction = serverReadRequestId(_getPromptBankCoverageAction);

export interface PromptBankMethodSummary {
  label: string;
  type: 'oneshot' | 'evolution';
  avgElo: number;
  avgCostUsd: number;
  avgEloPerDollar: number | null;
  winCount: number;
  winRate: number;
  entryCount: number;
}

/** Compute per-method-label stats across all prompt bank topics. */
const _getPromptBankMethodSummaryAction = withLogging(async (): Promise<ActionResult<PromptBankMethodSummary[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    // Fetch all prompt bank topics
    const topicIds: string[] = [];
    const topicMap = new Map<string, string>(); // topicId → prompt

    for (const p of PROMPT_BANK.prompts) {
      const { data: topic } = await supabase
        .from('article_bank_topics')
        .select('id')
        .ilike('prompt', p.prompt.trim().toLowerCase())
        .is('deleted_at', null)
        .single();

      if (topic) {
        topicIds.push(topic.id);
        topicMap.set(topic.id, p.prompt);
      }
    }

    if (topicIds.length === 0) return { success: true, data: [], error: null };

    // Fetch entries + Elo for all prompt bank topics
    const { data: entries } = await supabase
      .from('article_bank_entries')
      .select('id, topic_id, generation_method, model, total_cost_usd, metadata')
      .in('topic_id', topicIds)
      .is('deleted_at', null);

    if (!entries || entries.length === 0) return { success: true, data: [], error: null };

    const entryIds = entries.map((e) => e.id);
    const { data: eloRows } = await supabase
      .from('article_bank_elo')
      .select('entry_id, elo_rating, elo_per_dollar, match_count')
      .in('entry_id', entryIds);

    const eloMap = new Map((eloRows ?? []).map((r) => [r.entry_id, r]));

    // Build per-label stats
    const allLabels = expandMethodLabels(PROMPT_BANK.methods);
    const labelType = new Map<string, 'oneshot' | 'evolution'>();
    for (const m of PROMPT_BANK.methods) {
      if (m.type === 'oneshot') {
        labelType.set(m.label, 'oneshot');
      } else {
        for (const cp of m.checkpoints) {
          labelType.set(`${m.label}_${cp}iter`, 'evolution');
        }
      }
    }

    const stats = new Map<string, {
      elos: number[]; costs: number[]; epds: number[]; topicWins: Map<string, number>;
    }>();

    for (const label of allLabels) {
      stats.set(label, { elos: [], costs: [], epds: [], topicWins: new Map() });
    }

    // Find best entry per topic (for win tracking)
    const topicBest = new Map<string, { label: string; elo: number }>();

    for (const entry of entries) {
      const elo = eloMap.get(entry.id);
      if (!elo) continue;

      // Match entry to a method label
      const matchedLabel = matchEntryToLabel(entry, PROMPT_BANK.methods);
      if (!matchedLabel) continue;

      const s = stats.get(matchedLabel);
      if (!s) continue;

      // Only count entries with matches for Elo average (exclude default 1200)
      if (elo.match_count > 0) {
        s.elos.push(elo.elo_rating);
      }

      if (entry.total_cost_usd !== null && entry.total_cost_usd > 0) {
        s.costs.push(entry.total_cost_usd);
      }

      if (elo.elo_per_dollar !== null) {
        s.epds.push(elo.elo_per_dollar);
      }

      // Track topic-level wins
      const current = topicBest.get(entry.topic_id);
      if (!current || elo.elo_rating > current.elo) {
        topicBest.set(entry.topic_id, { label: matchedLabel, elo: elo.elo_rating });
      }
    }

    // Count wins
    const topicsWithComparisons = new Set<string>();
    for (const entry of entries) {
      const elo = eloMap.get(entry.id);
      if (elo && elo.match_count > 0) {
        topicsWithComparisons.add(entry.topic_id);
      }
    }

    const winCounts = new Map<string, number>();
    for (const best of topicBest.values()) {
      winCounts.set(best.label, (winCounts.get(best.label) ?? 0) + 1);
    }

    const totalTopicsWithComparisons = topicsWithComparisons.size;

    // Build summary
    const summary: PromptBankMethodSummary[] = allLabels.map((label) => {
      const s = stats.get(label)!;
      const wins = winCounts.get(label) ?? 0;
      return {
        label,
        type: labelType.get(label) ?? 'oneshot',
        avgElo: s.elos.length > 0 ? Math.round((s.elos.reduce((a, b) => a + b, 0) / s.elos.length) * 100) / 100 : 0,
        avgCostUsd: s.costs.length > 0 ? Math.round((s.costs.reduce((a, b) => a + b, 0) / s.costs.length) * 1e6) / 1e6 : 0,
        avgEloPerDollar: s.epds.length > 0 ? Math.round((s.epds.reduce((a, b) => a + b, 0) / s.epds.length) * 100) / 100 : null,
        winCount: wins,
        winRate: totalTopicsWithComparisons > 0 ? Math.round((wins / totalTopicsWithComparisons) * 1000) / 1000 : 0,
        entryCount: s.elos.length + (s.elos.length === 0 ? countUncomparedEntries(entries, eloMap, label, PROMPT_BANK.methods) : 0),
      };
    }).sort((a, b) => b.avgElo - a.avgElo);

    return { success: true, data: summary, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getPromptBankMethodSummaryAction') };
  }
}, 'getPromptBankMethodSummaryAction');

export const getPromptBankMethodSummaryAction = serverReadRequestId(_getPromptBankMethodSummaryAction);

// ─── Helpers for prompt bank actions ────────────────────────────

function expandMethodLabels(methods: MethodConfig[]): string[] {
  const labels: string[] = [];
  for (const m of methods) {
    if (m.type === 'oneshot') {
      labels.push(m.label);
    } else {
      for (const cp of m.checkpoints) {
        labels.push(`${m.label}_${cp}iter`);
      }
    }
  }
  return labels;
}

function matchEntryToLabel(
  entry: { generation_method: string; model: string; metadata: unknown },
  methods: MethodConfig[],
): string | null {
  for (const m of methods) {
    if (m.type === 'oneshot' && entry.generation_method === 'oneshot' && entry.model === m.model) {
      return m.label;
    }
    if (m.type === 'evolution' && entry.generation_method === 'evolution_winner') {
      const meta = entry.metadata as Record<string, unknown> | null;
      const iterations = meta?.iterations;
      if (typeof iterations === 'number' && m.checkpoints.includes(iterations)) {
        return `${m.label}_${iterations}iter`;
      }
    }
  }
  return null;
}

function countUncomparedEntries(
  entries: Array<{ id: string; generation_method: string; model: string; metadata: unknown }>,
  eloMap: Map<string, { match_count: number }>,
  label: string,
  methods: MethodConfig[],
): number {
  return entries.filter((entry) => {
    const matched = matchEntryToLabel(entry, methods);
    if (matched !== label) return false;
    const elo = eloMap.get(entry.id);
    return !elo || elo.match_count === 0;
  }).length;
}
