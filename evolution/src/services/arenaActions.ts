'use server';
// Server actions for the Arena admin UI: topic CRUD, entry management, and leaderboard.
// V2 schema: elo data lives directly on evolution_arena_entries (no separate elo table).

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid } from './shared';
import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────

export interface ArenaTopic {
  id: string;
  prompt: string;
  title: string;
  difficulty_tier: string | null;
  domain_tags: string[];
  status: 'active' | 'archived';
  created_at: string;
  entry_count?: number;
}

export interface ArenaEntry {
  id: string;
  topic_id: string;
  run_id: string | null;
  variant_id: string | null;
  content: string;
  generation_method: string;
  model: string | null;
  cost_usd: number | null;
  elo_rating: number;
  mu: number;
  sigma: number;
  match_count: number;
  archived_at: string | null;
  created_at: string;
}

export interface ArenaComparison {
  id: string;
  topic_id: string;
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
  prompt: z.string().min(1).max(10000),
  title: z.string().min(1).max(200),
  difficulty_tier: z.string().max(50).optional(),
  domain_tags: z.array(z.string().max(100)).max(20).optional(),
});

// ─── Actions ────────────────────────────────────────────────────

export const getArenaTopicsAction = adminAction(
  'getArenaTopics',
  async (
    filters: { status?: string } | undefined,
    ctx: AdminContext,
  ): Promise<ArenaTopic[]> => {
    let query = ctx.supabase
      .from('evolution_arena_topics')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (filters?.status) query = query.eq('status', filters.status);

    const { data, error } = await query;
    if (error) throw error;

    const topics = (data ?? []) as ArenaTopic[];

    // Batch-fetch entry counts
    if (topics.length > 0) {
      const topicIds = topics.map(t => t.id);
      const { data: counts } = await ctx.supabase
        .from('evolution_arena_entries')
        .select('topic_id')
        .in('topic_id', topicIds)
        .is('archived_at', null);

      const countMap = new Map<string, number>();
      for (const entry of counts ?? []) {
        const tid = entry.topic_id as string;
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
      .from('evolution_arena_topics')
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
      .from('evolution_arena_topics')
      .insert({
        prompt: parsed.prompt,
        title: parsed.title,
        difficulty_tier: parsed.difficulty_tier ?? null,
        domain_tags: parsed.domain_tags ?? [],
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
      .from('evolution_arena_entries')
      .select('*')
      .eq('topic_id', input.topicId)
      .order('elo_rating', { ascending: false });

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
      .from('evolution_arena_entries')
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
      .eq('topic_id', input.topicId)
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
      .from('evolution_arena_topics')
      .update({ status: 'archived', archived_at: new Date().toISOString() })
      .eq('id', topicId);
    if (error) throw error;
    return { archived: true };
  },
);
