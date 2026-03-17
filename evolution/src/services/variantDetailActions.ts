'use server';
// Server actions for the variant detail page: full variant data, lineage, and match history.
// Provides deep-dive into a single variant across its evolution lifecycle.

import { adminAction, type AdminContext } from './adminAction';
import type { EloAttribution, SerializedPipelineState } from '@evolution/lib/types';
import { toEloScale } from '@evolution/lib/core/rating';

// ─── Types ──────────────────────────────────────────────────────

export interface VariantFullDetail {
  id: string;
  runId: string;
  explanationId: number | null;
  explanationTitle: string | null;
  variantContent: string;
  eloScore: number;
  generation: number;
  agentName: string;
  matchCount: number;
  isWinner: boolean;
  parentVariantId: string | null;
  eloAttribution: EloAttribution | null;
  createdAt: string;
  runStatus: string;
  runCreatedAt: string;
}

export interface VariantRelative {
  id: string;
  eloScore: number;
  generation: number;
  agentName: string;
  isWinner: boolean;
  preview: string;
}

export interface VariantMatchEntry {
  opponentId: string;
  opponentElo: number | null;
  won: boolean;
  confidence: number;
}

export interface LineageEntry {
  id: string;
  agentName: string;
  generation: number;
  eloScore: number;
  preview: string;
}

// ─── 1. Full Variant Detail ─────────────────────────────────────

export const getVariantFullDetailAction = adminAction('getVariantFullDetailAction', async (
  variantId: string,
  ctx: AdminContext,
): Promise<VariantFullDetail> => {
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
      ? supabase.from('explanations').select('title').eq('id', variant.explanation_id).single()
      : Promise.resolve({ data: null, error: null }),
  ]);

  return {
    id: variant.id,
    runId: variant.run_id,
    explanationId: variant.explanation_id,
    explanationTitle: explResult.data?.title ?? null,
    variantContent: variant.variant_content,
    eloScore: variant.elo_score,
    generation: variant.generation,
    agentName: variant.agent_name,
    matchCount: variant.match_count,
    isWinner: variant.is_winner,
    parentVariantId: variant.parent_variant_id,
    eloAttribution: variant.elo_attribution as EloAttribution | null,
    createdAt: variant.created_at,
    runStatus: runResult.data?.status ?? 'unknown',
    runCreatedAt: runResult.data?.created_at ?? variant.created_at,
  };
});

// ─── 2. Variant Parents ─────────────────────────────────────────

export const getVariantParentsAction = adminAction('getVariantParentsAction', async (
  variantId: string,
  ctx: AdminContext,
): Promise<VariantRelative[]> => {
  const { supabase } = ctx;

  const { data: variant } = await supabase
    .from('evolution_variants')
    .select('parent_variant_id')
    .eq('id', variantId)
    .single();

  if (!variant?.parent_variant_id) return [];

  const { data: parent, error } = await supabase
    .from('evolution_variants')
    .select('id, elo_score, generation, agent_name, is_winner, variant_content')
    .eq('id', variant.parent_variant_id)
    .single();

  if (error || !parent) return [];

  return [{
    id: parent.id,
    eloScore: parent.elo_score,
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
  const { supabase } = ctx;

  const { data, error } = await supabase
    .from('evolution_variants')
    .select('id, elo_score, generation, agent_name, is_winner, variant_content')
    .eq('parent_variant_id', variantId)
    .order('elo_score', { ascending: false })
    .limit(20);

  if (error) throw error;

  return (data ?? []).map(v => ({
    id: v.id,
    eloScore: v.elo_score,
    generation: v.generation,
    agentName: v.agent_name,
    isWinner: v.is_winner,
    preview: (v.variant_content ?? '').slice(0, 200),
  }));
});

// ─── 4. Variant Match History ──────────────────────────────────

export const getVariantMatchHistoryAction = adminAction('getVariantMatchHistoryAction', async (
  variantId: string,
  ctx: AdminContext,
): Promise<VariantMatchEntry[]> => {
  const { supabase } = ctx;

  const { data: variant } = await supabase
    .from('evolution_variants')
    .select('run_id')
    .eq('id', variantId)
    .single();

  if (!variant) return [];

  const { data: cpData, error: cpError } = await supabase
    .from('evolution_checkpoints')
    .select('state_snapshot')
    .eq('run_id', variant.run_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cpError) throw cpError;
  if (!cpData) return [];

  const snapshot = cpData.state_snapshot as SerializedPipelineState;
  const matchHistory = snapshot.matchHistory ?? [];

  const eloLookup = buildEloLookup(snapshot);

  return matchHistory
    .filter(m => m.variationA === variantId || m.variationB === variantId)
    .map(m => ({
      opponentId: m.variationA === variantId ? m.variationB : m.variationA,
      opponentElo: eloLookup[m.variationA === variantId ? m.variationB : m.variationA] ?? null,
      won: m.winner === variantId,
      confidence: m.confidence,
    }));
});

// ─── 5. Variant Lineage Chain ───────────────────────────────────

export const getVariantLineageChainAction = adminAction('getVariantLineageChainAction', async (
  variantId: string,
  ctx: AdminContext,
): Promise<LineageEntry[]> => {
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
      .select('id, agent_name, generation, elo_score, variant_content, parent_variant_id')
      .eq('id', currentParentId)
      .single();

    if (!ancestor) break;
    lineage.push({
      id: ancestor.id,
      agentName: ancestor.agent_name,
      generation: ancestor.generation,
      eloScore: ancestor.elo_score,
      preview: (ancestor.variant_content ?? '').slice(0, 200),
    });
    currentParentId = ancestor.parent_variant_id;
  }

  return lineage;
});

/** Build Elo lookup from {mu,sigma} ratings or legacy eloRatings. */
function buildEloLookup(snapshot: SerializedPipelineState): Record<string, number> {
  if (snapshot.ratings && Object.keys(snapshot.ratings).length > 0) {
    return Object.fromEntries(
      Object.entries(snapshot.ratings).map(([id, r]) => [
        id,
        toEloScale((r as { mu: number; sigma: number }).mu),
      ]),
    );
  }
  return snapshot.eloRatings ?? {};
}
