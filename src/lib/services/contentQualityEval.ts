// Evaluates article content quality across configurable dimensions via LLM.
// Fire-and-forget: errors are logged but never thrown to caller (same pattern as explanationSummarizer).

import { callLLM, LIGHTER_MODEL } from './llms';
import {
  contentQualityEvalResponseSchema,
  type ContentQualityDimension,
  type ContentQualityEvalResponse,
} from '@/lib/schemas/schemas';
import { DIMENSION_CRITERIA, DEFAULT_EVAL_DIMENSIONS } from './contentQualityCriteria';
import { logger } from '@/lib/server_utilities';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';

// ─── Prompt construction ─────────────────────────────────────────

function buildEvalPrompt(
  title: string,
  content: string,
  dimensions: ContentQualityDimension[],
): string {
  const dimensionBlocks = dimensions
    .map((dim) => `### ${dim.toUpperCase()}\n${DIMENSION_CRITERIA[dim]}`)
    .join('\n\n');

  return `You are an expert writing quality evaluator. Score the following article on each dimension.

## Article
Title: ${title}

${content.slice(0, 6000)}

## Evaluation Dimensions
${dimensionBlocks}

## Instructions
- Score each dimension on a 0-1 scale (two decimal places).
- Provide a brief rationale (1-3 sentences) for each score.
- Be calibrated: 0.5 is average, 0.7+ is good, 0.9+ is exceptional.
- Score the WRITING quality, not whether you agree with the content.

Respond with JSON matching the schema exactly.`;
}

// ─── Core evaluation function ────────────────────────────────────

/**
 * Evaluate a single article's content quality across specified dimensions.
 * Returns parsed scores or null on failure.
 */
export async function evaluateContentQuality(
  explanationId: number,
  title: string,
  content: string,
  userid: string,
  dimensions: ContentQualityDimension[] = DEFAULT_EVAL_DIMENSIONS,
): Promise<ContentQualityEvalResponse | null> {
  try {
    const prompt = buildEvalPrompt(title, content, dimensions);

    const result = await callLLM(
      prompt,
      'content_quality_eval',
      userid,
      LIGHTER_MODEL,
      false,
      null,
      contentQualityEvalResponseSchema,
      'ContentQualityEvalResponse',
    );

    const parsed = contentQualityEvalResponseSchema.safeParse(JSON.parse(result));

    if (!parsed.success) {
      logger.warn('Quality eval schema validation failed', {
        explanationId,
        errors: parsed.error.errors,
      });
      return null;
    }

    return parsed.data;
  } catch (error) {
    logger.error('Failed to evaluate content quality', {
      explanationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ─── Evaluate and persist to DB ──────────────────────────────────

/**
 * Evaluate an article and save scores to content_quality_scores.
 * Fire-and-forget: errors logged but never thrown.
 */
export async function evaluateAndSaveContentQuality(
  explanationId: number,
  title: string,
  content: string,
  userid: string,
  dimensions: ContentQualityDimension[] = DEFAULT_EVAL_DIMENSIONS,
  evalRunId?: string,
): Promise<void> {
  try {
    const evalResult = await evaluateContentQuality(
      explanationId, title, content, userid, dimensions,
    );

    if (!evalResult) return;

    const supabase = await createSupabaseServiceClient();

    const inserts = evalResult.scores.map((s) => ({
      explanation_id: explanationId,
      dimension: s.dimension,
      score: s.score,
      rationale: s.rationale,
      model: LIGHTER_MODEL,
      eval_run_id: evalRunId ?? null,
      estimated_cost_usd: 0.002, // rough estimate per dimension
    }));

    const { error } = await supabase
      .from('content_quality_scores')
      .insert(inserts);

    if (error) {
      logger.error('Failed to insert quality scores', {
        explanationId,
        error: error.message,
      });
      return;
    }

    logger.info('Saved content quality scores', {
      explanationId,
      dimensions: evalResult.scores.map((s) => s.dimension),
      avgScore: evalResult.scores.reduce((sum, s) => sum + s.score, 0) / evalResult.scores.length,
    });
  } catch (error) {
    logger.error('evaluateAndSaveContentQuality failed', {
      explanationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ─── Batch evaluation ────────────────────────────────────────────

/**
 * Run quality evaluation on a batch of articles.
 * Creates a content_eval_runs record and evaluates each article sequentially.
 */
export async function runContentQualityBatch(
  explanationIds: number[],
  userid: string,
  dimensions: ContentQualityDimension[] = DEFAULT_EVAL_DIMENSIONS,
  triggeredBy: string = 'manual',
): Promise<string | null> {
  const supabase = await createSupabaseServiceClient();

  // Create eval run record
  const { data: evalRun, error: createError } = await supabase
    .from('content_eval_runs')
    .insert({
      total_articles: explanationIds.length,
      dimensions,
      triggered_by: triggeredBy,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (createError || !evalRun) {
    logger.error('Failed to create eval run', { error: createError?.message });
    return null;
  }

  const runId = evalRun.id;
  let completedCount = 0;
  let totalCost = 0;

  for (const explanationId of explanationIds) {
    try {
      // Fetch article content
      const { data: explanation } = await supabase
        .from('explanations')
        .select('explanation_title, content')
        .eq('id', explanationId)
        .single();

      if (!explanation) {
        logger.warn('Explanation not found for eval', { explanationId });
        continue;
      }

      await evaluateAndSaveContentQuality(
        explanationId,
        explanation.explanation_title,
        explanation.content,
        userid,
        dimensions,
        runId,
      );

      completedCount++;
      totalCost += 0.002 * dimensions.length; // rough estimate

      // Update progress
      await supabase
        .from('content_eval_runs')
        .update({
          completed_articles: completedCount,
          total_cost_usd: totalCost,
        })
        .eq('id', runId);
    } catch (error) {
      logger.error('Batch eval: article failed', {
        explanationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Mark complete
  await supabase
    .from('content_eval_runs')
    .update({
      status: 'completed',
      completed_articles: completedCount,
      total_cost_usd: totalCost,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId);

  logger.info('Batch eval completed', { runId, completedCount, totalCost });
  return runId;
}
