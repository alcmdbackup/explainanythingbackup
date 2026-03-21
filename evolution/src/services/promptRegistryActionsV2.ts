'use server';
// V2 prompt registry CRUD actions for the admin Prompts page.
// Operates on evolution_arena_topics table. Uses adminAction wrapper.

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid } from './shared';
import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────

export interface PromptListItem {
  id: string;
  prompt: string;
  title: string;
  difficulty_tier: string | null;
  domain_tags: string[];
  status: 'active' | 'archived';
  deleted_at: string | null;
  archived_at: string | null;
  created_at: string;
}

// ─── Schemas ────────────────────────────────────────────────────

const createPromptSchema = z.object({
  title: z.string().min(1).max(200),
  prompt: z.string().min(1).max(10000),
  difficulty_tier: z.string().max(50).optional(),
  domain_tags: z.string().max(500).optional(),
});

const updatePromptSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  prompt: z.string().min(1).max(10000).optional(),
  difficulty_tier: z.string().max(50).optional(),
  domain_tags: z.string().max(500).optional(),
});

// ─── Actions ────────────────────────────────────────────────────

/** List prompts with pagination. Named listPromptsAction to avoid collision with experimentActionsV2.getPromptsAction. */
export const listPromptsAction = adminAction(
  'listPrompts',
  async (
    input: { limit: number; offset: number; status?: string; difficulty_tier?: string },
    ctx: AdminContext,
  ): Promise<{ items: PromptListItem[]; total: number }> => {
    let query = ctx.supabase
      .from('evolution_arena_topics')
      .select('*', { count: 'exact' })
      .is('deleted_at', null);

    if (input.status) query = query.eq('status', input.status);
    if (input.difficulty_tier) query = query.eq('difficulty_tier', input.difficulty_tier);

    query = query.order('created_at', { ascending: false })
      .range(input.offset, input.offset + input.limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return { items: (data ?? []) as PromptListItem[], total: count ?? 0 };
  },
);

/** Get prompt detail by ID. */
export const getPromptDetailAction = adminAction(
  'getPromptDetail',
  async (promptId: string, ctx: AdminContext): Promise<PromptListItem> => {
    if (!validateUuid(promptId)) throw new Error('Invalid promptId');
    const { data, error } = await ctx.supabase
      .from('evolution_arena_topics')
      .select('*')
      .eq('id', promptId)
      .single();
    if (error) throw error;
    return data as PromptListItem;
  },
);

/** Create a new prompt. */
export const createPromptAction = adminAction(
  'createPrompt',
  async (input: z.input<typeof createPromptSchema>, ctx: AdminContext): Promise<PromptListItem> => {
    const parsed = createPromptSchema.parse(input);

    const domainTags = parsed.domain_tags
      ? parsed.domain_tags.split(',').map(t => t.trim()).filter(Boolean)
      : [];

    const { data, error } = await ctx.supabase
      .from('evolution_arena_topics')
      .insert({
        title: parsed.title,
        prompt: parsed.prompt,
        difficulty_tier: parsed.difficulty_tier ?? null,
        domain_tags: domainTags,
      })
      .select()
      .single();

    if (error) throw error;
    return data as PromptListItem;
  },
);

/** Update a prompt. */
export const updatePromptAction = adminAction(
  'updatePrompt',
  async (input: z.input<typeof updatePromptSchema>, ctx: AdminContext): Promise<PromptListItem> => {
    const parsed = updatePromptSchema.parse(input);
    if (!validateUuid(parsed.id)) throw new Error('Invalid promptId');

    const updates: Record<string, unknown> = {};
    if (parsed.title !== undefined) updates.title = parsed.title;
    if (parsed.prompt !== undefined) updates.prompt = parsed.prompt;
    if (parsed.difficulty_tier !== undefined) updates.difficulty_tier = parsed.difficulty_tier;
    if (parsed.domain_tags !== undefined) {
      updates.domain_tags = parsed.domain_tags
        .split(',').map(t => t.trim()).filter(Boolean);
    }

    if (Object.keys(updates).length === 0) throw new Error('No fields to update');

    const { data, error } = await ctx.supabase
      .from('evolution_arena_topics')
      .update(updates)
      .eq('id', parsed.id)
      .select()
      .single();

    if (error) throw error;
    return data as PromptListItem;
  },
);

/** Archive a prompt. */
export const archivePromptAction = adminAction(
  'archivePrompt',
  async (promptId: string, ctx: AdminContext): Promise<{ archived: boolean }> => {
    if (!validateUuid(promptId)) throw new Error('Invalid promptId');
    const { error } = await ctx.supabase
      .from('evolution_arena_topics')
      .update({ status: 'archived', archived_at: new Date().toISOString() })
      .eq('id', promptId);
    if (error) throw error;
    return { archived: true };
  },
);

/** Delete a prompt (soft delete). */
export const deletePromptAction = adminAction(
  'deletePrompt',
  async (promptId: string, ctx: AdminContext): Promise<{ deleted: boolean }> => {
    if (!validateUuid(promptId)) throw new Error('Invalid promptId');
    const { error } = await ctx.supabase
      .from('evolution_arena_topics')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', promptId);
    if (error) throw error;
    return { deleted: true };
  },
);
