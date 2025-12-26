import { callOpenAIModel, lighter_model } from '@/lib/services/llms';
import { logger } from '@/lib/server_utilities';
import { countWords } from './sourceFetcher';

/**
 * Result type for summarization operations
 */
export interface SummarizeResult {
  summarized: string;
  isVerbatim: boolean;
  originalLength: number;
}

/**
 * Create prompt for summarizing source content
 */
function createSummarizationPrompt(content: string, maxWords: number): string {
  return `You are a content summarizer for an educational platform. Summarize the following source content to be used as reference material for generating explanations.

REQUIREMENTS:
1. Preserve key facts, concepts, and terminology exactly as stated
2. Maintain technical accuracy - do not paraphrase specialized terms
3. Keep direct quotes for important definitions or statements
4. Target approximately ${maxWords} words
5. Organize by topic/section if the original has clear structure
6. Mark any sections that are verbatim quotes with quotation marks

SOURCE CONTENT:
${content}

SUMMARIZED CONTENT:`;
}

/**
 * Summarize source content for use in prompts
 *
 * Uses gpt-4.1-nano for cost efficiency
 * Preserves key information while reducing length
 *
 * @param content - The full extracted text to summarize
 * @param maxWords - Target word count (default 3000)
 * @param userid - User ID for LLM tracking
 */
export async function summarizeSourceContent(
  content: string,
  maxWords: number = 3000,
  userid: string
): Promise<SummarizeResult> {
  const originalLength = countWords(content);

  logger.info('summarizeSourceContent: Starting', {
    originalLength,
    maxWords
  });

  // If content is already under threshold, return as-is
  if (originalLength <= maxWords) {
    return {
      summarized: content,
      isVerbatim: true,
      originalLength
    };
  }

  try {
    const prompt = createSummarizationPrompt(content, maxWords);

    const result = await callOpenAIModel(
      prompt,
      'source_summarization',
      userid,
      lighter_model, // gpt-4.1-nano for cost efficiency
      false, // not streaming
      null, // no setText callback
      null, // no response schema
      null  // no schema name
    );

    if (!result || result.trim().length === 0) {
      logger.error('summarizeSourceContent: LLM call returned empty');
      // Fallback: truncate to approximate word limit
      const words = content.split(/\s+/);
      const truncated = words.slice(0, maxWords).join(' ') + '...';
      return {
        summarized: truncated,
        isVerbatim: false,
        originalLength
      };
    }

    const summarizedLength = countWords(result);

    logger.info('summarizeSourceContent: Complete', {
      originalLength,
      summarizedLength,
      reduction: `${Math.round((1 - summarizedLength / originalLength) * 100)}%`
    });

    return {
      summarized: result,
      isVerbatim: false,
      originalLength
    };

  } catch (error) {
    logger.error('summarizeSourceContent: Error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    // Fallback: simple truncation
    const words = content.split(/\s+/);
    const truncated = words.slice(0, maxWords).join(' ') + '...';
    return {
      summarized: truncated,
      isVerbatim: false,
      originalLength
    };
  }
}
