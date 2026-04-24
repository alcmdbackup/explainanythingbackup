'use server';
// Server actions for the Arena admin UI: topic CRUD, entry management, and leaderboard.
// V2 schema: elo data lives directly on evolution_variants (no separate elo table).

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid, applyTestContentColumnFilter } from './shared';
import { _INTERNAL_ELO_SIGMA_SCALE } from '@evolution/lib/shared/computeRatings';
import { z } from 'zod';

/** Transform raw DB row (with mu/sigma) to ArenaEntry (with elo/uncertainty). */
function toArenaEntry(row: Record<string, unknown>): ArenaEntry {
  const sigma = row.sigma as number | null;
  const generationMethod = row.generation_method as string;
  return {
    id: row.id as string,
    prompt_id: row.prompt_id as string,
    run_id: row.run_id as string | null,
    variant_content: row.variant_content as string,
    synced_to_arena: row.synced_to_arena as boolean,
    generation_method: generationMethod,
    is_seed: generationMethod === 'seed',
    model: row.model as string | null,
    cost_usd: row.cost_usd as number | null,
    elo_score: row.elo_score as number,
    uncertainty: sigma != null ? sigma * _INTERNAL_ELO_SIGMA_SCALE : 0,
    arena_match_count: row.arena_match_count as number,
    archived_at: row.archived_at as string | null,
    created_at: row.created_at as string,
    generation: (row.generation as number | null) ?? null,
    parent_variant_id: (row.parent_variant_id as string | null) ?? null,
    parent_elo: (row.parent_elo as number | null) ?? null,
    parent_uncertainty: (row.parent_uncertainty as number | null) ?? null,
    parent_run_id: (row.parent_run_id as string | null) ?? null,
    // Phase 3 (track_tactic_effectiveness): tactic identity fields. agent_name comes
    // directly off evolution_variants (null for seeds / manual entries); tactic_id is
    // resolved via batch lookup against evolution_tactics in the caller.
    agent_name: (row.agent_name as string | null) ?? null,
    tactic_id: null,
  };
}

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
  /** True when this entry is the seed variant (generation_method === 'seed'). */
  is_seed: boolean;
  model: string | null;
  cost_usd: number | null;
  elo_score: number;
  /** Elo-scale uncertainty (converted from DB sigma × 16). */
  uncertainty: number;
  arena_match_count: number;
  archived_at: string | null;
  created_at: string;
  /** Iteration (generation) number from the originating run. */
  generation: number | null;
  /** Parent variant ID for lineage display. */
  parent_variant_id: string | null;
  /** Parent's current ELO (mu preferred over elo_score). Used by VariantParentBadge. */
  parent_elo: number | null;
  /** Parent's uncertainty (sigma). */
  parent_uncertainty: number | null;
  /** Parent's run_id — detects cross-run parents. */
  parent_run_id: string | null;
  /** Tactic name (evolution_variants.agent_name) — null for seed / manual entries. */
  agent_name: string | null;
  /** Tactic UUID resolved from agent_name via evolution_tactics lookup; null when
   *  agent_name is null or no matching tactic row exists (e.g. legacy names). */
  tactic_id: string | null;
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
    if (filters?.filterTestContent) query = applyTestContentColumnFilter(query);

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

export interface ArenaTopicDetail extends ArenaTopic {
  /** The topic's seed variant (generation_method='seed'), or null when no seed
   *  has been persisted yet. Sourced via a dedicated query — NOT from the paginated
   *  leaderboard `entries` array — so the arena topic page's seed panel is always
   *  available regardless of which leaderboard page the user is on. If legacy data
   *  has multiple seeds for one topic (pre-EVOLUTION_REUSE_SEED_RATING), the
   *  highest-Elo row wins (ties broken by earliest created_at). */
  seedVariant: ArenaEntry | null;
}

export const getArenaTopicDetailAction = adminAction(
  'getArenaTopicDetail',
  async (topicId: string, ctx: AdminContext): Promise<ArenaTopicDetail> => {
    if (!validateUuid(topicId)) throw new Error('Invalid topicId');
    const { data, error } = await ctx.supabase
      .from('evolution_prompts')
      .select('*')
      .eq('id', topicId)
      .single();
    if (error) throw error;
    if (!data) throw new Error(`Arena topic not found: ${topicId}`);

    // Fetch the topic's seed variant (if any). Deterministic ordering handles the
    // legacy EVOLUTION_REUSE_SEED_RATING=false case where multiple seed rows may
    // exist for one prompt — we pick the highest-Elo row with the earliest created_at
    // as tiebreak. `.maybeSingle()` returns null (not an error) when no seed exists.
    const { data: seedRow, error: seedError } = await ctx.supabase
      .from('evolution_variants')
      .select('*')
      .eq('prompt_id', topicId)
      .eq('generation_method', 'seed')
      .eq('synced_to_arena', true)  // match the leaderboard query (line ~210); defensive against any future seed row with synced_to_arena=false
      .is('archived_at', null)
      .order('elo_score', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (seedError) throw seedError;

    return {
      ...(data as ArenaTopic),
      seedVariant: seedRow ? toArenaEntry(seedRow as Record<string, unknown>) : null,
    };
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
    input: { topicId: string; includeArchived?: boolean; limit?: number; offset?: number },
    ctx: AdminContext,
  ): Promise<{ items: ArenaEntry[]; total: number }> => {
    if (!validateUuid(input.topicId)) throw new Error('Invalid topicId');

    let query = ctx.supabase
      .from('evolution_variants')
      .select('*', { count: 'exact' })
      .eq('prompt_id', input.topicId)
      .eq('synced_to_arena', true)
      .order('elo_score', { ascending: false });

    if (!input.includeArchived) query = query.is('archived_at', null);

    if (input.limit != null) {
      const offset = input.offset ?? 0;
      query = query.range(offset, offset + input.limit - 1);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    const items = (data ?? []).map(toArenaEntry);

    // Phase 3 (track_tactic_effectiveness_evolution_20260422): batch-resolve tactic_id
    // from agent_name. In-memory lookup — PostgREST sub-select on unrelated-table isn't
    // supported, and 24 distinct tactics means one small follow-up query is cheap.
    const tacticNames = [...new Set(items.map(v => v.agent_name).filter((n): n is string => !!n))];
    if (tacticNames.length > 0) {
      const { data: tacticRows, error: tacticError } = await ctx.supabase
        .from('evolution_tactics')
        .select('id, name')
        .in('name', tacticNames);
      if (tacticError) throw tacticError;
      const tacticIdByName = new Map(
        (tacticRows ?? []).map(t => [t.name as string, t.id as string]),
      );
      for (const item of items) {
        if (item.agent_name) {
          item.tactic_id = tacticIdByName.get(item.agent_name) ?? null;
        }
      }
    }

    // Phase 3: batch-fetch parent ratings for VariantParentBadge.
    const parentIds = [...new Set(items.map(v => v.parent_variant_id).filter((id): id is string => !!id))];
    if (parentIds.length > 0) {
      const { data: parents, error: parentError } = await ctx.supabase
        .from('evolution_variants')
        .select('id, mu, sigma, elo_score, run_id')
        .in('id', parentIds);
      if (parentError) throw parentError;
      const parentMap = new Map(
        (parents ?? []).map(p => [
          p.id as string,
          { elo: p.elo_score as number | null, mu: p.mu as number | null,
            sigma: p.sigma as number | null, run_id: p.run_id as string | null },
        ]),
      );
      for (const item of items) {
        const parent = item.parent_variant_id ? parentMap.get(item.parent_variant_id) : null;
        if (parent) {
          // parent.mu is raw OpenSkill mu (~25); parent.elo_score is the ELO-scale projection (~1200).
          // Prefer elo_score which is already in the right units; mu fallback converts via sigma scale.
          item.parent_elo = parent.elo ?? null;
          // Convert sigma -> Elo-scale uncertainty (matches toArenaEntry convention).
          item.parent_uncertainty = parent.sigma != null ? parent.sigma * _INTERNAL_ELO_SIGMA_SCALE : null;
          item.parent_run_id = parent.run_id;
        }
      }
    }

    return { items, total: count ?? 0 };
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
    return toArenaEntry(data);
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
    input: { limit: number; offset: number; status?: string; filterTestContent?: boolean; name?: string },
    ctx: AdminContext,
  ): Promise<{ items: PromptListItem[]; total: number }> => {
    const limit = Math.min(Math.max(input.limit, 1), 200);
    const offset = Math.max(input.offset, 0);

    let query = ctx.supabase
      .from('evolution_prompts')
      .select('*', { count: 'exact' })
      .is('deleted_at', null);

    if (input.status) query = query.eq('status', input.status);
    if (input.filterTestContent) query = applyTestContentColumnFilter(query);
    if (input.name) {
      const escaped = input.name.replace(/[%_\\]/g, '\\$&');
      query = query.ilike('name', `%${escaped}%`);
    }

    query = query.order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

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
