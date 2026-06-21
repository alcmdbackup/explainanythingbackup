'use server';
// Server actions for the Arena admin UI: topic CRUD, entry management, and leaderboard.
// V2 schema: elo data lives directly on evolution_variants (no separate elo table).

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid, applyTestContentColumnFilter } from './shared';
import {
  _INTERNAL_ELO_SIGMA_SCALE,
  buildComparisonPrompt,
  parseWinner,
  parseVerdictFromReasoning,
  aggregateWinners,
  type ComparisonMode,
} from '@evolution/lib/shared/computeRatings';
import { callLLM, type CallLLMOptions } from '@/lib/services/llms';
import { CALL_SOURCES } from '@/lib/services/llmCallSource';
import { getEvolutionModelIds, getModelMaxTemperature } from '@/config/modelRegistry';
import type { AllowedLLMModelType } from '@/lib/schemas/schemas';
import { GlobalBudgetExceededError, LLMKillSwitchError } from '@/lib/errors/serviceError';
import type { RubricBreakdown } from '@evolution/lib/shared/rubricJudge';
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
    // bring_back_debate_agent_20260506 PR 2 — parent_variant_ids array column replaces
    // legacy parent_variant_id. parent_variant_id field on ArenaEntry stays as derived
    // (= parent_variant_ids[0] || null) for backward compat with existing UI consumers
    // that read it as a scalar; new multi-parent UI consumers read parent_variant_ids.
    parent_variant_ids: ((row.parent_variant_ids as string[] | null) ?? []),
    parent_variant_id: (() => {
      const ids = (row.parent_variant_ids as string[] | null) ?? [];
      return ids.length > 0 ? ids[0]! : null;
    })(),
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
  /** Parent variant IDs for lineage display. parent_variant_ids[0] is the canonical
   *  primary parent by convention (e.g. judge's winner for debate variants per
   *  bring_back_debate_agent_20260506 Decision §20). Empty array for root variants. */
  parent_variant_ids: string[];
  /** @deprecated Backward-compat field — derived from parent_variant_ids[0]. New UI
   *  code should read parent_variant_ids directly to support multi-parent variants. */
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
  // Rubric judging (20260610): per-dimension snapshot (authoritative for the Match
  // Viewer breakdown) + the rubric id (indexed filtering). Null for holistic matches.
  rubric_breakdown?: RubricBreakdown | null;
  judge_rubric_id?: string | null;
  // Phase 4 ensemble summary (null/absent for single-judge matches = a chain-of-1).
  chain_depth?: number | null;
  agreement?: number | null;
  aggregation_rule?: string | null;
  aggregation_rule_version?: number | null;
}

/** One per-dimension verdict row of an ensemble submatch (Match Viewer). */
export interface ComparisonSubmatchDimension {
  criteria_name: string;
  weight: number;
  forward_verdict: string | null;
  reverse_verdict: string | null;
  dimension_winner: string | null;
  favored_match_winner: boolean | null;
  position: number;
}

/** One submatch (one judge's consolidated verdict) of an ensemble match, + its dimension verdicts. */
export interface ComparisonSubmatch {
  id: string;
  judge_model: string;
  escalation_step: number;
  triggered_escalation: boolean;
  winner: string | null;
  confidence: number | null;
  judge_rubric_id: string | null;
  dimensions: ComparisonSubmatchDimension[];
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
    filters: { status?: string; filterTestContent?: boolean; includeParagraphTopics?: boolean } | undefined,
    ctx: AdminContext,
  ): Promise<ArenaTopic[]> => {
    let query = ctx.supabase
      .from('evolution_prompts')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (filters?.status) query = query.eq('status', filters.status);
    if (filters?.filterTestContent) query = applyTestContentColumnFilter(query);
    // Per D13 + D20 of rank_individual_paragraphs_evolution_20260525: filter out
    // paragraph topics by default so they don't drown the article-topic list.
    // Researchers can opt in by passing `includeParagraphTopics: true`.
    if (!filters?.includeParagraphTopics) {
      query = query.eq('prompt_kind', 'article');
    }

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
  /** All seed variants for the topic (generation_method='seed', non-archived,
   *  synced_to_arena). Sorted by elo_score DESC with created_at ASC tiebreak.
   *  Phase 5 (investigate_sequential_paragraph_recombine_performance_20260615):
   *  Federal Reserve 3 is the first true multi-seed topic; existing topics have
   *  0 or 1 seed and `seedVariants` is empty or single-element accordingly. */
  seedVariants: ArenaEntry[];
  /** The topic's primary seed variant — convenience field = seedVariants[0]
   *  when non-empty, null otherwise. Preserved for back-compat with consumers
   *  written before multi-seed (most arena topic UI surfaces). New multi-seed
   *  consumers should read `seedVariants` directly. */
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

    // Fetch ALL seed variants for the topic. Multi-seed topics (Phase 5: FR3)
    // need every seed visible to consumers; single-seed/zero-seed topics yield
    // a 1-element or empty array. Deterministic ordering: elo_score DESC with
    // created_at ASC as tiebreak — same convention as the prior single-seed
    // query, applied to the entire seed set.
    const { data: seedRows, error: seedError } = await ctx.supabase
      .from('evolution_variants')
      .select('*')
      .eq('prompt_id', topicId)
      .eq('generation_method', 'seed')
      .eq('synced_to_arena', true)  // match the leaderboard query (line ~210); defensive against any future seed row with synced_to_arena=false
      .is('archived_at', null)
      .order('elo_score', { ascending: false })
      .order('created_at', { ascending: true });
    if (seedError) throw seedError;

    const seedVariants = (seedRows ?? []).map((row) => toArenaEntry(row as Record<string, unknown>));

    return {
      ...(data as ArenaTopic),
      seedVariants,
      // Convenience field — first (highest-elo) seed or null. Mirrors the
      // pre-Phase-5 shape exactly: zero seeds → null; one or more → seedVariants[0].
      seedVariant: seedVariants.length > 0 ? seedVariants[0]! : null,
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
      // B004-S5: cap at 200 — previously accepted arbitrary user-supplied values
      // (e.g. 10_000_000) which risked OOM.
      .limit(Math.min(Math.max(input.limit ?? 100, 1), 200));
    if (error) throw error;
    return (data ?? []) as ArenaComparison[];
  },
);

// ─── Match Viewer (match_viewer_with_experimentation_procedures_20260605) ──────
// Read-only browse of recent judge matches + a DISPLAY-ONLY re-judge sandbox. None of
// these actions write to evolution_arena_comparisons or mutate ratings.

/** One char of preview content, single-lined and truncated. */
function previewContent(content: string | null | undefined, max = 80): string | null {
  if (!content) return null;
  const oneLine = content.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** Match kind: 'paragraph' = per-paragraph rewrite match; 'article' = whole-variant match.
 *  Derived from the comparison's prompt (`evolution_prompts.prompt_kind`); null when the row
 *  has no prompt (rare — ~0.5% of in-run rows have a null prompt_id). */
export type MatchKind = 'article' | 'paragraph';

export interface MatchListItem extends ArenaComparison {
  entry_a_preview: string | null;
  entry_b_preview: string | null;
  kind: MatchKind | null;
  /** True when this match was rubric-judged (drives the list's rubric indicator). */
  has_rubric: boolean;
  /** True when this match was ensemble-judged (Phase 4); drives the escalation badge. */
  is_escalation: boolean;
}

/** List recent judge matches. Unlike getArenaComparisonsAction (prompt_id only), this filters
 *  by run_id (the Match Viewer's primary axis) plus winner/min-confidence/kind, with pagination
 *  and an optional test-content exclusion. Match kind (article vs paragraph) comes from the
 *  comparison's prompt_kind via an embedded join. */
export const getRecentMatchesAction = adminAction(
  'getRecentMatches',
  async (
    input: {
      runId?: string;
      topicId?: string;
      winner?: 'a' | 'b' | 'draw';
      minConfidence?: number;
      kind?: MatchKind;
      judgeRubricId?: string;
      filterTestContent?: boolean;
      limit?: number;
      offset?: number;
    },
    ctx: AdminContext,
  ): Promise<{ items: MatchListItem[]; total: number }> => {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const offset = Math.max(input.offset ?? 0, 0);
    if (input.runId && !validateUuid(input.runId)) throw new Error('Invalid runId');
    if (input.topicId && !validateUuid(input.topicId)) throw new Error('Invalid topicId');

    // prompt_kind embed gives the article/paragraph label. Left join for the label (keeps
    // null-prompt rows); !inner when filtering by kind so non-matching rows are dropped.
    const promptEmbed = input.kind
      ? 'evolution_prompts!inner(prompt_kind)'
      : 'evolution_prompts(prompt_kind)';
    // Test-content exclusion needs a two-level !inner embed (the column lives on
    // evolution_strategies via the run). NOTE: while on, this drops null-run_id rows; uncheck
    // to see them.
    const parts = ['*', promptEmbed];
    if (input.filterTestContent) {
      parts.push('evolution_runs!inner(evolution_strategies!inner(is_test_content))');
    }
    const selectExpr = parts.join(', ');

    let query = ctx.supabase
      .from('evolution_arena_comparisons')
      .select(selectExpr, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (input.runId) query = query.eq('run_id', input.runId);
    if (input.topicId) query = query.eq('prompt_id', input.topicId);
    if (input.winner) query = query.eq('winner', input.winner);
    if (input.judgeRubricId) {
      if (!validateUuid(input.judgeRubricId)) throw new Error('Invalid judgeRubricId');
      query = query.eq('judge_rubric_id', input.judgeRubricId);
    }
    if (input.minConfidence != null) query = query.gte('confidence', input.minConfidence);
    if (input.kind) query = query.eq('evolution_prompts.prompt_kind', input.kind);
    if (input.filterTestContent) {
      query = query.eq('evolution_runs.evolution_strategies.is_test_content', false);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    const rows = (data ?? []) as unknown as Array<
      ArenaComparison & { evolution_prompts?: { prompt_kind?: string } | null }
    >;

    // Batch-fetch variant content for previews (entry_a/entry_b are variant ids).
    const variantIds = [...new Set(rows.flatMap(r => [r.entry_a, r.entry_b]).filter(Boolean))];
    const contentById = new Map<string, string>();
    if (variantIds.length > 0) {
      const { data: variants, error: vErr } = await ctx.supabase
        .from('evolution_variants')
        .select('id, variant_content')
        .in('id', variantIds);
      if (vErr) throw vErr;
      for (const v of variants ?? []) contentById.set(v.id as string, v.variant_content as string);
    }

    const items: MatchListItem[] = rows.map(r => {
      const pk = r.evolution_prompts && !Array.isArray(r.evolution_prompts)
        ? r.evolution_prompts.prompt_kind
        : null;
      const kind: MatchKind | null = pk === 'paragraph' ? 'paragraph' : pk === 'article' ? 'article' : null;
      return {
        id: r.id,
        prompt_id: r.prompt_id,
        entry_a: r.entry_a,
        entry_b: r.entry_b,
        winner: r.winner,
        confidence: r.confidence,
        run_id: r.run_id,
        status: r.status,
        created_at: r.created_at,
        kind,
        judge_rubric_id: r.judge_rubric_id ?? null,
        rubric_breakdown: r.rubric_breakdown ?? null,
        has_rubric: r.judge_rubric_id != null || r.rubric_breakdown != null,
        is_escalation: r.aggregation_rule != null,
        entry_a_preview: previewContent(contentById.get(r.entry_a)),
        entry_b_preview: previewContent(contentById.get(r.entry_b)),
      };
    });

    return { items, total: count ?? 0 };
  },
);

export interface ComparisonDetail extends ArenaComparison {
  entry_a_content: string | null;
  entry_b_content: string | null;
  entry_a_elo: number | null;
  entry_b_elo: number | null;
  /** Phase 4: the escalation chain's submatches (empty for legacy single-judge matches). */
  submatches: ComparisonSubmatch[];
}

/** Fetch a comparison's ensemble submatches + their per-dimension verdicts. Returns [] for a legacy
 *  single-judge match (no submatch rows) or if the Phase-4 tables aren't deployed yet (fails soft). */
async function fetchComparisonSubmatches(
  supabase: AdminContext['supabase'],
  comparisonId: string,
): Promise<ComparisonSubmatch[]> {
  const { data: subs, error } = await supabase
    .from('evolution_arena_submatches')
    .select('id, judge_model, escalation_step, triggered_escalation, winner, confidence, judge_rubric_id')
    .eq('arena_comparison_id', comparisonId)
    .order('escalation_step');
  if (error || !subs || subs.length === 0) return [];

  const ids = subs.map((s) => s.id);
  const dimsBySubmatch = new Map<string, ComparisonSubmatchDimension[]>();
  const { data: dims } = await supabase
    .from('evolution_submatch_dimension_verdicts')
    .select('submatch_id, criteria_name, weight, forward_verdict, reverse_verdict, dimension_winner, favored_match_winner, position')
    .in('submatch_id', ids)
    .order('position');
  for (const d of dims ?? []) {
    const list = dimsBySubmatch.get(d.submatch_id) ?? [];
    list.push({
      criteria_name: d.criteria_name,
      weight: d.weight,
      forward_verdict: d.forward_verdict,
      reverse_verdict: d.reverse_verdict,
      dimension_winner: d.dimension_winner,
      favored_match_winner: d.favored_match_winner,
      position: d.position,
    });
    dimsBySubmatch.set(d.submatch_id, list);
  }
  return subs.map((s) => ({
    id: s.id,
    judge_model: s.judge_model,
    escalation_step: s.escalation_step,
    triggered_escalation: s.triggered_escalation,
    winner: s.winner,
    confidence: s.confidence,
    judge_rubric_id: s.judge_rubric_id,
    dimensions: dimsBySubmatch.get(s.id) ?? [],
  }));
}

/** Fetch a single comparison + both variants' full content/elo for the detail view. Missing
 *  variants (entry FKs were dropped; a variant can be deleted) come back as null content. */
export const getComparisonDetailAction = adminAction(
  'getComparisonDetail',
  async (input: { comparisonId: string }, ctx: AdminContext): Promise<ComparisonDetail> => {
    if (!validateUuid(input.comparisonId)) throw new Error('Invalid comparisonId');
    const { data: row, error } = await ctx.supabase
      .from('evolution_arena_comparisons')
      .select('*')
      .eq('id', input.comparisonId)
      .single();
    if (error) throw error;
    if (!row) throw new Error(`Comparison not found: ${input.comparisonId}`);
    const c = row as ArenaComparison;

    const { data: variants, error: vErr } = await ctx.supabase
      .from('evolution_variants')
      .select('id, variant_content, elo_score')
      .in('id', [c.entry_a, c.entry_b]);
    if (vErr) throw vErr;
    const byId = new Map((variants ?? []).map(v => [v.id as string, v]));
    const a = byId.get(c.entry_a);
    const b = byId.get(c.entry_b);

    const submatches = await fetchComparisonSubmatches(ctx.supabase, c.id);

    return {
      ...c,
      entry_a_content: (a?.variant_content as string | undefined) ?? null,
      entry_b_content: (b?.variant_content as string | undefined) ?? null,
      entry_a_elo: (a?.elo_score as number | undefined) ?? null,
      entry_b_elo: (b?.elo_score as number | undefined) ?? null,
      submatches,
    };
  },
);

export interface RejudgePass {
  direction: 'forward' | 'reverse';
  prompt: string;
  rawResponse: string;
  parsedWinner: 'A' | 'B' | 'TIE' | null;
}

export interface RejudgeResult {
  winner: 'A' | 'B' | 'TIE';
  confidence: number;
  turns: number;
  costUsd: number;
  judgeModel: string;
  temperature: number | null;
  explainReasoning: boolean;
  /** The two reversal passes, each with the exact prompt sent + raw model response. */
  passes: RejudgePass[];
}

const MAX_VARIANT_CHARS = 12_000;
const MAX_CUSTOM_PROMPT_CHARS = 4_000;

const rejudgeSchema = z.object({
  comparisonId: z.string(),
  judgeModel: z.string(),
  mode: z.enum(['article', 'paragraph']).optional(),
  customPrompt: z.string().optional(),
  temperature: z.number().optional(),
  explainReasoning: z.boolean().optional(),
});

/** DISPLAY-ONLY re-judge: re-run the 2-pass judge for a stored comparison with a chosen model,
 *  temperature, optional rubric override, and optional reasoning output. Writes NOTHING to
 *  evolution_arena_comparisons and never mutates ratings. Uses the plain callLLM path (NOT the
 *  evolution LLM client), so it incurs no evolution_metrics cost write — only the standard
 *  per-call llmCallTracking audit row. Returns each pass's exact prompt + raw response. */
export const rejudgeComparisonAction = adminAction(
  'rejudgeComparison',
  async (input: z.input<typeof rejudgeSchema>, ctx: AdminContext): Promise<RejudgeResult> => {
    const parsed = rejudgeSchema.parse(input);
    if (!validateUuid(parsed.comparisonId)) throw new Error('Invalid comparisonId');

    // Validate model against the picker's allowed set (== allowedLLMModelSchema enum).
    if (!getEvolutionModelIds().includes(parsed.judgeModel)) {
      throw new Error(`Invalid judgeModel: ${parsed.judgeModel}`);
    }
    const judgeModel = parsed.judgeModel as AllowedLLMModelType;
    const mode: ComparisonMode = parsed.mode ?? 'article';
    const explainReasoning = parsed.explainReasoning ?? false;

    // Custom prompt: rubric/instructions only. Reject over-long; treat blank as absent.
    const customPrompt = parsed.customPrompt?.trim() || undefined;
    if (customPrompt && customPrompt.length > MAX_CUSTOM_PROMPT_CHARS) {
      throw new Error(`Custom prompt too long (max ${MAX_CUSTOM_PROMPT_CHARS} chars)`);
    }

    // Temperature: honor only when the model supports it; clamp to [0, max].
    const maxTemp = getModelMaxTemperature(judgeModel);
    let temperature: number | undefined;
    if (parsed.temperature != null && maxTemp != null) {
      temperature = Math.min(Math.max(parsed.temperature, 0), maxTemp);
    }

    // Fetch the comparison + both variant texts.
    const { data: row, error } = await ctx.supabase
      .from('evolution_arena_comparisons')
      .select('entry_a, entry_b')
      .eq('id', parsed.comparisonId)
      .single();
    if (error) throw error;
    if (!row) throw new Error(`Comparison not found: ${parsed.comparisonId}`);

    const { data: variants, error: vErr } = await ctx.supabase
      .from('evolution_variants')
      .select('id, variant_content')
      .in('id', [row.entry_a as string, row.entry_b as string]);
    if (vErr) throw vErr;
    const byId = new Map((variants ?? []).map(v => [v.id as string, v.variant_content as string]));
    const rawA = byId.get(row.entry_a as string);
    const rawB = byId.get(row.entry_b as string);
    if (rawA == null || rawB == null) {
      throw new Error('Cannot re-judge: one or both variants no longer exist');
    }
    const textA = rawA.slice(0, MAX_VARIANT_CHARS);
    const textB = rawB.slice(0, MAX_VARIANT_CHARS);

    const forwardPrompt = buildComparisonPrompt(textA, textB, mode, customPrompt, explainReasoning);
    const reversePrompt = buildComparisonPrompt(textB, textA, mode, customPrompt, explainReasoning);
    // Defensive: a valid prompt must carry both text markers + a verdict cue before we spend.
    for (const p of [forwardPrompt, reversePrompt]) {
      if (!p.includes('## Text A') || !p.includes('## Text B') || !/your answer/i.test(p)) {
        throw new Error('Invalid judge prompt (missing Text A/Text B/verdict instruction)');
      }
    }

    // A custom prompt may elicit free-form output (e.g. an explanation) just like the reasoning
    // toggle, so use the reasoning-tolerant parser in both cases; parseWinner only for the
    // strict verdict-only default.
    const wantsFreeform = explainReasoning || customPrompt != null;
    const parser = wantsFreeform ? parseVerdictFromReasoning : parseWinner;
    const norm = (s: string | null): 'A' | 'B' | 'TIE' | null =>
      s === 'A' || s === 'B' || s === 'TIE' ? s : null;

    // E2E stub: deterministic canned response, no provider call. Mirror the repo's prod guard
    // (returnExplanation/route.ts) so a misconfigured prod server can never serve canned verdicts.
    const isE2E = process.env.E2E_TEST_MODE === 'true';
    if (isE2E && process.env.NODE_ENV === 'production' && !process.env.CI) {
      throw new Error('E2E_TEST_MODE must not be enabled in production');
    }

    let costUsd = 0;
    const judge = async (prompt: string): Promise<string> => {
      if (isE2E) {
        // Constant canned verdict → deterministic aggregate (forward A + reverse A→flipped B
        // ⇒ TIE @0.5). The E2E asserts the result card renders, not a specific winner.
        return 'Stubbed reasoning for E2E.\nYour answer: A';
      }
      const opts: CallLLMOptions = {
        ...(temperature != null ? { temperature } : {}),
        onUsage: (u) => { costUsd += u.estimatedCostUsd; },
      };
      return callLLM(prompt, CALL_SOURCES.matchViewerRejudge, ctx.adminUserId, judgeModel, false, null, null, null, false, opts);
    };

    // 2-pass A/B reversal (mirrors run2PassReversal) — capture each pass's raw response BY
    // DIRECTION rather than via a prompt-keyed map, so identical-content variants
    // (forwardPrompt === reversePrompt) don't collide in the displayed output.
    let forwardResponse: string;
    let reverseResponse: string;
    try {
      [forwardResponse, reverseResponse] = await Promise.all([judge(forwardPrompt), judge(reversePrompt)]);
    } catch (e) {
      if (e instanceof GlobalBudgetExceededError || e instanceof LLMKillSwitchError) {
        throw new Error(`Re-judge unavailable: ${e.message}`);
      }
      throw e;
    }
    const forwardParsed = parser(forwardResponse);
    const reverseParsed = parser(reverseResponse);
    const agg = aggregateWinners(forwardParsed, reverseParsed);

    const passes: RejudgePass[] = [
      { direction: 'forward', prompt: forwardPrompt, rawResponse: forwardResponse, parsedWinner: norm(forwardParsed) },
      { direction: 'reverse', prompt: reversePrompt, rawResponse: reverseResponse, parsedWinner: norm(reverseParsed) },
    ];

    return {
      winner: agg.winner,
      confidence: agg.confidence,
      turns: agg.turns,
      costUsd,
      judgeModel,
      temperature: temperature ?? null,
      explainReasoning,
      passes,
    };
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
