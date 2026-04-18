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

  const { data: variant, error } = await supabase
    .from('evolution_variants')
    .select('*')
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

export const getVariantMatchHistoryAction = adminAction('getVariantMatchHistoryAction', async (
  _variantId: string,
  _ctx: AdminContext,
): Promise<VariantMatchEntry[]> => {
  // V2: match history not persisted per-variant — aggregated in run_summary JSONB
  return [];
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
