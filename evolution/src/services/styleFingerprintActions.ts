// Style fingerprint registry server actions: CRUD + article-set ops + recompute +
// validateStyleFingerprintId. A style fingerprint is a DB-first user-authored entity
// (mirrors criteriaActions) computed over a SET of articles and injected into generation +
// judging. Soft-delete via deleted_at.
//
// Recompute consistency (Supabase JS has no multi-statement tx): COMPUTE FIRST, PERSIST LAST.
// Set-mutating ops resolve the resulting article set in memory, run extraction, and only
// persist the junction change + fingerprint fields together on success; on extraction failure
// nothing is persisted, so the set and fingerprint never diverge.
//
// Extraction runs at CRUD time (no run), so it uses callLLM (the standalone path runJudgeEval
// uses) — NOT createEvolutionLLMClient.complete. Cost is accumulated into the fingerprint-level
// total_extraction_cost metric via writeMetricMax (read-add-max ⇒ a true running total).

'use server';

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminAction, type AdminContext } from './adminAction';
import { validateUuid, applyTestContentColumnFilter } from './shared';
import { callLLM, DEFAULT_MODEL, type LLMUsageMetadata } from '@/lib/services/llms';
import { extractStyleFingerprint } from '@evolution/lib/pipeline/setup/extractStyleFingerprint';
import { renderFingerprintProse } from '@evolution/lib/pipeline/setup/renderFingerprintProse';
import { writeMetricMax } from '@evolution/lib/metrics/writeMetrics';
import {
  evolutionStyleFingerprintFullDbSchema,
  evolutionStyleFingerprintArticleSchema,
  addStyleFingerprintArticleInputSchema,
  type EvolutionStyleFingerprintFullDb,
  type EvolutionStyleFingerprintArticle,
  type StyleFingerprintTraits,
} from '@evolution/lib/schemas';

export type StyleFingerprintListItem = EvolutionStyleFingerprintFullDb;

export interface StyleFingerprintDetail {
  fingerprint: EvolutionStyleFingerprintFullDb;
  articles: EvolutionStyleFingerprintArticle[];
}

const TABLE = 'evolution_style_fingerprints';
const ARTICLES_TABLE = 'evolution_style_fingerprint_articles';

const createSchema = z.object({
  name: z.string().trim().min(1).max(128).regex(/^[A-Za-z][a-zA-Z0-9_-]*$/),
  description: z.string().trim().max(2000).nullable().optional(),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  description: z.string().trim().max(2000).nullable().optional(),
});

// ─── internal: article-set resolution + recompute ──────────────────────────

/** Resolve a junction row's source to its article text (explanation content or pasted text). */
async function resolveArticleText(
  supabase: SupabaseClient,
  row: { explanation_id: number | null; article_text: string | null },
): Promise<string | null> {
  if (row.article_text != null) return row.article_text;
  if (row.explanation_id != null) {
    const { data } = await supabase.from('explanations').select('content').eq('id', row.explanation_id).single();
    return (data?.content as string | undefined) ?? null;
  }
  return null;
}

/** Load the ordered article set (raw junction rows) for a fingerprint. */
async function loadArticleRows(
  supabase: SupabaseClient,
  fingerprintId: string,
): Promise<EvolutionStyleFingerprintArticle[]> {
  const { data, error } = await supabase
    .from(ARTICLES_TABLE)
    .select('*')
    .eq('fingerprint_id', fingerprintId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => evolutionStyleFingerprintArticleSchema.parse(r));
}

/** Run extraction over a set of article texts via callLLM, accumulating cost. */
async function extractWithCallLLM(
  texts: string[],
  userId: string,
): Promise<{ traits: StyleFingerprintTraits; costUsd: number }> {
  let costUsd = 0;
  const callFn = async (prompt: string): Promise<string> =>
    callLLM(prompt, 'style_extraction', userId, DEFAULT_MODEL, false, null, null, null, false, {
      onUsage: (u: LLMUsageMetadata) => { costUsd += u.estimatedCostUsd; },
    });
  const traits = await extractStyleFingerprint(texts, callFn);
  return { traits, costUsd };
}

/** Accumulate extraction cost into the fingerprint-level total_extraction_cost metric.
 *  Read current total + add ⇒ writeMetricMax(GREATEST) yields a true running total. */
async function accumulateExtractionCost(
  supabase: SupabaseClient,
  fingerprintId: string,
  costUsd: number,
): Promise<void> {
  if (costUsd <= 0) return;
  const { data } = await supabase
    .from('evolution_metrics')
    .select('value')
    .eq('entity_type', 'style_fingerprint')
    .eq('entity_id', fingerprintId)
    .eq('metric_name', 'total_extraction_cost')
    .maybeSingle();
  const prior = typeof data?.value === 'number' ? data.value : 0;
  await writeMetricMax(supabase, 'style_fingerprint', fingerprintId, 'total_extraction_cost', prior + costUsd, 'during_execution');
}

/** Persist computed traits + prose + count onto the fingerprint row. */
async function persistFingerprint(
  supabase: SupabaseClient,
  fingerprintId: string,
  traits: StyleFingerprintTraits | null,
  articleCount: number,
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({
      fingerprint: traits,
      fingerprint_prose: traits ? renderFingerprintProse(traits, 'article') : null,
      article_count: articleCount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', fingerprintId);
  if (error) throw error;
}

// ─── List / Detail ──────────────────────────────────────────────────────────

export const listStyleFingerprintsAction = adminAction(
  'listStyleFingerprints',
  async (
    input: { limit?: number; offset?: number; status?: string; filterTestContent?: boolean; name?: string },
    ctx: AdminContext,
  ): Promise<{ items: StyleFingerprintListItem[]; total: number }> => {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
    const offset = Math.max(input.offset ?? 0, 0);

    let query = ctx.supabase.from(TABLE).select('*', { count: 'exact' }).is('deleted_at', null);
    if (input.status) query = query.eq('status', input.status);
    if (input.filterTestContent) query = applyTestContentColumnFilter(query);
    if (input.name) {
      const escaped = input.name.replace(/[%_\\]/g, '\\$&');
      query = query.ilike('name', `%${escaped}%`);
    }
    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    return { items: (data ?? []) as StyleFingerprintListItem[], total: count ?? 0 };
  },
);

export const getStyleFingerprintDetailAction = adminAction(
  'getStyleFingerprintDetail',
  async (fingerprintId: string, ctx: AdminContext): Promise<StyleFingerprintDetail> => {
    if (!validateUuid(fingerprintId)) throw new Error('Invalid fingerprintId');
    const { data, error } = await ctx.supabase
      .from(TABLE).select('*').eq('id', fingerprintId).is('deleted_at', null).single();
    if (error) throw error;
    const articles = await loadArticleRows(ctx.supabase, fingerprintId);
    return { fingerprint: evolutionStyleFingerprintFullDbSchema.parse(data), articles };
  },
);

// ─── Create / Update / Archive / Delete ──────────────────────────────────────

export const createStyleFingerprintAction = adminAction(
  'createStyleFingerprint',
  async (input: z.input<typeof createSchema>, ctx: AdminContext): Promise<StyleFingerprintListItem> => {
    const parsed = createSchema.parse(input);
    // Created with an empty set: no extraction yet (articles are added on the detail page).
    const { data, error } = await ctx.supabase
      .from(TABLE)
      .insert({ name: parsed.name, description: parsed.description ?? null, article_count: 0 })
      .select().single();
    if (error) throw error;
    return data as StyleFingerprintListItem;
  },
);

export const updateStyleFingerprintAction = adminAction(
  'updateStyleFingerprint',
  async (input: z.input<typeof updateSchema>, ctx: AdminContext): Promise<StyleFingerprintListItem> => {
    const parsed = updateSchema.parse(input);
    if (!validateUuid(parsed.id)) throw new Error('Invalid fingerprintId');
    const { data, error } = await ctx.supabase
      .from(TABLE)
      .update({ description: parsed.description ?? null, updated_at: new Date().toISOString() })
      .eq('id', parsed.id).is('deleted_at', null).select().single();
    if (error) throw error;
    return data as StyleFingerprintListItem;
  },
);

export const archiveStyleFingerprintAction = adminAction(
  'archiveStyleFingerprint',
  async (fingerprintId: string, ctx: AdminContext): Promise<void> => {
    if (!validateUuid(fingerprintId)) throw new Error('Invalid fingerprintId');
    const { error } = await ctx.supabase
      .from(TABLE)
      .update({ status: 'archived', archived_at: new Date().toISOString() })
      .eq('id', fingerprintId);
    if (error) throw error;
  },
);

export const deleteStyleFingerprintAction = adminAction(
  'deleteStyleFingerprint',
  async (fingerprintId: string, ctx: AdminContext): Promise<void> => {
    if (!validateUuid(fingerprintId)) throw new Error('Invalid fingerprintId');
    // Soft-delete (never hard-delete — would cascade the article junction + orphan run snapshots).
    const { error } = await ctx.supabase
      .from(TABLE).update({ deleted_at: new Date().toISOString() }).eq('id', fingerprintId);
    if (error) throw error;
  },
);

// ─── Article-set ops (compute-first / persist-last) ──────────────────────────

export const addArticleToFingerprintAction = adminAction(
  'addArticleToFingerprint',
  async (input: z.input<typeof addStyleFingerprintArticleInputSchema>, ctx: AdminContext): Promise<void> => {
    const parsed = addStyleFingerprintArticleInputSchema.parse(input);
    if (!validateUuid(parsed.fingerprintId)) throw new Error('Invalid fingerprintId');

    // Resolve the new article's text.
    const newText = await resolveArticleText(ctx.supabase, {
      explanation_id: parsed.explanationId ?? null,
      article_text: parsed.articleText ?? null,
    });
    if (!newText || newText.trim().length === 0) throw new Error('article has no resolvable text');

    // COMPUTE FIRST over the resulting (persisted + new) set.
    const existing = await loadArticleRows(ctx.supabase, parsed.fingerprintId);
    const existingTexts = (await Promise.all(existing.map((r) => resolveArticleText(ctx.supabase, r))))
      .filter((t): t is string => !!t);
    const { traits, costUsd } = await extractWithCallLLM([...existingTexts, newText], ctx.adminUserId);

    // PERSIST LAST: junction row + fingerprint together (only on extraction success).
    const { error: insErr } = await ctx.supabase.from(ARTICLES_TABLE).insert({
      fingerprint_id: parsed.fingerprintId,
      explanation_id: parsed.explanationId ?? null,
      article_text: parsed.articleText ?? null,
      position: existing.length,
    });
    if (insErr) throw insErr;
    await persistFingerprint(ctx.supabase, parsed.fingerprintId, traits, existing.length + 1);
    await accumulateExtractionCost(ctx.supabase, parsed.fingerprintId, costUsd);
  },
);

export const removeArticleFromFingerprintAction = adminAction(
  'removeArticleFromFingerprint',
  async (input: { fingerprintId: string; articleId: string }, ctx: AdminContext): Promise<void> => {
    if (!validateUuid(input.fingerprintId) || !validateUuid(input.articleId)) throw new Error('Invalid id');
    const rows = await loadArticleRows(ctx.supabase, input.fingerprintId);
    const remaining = rows.filter((r) => r.id !== input.articleId);

    if (remaining.length === 0) {
      // Empty set: clear the fingerprint (no extraction).
      const { error: delErr } = await ctx.supabase.from(ARTICLES_TABLE).delete().eq('id', input.articleId);
      if (delErr) throw delErr;
      await persistFingerprint(ctx.supabase, input.fingerprintId, null, 0);
      return;
    }

    // COMPUTE FIRST over the remaining set.
    const texts = (await Promise.all(remaining.map((r) => resolveArticleText(ctx.supabase, r))))
      .filter((t): t is string => !!t);
    const { traits, costUsd } = await extractWithCallLLM(texts, ctx.adminUserId);

    // PERSIST LAST.
    const { error: delErr } = await ctx.supabase.from(ARTICLES_TABLE).delete().eq('id', input.articleId);
    if (delErr) throw delErr;
    await persistFingerprint(ctx.supabase, input.fingerprintId, traits, remaining.length);
    await accumulateExtractionCost(ctx.supabase, input.fingerprintId, costUsd);
  },
);

export const reorderFingerprintArticlesAction = adminAction(
  'reorderFingerprintArticles',
  async (input: { fingerprintId: string; orderedArticleIds: string[] }, ctx: AdminContext): Promise<void> => {
    if (!validateUuid(input.fingerprintId)) throw new Error('Invalid fingerprintId');
    // Reorder is position-only — no LLM call (the rendered prose does not depend on order).
    for (let i = 0; i < input.orderedArticleIds.length; i++) {
      const id = input.orderedArticleIds[i];
      if (!id || !validateUuid(id)) throw new Error('Invalid articleId');
      const { error } = await ctx.supabase
        .from(ARTICLES_TABLE).update({ position: i }).eq('id', id).eq('fingerprint_id', input.fingerprintId);
      if (error) throw error;
    }
  },
);

export const reExtractFingerprintAction = adminAction(
  'reExtractFingerprint',
  async (fingerprintId: string, ctx: AdminContext): Promise<void> => {
    if (!validateUuid(fingerprintId)) throw new Error('Invalid fingerprintId');
    const rows = await loadArticleRows(ctx.supabase, fingerprintId);
    if (rows.length === 0) {
      await persistFingerprint(ctx.supabase, fingerprintId, null, 0);
      return;
    }
    const texts = (await Promise.all(rows.map((r) => resolveArticleText(ctx.supabase, r))))
      .filter((t): t is string => !!t);
    const { traits, costUsd } = await extractWithCallLLM(texts, ctx.adminUserId);
    await persistFingerprint(ctx.supabase, fingerprintId, traits, rows.length);
    await accumulateExtractionCost(ctx.supabase, fingerprintId, costUsd);
  },
);

// ─── validation helper (for strategy config — Phase 6) ───────────────────────

/** Throws if the fingerprint id does not reference a live (non-deleted) fingerprint. */
export async function validateStyleFingerprintId(id: string, supabase: SupabaseClient): Promise<void> {
  if (!validateUuid(id)) throw new Error(`Invalid styleFingerprintId: ${id}`);
  const { data, error } = await supabase
    .from(TABLE).select('id').eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`styleFingerprintId ${id} does not reference a live style fingerprint`);
}
