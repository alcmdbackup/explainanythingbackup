'use server';
// Server actions for prompt registry CRUD. Prompts are stored in evolution_arena_topics
// with additional metadata columns (difficulty_tier, domain_tags, status).

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import type { PromptMetadata } from '@evolution/lib/types';

type ActionResult<T> = { success: boolean; data: T | null; error: ErrorResponse | null };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(id: string, label: string): void {
  if (!UUID_REGEX.test(id)) {
    throw new Error(`Invalid ${label} format: ${id}`);
  }
}

/** Normalize a raw DB row to PromptMetadata, filling defaults for pre-migration rows. */
function normalizePromptRow(row: Record<string, unknown>): PromptMetadata {
  return {
    ...row,
    title: (row.title as string | null) ?? (row.prompt as string).slice(0, 60),
    domain_tags: (row.domain_tags as string[] | null) ?? [],
    status: (row.status as string | null) ?? 'active',
  } as PromptMetadata;
}

// ─── List prompts ────────────────────────────────────────────────

const _getPromptsAction = withLogging(async (
  filters?: { status?: 'active' | 'archived'; includeDeleted?: boolean; limit?: number },
): Promise<ActionResult<PromptMetadata[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    let query = supabase
      .from('evolution_arena_topics')
      .select('id, prompt, title, difficulty_tier, domain_tags, status, deleted_at, created_at')
      .order('created_at', { ascending: false });

    if (!filters?.includeDeleted) {
      query = query.is('deleted_at', null);
    }
    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch prompts: ${error.message}`);

    const prompts: PromptMetadata[] = (data ?? []).map(normalizePromptRow);

    return { success: true, data: prompts, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getPromptsAction') };
  }
}, 'getPromptsAction');

export const getPromptsAction = serverReadRequestId(_getPromptsAction);

// ─── Create prompt ───────────────────────────────────────────────

export interface CreatePromptInput {
  prompt: string;
  title: string;
  difficultyTier?: string;
  domainTags?: string[];
  status?: 'active' | 'archived';
}

const _createPromptAction = withLogging(async (
  input: CreatePromptInput,
): Promise<ActionResult<PromptMetadata>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const trimmedPrompt = input.prompt.trim();
    if (!trimmedPrompt) throw new Error('Prompt text is required');
    const trimmedTitle = input.title.trim();
    if (!trimmedTitle) throw new Error('Title is required');

    const { data: existing } = await supabase
      .from('evolution_arena_topics')
      .select('id')
      .ilike('prompt', trimmedPrompt)
      .is('deleted_at', null)
      .single();

    if (existing) {
      throw new Error('A prompt with this text already exists (case-insensitive match)');
    }

    const { data, error } = await supabase
      .from('evolution_arena_topics')
      .insert({
        prompt: trimmedPrompt,
        title: trimmedTitle,
        difficulty_tier: input.difficultyTier ?? null,
        domain_tags: input.domainTags ?? [],
        status: input.status ?? 'active',
      })
      .select('id, prompt, title, difficulty_tier, domain_tags, status, deleted_at, created_at')
      .single();

    if (error || !data) throw new Error(`Failed to create prompt: ${error?.message}`);

    return { success: true, data: normalizePromptRow(data), error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'createPromptAction') };
  }
}, 'createPromptAction');

export const createPromptAction = serverReadRequestId(_createPromptAction);

// ─── Update prompt ───────────────────────────────────────────────

export interface UpdatePromptInput {
  id: string;
  prompt?: string;
  title?: string;
  difficultyTier?: string | null;
  domainTags?: string[];
  status?: 'active' | 'archived';
}

const _updatePromptAction = withLogging(async (
  input: UpdatePromptInput,
): Promise<ActionResult<PromptMetadata>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    if (input.prompt !== undefined) {
      const trimmed = input.prompt.trim();
      if (!trimmed) throw new Error('Prompt text cannot be empty');

      const { data: existing } = await supabase
        .from('evolution_arena_topics')
        .select('id')
        .ilike('prompt', trimmed)
        .is('deleted_at', null)
        .neq('id', input.id)
        .single();

      if (existing) {
        throw new Error('Another prompt with this text already exists (case-insensitive match)');
      }
    }

    if (input.title !== undefined && !input.title.trim()) {
      throw new Error('Title cannot be empty');
    }

    const updates: Record<string, unknown> = {};
    if (input.prompt !== undefined) updates.prompt = input.prompt.trim();
    if (input.title !== undefined) updates.title = input.title.trim();
    if (input.difficultyTier !== undefined) updates.difficulty_tier = input.difficultyTier;
    if (input.domainTags !== undefined) updates.domain_tags = input.domainTags;
    if (input.status !== undefined) updates.status = input.status;

    if (Object.keys(updates).length === 0) {
      throw new Error('No fields to update');
    }

    const { data, error } = await supabase
      .from('evolution_arena_topics')
      .update(updates)
      .eq('id', input.id)
      .is('deleted_at', null)
      .select('id, prompt, title, difficulty_tier, domain_tags, status, deleted_at, created_at')
      .single();

    if (error || !data) throw new Error(`Failed to update prompt: ${error?.message ?? 'not found'}`);

    return { success: true, data: normalizePromptRow(data), error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'updatePromptAction') };
  }
}, 'updatePromptAction');

export const updatePromptAction = serverReadRequestId(_updatePromptAction);

// ─── Archive prompt ──────────────────────────────────────────────

const _archivePromptAction = withLogging(async (
  id: string,
): Promise<ActionResult<{ archived: boolean }>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { error } = await supabase
      .from('evolution_arena_topics')
      .update({ status: 'archived' })
      .eq('id', id)
      .is('deleted_at', null);

    if (error) throw new Error(`Failed to archive prompt: ${error.message}`);
    return { success: true, data: { archived: true }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'archivePromptAction') };
  }
}, 'archivePromptAction');

export const archivePromptAction = serverReadRequestId(_archivePromptAction);

// ─── Unarchive prompt ───────────────────────────────────────────

const _unarchivePromptAction = withLogging(async (
  id: string,
): Promise<ActionResult<{ unarchived: boolean }>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { error } = await supabase
      .from('evolution_arena_topics')
      .update({ status: 'active' })
      .eq('id', id)
      .is('deleted_at', null);

    if (error) throw new Error(`Failed to unarchive prompt: ${error.message}`);
    return { success: true, data: { unarchived: true }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'unarchivePromptAction') };
  }
}, 'unarchivePromptAction');

export const unarchivePromptAction = serverReadRequestId(_unarchivePromptAction);

// ─── Delete prompt ───────────────────────────────────────────────

const _deletePromptAction = withLogging(async (
  id: string,
): Promise<ActionResult<{ deleted: boolean }>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: runs } = await supabase
      .from('evolution_runs')
      .select('id')
      .eq('prompt_id', id)
      .limit(1);

    if (runs && runs.length > 0) {
      throw new Error('Cannot delete prompt with associated runs. Use archive instead.');
    }

    const { error } = await supabase
      .from('evolution_arena_topics')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(`Failed to delete prompt: ${error.message}`);
    return { success: true, data: { deleted: true }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'deletePromptAction') };
  }
}, 'deletePromptAction');

export const deletePromptAction = serverReadRequestId(_deletePromptAction);

// ─── Get prompt title by ID ──────────────────────────────────────

const _getPromptTitleAction = withLogging(async (
  id: string,
): Promise<ActionResult<string>> => {
  try {
    await requireAdmin();
    validateUuid(id, 'prompt ID');
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('evolution_arena_topics')
      .select('title')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error || !data) throw new Error(`Prompt not found: ${id}`);
    return { success: true, data: (data.title as string | null) ?? id.substring(0, 8), error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getPromptTitleAction') };
  }
}, 'getPromptTitleAction');

export const getPromptTitleAction = serverReadRequestId(_getPromptTitleAction);

// ─── Resolve prompt by text (for auto-link + CLI) ────────────────

/**
 * Find an active prompt by case-insensitive text match.
 * Used by finalizePipelineRun() auto-link and CLI --prompt flag.
 */
export async function resolvePromptByText(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  promptText: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('evolution_arena_topics')
    .select('id')
    .ilike('prompt', promptText.trim())
    .is('deleted_at', null)
    .single();

  return data?.id ?? null;
}
