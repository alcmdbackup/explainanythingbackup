'use server';
// Server actions for prompt registry CRUD. Prompts are stored in evolution_arena_topics
// with additional metadata columns (difficulty_tier, domain_tags, status).

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid } from './shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PromptMetadata } from '@evolution/lib/types';

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

export const getPromptsAction = adminAction(
  'getPromptsAction',
  async (
    filters: { status?: 'active' | 'archived'; includeDeleted?: boolean; limit?: number } | undefined,
    ctx: AdminContext,
  ) => {
    let query = ctx.supabase
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

    return (data ?? []).map(normalizePromptRow);
  },
);

// ─── Create prompt ───────────────────────────────────────────────

export interface CreatePromptInput {
  prompt: string;
  title: string;
  difficultyTier?: string;
  domainTags?: string[];
  status?: 'active' | 'archived';
}

export const createPromptAction = adminAction(
  'createPromptAction',
  async (input: CreatePromptInput, ctx: AdminContext) => {
    const trimmedPrompt = input.prompt.trim();
    if (!trimmedPrompt) throw new Error('Prompt text is required');
    const trimmedTitle = input.title.trim();
    if (!trimmedTitle) throw new Error('Title is required');

    const { data: existing } = await ctx.supabase
      .from('evolution_arena_topics')
      .select('id')
      .ilike('prompt', trimmedPrompt)
      .is('deleted_at', null)
      .single();

    if (existing) {
      throw new Error('A prompt with this text already exists (case-insensitive match)');
    }

    const { data, error } = await ctx.supabase
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

    return normalizePromptRow(data);
  },
);

// ─── Update prompt ───────────────────────────────────────────────

export interface UpdatePromptInput {
  id: string;
  prompt?: string;
  title?: string;
  difficultyTier?: string | null;
  domainTags?: string[];
  status?: 'active' | 'archived';
}

export const updatePromptAction = adminAction(
  'updatePromptAction',
  async (input: UpdatePromptInput, ctx: AdminContext) => {
    if (input.prompt !== undefined) {
      const trimmed = input.prompt.trim();
      if (!trimmed) throw new Error('Prompt text cannot be empty');

      const { data: existing } = await ctx.supabase
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

    const { data, error } = await ctx.supabase
      .from('evolution_arena_topics')
      .update(updates)
      .eq('id', input.id)
      .is('deleted_at', null)
      .select('id, prompt, title, difficulty_tier, domain_tags, status, deleted_at, created_at')
      .single();

    if (error || !data) throw new Error(`Failed to update prompt: ${error?.message ?? 'not found'}`);

    return normalizePromptRow(data);
  },
);

// ─── Archive prompt ──────────────────────────────────────────────

export const archivePromptAction = adminAction(
  'archivePromptAction',
  async (id: string, ctx: AdminContext) => {
    const { error } = await ctx.supabase
      .from('evolution_arena_topics')
      .update({ status: 'archived' })
      .eq('id', id)
      .is('deleted_at', null);

    if (error) throw new Error(`Failed to archive prompt: ${error.message}`);
    return { archived: true };
  },
);

// ─── Unarchive prompt ───────────────────────────────────────────

export const unarchivePromptAction = adminAction(
  'unarchivePromptAction',
  async (id: string, ctx: AdminContext) => {
    const { error } = await ctx.supabase
      .from('evolution_arena_topics')
      .update({ status: 'active' })
      .eq('id', id)
      .is('deleted_at', null);

    if (error) throw new Error(`Failed to unarchive prompt: ${error.message}`);
    return { unarchived: true };
  },
);

// ─── Delete prompt ───────────────────────────────────────────────

export const deletePromptAction = adminAction(
  'deletePromptAction',
  async (id: string, ctx: AdminContext) => {
    const { data: runs } = await ctx.supabase
      .from('evolution_runs')
      .select('id')
      .eq('prompt_id', id)
      .limit(1);

    if (runs && runs.length > 0) {
      throw new Error('Cannot delete prompt with associated runs. Use archive instead.');
    }

    const { error } = await ctx.supabase
      .from('evolution_arena_topics')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(`Failed to delete prompt: ${error.message}`);
    return { deleted: true };
  },
);

// ─── Get prompt title by ID ──────────────────────────────────────

export const getPromptTitleAction = adminAction(
  'getPromptTitleAction',
  async (id: string, ctx: AdminContext) => {
    if (!validateUuid(id)) {
      throw new Error(`Invalid prompt ID format: ${id}`);
    }

    const { data, error } = await ctx.supabase
      .from('evolution_arena_topics')
      .select('title')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error || !data) throw new Error(`Prompt not found: ${id}`);
    return (data.title as string | null) ?? id.substring(0, 8);
  },
);

// ─── Resolve prompt by text (for auto-link + CLI) ────────────────

/**
 * Find an active prompt by case-insensitive text match.
 * Used by finalizePipelineRun() auto-link and CLI --prompt flag.
 * NOT a server action — takes a supabase client param directly.
 */
export async function resolvePromptByText(
  supabase: SupabaseClient,
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
