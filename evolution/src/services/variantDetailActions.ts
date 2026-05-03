'use server';
// Server actions for the variant detail page: full variant data, lineage, and match history.
// Provides deep-dive into a single variant across its evolution lifecycle.

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid } from './shared';
import { dbToRating } from '../lib/shared/computeRatings';

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
  parentVariantId: string | null;
  /** Parent's current mu (application-layer ELO). Null when no parent or parent was deleted. */
  parentElo: number | null;
  /** Parent's sigma (uncertainty). Null when no parent. */
  parentUncertainty: number | null;
  /** Parent's run_id — used to detect cross-run parents for the "(other run)" badge. */
  parentRunId: string | null;
  createdAt: string;
  runStatus: string;
  runCreatedAt: string;
  /** Whether this variant survived to the final pool. False = discarded by its owning generate agent. */
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
  parentVariantId: string | null;
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

  const [runResult, explResult, parentResult] = await Promise.all([
    supabase.from('evolution_runs').select('status, created_at').eq('id', variant.run_id).single(),
    variant.explanation_id
      ? supabase.from('explanations').select('explanation_title').eq('id', variant.explanation_id).single()
      : Promise.resolve({ data: null, error: null }),
    variant.parent_variant_id
      ? supabase.from('evolution_variants').select('mu, sigma, elo_score, run_id').eq('id', variant.parent_variant_id).single()
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
    parentVariantId: variant.parent_variant_id,
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

// ─── 2. Variant Parents ─────────────────────────────────────────

export const getVariantParentsAction = adminAction('getVariantParentsAction', async (
  variantId: string,
  ctx: AdminContext,
): Promise<VariantRelative[]> => {
  if (!validateUuid(variantId)) throw new Error('Invalid variantId');
  const { supabase } = ctx;

  const { data: variant, error: variantError } = await supabase
    .from('evolution_variants')
    .select('parent_variant_id')
    .eq('id', variantId)
    .single();
  if (variantError) throw variantError;

  if (!variant?.parent_variant_id) return [];

  const { data: parent, error } = await supabase
    .from('evolution_variants')
    .select('id, elo_score, mu, sigma, generation, agent_name, is_winner, variant_content')
    .eq('id', variant.parent_variant_id)
    .single();

  if (error || !parent) return [];

  const parentUncertainty = liftUncertainty(parent as { mu?: number | null; sigma?: number | null });
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

  const { data, error } = await supabase
    .from('evolution_variants')
    .select('id, elo_score, mu, sigma, generation, agent_name, is_winner, variant_content')
    .eq('parent_variant_id', variantId)
    .order('elo_score', { ascending: false })
    .limit(20);

  if (error) throw error;

  return (data ?? []).map(v => {
    const u = liftUncertainty(v as { mu?: number | null; sigma?: number | null });
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

  const { data: variant } = await supabase
    .from('evolution_variants')
    .select('parent_variant_id')
    .eq('id', variantId)
    .single();

  if (!variant) return [];

  const lineage: LineageEntry[] = [];
  let currentParentId = variant.parent_variant_id;
  const visited = new Set<string>();

  while (currentParentId && !visited.has(currentParentId) && lineage.length < 10) {
    visited.add(currentParentId);
    const { data: ancestor } = await supabase
      .from('evolution_variants')
      .select('id, agent_name, generation, elo_score, mu, sigma, variant_content, parent_variant_id')
      .eq('id', currentParentId)
      .single();

    if (!ancestor) break;
    const ancUncertainty = liftUncertainty(ancestor as { mu?: number | null; sigma?: number | null });
    lineage.push({
      id: ancestor.id,
      agentName: ancestor.agent_name,
      generation: ancestor.generation,
      eloScore: ancestor.elo_score,
      ...(ancUncertainty != null ? { uncertainty: ancUncertainty } : {}),
      preview: (ancestor.variant_content ?? '').slice(0, 200),
    });
    currentParentId = ancestor.parent_variant_id;
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
    parent_variant_id: string | null;
    depth: number;
  };
  // RPC not declared in generated Database types — see migration
  // 20260418000002_variants_get_full_chain_rpc.sql. Casting via unknown to the row shape.
  const rpcResult = await supabase.rpc(
    'get_variant_full_chain' as never,
    { target_variant_id: variantId } as never,
  ) as unknown as { data: ChainRpcRow[] | null; error: { message: string } | null };
  if (rpcResult.error) throw rpcResult.error;

  const rows = rpcResult.data ?? [];
  return rows.map((r) => {
    const uncertainty = liftUncertainty({ mu: r.mu, sigma: r.sigma });
    return {
      id: String(r.id),
      runId: String(r.run_id),
      agentName: String(r.agent_name ?? ''),
      generation: Number(r.generation ?? 0),
      eloScore: Number(r.elo_score ?? 0),
      ...(uncertainty != null ? { uncertainty } : {}),
      parentVariantId: r.parent_variant_id ? String(r.parent_variant_id) : null,
      variantContent: String(r.variant_content ?? ''),
      depth: Number(r.depth ?? 0),
    };
  });
});
