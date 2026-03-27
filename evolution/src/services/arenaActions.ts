'use server';
// Server actions for the Arena admin UI: topic CRUD, entry management, and leaderboard.
// V2 schema: elo data lives directly on evolution_variants (no separate elo table).

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid } from './shared';
import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────

export interface ArenaTopic {
  id: string;
  prompt: string;
  name: string;
  status: 'active' | 'archived';
  created_at: string;
  entry_count?: number;
}

export interface ArenaEntry {
  id: string;
  prompt_id: string;
  run_id: string | null;
  variant_content: string;
  synced_to_arena: boolean;
  generation_method: string;
  model: string | null;
  cost_usd: number | null;
  elo_score: number;
  mu: number;
  sigma: number;
  arena_match_count: number;
  archived_at: string | null;
  created_at: string;
}

export interface ArenaComparison {
  id: string;
  prompt_id: string;
  entry_a: string;
  entry_b: string;
  winner: 'a' | 'b' | 'draw';
  confidence: number;
  run_id: string | null;
  status: string;
  created_at: string;
}

// ─── Schemas ────────────────────────────────────────────────────

const createTopicSchema = z.object({
  prompt: z.string().trim().min(1).max(10000),
  name: z.string().trim().min(1).max(200),
});

// ─── Actions ────────────────────────────────────────────────────

export const getArenaTopicsAction = adminAction(
  'getArenaTopics',
  async (
    filters: { status?: string; filterTestContent?: boolean } | undefined,
    ctx: AdminContext,
  ): Promise<ArenaTopic[]> => {
    let query = ctx.supabase
      .from('evolution_prompts')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (filters?.status) query = query.eq('status', filters.status);
    if (filters?.filterTestContent) query = query.not('name', 'ilike', '%[TEST]%');

    const { data, error } = await query;
    if (error) throw error;

    const topics = (data ?? []) as ArenaTopic[];

    // Batch-fetch entry counts
    if (topics.length > 0) {
      const topicIds = topics.map(t => t.id);
      const { data: counts, error: countError } = await ctx.supabase
        .from('evolution_variants')
        .select('prompt_id')
        .eq('synced_to_arena', true)
        .in('prompt_id', topicIds)
        .is('archived_at', null);
      if (countError) throw countError;

      const countMap = new Map<string, number>();
      for (const entry of counts ?? []) {
        const tid = entry.prompt_id;
        if (!tid) continue;
        countMap.set(tid, (countMap.get(tid) ?? 0) + 1);
      }
      for (const topic of topics) {
        topic.entry_count = countMap.get(topic.id) ?? 0;
      }
    }

    return topics;
  },
);

export const getArenaTopicDetailAction = adminAction(
  'getArenaTopicDetail',
  async (topicId: string, ctx: AdminContext): Promise<ArenaTopic> => {
    if (!validateUuid(topicId)) throw new Error('Invalid topicId');
    const { data, error } = await ctx.supabase
      .from('evolution_prompts')
      .select('*')
      .eq('id', topicId)
      .single();
    if (error) throw error;
    return data as ArenaTopic;
  },
);

export const createArenaTopicAction = adminAction(
  'createArenaTopic',
  async (input: z.input<typeof createTopicSchema>, ctx: AdminContext): Promise<ArenaTopic> => {
    const parsed = createTopicSchema.parse(input);
    const { data, error } = await ctx.supabase
      .from('evolution_prompts')
      .insert({
        prompt: parsed.prompt,
        name: parsed.name,
      })
      .select()
      .single();
    if (error) throw error;
    return data as ArenaTopic;
  },
);

export const getArenaEntriesAction = adminAction(
  'getArenaEntries',
  async (
    input: { topicId: string; includeArchived?: boolean },
    ctx: AdminContext,
  ): Promise<ArenaEntry[]> => {
    if (!validateUuid(input.topicId)) throw new Error('Invalid topicId');

    let query = ctx.supabase
      .from('evolution_variants')
      .select('*')
      .eq('prompt_id', input.topicId)
      .eq('synced_to_arena', true)
      .order('elo_score', { ascending: false });

    if (!input.includeArchived) query = query.is('archived_at', null);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as ArenaEntry[];
  },
);

export const getArenaEntryDetailAction = adminAction(
  'getArenaEntryDetail',
  async (entryId: string, ctx: AdminContext): Promise<ArenaEntry> => {
    if (!validateUuid(entryId)) throw new Error('Invalid entryId');
    const { data, error } = await ctx.supabase
      .from('evolution_variants')
      .select('*')
      .eq('id', entryId)
      .single();
    if (error) throw error;
    return data as ArenaEntry;
  },
);

export const getArenaComparisonsAction = adminAction(
  'getArenaComparisons',
  async (
    input: { topicId: string; limit?: number },
    ctx: AdminContext,
  ): Promise<ArenaComparison[]> => {
    if (!validateUuid(input.topicId)) throw new Error('Invalid topicId');
    const { data, error } = await ctx.supabase
      .from('evolution_arena_comparisons')
      .select('*')
      .eq('prompt_id', input.topicId)
      .order('created_at', { ascending: false })
      .limit(input.limit ?? 100);
    if (error) throw error;
    return (data ?? []) as ArenaComparison[];
  },
);

export const archiveArenaTopicAction = adminAction(
  'archiveArenaTopic',
  async (topicId: string, ctx: AdminContext): Promise<{ archived: boolean }> => {
    if (!validateUuid(topicId)) throw new Error('Invalid topicId');
    const { error } = await ctx.supabase
      .from('evolution_prompts')
      .update({ status: 'archived', archived_at: new Date().toISOString() })
      .eq('id', topicId);
    if (error) throw error;
    return { archived: true };
  },
);

// ─── Prompt registry actions (merged from promptRegistryActionsV2) ──

export interface PromptListItem {
  id: string;
  prompt: string;
  name: string;
  status: 'active' | 'archived';
  deleted_at: string | null;
  archived_at: string | null;
  created_at: string;
}

const createPromptSchema = z.object({
  name: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(10000),
});

const updatePromptSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  prompt: z.string().trim().min(1).max(10000).optional(),
});

export const listPromptsAction = adminAction(
  'listPrompts',
  async (
    input: { limit: number; offset: number; status?: string; filterTestContent?: boolean },
    ctx: AdminContext,
  ): Promise<{ items: PromptListItem[]; total: number }> => {
    let query = ctx.supabase
      .from('evolution_prompts')
      .select('*', { count: 'exact' })
      .is('deleted_at', null);

    if (input.status) query = query.eq('status', input.status);
    if (input.filterTestContent) query = query.not('name', 'ilike', '%[TEST]%');

    query = query.order('created_at', { ascending: false })
      .range(input.offset, input.offset + input.limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return { items: (data ?? []) as PromptListItem[], total: count ?? 0 };
  },
);

export const getPromptDetailAction = adminAction(
  'getPromptDetail',
  async (promptId: string, ctx: AdminContext): Promise<PromptListItem> => {
    if (!validateUuid(promptId)) throw new Error('Invalid promptId');
    const { data, error } = await ctx.supabase
      .from('evolution_prompts')
      .select('*')
      .eq('id', promptId)
      .single();
    if (error) throw error;
    return data as PromptListItem;
  },
);

export const createPromptAction = adminAction(
  'createPrompt',
  async (input: z.input<typeof createPromptSchema>, ctx: AdminContext): Promise<PromptListItem> => {
    const parsed = createPromptSchema.parse(input);

    const { data, error } = await ctx.supabase
      .from('evolution_prompts')
      .insert({
        name: parsed.name,
        prompt: parsed.prompt,
      })
      .select()
      .single();

    if (error) throw error;
    return data as PromptListItem;
  },
);

export const updatePromptAction = adminAction(
  'updatePrompt',
  async (input: z.input<typeof updatePromptSchema>, ctx: AdminContext): Promise<PromptListItem> => {
    const parsed = updatePromptSchema.parse(input);
    if (!validateUuid(parsed.id)) throw new Error('Invalid promptId');

    const updates: Record<string, unknown> = {};
    if (parsed.name !== undefined) updates.name = parsed.name;
    if (parsed.prompt !== undefined) updates.prompt = parsed.prompt;

    if (Object.keys(updates).length === 0) throw new Error('No fields to update');

    const { data, error } = await ctx.supabase
      .from('evolution_prompts')
      .update(updates)
      .eq('id', parsed.id)
      .select()
      .single();

    if (error) throw error;
    return data as PromptListItem;
  },
);

export const archivePromptAction = adminAction(
  'archivePrompt',
  async (promptId: string, ctx: AdminContext): Promise<{ archived: boolean }> => {
    if (!validateUuid(promptId)) throw new Error('Invalid promptId');
    const { error } = await ctx.supabase
      .from('evolution_prompts')
      .update({ status: 'archived', archived_at: new Date().toISOString() })
      .eq('id', promptId);
    if (error) throw error;
    return { archived: true };
  },
);

export const deletePromptAction = adminAction(
  'deletePrompt',
  async (promptId: string, ctx: AdminContext): Promise<{ deleted: boolean }> => {
    if (!validateUuid(promptId)) throw new Error('Invalid promptId');
    const { error } = await ctx.supabase
      .from('evolution_prompts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', promptId);
    if (error) throw error;
    return { deleted: true };
  },
);
