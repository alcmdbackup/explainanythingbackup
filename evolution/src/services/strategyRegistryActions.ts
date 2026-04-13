'use server';
// V2 strategy registry CRUD actions for the admin Strategies page.
// Uses adminAction wrapper, validates all inputs, and returns ActionResult<T>.

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid, applyTestContentNameFilter } from './shared';
import { hashStrategyConfig, labelStrategyConfig } from '@evolution/lib/pipeline/setup/findOrCreateStrategy';
import type { StrategyConfig } from '@evolution/lib/pipeline/infra/types';
import { createEntityLogger } from '@evolution/lib/pipeline/infra/createEntityLogger';
import { z } from 'zod';
import { generationGuidanceSchema } from '@evolution/lib/schemas';

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
  iterations: z.number().int().min(1).max(100),
  strategiesPerRound: z.number().int().min(1).max(20).optional(),
  budgetUsd: z.number().min(0.01).max(100).optional(),
  pipeline_type: z.string().max(50).optional(),
  generationGuidance: generationGuidanceSchema.optional(),
  maxVariantsToGenerateFromSeedArticle: z.number().int().min(1).max(100).optional(),
  maxComparisonsPerVariant: z.number().int().min(1).max(100).optional(),
  budgetBufferAfterParallel: z.number().min(0).max(1).optional(),
  budgetBufferAfterSequential: z.number().min(0).max(1).optional(),
  generationTemperature: z.number().min(0).max(2).optional(),
}).refine((c) => {
  const parallel = c.budgetBufferAfterParallel ?? 0;
  const sequential = c.budgetBufferAfterSequential ?? 0;
  return parallel >= sequential;
}, { message: 'budgetBufferAfterParallel must be >= budgetBufferAfterSequential' });

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
    input: { limit: number; offset: number; status?: string; created_by?: string; pipeline_type?: string; filterTestContent?: boolean },
    ctx: AdminContext,
  ): Promise<{ items: StrategyListItem[]; total: number }> => {
    const limit = Math.min(Math.max(input.limit, 1), 200);
    const offset = Math.max(input.offset, 0);

    let query = ctx.supabase
      .from('evolution_strategies')
      .select('*', { count: 'exact' });

    if (input.status) query = query.eq('status', input.status);
    if (input.created_by) query = query.eq('created_by', input.created_by);
    if (input.pipeline_type) query = query.eq('pipeline_type', input.pipeline_type);
    if (input.filterTestContent) query = applyTestContentNameFilter(query);

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

    const config: StrategyConfig = {
      generationModel: parsed.generationModel,
      judgeModel: parsed.judgeModel,
      iterations: parsed.iterations,
      strategiesPerRound: parsed.strategiesPerRound,
      budgetUsd: parsed.budgetUsd,
      generationGuidance: parsed.generationGuidance,
      maxVariantsToGenerateFromSeedArticle: parsed.maxVariantsToGenerateFromSeedArticle,
      maxComparisonsPerVariant: parsed.maxComparisonsPerVariant,
      budgetBufferAfterParallel: parsed.budgetBufferAfterParallel,
      budgetBufferAfterSequential: parsed.budgetBufferAfterSequential,
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
        config_hash: `${configHash}_clone_${Date.now()}`,
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

    // Check for referencing runs
    const { count } = await ctx.supabase
      .from('evolution_runs')
      .select('id', { count: 'exact', head: true })
      .eq('strategy_id', strategyId);

    if ((count ?? 0) > 0) {
      const stratLogger = createEntityLogger({
        entityType: 'strategy',
        entityId: strategyId,
        strategyId,
      }, ctx.supabase);
      stratLogger.warn('Strategy deletion blocked', { runCount: count ?? 0 });
      throw new Error('Cannot delete strategy with existing runs. Archive it instead.');
    }

    const { error } = await ctx.supabase
      .from('evolution_strategies')
      .delete()
      .eq('id', strategyId);

    if (error) throw error;

    const stratLogger = createEntityLogger({
      entityType: 'strategy',
      entityId: strategyId,
      strategyId,
    }, ctx.supabase);
    stratLogger.info('Strategy deleted');

    return { deleted: true };
  },
);
