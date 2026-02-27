'use server';
// Server actions for the explanation detail page: cross-run article history and attribution.
// Aggregates evolution data across all runs for a single explanation/article.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import type { EloAttribution, AgentAttribution } from '@evolution/lib/types';

type ActionResult<T> = { success: boolean; data: T | null; error: ErrorResponse | null };

// ─── Types ──────────────────────────────────────────────────────

export interface ArticleOverview {
  explanationId: number;
  title: string;
  totalRuns: number;
  bestElo: number | null;
  bestVariantId: string | null;
  hofEntries: number;
}

export interface ArticleRun {
  id: string;
  status: string;
  phase: string;
  winnerVariantId: string | null;
  winnerElo: number | null;
  totalCostUsd: number;
  totalVariants: number;
  createdAt: string;
  completedAt: string | null;
  pipelineType: string | null;
}

export interface ArticleEloPoint {
  runId: string;
  completedAt: string;
  bestElo: number;
}

export interface ArticleAgentAttribution {
  agentName: string;
  runCount: number;
  totalVariants: number;
  avgGain: number;
  avgCi: number;
}

export interface ArticleVariant {
  id: string;
  runId: string;
  eloScore: number;
  generation: number;
  agentName: string;
  matchCount: number;
  isWinner: boolean;
  eloAttribution: EloAttribution | null;
  createdAt: string;
}

// ─── 1. Article Overview ────────────────────────────────────────

const _getArticleOverviewAction = withLogging(async (
  explanationId: number
): Promise<ActionResult<ArticleOverview>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const [explResult, runsResult, variantsResult, hofResult] = await Promise.all([
      supabase.from('explanations').select('id, title').eq('id', explanationId).single(),
      supabase.from('evolution_runs').select('id', { count: 'exact', head: true }).eq('explanation_id', explanationId),
      supabase.from('evolution_variants').select('id, elo_score').eq('explanation_id', explanationId).order('elo_score', { ascending: false }).limit(1),
      supabase.from('evolution_hall_of_fame_entries').select('id', { count: 'exact', head: true })
        .eq('explanation_id', explanationId).is('deleted_at', null),
    ]);

    if (explResult.error) throw explResult.error;

    const bestVariant = variantsResult.data?.[0];

    return {
      success: true,
      data: {
        explanationId,
        title: explResult.data?.title ?? `Explanation #${explanationId}`,
        totalRuns: runsResult.count ?? 0,
        bestElo: bestVariant?.elo_score ?? null,
        bestVariantId: bestVariant?.id ?? null,
        hofEntries: hofResult.count ?? 0,
      },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getArticleOverviewAction', { explanationId }) };
  }
}, 'getArticleOverviewAction');

export const getArticleOverviewAction = serverReadRequestId(_getArticleOverviewAction);

// ─── 2. Article Runs ────────────────────────────────────────────

const _getArticleRunsAction = withLogging(async (
  explanationId: number
): Promise<ActionResult<ArticleRun[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: runs, error } = await supabase
      .from('evolution_runs')
      .select('id, status, phase, total_cost_usd, total_variants, created_at, completed_at, pipeline_type')
      .eq('explanation_id', explanationId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Get winner variants for each run
    const runIds = (runs ?? []).map(r => r.id);
    const { data: winners } = runIds.length > 0
      ? await supabase.from('evolution_variants').select('run_id, id, elo_score').in('run_id', runIds).eq('is_winner', true)
      : { data: [] };

    const winnerMap = new Map((winners ?? []).map(w => [w.run_id, { id: w.id, elo: w.elo_score }]));

    return {
      success: true,
      data: (runs ?? []).map(r => ({
        id: r.id,
        status: r.status,
        phase: r.phase,
        winnerVariantId: winnerMap.get(r.id)?.id ?? null,
        winnerElo: winnerMap.get(r.id)?.elo ?? null,
        totalCostUsd: r.total_cost_usd ?? 0,
        totalVariants: r.total_variants ?? 0,
        createdAt: r.created_at,
        completedAt: r.completed_at,
        pipelineType: r.pipeline_type,
      })),
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getArticleRunsAction', { explanationId }) };
  }
}, 'getArticleRunsAction');

export const getArticleRunsAction = serverReadRequestId(_getArticleRunsAction);

// ─── 3. Article Elo Timeline ────────────────────────────────────

const _getArticleEloTimelineAction = withLogging(async (
  explanationId: number
): Promise<ActionResult<ArticleEloPoint[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: runs, error } = await supabase
      .from('evolution_runs')
      .select('id, completed_at')
      .eq('explanation_id', explanationId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: true });

    if (error) throw error;

    const runIds = (runs ?? []).map(r => r.id);
    if (runIds.length === 0) return { success: true, data: [], error: null };

    const { data: winners } = await supabase
      .from('evolution_variants')
      .select('run_id, elo_score')
      .in('run_id', runIds)
      .eq('is_winner', true);

    const winnerEloMap = new Map((winners ?? []).map(w => [w.run_id, w.elo_score as number]));

    const points: ArticleEloPoint[] = (runs ?? [])
      .filter(r => winnerEloMap.has(r.id))
      .map(r => ({
        runId: r.id,
        completedAt: r.completed_at!,
        bestElo: winnerEloMap.get(r.id)!,
      }));

    return { success: true, data: points, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getArticleEloTimelineAction', { explanationId }) };
  }
}, 'getArticleEloTimelineAction');

export const getArticleEloTimelineAction = serverReadRequestId(_getArticleEloTimelineAction);

// ─── 4. Article Agent Attribution ───────────────────────────────

const _getArticleAgentAttributionAction = withLogging(async (
  explanationId: number
): Promise<ActionResult<ArticleAgentAttribution[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: runs } = await supabase
      .from('evolution_runs')
      .select('id')
      .eq('explanation_id', explanationId);

    const runIds = (runs ?? []).map(r => r.id);
    if (runIds.length === 0) return { success: true, data: [], error: null };

    const { data: invocations } = await supabase
      .from('evolution_agent_invocations')
      .select('agent_name, agent_attribution')
      .in('run_id', runIds)
      .not('agent_attribution', 'is', null);

    const agentMap = new Map<string, { totalVariants: number; gains: number[]; cis: number[] }>();

    for (const inv of invocations ?? []) {
      const attr = inv.agent_attribution as AgentAttribution | null;
      if (!attr) continue;

      let entry = agentMap.get(attr.agentName);
      if (!entry) {
        entry = { totalVariants: 0, gains: [], cis: [] };
        agentMap.set(attr.agentName, entry);
      }
      entry.totalVariants += attr.variantCount;
      entry.gains.push(attr.avgGain);
      entry.cis.push(attr.avgCi);
    }

    const results: ArticleAgentAttribution[] = [];
    for (const [agentName, entry] of agentMap) {
      const n = entry.gains.length;
      results.push({
        agentName,
        runCount: n,
        totalVariants: entry.totalVariants,
        avgGain: entry.gains.reduce((s, g) => s + g, 0) / n,
        avgCi: Math.sqrt(entry.cis.reduce((s, c) => s + c ** 2, 0)) / n,
      });
    }

    results.sort((a, b) => b.avgGain - a.avgGain);
    return { success: true, data: results, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getArticleAgentAttributionAction', { explanationId }) };
  }
}, 'getArticleAgentAttributionAction');

export const getArticleAgentAttributionAction = serverReadRequestId(_getArticleAgentAttributionAction);

// ─── 5. Article Variants ────────────────────────────────────────

const _getArticleVariantsAction = withLogging(async (
  explanationId: number
): Promise<ActionResult<ArticleVariant[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('evolution_variants')
      .select('id, run_id, elo_score, generation, agent_name, match_count, is_winner, elo_attribution, created_at')
      .eq('explanation_id', explanationId)
      .order('elo_score', { ascending: false })
      .limit(200);

    if (error) throw error;

    return {
      success: true,
      data: (data ?? []).map(v => ({
        id: v.id,
        runId: v.run_id,
        eloScore: v.elo_score,
        generation: v.generation,
        agentName: v.agent_name,
        matchCount: v.match_count,
        isWinner: v.is_winner,
        eloAttribution: v.elo_attribution as EloAttribution | null,
        createdAt: v.created_at,
      })),
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getArticleVariantsAction', { explanationId }) };
  }
}, 'getArticleVariantsAction');

export const getArticleVariantsAction = serverReadRequestId(_getArticleVariantsAction);
