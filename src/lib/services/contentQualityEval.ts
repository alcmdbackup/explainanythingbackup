// Evaluates article content quality across configurable dimensions via LLM.
// Pure evaluation only -- does not persist results to DB.

import { callLLM, LIGHTER_MODEL } from './llms';
import {
  contentQualityEvalResponseSchema,
  type ContentQualityDimension,
  type ContentQualityEvalResponse,
} from '@/lib/schemas/schemas';
import { DIMENSION_CRITERIA, DEFAULT_EVAL_DIMENSIONS } from './contentQualityCriteria';
import { logger } from '@/lib/server_utilities';

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
