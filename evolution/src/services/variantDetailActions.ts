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

  const [runResult, explResult] = await Promise.all([
    supabase.from('evolution_runs').select('status, created_at').eq('id', variant.run_id).single(),
    variant.explanation_id
      ? supabase.from('explanations').select('explanation_title').eq('id', variant.explanation_id).single()
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
