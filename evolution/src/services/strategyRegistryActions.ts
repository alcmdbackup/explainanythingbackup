'use server';
// Server actions for strategy registry CRUD. Strategies are stored in strategy_configs
// with is_predefined flag distinguishing admin-curated from auto-created configs.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import {
  hashStrategyConfig,
  labelStrategyConfig,
  type StrategyConfig,
  type StrategyConfigRow,
} from '@evolution/lib/core/strategyConfig';
import { validateStrategyConfig } from '@evolution/lib/core/configValidation';
import { DEFAULT_EVOLUTION_CONFIG } from '@evolution/lib/config';
import type { PipelineType } from '@evolution/lib/types';

type ActionResult<T> = { success: boolean; data: T | null; error: ErrorResponse | null };

/** Normalize a raw DB row to StrategyConfigRow, filling defaults for pre-migration columns. */
function normalizeStrategyRow(row: Record<string, unknown>): StrategyConfigRow {
  return {
    ...row,
    status: (row.status as string | null) ?? 'active',
    created_by: (row.created_by as string | null) ?? 'system',
  } as StrategyConfigRow;
}

// ─── List strategies ─────────────────────────────────────────────

const _getStrategiesAction = withLogging(async (
  filters?: { status?: 'active' | 'archived'; isPredefined?: boolean; createdBy?: string[]; pipelineType?: PipelineType; limit?: number },
): Promise<ActionResult<StrategyConfigRow[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    let query = supabase
      .from('evolution_strategy_configs')
      .select('*')
      .order('last_used_at', { ascending: false });

    if (filters?.status) query = query.eq('status', filters.status);
    if (filters?.isPredefined !== undefined) query = query.eq('is_predefined', filters.isPredefined);
    if (filters?.createdBy?.length) query = query.in('created_by', filters.createdBy);
    if (filters?.pipelineType) query = query.eq('pipeline_type', filters.pipelineType);
    if (filters?.limit) query = query.limit(filters.limit);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch strategies: ${error.message}`);

    const rows: StrategyConfigRow[] = (data ?? []).map(normalizeStrategyRow);

    return { success: true, data: rows, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getStrategiesAction') };
  }
}, 'getStrategiesAction');

export const getStrategiesAction = serverReadRequestId(_getStrategiesAction);

// ─── Get strategy detail ─────────────────────────────────────────

const _getStrategyDetailAction = withLogging(async (
  id: string,
): Promise<ActionResult<StrategyConfigRow>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('evolution_strategy_configs')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw new Error(`Strategy not found: ${id}`);

    return { success: true, data: normalizeStrategyRow(data), error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getStrategyDetailAction') };
  }
}, 'getStrategyDetailAction');

export const getStrategyDetailAction = serverReadRequestId(_getStrategyDetailAction);

// ─── Create strategy ─────────────────────────────────────────────

export interface CreateStrategyInput {
  name: string;
  description?: string;
  config: StrategyConfig;
  pipelineType?: PipelineType;
}

/** Core create-or-promote logic — no withLogging wrapper, safe for internal callers. */
async function createStrategyCore(input: CreateStrategyInput): Promise<ActionResult<StrategyConfigRow>> {
  await requireAdmin();
  if (!input.name.trim()) throw new Error('Strategy name is required');

  // Validate config before persisting — prevents invalid models/agents from corrupting leaderboard
  const validation = validateStrategyConfig(input.config);
  if (!validation.valid) {
    throw new Error(`Invalid strategy config: ${validation.errors.join('; ')}`);
  }

  const supabase = await createSupabaseServiceClient();

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
    return { success: true, data: normalizeStrategyRow(updated), error: null };
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
  return { success: true, data: normalizeStrategyRow(data), error: null };
}

const _createStrategyAction = withLogging(async (
  input: CreateStrategyInput,
): Promise<ActionResult<StrategyConfigRow>> => {
  try {
    return await createStrategyCore(input);
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'createStrategyAction') };
  }
}, 'createStrategyAction');

export const createStrategyAction = serverReadRequestId(_createStrategyAction);

// ─── Update strategy ─────────────────────────────────────────────

export interface UpdateStrategyInput {
  id: string;
  name?: string;
  description?: string;
  config?: StrategyConfig;
  pipelineType?: PipelineType;
}

const _updateStrategyAction = withLogging(async (
  input: UpdateStrategyInput,
): Promise<ActionResult<StrategyConfigRow>> => {
  try {
    await requireAdmin();
    if (input.name !== undefined && !input.name.trim()) {
      throw new Error('Strategy name cannot be empty');
    }
    const supabase = await createSupabaseServiceClient();

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

    // If config changed and strategy has completed runs → version: archive old, create new
    if (configChanged && (current.run_count ?? 0) > 0) {
      // Archive the old version
      await supabase
        .from('evolution_strategy_configs')
        .update({ status: 'archived' })
        .eq('id', input.id);

      // Create new version via create action
      return await createStrategyCore({
        name: input.name ?? current.name,
        description: input.description ?? current.description,
        config: newConfig,
        pipelineType: input.pipelineType ?? current.pipeline_type,
      });
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
      return { success: true, data: normalizeStrategyRow(current), error: null };
    }

    const { data: updated, error: updateErr } = await supabase
      .from('evolution_strategy_configs')
      .update(updates)
      .eq('id', input.id)
      .select('*')
      .single();

    if (updateErr || !updated) throw new Error(`Failed to update strategy: ${updateErr?.message}`);
    return { success: true, data: normalizeStrategyRow(updated), error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'updateStrategyAction') };
  }
}, 'updateStrategyAction');

export const updateStrategyAction = serverReadRequestId(_updateStrategyAction);

// ─── Clone strategy ──────────────────────────────────────────────

const _cloneStrategyAction = withLogging(async (
  input: { sourceId: string; name: string; description?: string },
): Promise<ActionResult<StrategyConfigRow>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: source, error: sourceErr } = await supabase
      .from('evolution_strategy_configs')
      .select('config, pipeline_type')
      .eq('id', input.sourceId)
      .single();

    if (sourceErr || !source) throw new Error(`Source strategy not found: ${input.sourceId}`);

    // Use unwrapped core to avoid double-logging (this action already has withLogging)
    return await createStrategyCore({
      name: input.name,
      description: input.description,
      config: source.config,
      pipelineType: source.pipeline_type,
    });
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'cloneStrategyAction') };
  }
}, 'cloneStrategyAction');

export const cloneStrategyAction = serverReadRequestId(_cloneStrategyAction);

// ─── Archive strategy ────────────────────────────────────────────

const _archiveStrategyAction = withLogging(async (
  id: string,
): Promise<ActionResult<{ archived: boolean }>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    // Guard: only predefined strategies can be archived
    const { data: strategy } = await supabase
      .from('evolution_strategy_configs')
      .select('is_predefined')
      .eq('id', id)
      .single();

    if (!strategy?.is_predefined) {
      throw new Error('Only predefined strategies can be archived');
    }

    const { error } = await supabase
      .from('evolution_strategy_configs')
      .update({ status: 'archived' })
      .eq('id', id);

    if (error) throw new Error(`Failed to archive strategy: ${error.message}`);
    return { success: true, data: { archived: true }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'archiveStrategyAction') };
  }
}, 'archiveStrategyAction');

export const archiveStrategyAction = serverReadRequestId(_archiveStrategyAction);

// ─── Delete strategy ─────────────────────────────────────────────

const _deleteStrategyAction = withLogging(async (
  id: string,
): Promise<ActionResult<{ deleted: boolean }>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

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
    return { success: true, data: { deleted: true }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'deleteStrategyAction') };
  }
}, 'deleteStrategyAction');

export const deleteStrategyAction = serverReadRequestId(_deleteStrategyAction);

// ─── Strategy presets ────────────────────────────────────────────

export interface StrategyPreset {
  name: string;
  description: string;
  config: StrategyConfig;
  pipelineType: PipelineType;
}

/** Returns 3 built-in strategy presets derived from DEFAULT_EVOLUTION_CONFIG. */
export async function getStrategyPresets(): Promise<StrategyPreset[]> {
  return [
    {
      name: 'Economy',
      description: 'Low-cost exploration with minimal agents. Best for quick experiments.',
      config: {
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        iterations: 2,
        budgetCaps: { generation: 0.30, calibration: 0.30, tournament: 0.40 },
        enabledAgents: [],
      },
      pipelineType: 'minimal',
    },
    {
      name: 'Balanced',
      description: 'Standard config with all agents. Good baseline for most prompts.',
      config: {
        generationModel: DEFAULT_EVOLUTION_CONFIG.generationModel ?? 'gpt-4.1-mini',
        judgeModel: DEFAULT_EVOLUTION_CONFIG.judgeModel ?? 'gpt-4.1-nano',
        iterations: 3,
        budgetCaps: DEFAULT_EVOLUTION_CONFIG.budgetCaps,
        enabledAgents: ['reflection', 'iterativeEditing', 'sectionDecomposition', 'debate', 'evolution', 'metaReview'],
      },
      pipelineType: 'full',
    },
    {
      name: 'Quality',
      description: 'Maximum quality with premium models and more iterations.',
      config: {
        generationModel: 'gpt-4.1',
        judgeModel: 'gpt-4.1-mini',
        iterations: 5,
        budgetCaps: DEFAULT_EVOLUTION_CONFIG.budgetCaps,
        agentModels: { treeSearch: 'gpt-4.1-mini' },
        enabledAgents: ['reflection', 'iterativeEditing', 'sectionDecomposition', 'debate', 'evolution', 'metaReview', 'outlineGeneration'],
      },
      pipelineType: 'full',
    },
  ];
}

const _getStrategyPresetsAction = withLogging(async (): Promise<ActionResult<StrategyPreset[]>> => {
  try {
    await requireAdmin();
    return { success: true, data: await getStrategyPresets(), error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getStrategyPresetsAction') };
  }
}, 'getStrategyPresetsAction');

export const getStrategyPresetsAction = serverReadRequestId(_getStrategyPresetsAction);
