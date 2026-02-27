'use server';
// Server actions for the variant detail page: full variant data, lineage, and match history.
// Provides deep-dive into a single variant across its evolution lifecycle.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import type { EloAttribution, SerializedPipelineState } from '@evolution/lib/types';
import { getOrdinal, ordinalToEloScale } from '@evolution/lib/core/rating';

type ActionResult<T> = { success: boolean; data: T | null; error: ErrorResponse | null };

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

const _getVariantFullDetailAction = withLogging(async (
  variantId: string
): Promise<ActionResult<VariantFullDetail>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

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
      success: true,
      data: {
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
      },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getVariantFullDetailAction', { variantId }) };
  }
}, 'getVariantFullDetailAction');

export const getVariantFullDetailAction = serverReadRequestId(_getVariantFullDetailAction);

// ─── 2. Variant Parents ─────────────────────────────────────────

const _getVariantParentsAction = withLogging(async (
  variantId: string
): Promise<ActionResult<VariantRelative[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: variant } = await supabase
      .from('evolution_variants')
      .select('parent_variant_id')
      .eq('id', variantId)
      .single();

    if (!variant?.parent_variant_id) return { success: true, data: [], error: null };

    const { data: parent, error } = await supabase
      .from('evolution_variants')
      .select('id, elo_score, generation, agent_name, is_winner, variant_content')
      .eq('id', variant.parent_variant_id)
      .single();

    if (error || !parent) return { success: true, data: [], error: null };

    return {
      success: true,
      data: [{
        id: parent.id,
        eloScore: parent.elo_score,
        generation: parent.generation,
        agentName: parent.agent_name,
        isWinner: parent.is_winner,
        preview: (parent.variant_content ?? '').slice(0, 200),
      }],
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getVariantParentsAction', { variantId }) };
  }
}, 'getVariantParentsAction');

export const getVariantParentsAction = serverReadRequestId(_getVariantParentsAction);

// ─── 3. Variant Children ────────────────────────────────────────

const _getVariantChildrenAction = withLogging(async (
  variantId: string
): Promise<ActionResult<VariantRelative[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('evolution_variants')
      .select('id, elo_score, generation, agent_name, is_winner, variant_content')
      .eq('parent_variant_id', variantId)
      .order('elo_score', { ascending: false })
      .limit(20);

    if (error) throw error;

    return {
      success: true,
      data: (data ?? []).map(v => ({
        id: v.id,
        eloScore: v.elo_score,
        generation: v.generation,
        agentName: v.agent_name,
        isWinner: v.is_winner,
        preview: (v.variant_content ?? '').slice(0, 200),
      })),
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getVariantChildrenAction', { variantId }) };
  }
}, 'getVariantChildrenAction');

export const getVariantChildrenAction = serverReadRequestId(_getVariantChildrenAction);

// ─── 4. Variant Match History ──────────────────────────────────

const _getVariantMatchHistoryAction = withLogging(async (
  variantId: string
): Promise<ActionResult<VariantMatchEntry[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: variant } = await supabase
      .from('evolution_variants')
      .select('run_id')
      .eq('id', variantId)
      .single();

    if (!variant) return { success: true, data: [], error: null };

    const { data: cpData, error: cpError } = await supabase
      .from('evolution_checkpoints')
      .select('state_snapshot')
      .eq('run_id', variant.run_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cpError) throw cpError;
    if (!cpData) return { success: true, data: [], error: null };

    const snapshot = cpData.state_snapshot as SerializedPipelineState;
    const matchHistory = snapshot.matchHistory ?? [];

    const eloLookup = buildEloLookup(snapshot);

    const matches: VariantMatchEntry[] = matchHistory
      .filter(m => m.variationA === variantId || m.variationB === variantId)
      .map(m => ({
        opponentId: m.variationA === variantId ? m.variationB : m.variationA,
        opponentElo: eloLookup[m.variationA === variantId ? m.variationB : m.variationA] ?? null,
        won: m.winner === variantId,
        confidence: m.confidence,
      }));

    return { success: true, data: matches, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getVariantMatchHistoryAction', { variantId }) };
  }
}, 'getVariantMatchHistoryAction');

export const getVariantMatchHistoryAction = serverReadRequestId(_getVariantMatchHistoryAction);

// ─── 5. Variant Lineage Chain ───────────────────────────────────

const _getVariantLineageChainAction = withLogging(async (
  variantId: string
): Promise<ActionResult<LineageEntry[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: variant } = await supabase
      .from('evolution_variants')
      .select('parent_variant_id')
      .eq('id', variantId)
      .single();

    if (!variant) return { success: true, data: [], error: null };

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

    return { success: true, data: lineage, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getVariantLineageChainAction', { variantId }) };
  }
}, 'getVariantLineageChainAction');

export const getVariantLineageChainAction = serverReadRequestId(_getVariantLineageChainAction);

/** Build Elo lookup from {mu,sigma} ratings or legacy eloRatings. */
function buildEloLookup(snapshot: SerializedPipelineState): Record<string, number> {
  if (snapshot.ratings && Object.keys(snapshot.ratings).length > 0) {
    return Object.fromEntries(
      Object.entries(snapshot.ratings).map(([id, r]) => [
        id,
        ordinalToEloScale(getOrdinal(r as { mu: number; sigma: number })),
      ]),
    );
  }
  return snapshot.eloRatings ?? {};
}
