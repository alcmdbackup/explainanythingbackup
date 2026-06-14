// Judge-rubric registry server actions: CRUD + the pipeline-runtime resolver
// (getJudgeRubricForEvaluation) + validateJudgeRubricId.
//
// A judge rubric is a reusable named bundle of judging DIMENSIONS (each a
// reference to an evolution_criteria row + a weight) used by rubric-based
// pairwise judging. Thin entity; dimensions live in the
// evolution_judge_rubric_dimensions junction. Weights are normalized at read
// time. Hard-delete is blocked while an active strategy references the rubric.

'use server';

import { z } from 'zod';
import { adminAction, type AdminContext } from './adminAction';
import { applyTestContentColumnFilter } from './shared';
import { validateCriteriaIds } from './criteriaActions';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityLogger } from '@evolution/lib/pipeline/infra/createEntityLogger';
import {
  evolutionJudgeRubricInsertSchema,
  type EvolutionJudgeRubricRow,
  type JudgeRubricDimensionInput,
} from '@evolution/lib/schemas';
import {
  normalizeDimensions,
  type ResolvedJudgeRubric,
  type ResolvedRubricDimension,
} from '@evolution/lib/shared/rubricJudge';

/** Surface the most useful part of a Supabase/PostgREST error (its `message` is
 *  sometimes empty while code/details/hint carry the real cause). */
function pgMsg(e: { message?: string; details?: string; hint?: string; code?: string } | null): string {
  if (!e) return 'unknown error';
  return e.message || e.details || e.hint || (e.code ? `code ${e.code}` : '') || JSON.stringify(e);
}

// ─── Types ─────────────────────────────────────────────────────────

export type JudgeRubricListItem = EvolutionJudgeRubricRow & { dimension_count: number };

export interface JudgeRubricDetail extends EvolutionJudgeRubricRow {
  dimensions: Array<{
    criteria_id: string;
    criteria_name: string;
    weight: number;
    position: number;
  }>;
}

// Shape of the one-query embed used by the runtime resolver.
interface EmbeddedDimensionRow {
  criteria_id: string;
  weight: number;
  position: number;
  evolution_criteria: {
    id: string;
    name: string;
    description: string | null;
    min_rating: number;
    max_rating: number;
    evaluation_guidance: ResolvedRubricDimension['evaluationGuidance'];
    status: string;
    deleted_at: string | null;
  } | null;
}

const RUBRIC_DIM_EMBED =
  'id, name, label, description, status, is_test_content, archived_at, deleted_at, created_at, updated_at, ' +
  'evolution_judge_rubric_dimensions(criteria_id, weight, position, ' +
  'evolution_criteria(id, name, description, min_rating, max_rating, evaluation_guidance, status, deleted_at))';

// ─── Pipeline-runtime resolver ─────────────────────────────────────

/** Resolve a rubric id to its normalized dimensions for judging. One PostgREST
 *  embed (rubric -> dimensions -> criteria). Soft-deleted/archived criteria are
 *  filtered out, then the surviving weights are normalized. Returns null when the
 *  rubric is missing/deleted/archived OR zero dimensions survive — the caller then
 *  falls back to holistic judging. Never throws (warn-logs on error). */
export async function getJudgeRubricForEvaluation(
  db: SupabaseClient,
  rubricId: string,
  logger?: EntityLogger,
): Promise<ResolvedJudgeRubric | null> {
  try {
    const { data, error } = await db
      .from('evolution_judge_rubrics')
      .select(RUBRIC_DIM_EMBED)
      .eq('id', rubricId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const rawDims = ((data as unknown as { evolution_judge_rubric_dimensions?: EmbeddedDimensionRow[] })
      .evolution_judge_rubric_dimensions ?? []) as EmbeddedDimensionRow[];

    const survivors = rawDims
      .filter((d) => d.evolution_criteria && d.evolution_criteria.status === 'active' && d.evolution_criteria.deleted_at === null)
      .sort((a, b) => a.position - b.position)
      .map((d) => {
        const c = d.evolution_criteria!;
        return {
          criteriaId: c.id,
          name: c.name,
          description: c.description,
          minRating: c.min_rating,
          maxRating: c.max_rating,
          evaluationGuidance: c.evaluation_guidance,
          weight: d.weight,
        };
      });

    if (survivors.length === 0) {
      logger?.warn('judge rubric resolved to zero active dimensions; falling back to holistic', {
        phaseName: 'rubric_prep',
        rubricId,
      });
      return null;
    }

    return { rubricId, dimensions: normalizeDimensions(survivors) };
  } catch (err) {
    logger?.warn('getJudgeRubricForEvaluation failed; falling back to holistic', {
      phaseName: 'rubric_prep',
      rubricId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── Cross-strategy validation ─────────────────────────────────────

/** Validate that a rubric id references an existing, active, non-deleted rubric
 *  with at least one active dimension. Called by strategy create/update before
 *  persisting so a strategy can never reference a missing/empty rubric. Throws. */
export async function validateJudgeRubricId(
  rubricId: string,
  db: SupabaseClient,
): Promise<void> {
  const resolved = await getJudgeRubricForEvaluation(db, rubricId);
  if (!resolved) {
    throw new Error(
      `Strategy references judge rubric ${rubricId} which does not exist, is archived/deleted, or has no active dimensions.`,
    );
  }
}

// ─── CRUD ──────────────────────────────────────────────────────────

export const listJudgeRubricsAction = adminAction(
  'listJudgeRubrics',
  async (
    input: { limit?: number; offset?: number; status?: string; filterTestContent?: boolean },
    ctx: AdminContext,
  ): Promise<{ items: JudgeRubricListItem[]; total: number }> => {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
    const offset = Math.max(input.offset ?? 0, 0);
    let q = ctx.supabase
      .from('evolution_judge_rubrics')
      .select('*, evolution_judge_rubric_dimensions(criteria_id)', { count: 'exact' })
      .is('deleted_at', null);
    if (input.status) q = q.eq('status', input.status);
    if (input.filterTestContent !== false) q = applyTestContentColumnFilter(q);
    q = q.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    const { data, count, error } = await q;
    if (error) throw new Error(`listJudgeRubrics failed: ${error.message}`);
    const items = ((data ?? []) as unknown as Array<EvolutionJudgeRubricRow & { evolution_judge_rubric_dimensions?: unknown[] }>).map(
      (r) => {
        const { evolution_judge_rubric_dimensions, ...row } = r;
        return { ...row, dimension_count: (evolution_judge_rubric_dimensions ?? []).length };
      },
    );
    return { items, total: count ?? items.length };
  },
);

export const getJudgeRubricDetailAction = adminAction(
  'getJudgeRubricDetail',
  async (rubricId: string, ctx: AdminContext): Promise<JudgeRubricDetail> => {
    const { data, error } = await ctx.supabase
      .from('evolution_judge_rubrics')
      .select(RUBRIC_DIM_EMBED)
      .eq('id', rubricId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw new Error(`getJudgeRubricDetail failed: ${error.message}`);
    if (!data) throw new Error(`Judge rubric ${rubricId} not found`);
    const d = data as unknown as EvolutionJudgeRubricRow & {
      evolution_judge_rubric_dimensions?: EmbeddedDimensionRow[];
    };
    const { evolution_judge_rubric_dimensions, ...row } = d;
    const dimensions = (evolution_judge_rubric_dimensions ?? [])
      .sort((a, b) => a.position - b.position)
      .map((dim) => ({
        criteria_id: dim.criteria_id,
        criteria_name: dim.evolution_criteria?.name ?? '(deleted criterion)',
        weight: dim.weight,
        position: dim.position,
      }));
    return { ...row, dimensions };
  },
);

/** Replace a rubric's dimension rows (delete-all + insert). */
async function writeDimensions(
  db: SupabaseClient,
  rubricId: string,
  dimensions: ReadonlyArray<JudgeRubricDimensionInput>,
): Promise<void> {
  await db.from('evolution_judge_rubric_dimensions').delete().eq('rubric_id', rubricId);
  const rows = dimensions.map((d, i) => ({
    rubric_id: rubricId,
    criteria_id: d.criteria_id,
    weight: d.weight,
    position: d.position ?? i,
  }));
  const { error } = await db.from('evolution_judge_rubric_dimensions').insert(rows);
  if (error) throw new Error(`writeDimensions failed: ${pgMsg(error)}`);
}

export const createJudgeRubricAction = adminAction(
  'createJudgeRubric',
  async (input: unknown, ctx: AdminContext): Promise<EvolutionJudgeRubricRow> => {
    const parsed = evolutionJudgeRubricInsertSchema.parse(input);
    await validateCriteriaIds(parsed.dimensions.map((d) => d.criteria_id), ctx.supabase);
    const { data, error } = await ctx.supabase
      .from('evolution_judge_rubrics')
      .insert({
        name: parsed.name,
        label: parsed.label ?? '',
        description: parsed.description ?? null,
        status: parsed.status,
      })
      .select('*')
      .single();
    if (error) throw new Error(`createJudgeRubric failed: ${pgMsg(error)}`);
    if (!data) throw new Error('createJudgeRubric failed: insert returned no row (check that migrations are applied to this database)');
    const row = data as unknown as EvolutionJudgeRubricRow;
    await writeDimensions(ctx.supabase, row.id, parsed.dimensions);
    return row;
  },
);

const updateJudgeRubricSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  label: z.string().max(200).optional(),
  description: z.string().nullable().optional(),
  status: z.enum(['active', 'archived']).optional(),
  dimensions: z.array(z.object({
    criteria_id: z.string().uuid(),
    weight: z.number().min(0),
    position: z.number().int().min(0).optional(),
  })).min(1).optional(),
});

export const updateJudgeRubricAction = adminAction(
  'updateJudgeRubric',
  async (input: unknown, ctx: AdminContext): Promise<{ updated: boolean }> => {
    const parsed = updateJudgeRubricSchema.parse(input);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.name !== undefined) patch.name = parsed.name;
    if (parsed.label !== undefined) patch.label = parsed.label;
    if (parsed.description !== undefined) patch.description = parsed.description;
    if (parsed.status !== undefined) patch.status = parsed.status;
    const { error } = await ctx.supabase.from('evolution_judge_rubrics').update(patch).eq('id', parsed.id);
    if (error) throw new Error(`updateJudgeRubric failed: ${error.message}`);
    if (parsed.dimensions) {
      await validateCriteriaIds(parsed.dimensions.map((d) => d.criteria_id), ctx.supabase);
      await writeDimensions(ctx.supabase, parsed.id, parsed.dimensions);
    }
    return { updated: true };
  },
);

export const archiveJudgeRubricAction = adminAction(
  'archiveJudgeRubric',
  async (rubricId: string, ctx: AdminContext): Promise<{ archived: boolean }> => {
    const { error } = await ctx.supabase
      .from('evolution_judge_rubrics')
      .update({ status: 'archived', archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', rubricId);
    if (error) throw new Error(`archiveJudgeRubric failed: ${error.message}`);
    return { archived: true };
  },
);

/** Hard-delete is BLOCKED while an active strategy references the rubric. The
 *  count check runs (in one transaction-like sequence) BEFORE any delete, so the
 *  dimensions ON DELETE CASCADE only fires after the gate passes. The strategy->
 *  rubric link is a JSON config field (no DB FK), so a raced create after the
 *  count is benign: at runtime getJudgeRubricForEvaluation returns null and the
 *  run falls back to holistic. Archive instead to retire a referenced rubric. */
export const deleteJudgeRubricAction = adminAction(
  'deleteJudgeRubric',
  async (rubricId: string, ctx: AdminContext): Promise<{ deleted: boolean }> => {
    const { count, error: countErr } = await ctx.supabase
      .from('evolution_strategies')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .eq('config->>judgeRubricId', rubricId);
    if (countErr) throw new Error(`deleteJudgeRubric reference-check failed: ${countErr.message}`);
    if ((count ?? 0) > 0) {
      throw new Error(
        `Cannot delete: ${count} active strateg${(count ?? 0) === 1 ? 'y references' : 'ies reference'} this rubric. Detach them or archive the rubric instead.`,
      );
    }
    const { error } = await ctx.supabase.from('evolution_judge_rubrics').delete().eq('id', rubricId);
    if (error) throw new Error(`deleteJudgeRubric failed: ${error.message}`);
    return { deleted: true };
  },
);
