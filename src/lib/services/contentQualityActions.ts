'use server';
// Server actions for content quality evaluation admin UI.
// Provides CRUD for eval runs, quality scores listing, and batch eval triggers.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { logger } from '@/lib/server_utilities';
import type { ContentQualityDimension } from '@/lib/schemas/schemas';

// ─── Types ───────────────────────────────────────────────────────

export interface ContentQualityScoreRow {
  id: string;
  explanation_id: number;
  dimension: ContentQualityDimension;
  score: number;
  rationale: string;
  model: string;
  eval_run_id: string | null;
  estimated_cost_usd: number;
  created_at: string;
}

export interface ContentEvalRun {
  id: string;
  status: string;
  total_articles: number;
  completed_articles: number;
  total_cost_usd: number;
  dimensions: string[];
  error_message: string | null;
  triggered_by: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ArticleQualitySummary {
  explanation_id: number;
  explanation_title: string;
  scores: Record<string, number>;
  avgScore: number;
  lastEvalAt: string;
}

// ─── Get quality scores for an article ───────────────────────────

const _getQualityScoresAction = withLogging(async (
  explanationId: number
): Promise<{ success: boolean; data: ContentQualityScoreRow[] | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('content_quality_scores')
      .select('*')
      .eq('explanation_id', explanationId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching quality scores', { error: error.message });
      throw error;
    }

    return { success: true, data: (data ?? []) as ContentQualityScoreRow[], error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getQualityScoresAction', { explanationId }) };
  }
}, 'getQualityScoresAction');

export const getQualityScoresAction = serverReadRequestId(_getQualityScoresAction);

// ─── Get articles with quality summaries ─────────────────────────

const _getArticleQualitySummariesAction = withLogging(async (
  limit: number = 50
): Promise<{ success: boolean; data: ArticleQualitySummary[] | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    // Get latest scores grouped by explanation_id + dimension
    // Use a subquery approach: get distinct explanation_ids that have scores
    const { data: scoreData, error: scoreError } = await supabase
      .from('content_quality_scores')
      .select('explanation_id, dimension, score, created_at')
      .order('created_at', { ascending: false })
      .limit(500);

    if (scoreError) {
      logger.error('Error fetching quality summaries', { error: scoreError.message });
      throw scoreError;
    }

    if (!scoreData || scoreData.length === 0) {
      return { success: true, data: [], error: null };
    }

    // Group by explanation_id, take latest score per dimension
    const byExplanation = new Map<number, Map<string, { score: number; createdAt: string }>>();
    for (const row of scoreData) {
      if (!byExplanation.has(row.explanation_id)) {
        byExplanation.set(row.explanation_id, new Map());
      }
      const dimMap = byExplanation.get(row.explanation_id)!;
      // Only keep latest (already sorted DESC)
      if (!dimMap.has(row.dimension)) {
        dimMap.set(row.dimension, { score: row.score, createdAt: row.created_at });
      }
    }

    // Fetch explanation titles
    const explanationIds = Array.from(byExplanation.keys()).slice(0, limit);
    const { data: explanations } = await supabase
      .from('explanations')
      .select('id, explanation_title')
      .in('id', explanationIds);

    const titleMap = new Map<number, string>();
    for (const e of explanations ?? []) {
      titleMap.set(e.id, e.explanation_title);
    }

    // Build summaries
    const summaries: ArticleQualitySummary[] = explanationIds.map((expId) => {
      const dimMap = byExplanation.get(expId)!;
      const scores: Record<string, number> = {};
      let total = 0;
      let count = 0;
      let lastEvalAt = '';

      for (const [dim, { score, createdAt }] of dimMap) {
        scores[dim] = score;
        total += score;
        count++;
        if (createdAt > lastEvalAt) lastEvalAt = createdAt;
      }

      return {
        explanation_id: expId,
        explanation_title: titleMap.get(expId) ?? `#${expId}`,
        scores,
        avgScore: count > 0 ? total / count : 0,
        lastEvalAt,
      };
    });

    // Sort by avgScore ascending (worst first)
    summaries.sort((a, b) => a.avgScore - b.avgScore);

    return { success: true, data: summaries, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getArticleQualitySummariesAction', {}) };
  }
}, 'getArticleQualitySummariesAction');

export const getArticleQualitySummariesAction = serverReadRequestId(_getArticleQualitySummariesAction);

// ─── Get eval runs ───────────────────────────────────────────────

const _getEvalRunsAction = withLogging(async (): Promise<{
  success: boolean;
  data: ContentEvalRun[] | null;
  error: ErrorResponse | null;
}> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('content_eval_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      logger.error('Error fetching eval runs', { error: error.message });
      throw error;
    }

    return { success: true, data: (data ?? []) as ContentEvalRun[], error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvalRunsAction', {}) };
  }
}, 'getEvalRunsAction');

export const getEvalRunsAction = serverReadRequestId(_getEvalRunsAction);

// ─── Trigger manual eval run ─────────────────────────────────────

const _triggerEvalRunAction = withLogging(async (
  input: { explanationIds: number[]; dimensions?: ContentQualityDimension[] }
): Promise<{ success: boolean; data: { runId: string } | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();

    if (input.explanationIds.length === 0) {
      throw new Error('At least one explanation ID required');
    }
    if (input.explanationIds.length > 100) {
      throw new Error('Maximum 100 articles per batch');
    }

    // Dynamic import to avoid loading eval code at module level
    const { runContentQualityBatch } = await import('./contentQualityEval');

    const runId = await runContentQualityBatch(
      input.explanationIds,
      'eval-admin',
      input.dimensions,
      'manual',
    );

    if (!runId) {
      throw new Error('Failed to create eval run');
    }

    return { success: true, data: { runId }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'triggerEvalRunAction', { input }) };
  }
}, 'triggerEvalRunAction');

export const triggerEvalRunAction = serverReadRequestId(_triggerEvalRunAction);

// ─── Evolution quality comparison (Phase E) ──────────────────────

export interface EvolutionComparison {
  explanationId: number;
  appliedAt: string;
  before: Record<string, number>;
  after: Record<string, number>;
  beforeAvg: number;
  afterAvg: number;
  improvement: number;
}

const _getEvolutionComparisonAction = withLogging(async (
  explanationId: number
): Promise<{ success: boolean; data: EvolutionComparison | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    // Get latest evolution history entry
    const { data: historyRow, error: historyError } = await supabase
      .from('content_history')
      .select('id, created_at')
      .eq('explanation_id', explanationId)
      .eq('source', 'evolution_pipeline')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (historyError || !historyRow) {
      return { success: true, data: null, error: null };
    }

    const appliedAt = historyRow.created_at as string;

    // Get all quality scores for this explanation
    const { data: scores, error: scoresError } = await supabase
      .from('content_quality_scores')
      .select('dimension, score, created_at')
      .eq('explanation_id', explanationId)
      .order('created_at', { ascending: false });

    if (scoresError || !scores || scores.length === 0) {
      return { success: true, data: null, error: null };
    }

    // Partition into before/after using appliedAt timestamp
    // Take the latest score per dimension in each partition
    const before: Record<string, number> = {};
    const after: Record<string, number> = {};

    for (const row of scores) {
      const isAfter = row.created_at >= appliedAt;
      const target = isAfter ? after : before;
      if (!(row.dimension in target)) {
        target[row.dimension] = row.score;
      }
    }

    // Need scores in both before and after to compare
    if (Object.keys(before).length === 0 || Object.keys(after).length === 0) {
      return { success: true, data: null, error: null };
    }

    const avgOf = (map: Record<string, number>) => {
      const vals = Object.values(map);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    };

    const beforeAvg = avgOf(before);
    const afterAvg = avgOf(after);

    return {
      success: true,
      data: {
        explanationId,
        appliedAt,
        before,
        after,
        beforeAvg,
        afterAvg,
        improvement: afterAvg - beforeAvg,
      },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionComparisonAction', { explanationId }) };
  }
}, 'getEvolutionComparisonAction');

export const getEvolutionComparisonAction = serverReadRequestId(_getEvolutionComparisonAction);
