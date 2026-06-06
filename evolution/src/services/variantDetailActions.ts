'use server';
// Server actions for the variant detail page: full variant data, lineage, and match history.
// Provides deep-dive into a single variant across its evolution lifecycle.

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid } from './shared';
import { dbToRating } from '../lib/shared/computeRatings';
import { parseSlotParagraphNumber } from '../lib/shared/paragraphLabels';

/** Lift optional mu/sigma from a DB row to the public Rating.uncertainty (Elo-scale).
 *  Returns undefined when either is missing (legacy rows). */
function liftUncertainty(row: { mu?: number | null; sigma?: number | null }): number | undefined {
  if (row.mu == null || row.sigma == null) return undefined;
  return dbToRating(row.mu, row.sigma).uncertainty;
}

// ─── Types ──────────────────────────────────────────────────────

export interface VariantFullDetail {
  id: string;
  runId: string;
  explanationId: number | null;
  explanationTitle: string | null;
  variantContent: string;
  eloScore: number;
  /** Elo-scale rating uncertainty (lifted from mu/sigma). Optional for legacy rows. */
  uncertainty?: number;
  generation: number;
  agentName: string;
  matchCount: number;
  isWinner: boolean;
  /** 'article' (full article variant) or 'paragraph' (paragraph_recombine slot variant).
   *  Legacy rows with NULL variant_kind are treated as 'article'. Drives the parent-badge
   *  label ('Original paragraph' vs 'Seed · no parent') and the Diff-vs-parent framing. */
  variantKind: 'article' | 'paragraph';
  /** Canonical primary parent (parent_variant_ids[0]). null for root variants. */
  parentVariantId: string | null;
  /** Full parents array. Multi-parent variants (debate) emit [winner, loser];
   *  single-parent variants have a 1-element array; root variants have []. */
  parentVariantIds: string[];
  /** Parent's current mu (application-layer ELO). Null when no parent or parent was deleted. */
  parentElo: number | null;
  /** Parent's sigma (uncertainty). Null when no parent. */
  parentUncertainty: number | null;
  /** Parent's run_id — used to detect cross-run parents for the "(other run)" badge. */
  parentRunId: string | null;
  createdAt: string;
  runStatus: string;
  runCreatedAt: string;
  /** Whether this variant survived to the final pool. False = discarded by its owning generate agent.
   *  Note: paragraph variants are always persisted=false by design (sync_to_arena) and are surfaced,
   *  not discarded — the discarded banner is gated on variantKind='article' via isDiscardedGenerateVariant. */
  persisted: boolean;
  /**
   * UUID of the agent invocation that produced this variant. NULL for variants
   * created before migration 20260418000003 (no backfill). Distinct from
   * `agentName` above — for wrapper agents (reflect_and_generate,
   * evaluate_criteria_then_generate), `agentName` reflects the inner GFPA
   * tactic while `agentInvocationName` reflects the wrapper invocation.
   */
  agentInvocationId: string | null;
  agentInvocationName: string | null;
}

export interface VariantRelative {
  id: string;
  eloScore: number;
  /** Elo-scale rating uncertainty (lifted from mu/sigma). Optional for legacy rows. */
  uncertainty?: number;
  generation: number;
  agentName: string;
  isWinner: boolean;
  preview: string;
}

export interface VariantMatchEntry {
  /** Comparison row id (evolution_arena_comparisons.id) — used to deep-link the row to the
   *  Match Viewer (match_viewer_with_experimentation_procedures_20260605). */
  comparisonId: string;
  opponentId: string;
  opponentElo: number | null;
  /** Opponent's Elo-scale rating uncertainty. Optional for legacy rows. */
  opponentUncertainty?: number;
  won: boolean;
  confidence: number;
}

export interface LineageEntry {
  id: string;
  agentName: string;
  generation: number;
  eloScore: number;
  /** Elo-scale rating uncertainty (lifted from mu/sigma). Optional for legacy rows. */
  uncertainty?: number;
  preview: string;
}

export interface VariantChainNode {
  id: string;
  runId: string;
  agentName: string;
  generation: number;
  eloScore: number;
  /** Elo-scale rating uncertainty (lifted from mu/sigma). Optional for legacy rows. */
  uncertainty?: number;
  /** Canonical primary parent (parent_variant_ids[0]). null for root variants. */
  parentVariantId: string | null;
  /** Full parents array. Multi-parent variants (debate) emit [winner, loser];
   *  single-parent variants have a 1-element array. */
  parentVariantIds: string[];
  /** Full variant text. Used by Phase 4 lineage tab to render TextDiff between consecutive nodes. */
  variantContent: string;
  /** 0 at the leaf (query target); increments by 1 for each hop toward the root. */
  depth: number;
}

// ─── 1. Full Variant Detail ─────────────────────────────────────

export const getVariantFullDetailAction = adminAction('getVariantFullDetailAction', async (
  variantId: string,
  ctx: AdminContext,
): Promise<VariantFullDetail> => {
  if (!validateUuid(variantId)) throw new Error('Invalid variantId');
  const { supabase } = ctx;

  // PostgREST embedded select on the agent_invocation_id FK:
  // - One-to-one relationship → returns object (or null when FK is NULL)
  // - PostgREST may return either `null`, a single object, or a 1-element array
  //   depending on the relationship cardinality it infers. Handle all three
  //   defensively in the consumer.
  const { data: variant, error } = await supabase
    .from('evolution_variants')
    .select('*, evolution_agent_invocations(id, agent_name)')
    .eq('id', variantId)
    .single();

  if (error) throw error;

  // bring_back_debate_agent_20260506 PR 2 — read primary parent from parent_variant_ids[0].
  const variantParentIds = (variant.parent_variant_ids as string[] | null) ?? [];
  const primaryParentId: string | null = variantParentIds.length > 0 ? variantParentIds[0]! : null;
  const [runResult, explResult, parentResult] = await Promise.all([
    supabase.from('evolution_runs').select('status, created_at').eq('id', variant.run_id).single(),
    variant.explanation_id
      ? supabase.from('explanations').select('explanation_title').eq('id', variant.explanation_id).single()
      : Promise.resolve({ data: null, error: null }),
    primaryParentId
      ? supabase.from('evolution_variants').select('mu, sigma, elo_score, run_id').eq('id', primaryParentId).single()
      : Promise.resolve({ data: null, error: null }),
  ]);

  // Normalize embedded invocation: PostgREST may return null, an object, or array.
  const rawInv = (variant as { evolution_agent_invocations?: unknown }).evolution_agent_invocations;
  const inv = Array.isArray(rawInv) ? rawInv[0] : rawInv;
  const invocation = (inv && typeof inv === 'object')
    ? inv as { id?: string; agent_name?: string }
    : null;

  const uncertainty = liftUncertainty(variant);
  return {
    id: variant.id,
    runId: variant.run_id,
    explanationId: variant.explanation_id,
    explanationTitle: explResult.data?.explanation_title ?? null,
    variantContent: variant.variant_content,
    eloScore: variant.elo_score,
    ...(uncertainty != null ? { uncertainty } : {}),
    generation: variant.generation,
    agentName: variant.agent_name,
    matchCount: variant.match_count,
    isWinner: variant.is_winner,
    variantKind: variant.variant_kind === 'paragraph' ? 'paragraph' : 'article',
    parentVariantId: primaryParentId,
    parentVariantIds: variantParentIds,
    // parent.mu is raw OpenSkill (~25); elo_score is the ELO-scale projection (~1200). Use elo_score.
    // sigma is converted via liftUncertainty to match the child's uncertainty scale.
    parentElo: parentResult.data?.elo_score ?? null,
    parentUncertainty: parentResult.data ? liftUncertainty({ mu: parentResult.data.mu, sigma: parentResult.data.sigma }) ?? null : null,
    parentRunId: parentResult.data?.run_id ?? null,
    createdAt: variant.created_at,
    runStatus: runResult.data?.status ?? 'unknown',
    runCreatedAt: runResult.data?.created_at ?? variant.created_at,
    // Default to true for legacy variants written before the persisted column existed.
    persisted: variant.persisted ?? true,
    agentInvocationId: invocation?.id ?? null,
    agentInvocationName: invocation?.agent_name ?? null,
  };
});

// ─── 1b. Variant ↔ Parent Diff ──────────────────────────────────

/** Powers the "Diff vs parent" tab on the variant detail page. Returns the variant's
 *  own text plus its primary parent's full text (parent_variant_ids[0]) in one call,
 *  for both article and paragraph variants.
 *
 *  For paragraph (paragraph_recombine slot) variants the "parent" is the slot's
 *  original-paragraph variant — whose variant_content IS the isolated parent paragraph —
 *  so the diff is inherently paragraph-vs-paragraph. Legacy slot rewrites persisted with
 *  empty parent_variant_ids (pre-migration 20260529000001) are recovered via the slot
 *  topic (prompt_id + agent_name='paragraph_original').
 *
 *  enable_side_by_side_variant_comparisons_vs_parent_20260531. */
export interface VariantParentDiff {
  variantId: string;
  variantKind: 'article' | 'paragraph';
  /** This variant's full text (right-hand side of the diff). */
  variantContent: string;
  /** Primary parent (left-hand side). null for parentless variants (seed article /
   *  original-slot paragraph) — the UI renders an empty state instead of a diff. */
  parent: {
    id: string;
    content: string;
    elo: number | null;
    /** Elo-scale uncertainty (lifted from mu/sigma). null for legacy rows. */
    uncertainty: number | null;
    runId: string | null;
  } | null;
  /** parent.runId !== variant.run_id — drives the "(other run)" pill. */
  crossRun: boolean;
  /** Paragraph variants only: 1-based slot number parsed from the slot topic name.
   *  null for article variants or when the topic name is unexpected. */
  slotContext: { paragraphNumber: number } | null;
}

export const getVariantParentDiffAction = adminAction('getVariantParentDiffAction', async (
  variantId: string,
  ctx: AdminContext,
): Promise<VariantParentDiff | null> => {
  if (!validateUuid(variantId)) throw new Error('Invalid variantId');
  const { supabase } = ctx;

  type VariantRow = {
    id: string;
    run_id: string | null;
    variant_kind: string | null;
    prompt_id: string | null;
    parent_variant_ids: string[] | null;
    variant_content: string;
  };
  const { data: variantData, error } = await supabase
    .from('evolution_variants')
    .select('id, run_id, variant_kind, prompt_id, parent_variant_ids, variant_content')
    .eq('id', variantId)
    .maybeSingle();
  if (error) throw error;
  if (!variantData) return null; // variant not found → tab renders nothing
  const variant = variantData as unknown as VariantRow;

  const variantKind: 'article' | 'paragraph' = variant.variant_kind === 'paragraph' ? 'paragraph' : 'article';
  const parentIds = variant.parent_variant_ids ?? [];
  let primaryParentId: string | null = parentIds.length > 0 ? parentIds[0]! : null;

  // Paragraph fallback: legacy slot rewrites persisted with empty parent_variant_ids
  // (pre-migration 20260529000001). Recover the slot's original-paragraph variant via the
  // slot topic. No DB uniqueness on (prompt_id, agent_name, variant_kind) → take earliest.
  if (!primaryParentId && variantKind === 'paragraph' && variant.prompt_id) {
    const { data: originals } = await supabase
      .from('evolution_variants')
      .select('id')
      .eq('prompt_id', variant.prompt_id)
      .eq('agent_name', 'paragraph_original')
      .eq('variant_kind', 'paragraph')
      .order('created_at', { ascending: true })
      .limit(1);
    const originalId = (originals ?? [])[0]?.id ?? null;
    // The variant may itself BE the original-slot paragraph → leave parentless.
    if (originalId && originalId !== variant.id) primaryParentId = originalId;
  }

  let parent: VariantParentDiff['parent'] = null;
  if (primaryParentId) {
    const { data: parentRow } = await supabase
      .from('evolution_variants')
      .select('id, variant_content, elo_score, mu, sigma, run_id')
      .eq('id', primaryParentId)
      .maybeSingle();
    if (parentRow) {
      parent = {
        id: parentRow.id,
        content: parentRow.variant_content,
        elo: parentRow.elo_score ?? null,
        uncertainty: liftUncertainty({ mu: parentRow.mu, sigma: parentRow.sigma }) ?? null,
        runId: parentRow.run_id ?? null,
      };
    }
  }

  // Slot context: paragraph number from the slot topic name (cheap). The parent-article
  // link is intentionally omitted — slot variants lack agent_invocation_id and the 8-char
  // topic prefix is non-unique, so a reliable article link would need a JSONB scan.
  let slotContext: VariantParentDiff['slotContext'] = null;
  if (variantKind === 'paragraph' && variant.prompt_id) {
    const { data: promptRow } = await supabase
      .from('evolution_prompts')
      .select('prompt')
      .eq('id', variant.prompt_id)
      .maybeSingle();
    const paragraphNumber = parseSlotParagraphNumber(promptRow?.prompt ?? null);
    if (paragraphNumber != null) slotContext = { paragraphNumber };
  }

  const crossRun = !!parent?.runId && !!variant.run_id && parent.runId !== variant.run_id;

  return {
    variantId: variant.id,
    variantKind,
    variantContent: variant.variant_content,
    parent,
    crossRun,
    slotContext,
  };
});

// ─── 2. Variant Parents ─────────────────────────────────────────

export const getVariantParentsAction = adminAction('getVariantParentsAction', async (
  variantId: string,
  ctx: AdminContext,
): Promise<VariantRelative[]> => {
  if (!validateUuid(variantId)) throw new Error('Invalid variantId');
  const { supabase } = ctx;

  const { data: variant, error: variantError } = await supabase
    .from('evolution_variants')
    .select('parent_variant_ids')
    .eq('id', variantId)
    .single();
  if (variantError) throw variantError;

  const parentIds = (variant?.parent_variant_ids as string[] | null) ?? [];
  // PR 2 + Phase 4.9: this action returns the FIRST parent only for the existing
  // single-parent UI surface. Multi-parent variants (debate) surface their full
  // parents list via VariantDetailContent's chip-list (Phase 4.9). When a multi-parent
  // UI is needed here, return parentIds.map(...) instead.
  if (parentIds.length === 0) return [];
  const primaryParentId = parentIds[0];

  const { data: parent, error } = await supabase
    .from('evolution_variants')
    .select('id, elo_score, mu, sigma, generation, agent_name, is_winner, variant_content')
    .eq('id', primaryParentId)
    .single();

  if (error || !parent) return [];

  const parentUncertainty = liftUncertainty(parent);
  return [{
    id: parent.id,
    eloScore: parent.elo_score,
    ...(parentUncertainty != null ? { uncertainty: parentUncertainty } : {}),
    generation: parent.generation,
    agentName: parent.agent_name,
    isWinner: parent.is_winner,
    preview: (parent.variant_content ?? '').slice(0, 200),
  }];
});

// ─── 3. Variant Children ────────────────────────────────────────

export const getVariantChildrenAction = adminAction('getVariantChildrenAction', async (
  variantId: string,
  ctx: AdminContext,
): Promise<VariantRelative[]> => {
  if (!validateUuid(variantId)) throw new Error('Invalid variantId');
  const { supabase } = ctx;

  // bring_back_debate_agent_20260506 PR 2 — find children whose parent_variant_ids array
  // contains the target variantId. For multi-parent variants (debate), this surfaces
  // them as children of BOTH parents (winner + loser). Postgres array containment
  // operator @> via Supabase .contains() filter.
  const { data, error } = await supabase
    .from('evolution_variants')
    .select('id, elo_score, mu, sigma, generation, agent_name, is_winner, variant_content')
    .contains('parent_variant_ids', [variantId])
    .order('elo_score', { ascending: false })
    .limit(20);

  if (error) throw error;

  return (data ?? []).map(v => {
    const u = liftUncertainty(v);
    return {
      id: v.id,
      eloScore: v.elo_score,
      ...(u != null ? { uncertainty: u } : {}),
      generation: v.generation,
      agentName: v.agent_name,
      isWinner: v.is_winner,
      preview: (v.variant_content ?? '').slice(0, 200),
    };
  });
});

// ─── 4. Variant Match History ──────────────────────────────────

/**
 * Returns the pairwise match history for a variant by querying
 * evolution_arena_comparisons for rows where the variant participated as
 * either entry_a or entry_b. Opponent ELO/uncertainty are batch-fetched from
 * evolution_variants (single round-trip).
 *
 * Filter pattern: `.or('entry_a.eq.<id>,entry_b.eq.<id>')`. Safe against
 * PostgREST filter-injection because `validateUuid` upstream restricts the
 * variantId to `[0-9a-f-]` only — no operator chars can pass through.
 */
export const getVariantMatchHistoryAction = adminAction('getVariantMatchHistoryAction', async (
  variantId: string,
  ctx: AdminContext,
): Promise<VariantMatchEntry[]> => {
  if (!validateUuid(variantId)) throw new Error('Invalid variantId');
  const { supabase } = ctx;

  const { data: comparisons, error } = await supabase
    .from('evolution_arena_comparisons')
    .select('id, entry_a, entry_b, winner, confidence, created_at')
    .or(`entry_a.eq.${variantId},entry_b.eq.${variantId}`)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw error;
  if (!comparisons || comparisons.length === 0) return [];

  const opponentIds = Array.from(new Set(
    comparisons.map((c) => (c.entry_a === variantId ? c.entry_b : c.entry_a)),
  ));

  const { data: opponents, error: oppError } = await supabase
    .from('evolution_variants')
    .select('id, mu, sigma, elo_score')
    .in('id', opponentIds);
  if (oppError) throw oppError;
  const oppMap = new Map(
    (opponents ?? []).map((o) => [o.id, o]),
  );

  return comparisons.map((c) => {
    const opponentId = c.entry_a === variantId ? c.entry_b : c.entry_a;
    const opp = oppMap.get(opponentId);
    // 'draw' counts as not-won; otherwise check winner side matches our side.
    const won =
      (c.entry_a === variantId && c.winner === 'a') ||
      (c.entry_b === variantId && c.winner === 'b');
    const oppUncertainty = opp ? liftUncertainty(opp) : undefined;
    return {
      comparisonId: c.id,
      opponentId,
      opponentElo: opp?.elo_score ?? null,
      ...(oppUncertainty != null ? { opponentUncertainty: oppUncertainty } : {}),
      won,
      confidence: c.confidence,
    };
  });
});

// ─── 5. Variant Lineage Chain ───────────────────────────────────

export const getVariantLineageChainAction = adminAction('getVariantLineageChainAction', async (
  variantId: string,
  ctx: AdminContext,
): Promise<LineageEntry[]> => {
  if (!validateUuid(variantId)) throw new Error('Invalid variantId');
  const { supabase } = ctx;

  // bring_back_debate_agent_20260506 PR 2 — walk via parent_variant_ids[0] (canonical
  // primary parent). Multi-parent variants (debate) walk only the primary chain in this
  // linear-lineage view; the full DAG is exposed by getVariantFullChainAction's RPC.
  const { data: variant } = await supabase
    .from('evolution_variants')
    .select('parent_variant_ids')
    .eq('id', variantId)
    .single();

  if (!variant) return [];

  const lineage: LineageEntry[] = [];
  const variantParentIds = (variant.parent_variant_ids as string[] | null) ?? [];
  let currentParentId: string | null = variantParentIds.length > 0 ? variantParentIds[0]! : null;
  const visited = new Set<string>();

  while (currentParentId && !visited.has(currentParentId) && lineage.length < 10) {
    visited.add(currentParentId);
    const { data: ancestor } = await supabase
      .from('evolution_variants')
      .select('id, agent_name, generation, elo_score, mu, sigma, variant_content, parent_variant_ids')
      .eq('id', currentParentId)
      .single();

    if (!ancestor) break;
    const ancUncertainty = liftUncertainty(ancestor);
    lineage.push({
      id: ancestor.id,
      agentName: ancestor.agent_name,
      generation: ancestor.generation,
      eloScore: ancestor.elo_score,
      ...(ancUncertainty != null ? { uncertainty: ancUncertainty } : {}),
      preview: (ancestor.variant_content ?? '').slice(0, 200),
    });
    const ancestorParentIds = (ancestor.parent_variant_ids as string[] | null) ?? [];
    currentParentId = ancestorParentIds.length > 0 ? ancestorParentIds[0]! : null;
  }

  return lineage;
});

// ─── 4. Full Variant Chain (Phase 4: recursive RPC with cycle protection) ───

/**
 * Fetches the full ancestor chain for a variant, root-first (seed → leaf).
 * Uses Postgres RPC `get_variant_full_chain` which runs a WITH RECURSIVE
 * walk with array-based cycle detection and a 20-hop cap.
 */
export const getVariantFullChainAction = adminAction('getVariantFullChainAction', async (
  variantId: string,
  ctx: AdminContext,
): Promise<VariantChainNode[]> => {
  if (!validateUuid(variantId)) throw new Error('Invalid variantId');
  const { supabase } = ctx;

  type ChainRpcRow = {
    id: string;
    run_id: string;
    variant_content: string;
    elo_score: number;
    mu: number | null;
    sigma: number | null;
    generation: number;
    agent_name: string | null;
    // bring_back_debate_agent_20260506 PR 2 — RPC return shape now exposes the full
    // parent_variant_ids array per row. RPC walks the primary parent chain (parent_variant_ids[1]
    // in PG 1-indexed); callers reading lineage as a linear chain use parent_variant_ids[0]
    // (in-memory 0-indexed) for the primary parent display.
    parent_variant_ids: string[] | null;
    depth: number;
  };
  // RPC return shape rewritten in migration 20260508000002 (Phase 1.18).
  const rpcArgs = { target_variant_id: variantId };
  const rpcResult = await supabase.rpc(
    'get_variant_full_chain' as never,
    rpcArgs as never,
  ) as unknown as { data: ChainRpcRow[] | null; error: { message: string } | null };
  if (rpcResult.error) throw rpcResult.error;

  const rows = rpcResult.data ?? [];
  return rows.map((r) => {
    const uncertainty = liftUncertainty({ mu: r.mu, sigma: r.sigma });
    const ancestorParentIds = (r.parent_variant_ids as string[] | null) ?? [];
    return {
      id: String(r.id),
      runId: String(r.run_id),
      agentName: String(r.agent_name ?? ''),
      generation: Number(r.generation ?? 0),
      eloScore: Number(r.elo_score ?? 0),
      ...(uncertainty != null ? { uncertainty } : {}),
      parentVariantId: ancestorParentIds.length > 0 ? String(ancestorParentIds[0]) : null,
      parentVariantIds: ancestorParentIds.map(String),
      variantContent: String(r.variant_content ?? ''),
      depth: Number(r.depth ?? 0),
    };
  });
});
