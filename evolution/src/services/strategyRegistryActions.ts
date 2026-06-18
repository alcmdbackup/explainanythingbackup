'use server';
// V2 strategy registry CRUD actions for the admin Strategies page.
// Uses adminAction wrapper, validates all inputs, and returns ActionResult<T>.

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid, applyTestContentColumnFilter } from './shared';
import { hashStrategyConfig, labelStrategyConfig } from '@evolution/lib/pipeline/setup/findOrCreateStrategy';
import type { StrategyConfig } from '@evolution/lib/pipeline/infra/types';
import { createEntityLogger } from '@evolution/lib/pipeline/infra/createEntityLogger';
import { z } from 'zod';
import { iterationConfigSchema, generationGuidanceSchema } from '@evolution/lib/schemas';
import { listEnsembleConfigIds, resolveEnsembleConfig } from '@evolution/lib/shared/judgeEnsemble/chainRegistry';

// ─── Types ──────────────────────────────────────────────────────

export interface StrategyListItem {
  id: string;
  name: string;
  label: string;
  description: string | null;
  config: StrategyConfig;
  config_hash: string;
  pipeline_type: string | null;
  status: string;
  created_by: string;
  first_used_at: string;
  last_used_at: string;
  created_at: string;
}

// ─── Schemas ────────────────────────────────────────────────────

const createStrategySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  generationModel: z.string().min(1).max(100),
  judgeModel: z.string().min(1).max(100),
  /** Optional rubric-set id for rubric-based pairwise judging (validated below). */
  judgeRubricId: z.string().uuid().optional(),
  /** Phase 1d (Fix 5b): optional per-paragraph rubric-set id (validated below). */
  paragraphJudgeRubricId: z.string().uuid().optional(),
  /** Optional named multi-judge escalation chain (chainRegistry id). Empty → single-judge ranking.
   *  Resolved at run time in buildRunContext; escalates only when the lead judge is indecisive. */
  ensembleConfigId: z.string().max(100).optional(),
  /** Iterative-editing Proposer model (optional). Falls back to generationModel at runtime. */
  editingModel: z.string().max(100).optional(),
  /** Iterative-editing Approver model (optional). Falls back to editingModel (which falls back
   *  to generationModel) at runtime. Same-as-editingModel surfaces a rubber-stamping warning
   *  in the wizard per Decisions §16. */
  approverModel: z.string().max(100).optional(),
  iterationConfigs: z.array(iterationConfigSchema).min(1).max(20),
  budgetUsd: z.number().min(0.01).max(100).optional(),
  pipeline_type: z.string().max(50).optional(),
  generationGuidance: generationGuidanceSchema.optional(),
  maxComparisonsPerVariant: z.number().int().min(1).max(100).optional(),
  // Budget floors (dual-unit). See evolution/src/lib/schemas.ts for full semantics.
  minBudgetAfterParallelFraction: z.number().min(0).max(1).optional(),
  minBudgetAfterParallelAgentMultiple: z.number().min(0).optional(),
  minBudgetAfterSequentialFraction: z.number().min(0).max(1).optional(),
  minBudgetAfterSequentialAgentMultiple: z.number().min(0).optional(),
  /** @deprecated Kept for backward-compat on inputs. Preprocessed to minBudgetAfterParallelFraction. */
  budgetBufferAfterParallel: z.number().min(0).max(1).optional(),
  /** @deprecated Kept for backward-compat on inputs. Preprocessed to minBudgetAfterSequentialFraction. */
  budgetBufferAfterSequential: z.number().min(0).max(1).optional(),
  generationTemperature: z.number().min(0).max(2).optional(),
}).refine((c) => {
  // Exactly one parallel unit may be set
  return !(c.minBudgetAfterParallelFraction != null && c.minBudgetAfterParallelAgentMultiple != null);
}, { message: 'Only one of minBudgetAfterParallelFraction or minBudgetAfterParallelAgentMultiple may be set' }).refine((c) => {
  // Exactly one sequential unit may be set
  return !(c.minBudgetAfterSequentialFraction != null && c.minBudgetAfterSequentialAgentMultiple != null);
}, { message: 'Only one of minBudgetAfterSequentialFraction or minBudgetAfterSequentialAgentMultiple may be set' }).refine((c) => {
  // Same unit mode across phases (when both set)
  const pF = c.minBudgetAfterParallelFraction != null;
  const pM = c.minBudgetAfterParallelAgentMultiple != null;
  const sF = c.minBudgetAfterSequentialFraction != null;
  const sM = c.minBudgetAfterSequentialAgentMultiple != null;
  if (!sF && !sM) return true;
  if (!pF && !pM) return true;
  if (pF && sF) return true;
  if (pM && sM) return true;
  return false;
}, { message: 'Parallel and sequential budget floors must use the same unit mode' }).refine((c) => {
  // Ordering: parallel >= sequential. Unset parallel implicitly 0; reject sequential-only > 0.
  const pF = c.minBudgetAfterParallelFraction ?? c.budgetBufferAfterParallel;
  const pM = c.minBudgetAfterParallelAgentMultiple;
  const sF = c.minBudgetAfterSequentialFraction ?? c.budgetBufferAfterSequential;
  const sM = c.minBudgetAfterSequentialAgentMultiple;
  if (pF != null && sF != null) return pF >= sF;
  if (pM != null && sM != null) return pM >= sM;
  const sequentialSetAboveZero = (sF != null && sF > 0) || (sM != null && sM > 0);
  const parallelUnset = pF == null && pM == null;
  if (sequentialSetAboveZero && parallelUnset) return false;
  return true;
}, { message: 'Parallel floor must be >= sequential floor' });

const updateStrategySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

// ─── Actions ────────────────────────────────────────────────────

/** List strategies with pagination. Named listStrategiesAction to avoid collision with experimentActions.getStrategiesAction. */
export const listStrategiesAction = adminAction(
  'listStrategies',
  async (
    input: { limit?: number; offset?: number; status?: string; created_by?: string; pipeline_type?: string; filterTestContent?: boolean } | undefined,
    ctx: AdminContext,
  ): Promise<{ items: StrategyListItem[]; total: number }> => {
    // B003-S5: defaults so calling without args (or with partial input) doesn't TypeError
    // on `input.limit`. Mirrors the project's default pagination shape (50/0).
    const safeInput = input ?? {};
    const limit = Math.min(Math.max(safeInput.limit ?? 50, 1), 200);
    const offset = Math.max(safeInput.offset ?? 0, 0);

    let query = ctx.supabase
      .from('evolution_strategies')
      .select('*', { count: 'exact' });

    if (safeInput.status) query = query.eq('status', safeInput.status);
    if (safeInput.created_by) query = query.eq('created_by', safeInput.created_by);
    if (safeInput.pipeline_type) query = query.eq('pipeline_type', safeInput.pipeline_type);
    if (safeInput.filterTestContent) query = applyTestContentColumnFilter(query);

    query = query.order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return { items: data ?? [], total: count ?? 0 };
  },
);

/** Get full strategy detail by ID. */
export const getStrategyDetailAction = adminAction(
  'getStrategyDetail',
  async (strategyId: string, ctx: AdminContext): Promise<StrategyListItem> => {
    if (!validateUuid(strategyId)) throw new Error('Invalid strategyId');
    const { data, error } = await ctx.supabase
      .from('evolution_strategies')
      .select('*')
      .eq('id', strategyId)
      .single();
    if (error) {
      if (error.code === 'PGRST116') throw new Error('Strategy not found');
      throw new Error('Failed to load strategy');
    }
    return data;
  },
);

/** Create a new strategy config. */
export const createStrategyAction = adminAction(
  'createStrategy',
  async (input: z.input<typeof createStrategySchema>, ctx: AdminContext): Promise<StrategyListItem> => {
    const parsed = createStrategySchema.parse(input);

    // Validate criteriaIds referenced by any criteria-based agent type (legacy + 2 new) exist + active.
    {
      const { validateCriteriaIds } = await import('./criteriaActions');
      const allIds = parsed.iterationConfigs
        .flatMap((it) => {
          const isCriteriaBased = it.agentType === 'criteria_and_generate'
            || it.agentType === 'single_pass_evaluate_criteria_and_generate'
            || it.agentType === 'proposer_approver_criteria_generate';
          return (isCriteriaBased && it.criteriaIds) ? it.criteriaIds : [];
        });
      if (allIds.length > 0) {
        await validateCriteriaIds(allIds, ctx.supabase);
      }
    }

    // Validate the judge rubric (must exist, be active, and have ≥1 active dimension).
    if (parsed.judgeRubricId) {
      const { validateJudgeRubricId } = await import('./judgeRubricActions');
      await validateJudgeRubricId(parsed.judgeRubricId, ctx.supabase);
    }
    // Phase 1d (Fix 5b): validate the paragraph rubric the same way. Reuses the same
    // helper — rubrics in evolution_judge_rubrics are not typed by article/paragraph,
    // strategy author picks which to use where.
    if (parsed.paragraphJudgeRubricId) {
      const { validateJudgeRubricId } = await import('./judgeRubricActions');
      await validateJudgeRubricId(parsed.paragraphJudgeRubricId, ctx.supabase);
    }

    // Validate the ensemble chain id resolves to a known composition (fail fast, not at run time).
    if (parsed.ensembleConfigId && !resolveEnsembleConfig(parsed.ensembleConfigId)) {
      throw new Error(`Unknown ensembleConfigId: ${parsed.ensembleConfigId}`);
    }

    const config: StrategyConfig = {
      generationModel: parsed.generationModel,
      judgeModel: parsed.judgeModel,
      judgeRubricId: parsed.judgeRubricId,
      paragraphJudgeRubricId: parsed.paragraphJudgeRubricId,
      ensembleConfigId: parsed.ensembleConfigId,
      editingModel: parsed.editingModel,
      approverModel: parsed.approverModel,
      iterationConfigs: parsed.iterationConfigs,
      budgetUsd: parsed.budgetUsd,
      generationGuidance: parsed.generationGuidance,
      maxComparisonsPerVariant: parsed.maxComparisonsPerVariant,
      // Budget floors — prefer new fields, fall back to legacy inputs if provided
      minBudgetAfterParallelFraction: parsed.minBudgetAfterParallelFraction ?? parsed.budgetBufferAfterParallel,
      minBudgetAfterParallelAgentMultiple: parsed.minBudgetAfterParallelAgentMultiple,
      minBudgetAfterSequentialFraction: parsed.minBudgetAfterSequentialFraction ?? parsed.budgetBufferAfterSequential,
      minBudgetAfterSequentialAgentMultiple: parsed.minBudgetAfterSequentialAgentMultiple,
      generationTemperature: parsed.generationTemperature,
    };

    const configHash = hashStrategyConfig(config);

    const { data, error } = await ctx.supabase
      .from('evolution_strategies')
      .insert({
        name: parsed.name,
        label: labelStrategyConfig(config),
        description: parsed.description ?? null,
        config,
        config_hash: configHash,
        pipeline_type: parsed.pipeline_type ?? 'full',
        created_by: ctx.adminUserId,
      })
      .select()
      .single();

    if (error) throw error;

    const stratLogger = createEntityLogger({
      entityType: 'strategy',
      entityId: data.id,
      strategyId: data.id,
    }, ctx.supabase);
    stratLogger.info('Strategy created', { name: parsed.name, pipelineType: parsed.pipeline_type ?? 'full' });

    return data;
  },
);

/** The named escalation-chain ids selectable in the wizard. Server-side so the client never imports
 *  chainRegistry (which pulls in node-only deps via the aggregation/computeRatings chain). */
export const listEnsembleConfigsAction = adminAction(
  'listEnsembleConfigs',
  async (ctx: AdminContext): Promise<{ ids: string[] }> => {
    void ctx; // admin gating only; the config list is static.
    return { ids: listEnsembleConfigIds() };
  },
);

/** Update strategy name, description, or status. */
export const updateStrategyAction = adminAction(
  'updateStrategy',
  async (input: z.input<typeof updateStrategySchema>, ctx: AdminContext): Promise<StrategyListItem> => {
    const parsed = updateStrategySchema.parse(input);
    if (!validateUuid(parsed.id)) throw new Error('Invalid strategyId');

    const updates: Record<string, unknown> = {};
    if (parsed.name !== undefined) updates.name = parsed.name;
    if (parsed.description !== undefined) updates.description = parsed.description;
    if (parsed.status !== undefined) updates.status = parsed.status;

    if (Object.keys(updates).length === 0) throw new Error('No fields to update');

    const { data, error } = await ctx.supabase
      .from('evolution_strategies')
      .update(updates)
      .eq('id', parsed.id)
      .select()
      .single();

    if (error) throw error;

    const stratLogger = createEntityLogger({
      entityType: 'strategy',
      entityId: parsed.id,
      strategyId: parsed.id,
    }, ctx.supabase);
    stratLogger.info('Strategy updated', { updatedFields: Object.keys(updates) });

    return data;
  },
);

/** Clone an existing strategy with a new name. */
export const cloneStrategyAction = adminAction(
  'cloneStrategy',
  async (
    input: { sourceId: string; newName: string },
    ctx: AdminContext,
  ): Promise<StrategyListItem> => {
    if (!validateUuid(input.sourceId)) throw new Error('Invalid sourceId');

    const { data: source, error: fetchError } = await ctx.supabase
      .from('evolution_strategies')
      .select('*')
      .eq('id', input.sourceId)
      .single();

    if (fetchError || !source) throw new Error(`Source strategy not found: ${input.sourceId}`);

    const config = source.config as StrategyConfig;
    const configHash = hashStrategyConfig(config);

    const { data, error } = await ctx.supabase
      .from('evolution_strategies')
      .insert({
        name: input.newName,
        label: source.label,
        description: source.description,
        config,
        // B001-S5: Date.now() collides on concurrent millisecond → UNIQUE constraint
        // violation OR breaks downstream find-or-create lookups. Use crypto.randomUUID()
        // for an immediately-distinct discriminator. Clones are NOT meant to be content-
        // addressable (they're explicit copies of a source); the source's content hash
        // is preserved as the prefix so `findOrCreateStrategy` dedup-on-content still works.
        config_hash: `${configHash}_clone_${crypto.randomUUID()}`,
        pipeline_type: source.pipeline_type,
        created_by: ctx.adminUserId,
      })
      .select()
      .single();

    if (error) throw error;

    const cloneLogger = createEntityLogger({
      entityType: 'strategy',
      entityId: data.id,
      strategyId: data.id,
    }, ctx.supabase);
    cloneLogger.info('Strategy cloned', { sourceId: input.sourceId, name: input.newName });

    return data;
  },
);

/** Archive a strategy. */
export const archiveStrategyAction = adminAction(
  'archiveStrategy',
  async (strategyId: string, ctx: AdminContext): Promise<{ archived: boolean }> => {
    if (!validateUuid(strategyId)) throw new Error('Invalid strategyId');
    const { error } = await ctx.supabase
      .from('evolution_strategies')
      .update({ status: 'archived' })
      .eq('id', strategyId);
    if (error) throw error;

    const stratLogger = createEntityLogger({
      entityType: 'strategy',
      entityId: strategyId,
      strategyId,
    }, ctx.supabase);
    stratLogger.info('Strategy archived');

    return { archived: true };
  },
);

/** Delete a strategy (only if unused). */
export const deleteStrategyAction = adminAction(
  'deleteStrategy',
  async (strategyId: string, ctx: AdminContext): Promise<{ deleted: boolean }> => {
    if (!validateUuid(strategyId)) throw new Error('Invalid strategyId');

    // B009-S5: removed the SELECT count then DELETE TOCTOU pattern. The DB FK
    // `evolution_runs.strategy_id REFERENCES evolution_strategies(id) ON DELETE RESTRICT`
    // (migration 20260324000001) atomically rejects the DELETE if any runs reference
    // this strategy. We catch the structured error code 23503 (foreign_key_violation)
    // and surface a friendly message; no race window between count and delete.
    const stratLogger = createEntityLogger({
      entityType: 'strategy',
      entityId: strategyId,
      strategyId,
    }, ctx.supabase);

    const { error } = await ctx.supabase
      .from('evolution_strategies')
      .delete()
      .eq('id', strategyId);

    if (error) {
      // Postgres FK violation surfaces as code '23503'.
      if ((error as { code?: string }).code === '23503') {
        stratLogger.warn('Strategy deletion blocked by FK', { error: error.message });
        throw new Error('Cannot delete strategy with existing runs. Archive it instead.');
      }
      throw error;
    }

    stratLogger.info('Strategy deleted');
    return { deleted: true };
  },
);
