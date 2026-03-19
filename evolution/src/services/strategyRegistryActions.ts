'use server';
// Server actions for strategy registry CRUD. Strategies are stored in strategy_configs
// with is_predefined flag distinguishing admin-curated from auto-created configs.

import { adminAction, type AdminContext } from './adminAction';
import {
  labelStrategyConfig,
  type StrategyConfig,
  type StrategyConfigRow,
} from '@evolution/lib/core/strategyConfig';
import { hashStrategyConfig } from '@evolution/lib/v2/strategy';
import { validateStrategyConfig } from '@evolution/lib/core/configValidation';
import type { PipelineType } from '@evolution/lib/types';

/** Normalize a raw DB row to StrategyConfigRow, filling defaults for pre-migration columns. */
function normalizeStrategyRow(row: Record<string, unknown>): StrategyConfigRow {
  return {
    ...row,
    status: (row.status as string | null) ?? 'active',
    created_by: (row.created_by as string | null) ?? 'system',
  } as StrategyConfigRow;
}

// ─── Create strategy core ─────────────────────────────────────────

export interface CreateStrategyInput {
  name: string;
  description?: string;
  config: StrategyConfig;
  pipelineType?: PipelineType;
}

/** Core create-or-promote logic — no wrapper, safe for internal callers. */
async function createStrategyCore(
  input: CreateStrategyInput,
  ctx: AdminContext,
): Promise<StrategyConfigRow> {
  if (!input.name.trim()) throw new Error('Strategy name is required');

  // Validate config before persisting — prevents invalid models/agents from corrupting leaderboard
  const validation = validateStrategyConfig(input.config);
  if (!validation.valid) {
    throw new Error(`Invalid strategy config: ${validation.errors.join('; ')}`);
  }

  const { supabase } = ctx;
  const configHash = hashStrategyConfig(input.config);
  const label = labelStrategyConfig(input.config);

  // Check if an auto-created strategy with same hash exists — promote it
  const { data: existing } = await supabase
    .from('evolution_strategy_configs')
    .select('*')
    .eq('config_hash', configHash)
    .single();

  if (existing) {
    // Promote to predefined
    const { data: updated, error: updateErr } = await supabase
      .from('evolution_strategy_configs')
      .update({
        is_predefined: true,
        name: input.name,
        description: input.description ?? existing.description,
        pipeline_type: input.pipelineType ?? existing.pipeline_type,
        created_by: 'admin',
        status: 'active',
      })
      .eq('id', existing.id)
      .select('*')
      .single();

    if (updateErr || !updated) throw new Error(`Failed to promote strategy: ${updateErr?.message}`);
    return normalizeStrategyRow(updated);
  }

  // Create new
  const { data, error } = await supabase
    .from('evolution_strategy_configs')
    .insert({
      config_hash: configHash,
      name: input.name,
      description: input.description ?? null,
      label,
      config: input.config,
      is_predefined: true,
      pipeline_type: input.pipelineType ?? null,
      status: 'active',
      created_by: 'admin',
    })
    .select('*')
    .single();

  if (error || !data) throw new Error(`Failed to create strategy: ${error?.message}`);
  return normalizeStrategyRow(data);
}

// ─── List strategies ─────────────────────────────────────────────

export const getStrategiesAction = adminAction('getStrategiesAction', async (
  filters: { status?: 'active' | 'archived' | 'all'; isPredefined?: boolean; createdBy?: string[]; pipelineType?: PipelineType; limit?: number } | undefined,
  ctx: AdminContext,
) => {
  const { supabase } = ctx;

  let query = supabase
    .from('evolution_strategy_configs')
    .select('*')
    .order('last_used_at', { ascending: false });

  const statusFilter = filters?.status ?? 'active';
  if (statusFilter !== 'all') query = query.eq('status', statusFilter);
  if (filters?.isPredefined !== undefined) query = query.eq('is_predefined', filters.isPredefined);
  if (filters?.createdBy?.length) query = query.in('created_by', filters.createdBy);
  if (filters?.pipelineType) query = query.eq('pipeline_type', filters.pipelineType);
  if (filters?.limit) query = query.limit(filters.limit);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch strategies: ${error.message}`);

  return (data ?? []).map(normalizeStrategyRow);
});

// ─── Get strategy detail ─────────────────────────────────────────

export const getStrategyDetailAction = adminAction('getStrategyDetailAction', async (
  id: string,
  ctx: AdminContext,
) => {
  const { supabase } = ctx;

  const { data, error } = await supabase
    .from('evolution_strategy_configs')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) throw new Error(`Strategy not found: ${id}`);
  return normalizeStrategyRow(data);
});

// ─── Create strategy ─────────────────────────────────────────────

export const createStrategyAction = adminAction('createStrategyAction', async (
  input: CreateStrategyInput,
  ctx: AdminContext,
) => {
  return await createStrategyCore(input, ctx);
});

// ─── Update strategy ─────────────────────────────────────────────

export interface UpdateStrategyInput {
  id: string;
  name?: string;
  description?: string;
  config?: StrategyConfig;
  pipelineType?: PipelineType;
}

export const updateStrategyAction = adminAction('updateStrategyAction', async (
  input: UpdateStrategyInput,
  ctx: AdminContext,
) => {
  const { supabase } = ctx;

  if (input.name !== undefined && !input.name.trim()) {
    throw new Error('Strategy name cannot be empty');
  }

  // Fetch current strategy
  const { data: current, error: fetchErr } = await supabase
    .from('evolution_strategy_configs')
    .select('*')
    .eq('id', input.id)
    .single();

  if (fetchErr || !current) throw new Error(`Strategy not found: ${input.id}`);
  if (!current.is_predefined) throw new Error('Only predefined strategies can be edited');

  const configChanged = input.config !== undefined;
  const newConfig = input.config ?? current.config;

  // If config changed, check for hash collision with another row
  if (configChanged) {
    const newHash = hashStrategyConfig(newConfig);
    if (newHash !== current.config_hash) {
      const { data: collision } = await supabase
        .from('evolution_strategy_configs')
        .select('id')
        .eq('config_hash', newHash)
        .neq('id', input.id)
        .single();

      if (collision) {
        throw new Error(
          `Config hash collision with strategy ${collision.id}. Consider cloning instead.`,
        );
      }
    }
  }

  // If config changed and strategy has completed runs -> version: archive old, create new
  if (configChanged && (current.run_count ?? 0) > 0) {
    // Archive the old version
    await supabase
      .from('evolution_strategy_configs')
      .update({ status: 'archived' })
      .eq('id', input.id);

    // Create new version via core helper
    return await createStrategyCore({
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      config: newConfig,
      pipelineType: input.pipelineType ?? current.pipeline_type,
    }, ctx);
  }

  // No config change or zero runs — update in place
  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.pipelineType !== undefined) updates.pipeline_type = input.pipelineType;
  if (configChanged) {
    updates.config = newConfig;
    updates.config_hash = hashStrategyConfig(newConfig);
    updates.label = labelStrategyConfig(newConfig);
  }

  if (Object.keys(updates).length === 0) {
    return normalizeStrategyRow(current);
  }

  const { data: updated, error: updateErr } = await supabase
    .from('evolution_strategy_configs')
    .update(updates)
    .eq('id', input.id)
    .select('*')
    .single();

  if (updateErr || !updated) throw new Error(`Failed to update strategy: ${updateErr?.message}`);
  return normalizeStrategyRow(updated);
});

// ─── Clone strategy ──────────────────────────────────────────────

export const cloneStrategyAction = adminAction('cloneStrategyAction', async (
  input: { sourceId: string; name: string; description?: string },
  ctx: AdminContext,
) => {
  const { supabase } = ctx;

  const { data: source, error: sourceErr } = await supabase
    .from('evolution_strategy_configs')
    .select('config, pipeline_type')
    .eq('id', input.sourceId)
    .single();

  if (sourceErr || !source) throw new Error(`Source strategy not found: ${input.sourceId}`);

  return await createStrategyCore({
    name: input.name,
    description: input.description,
    config: source.config,
    pipelineType: source.pipeline_type,
  }, ctx);
});

// ─── Archive strategy ────────────────────────────────────────────

export const archiveStrategyAction = adminAction('archiveStrategyAction', async (
  id: string,
  ctx: AdminContext,
) => {
  const { supabase } = ctx;

  const { error } = await supabase
    .from('evolution_strategy_configs')
    .update({ status: 'archived' })
    .eq('id', id);

  if (error) throw new Error(`Failed to archive strategy: ${error.message}`);
  return { archived: true };
});

// ─── Unarchive strategy ──────────────────────────────────────────

export const unarchiveStrategyAction = adminAction('unarchiveStrategyAction', async (
  id: string,
  ctx: AdminContext,
) => {
  const { supabase } = ctx;

  const { error } = await supabase
    .from('evolution_strategy_configs')
    .update({ status: 'active' })
    .eq('id', id);

  if (error) throw new Error(`Failed to unarchive strategy: ${error.message}`);
  return { unarchived: true };
});

// ─── Delete strategy ─────────────────────────────────────────────

export const deleteStrategyAction = adminAction('deleteStrategyAction', async (
  id: string,
  ctx: AdminContext,
) => {
  const { supabase } = ctx;

  // Guard: only predefined + zero runs
  const { data: strategy } = await supabase
    .from('evolution_strategy_configs')
    .select('is_predefined, run_count')
    .eq('id', id)
    .single();

  if (!strategy) throw new Error('Strategy not found');
  if (!strategy.is_predefined) throw new Error('Only predefined strategies can be deleted');
  if (strategy.run_count > 0) throw new Error('Cannot delete strategy with completed runs. Use archive instead.');

  const { error } = await supabase
    .from('evolution_strategy_configs')
    .delete()
    .eq('id', id);

  if (error) throw new Error(`Failed to delete strategy: ${error.message}`);
  return { deleted: true };
});

// ─── Strategy presets ────────────────────────────────────────────

export interface StrategyPreset {
  name: string;
  description: string;
  config: StrategyConfig;
  pipelineType: PipelineType;
}

/** Returns 3 built-in strategy presets. */
export async function getStrategyPresets(): Promise<StrategyPreset[]> {
  return [
    {
      name: 'Economy',
      description: 'Low-cost exploration with minimal agents. Best for quick experiments.',
      config: {
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        iterations: 50,
        enabledAgents: [],
        budgetCapUsd: 0.25,
      },
      pipelineType: 'full',
    },
    {
      name: 'Balanced',
      description: 'Standard config with all agents. Good baseline for most prompts.',
      config: {
        generationModel: 'gpt-4.1-mini',
        judgeModel: 'gpt-4.1-nano',
        iterations: 50,
        enabledAgents: ['reflection', 'iterativeEditing', 'sectionDecomposition', 'debate', 'evolution', 'metaReview'],
        budgetCapUsd: 0.50,
      },
      pipelineType: 'full',
    },
    {
      name: 'Quality',
      description: 'Maximum quality with premium models and more iterations.',
      config: {
        generationModel: 'gpt-4.1',
        judgeModel: 'gpt-4.1-mini',
        iterations: 50,
        agentModels: { treeSearch: 'gpt-4.1-mini' },
        enabledAgents: ['reflection', 'iterativeEditing', 'sectionDecomposition', 'debate', 'evolution', 'metaReview', 'outlineGeneration'],
        budgetCapUsd: 1.00,
      },
      pipelineType: 'full',
    },
  ];
}

export const getStrategyPresetsAction = adminAction('getStrategyPresetsAction', async (ctx: AdminContext) => {
  void ctx;
  return await getStrategyPresets();
});
