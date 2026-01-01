/**
 * Generates AI summaries for explanations using gpt-4.1-nano.
 * Fire-and-forget: errors are logged but never thrown to caller.
 * Used during article publish to generate preview text, SEO descriptions, and keywords.
 */

import { callOpenAIModel, lighter_model } from './llms';
import { explanationSummarySchema, type ExplanationSummary } from '../schemas/schemas';
import { logger } from '../server_utilities';
import { createSupabaseServerClient } from '../utils/supabase/server';

const SUMMARIZER_PROMPT = `You are summarizing an educational article for display on an explore page.

Article Title: {title}

Article Content:
{content}

Generate:
1. summary_teaser: A compelling 1-2 sentence preview (30-50 words) that captures the key insight
2. meta_description: An SEO-optimized description (max 160 chars) for search engines
3. keywords: 5-10 relevant search terms (single words or short phrases)

Focus on what makes this article valuable to readers.`;

/**
 * Updates an explanation record with summary data
 * @param explanationId - The ID of the explanation to update
 * @param summary - The summary data to save
 */
export async function updateExplanationSummary(
    explanationId: number,
    summary: ExplanationSummary
): Promise<void> {
    const supabase = await createSupabaseServerClient();

    const { error } = await supabase
        .from('explanations')
        .update({
            summary_teaser: summary.summary_teaser,
            meta_description: summary.meta_description,
            keywords: summary.keywords,
        })
        .eq('id', explanationId);

    if (error) {
        throw error;
    }
}

/**
 * Generates and saves an AI summary for an explanation.
 * Fire-and-forget pattern: errors are logged but never thrown to caller.
 *
 * @param explanationId - The ID of the explanation to summarize
 * @param title - The explanation title
 * @param content - The explanation content (markdown)
 * @param userid - The user ID for tracking LLM calls
 */
export async function generateAndSaveExplanationSummary(
    explanationId: number,
    title: string,
    content: string,
    userid: string
): Promise<void> {
    try {
        const prompt = SUMMARIZER_PROMPT
            .replace('{title}', title)
            .replace('{content}', content.slice(0, 4000)); // Limit context for cost

        const result = await callOpenAIModel(
            prompt,
            'explanation_summarization',
            userid,
            lighter_model,
            false,
            null,
            explanationSummarySchema,
            'ExplanationSummary'
        );

        const parsed = explanationSummarySchema.safeParse(JSON.parse(result));

        if (!parsed.success) {
            logger.warn('Summary schema validation failed', {
                explanationId,
                errors: parsed.error.errors,
            });
            return;
        }

        await updateExplanationSummary(explanationId, parsed.data);

        logger.info('Generated explanation summary', {
            explanationId,
            keywordCount: parsed.data.keywords.length,
        });
    } catch (error) {
        // Fire-and-forget: log but don't throw
        logger.error('Failed to generate explanation summary', {
            explanationId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
