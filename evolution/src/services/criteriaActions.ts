// Criteria registry server actions: CRUD + getCriteriaForEvaluation +
// getCriteriaVariantsAction + getCriteriaRunsAction + validateCriteriaIds.
// User-defined evaluation criteria for the
// EvaluateCriteriaThenGenerateFromPreviousArticleAgent. DB-first (NOT
// code-first like Tactic) — soft-delete via deleted_at; rubric (optional
// JSONB array of {score, description} anchors) drives LLM evaluation prompts.

'use server';

import { z } from 'zod';
import { adminAction, type AdminContext } from './adminAction';
import { validateUuid, applyTestContentColumnFilter } from './shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityLogger } from '@evolution/lib/pipeline/infra/createEntityLogger';
import {
  evolutionCriteriaInsertSchema,
  evolutionCriteriaFullDbSchema,
  evaluationGuidanceSchema,
  type EvolutionCriteriaFullDb,
  type EvaluationGuidance,
} from '@evolution/lib/schemas';

// ─── Types ─────────────────────────────────────────────────────────

export type CriteriaListItem = EvolutionCriteriaFullDb;

export interface EvolutionCriterionRow {
  id: string;
  name: string;
  description: string | null;
  min_rating: number;
  max_rating: number;
  evaluation_guidance: EvaluationGuidance | null;
}

// ─── Schemas ───────────────────────────────────────────────────────

const createCriteriaSchema = z.object({
  name: z.string().trim().min(1).max(128).regex(/^[A-Za-z][a-zA-Z0-9_-]*$/),
  description: z.string().trim().max(2000).nullable().optional(),
  min_rating: z.number().refine(Number.isFinite),
  max_rating: z.number().refine(Number.isFinite),
  evaluation_guidance: evaluationGuidanceSchema.nullable().optional(),
}).refine(
  (c) => c.max_rating > c.min_rating,
  { message: 'max_rating must exceed min_rating', path: ['max_rating'] },
).refine(
  (c) => !c.evaluation_guidance
    || c.evaluation_guidance.every((a) => a.score >= c.min_rating && a.score <= c.max_rating),
  { message: 'every rubric anchor score must be in [min_rating, max_rating]', path: ['evaluation_guidance'] },
);

const updateCriteriaSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(128).regex(/^[A-Za-z][a-zA-Z0-9_-]*$/).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  min_rating: z.number().refine(Number.isFinite).optional(),
  max_rating: z.number().refine(Number.isFinite).optional(),
  evaluation_guidance: evaluationGuidanceSchema.nullable().optional(),
});

// ─── List + Detail ─────────────────────────────────────────────────

export const listCriteriaAction = adminAction(
  'listCriteria',
  async (
    input: { limit?: number; offset?: number; status?: string; filterTestContent?: boolean; name?: string },
    ctx: AdminContext,
  ): Promise<{ items: CriteriaListItem[]; total: number }> => {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
    const offset = Math.max(input.offset ?? 0, 0);

    let query = ctx.supabase
      .from('evolution_criteria')
      .select('*', { count: 'exact' })
      .is('deleted_at', null);

    if (input.status) query = query.eq('status', input.status);
    if (input.filterTestContent) query = applyTestContentColumnFilter(query);
    if (input.name) {
      const escaped = input.name.replace(/[%_\\]/g, '\\$&');
      query = query.ilike('name', `%${escaped}%`);
    }

    query = query.order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return { items: (data ?? []) as CriteriaListItem[], total: count ?? 0 };
  },
);

export const getCriteriaDetailAction = adminAction(
  'getCriteriaDetail',
  async (criteriaId: string, ctx: AdminContext): Promise<CriteriaListItem> => {
    if (!validateUuid(criteriaId)) throw new Error('Invalid criteriaId');
    const { data, error } = await ctx.supabase
      .from('evolution_criteria')
      .select('*')
      .eq('id', criteriaId)
      .is('deleted_at', null)
      .single();
    if (error) throw error;
    return evolutionCriteriaFullDbSchema.parse(data) as CriteriaListItem;
  },
);

// ─── Create / Update / Archive / Delete ────────────────────────────

export const createCriteriaAction = adminAction(
  'createCriteria',
  async (input: z.input<typeof createCriteriaSchema>, ctx: AdminContext): Promise<CriteriaListItem> => {
    const parsed = createCriteriaSchema.parse(input);

    const { data, error } = await ctx.supabase
      .from('evolution_criteria')
      .insert({
        name: parsed.name,
        description: parsed.description ?? null,
        min_rating: parsed.min_rating,
        max_rating: parsed.max_rating,
        evaluation_guidance: parsed.evaluation_guidance ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return data as CriteriaListItem;
  },
);

export const updateCriteriaAction = adminAction(
  'updateCriteria',
  async (input: z.input<typeof updateCriteriaSchema>, ctx: AdminContext): Promise<CriteriaListItem> => {
    const parsed = updateCriteriaSchema.parse(input);
    if (!validateUuid(parsed.id)) throw new Error('Invalid criteriaId');

    // If updating min/max range, re-validate any existing anchors against the new range —
    // reject the update if anchors fall out of range (force user to fix rubric first).
    const wantsRangeUpdate = parsed.min_rating !== undefined || parsed.max_rating !== undefined;
    if (wantsRangeUpdate) {
      const { data: existing, error: existingErr } = await ctx.supabase
        .from('evolution_criteria')
        .select('min_rating, max_rating, evaluation_guidance')
        .eq('id', parsed.id)
        .is('deleted_at', null)
        .single();
      if (existingErr) throw existingErr;

      const newMin = parsed.min_rating ?? existing.min_rating;
      const newMax = parsed.max_rating ?? existing.max_rating;
      if (newMax <= newMin) {
        throw new Error('max_rating must exceed min_rating');
      }

      const rubric: EvaluationGuidance | null = parsed.evaluation_guidance !== undefined
        ? parsed.evaluation_guidance ?? null
        : (existing.evaluation_guidance as EvaluationGuidance | null);

      if (rubric && rubric.length > 0) {
        const outOfRange = rubric.filter((a) => a.score < newMin || a.score > newMax);
        if (outOfRange.length > 0) {
          const offenders = outOfRange.map((a) => `score ${a.score}`).join(', ');
          throw new Error(`Cannot save: ${outOfRange.length} rubric anchor(s) fall outside the new range [${newMin}-${newMax}] (${offenders}). Remove or adjust these anchors before saving.`);
        }
      }
    }

    const updates: Record<string, unknown> = {};
    if (parsed.name !== undefined) updates.name = parsed.name;
    if (parsed.description !== undefined) updates.description = parsed.description;
    if (parsed.min_rating !== undefined) updates.min_rating = parsed.min_rating;
    if (parsed.max_rating !== undefined) updates.max_rating = parsed.max_rating;
    if (parsed.evaluation_guidance !== undefined) updates.evaluation_guidance = parsed.evaluation_guidance;
    updates.updated_at = new Date().toISOString();

    if (Object.keys(updates).length === 1) throw new Error('No fields to update');

    const { data, error } = await ctx.supabase
      .from('evolution_criteria')
      .update(updates)
      .eq('id', parsed.id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) throw error;
    return data as CriteriaListItem;
  },
);

export const archiveCriteriaAction = adminAction(
  'archiveCriteria',
  async (criteriaId: string, ctx: AdminContext): Promise<{ archived: boolean }> => {
    if (!validateUuid(criteriaId)) throw new Error('Invalid criteriaId');
    const { error } = await ctx.supabase
      .from('evolution_criteria')
      .update({ status: 'archived', archived_at: new Date().toISOString() })
      .eq('id', criteriaId)
      .is('deleted_at', null);
    if (error) throw error;
    return { archived: true };
  },
);

export const deleteCriteriaAction = adminAction(
  'deleteCriteria',
  async (criteriaId: string, ctx: AdminContext): Promise<{ deleted: boolean }> => {
    if (!validateUuid(criteriaId)) throw new Error('Invalid criteriaId');
    const { error } = await ctx.supabase
      .from('evolution_criteria')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', criteriaId);
    if (error) throw error;
    return { deleted: true };
  },
);

// ─── Pipeline-runtime fetch (Phase 4) ──────────────────────────────

/** Fetch active criteria rows for a list of UUIDs. Used by the orchestrator
 *  at the start of each `criteria_and_generate` iteration to populate the
 *  wrapper agent's input. Returns an empty Map on DB error (with warn-log);
 *  the wrapper agent then throws at validation time with a clear message. */
export async function getCriteriaForEvaluation(
  db: SupabaseClient,
  criteriaIds: ReadonlyArray<string>,
  logger?: EntityLogger,
): Promise<Map<string, EvolutionCriterionRow>> {
  if (criteriaIds.length === 0) return new Map();

  try {
    const { data, error } = await db
      .from('evolution_criteria')
      .select('id, name, description, min_rating, max_rating, evaluation_guidance')
      .in('id', [...criteriaIds])
      .eq('status', 'active')
      .is('deleted_at', null);
    if (error) throw error;

    const result = new Map<string, EvolutionCriterionRow>();
    for (const row of (data ?? []) as EvolutionCriterionRow[]) {
      result.set(row.id, row);
    }
    return result;
  } catch (err) {
    logger?.warn('getCriteriaForEvaluation failed; returning empty map', {
      phaseName: 'criteria_prep',
      error: err instanceof Error ? err.message : String(err),
    });
    return new Map();
  }
}

// ─── Cross-strategy validation (Phase 1F) ──────────────────────────

/** Validate that every UUID in criteriaIds references an existing,
 *  non-archived, non-deleted criteria row. Called by the strategy-creation
 *  flow before `upsertStrategy` so configuration-time errors surface with
 *  a clear message instead of failing at first run. Throws on any miss. */
export async function validateCriteriaIds(
  criteriaIds: ReadonlyArray<string>,
  db: SupabaseClient,
): Promise<void> {
  if (criteriaIds.length === 0) return;

  const { data, error } = await db
    .from('evolution_criteria')
    .select('id')
    .in('id', [...criteriaIds])
    .eq('status', 'active')
    .is('deleted_at', null);
  if (error) throw new Error(`Criteria validation failed: ${error.message}`);

  const found = new Set((data ?? []).map((r) => r.id as string));
  const missing = criteriaIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Strategy references ${missing.length} criteria that do not exist or are archived/deleted: ${missing.join(', ')}`,
    );
  }
}

// ─── Detail-page tab actions ───────────────────────────────────────

export interface CriteriaVariantRow {
  id: string;
  run_id: string;
  variant_content: string;
  elo_score: number | null;
  agent_name: string | null;
  created_at: string;
  weakest_criteria_ids: string[] | null;
}

export const getCriteriaVariantsAction = adminAction(
  'getCriteriaVariants',
  async (
    input: { criteriaId: string; limit?: number; offset?: number },
    ctx: AdminContext,
  ): Promise<{ items: CriteriaVariantRow[]; total: number }> => {
    if (!validateUuid(input.criteriaId)) throw new Error('Invalid criteriaId');
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const offset = Math.max(input.offset ?? 0, 0);

    const { data, error, count } = await ctx.supabase
      .from('evolution_variants')
      .select('id, run_id, variant_content, elo_score, agent_name, created_at, weakest_criteria_ids', { count: 'exact' })
      .contains('weakest_criteria_ids', [input.criteriaId])
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    return { items: (data ?? []) as CriteriaVariantRow[], total: count ?? 0 };
  },
);

export interface CriteriaRunRow {
  id: string;
  status: string;
  created_at: string;
  iter_count_with_criteria: number;
  variants_focused_count: number;
}

export const getCriteriaRunsAction = adminAction(
  'getCriteriaRuns',
  async (
    input: { criteriaId: string; limit?: number; offset?: number },
    ctx: AdminContext,
  ): Promise<{ items: CriteriaRunRow[]; total: number }> => {
    if (!validateUuid(input.criteriaId)) throw new Error('Invalid criteriaId');
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const offset = Math.max(input.offset ?? 0, 0);

    // Variants whose weakest_criteria_ids include this criteria; group by run_id
    const { data: variantData, error: vErr } = await ctx.supabase
      .from('evolution_variants')
      .select('run_id, weakest_criteria_ids')
      .contains('weakest_criteria_ids', [input.criteriaId]);
    if (vErr) throw vErr;

    const runVariantCounts = new Map<string, number>();
    for (const row of (variantData ?? []) as { run_id: string }[]) {
      runVariantCounts.set(row.run_id, (runVariantCounts.get(row.run_id) ?? 0) + 1);
    }

    const runIds = Array.from(runVariantCounts.keys());
    if (runIds.length === 0) return { items: [], total: 0 };

    const total = runIds.length;
    const pageIds = runIds.slice(offset, offset + limit);

    const { data: runData, error: rErr } = await ctx.supabase
      .from('evolution_runs')
      .select('id, status, created_at')
      .in('id', pageIds)
      .order('created_at', { ascending: false });
    if (rErr) throw rErr;

    const items: CriteriaRunRow[] = (runData ?? []).map((r) => ({
      id: r.id as string,
      status: r.status as string,
      created_at: r.created_at as string,
      // iter_count_with_criteria computed client-side if needed; default 1 (at least one
      // iteration referenced this criteria — strategy-config inspection is more expensive).
      iter_count_with_criteria: 1,
      variants_focused_count: runVariantCounts.get(r.id as string) ?? 0,
    }));

    return { items, total };
  },
);

// Re-export so callers can use the shared insert schema for client-side validation
export { evolutionCriteriaInsertSchema };
