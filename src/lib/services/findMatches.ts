/* eslint-disable @typescript-eslint/no-explicit-any */
import { callOpenAIModel, default_model } from '@/lib/services/llms';
import { getExplanationById } from '@/lib/services/explanations';
import { logger } from '@/lib/server_utilities';
import { matchFoundFromListSchema, type matchWithCurrentContentType, MatchMode, type VectorSearchResult } from '@/lib/schemas/schemas';
import { createMatchSelectionPrompt } from '@/lib/prompts';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';

const FILE_DEBUG = true;

/**
 * Prefixes used to identify test content that should be excluded from discovery.
 */
const TEST_CONTENT_PREFIX = '[TEST]';
const LEGACY_TEST_PREFIX = 'test-';

/**
 * Filters out test content from match results.
 * Test content is identified by titles starting with '[TEST]' or 'test-' prefixes.
 * Used to prevent test data from appearing in related content recommendations.
 *
 * @param matches Array of matches with current_title field
 * @returns Filtered array excluding test content
 */
export function filterTestContent<T extends { current_title?: string }>(
  matches: T[]
): T[] {
  return matches.filter(m => {
    const title = m.current_title;
    if (!title) return true;
    return !title.startsWith(TEST_CONTENT_PREFIX) && !title.startsWith(LEGACY_TEST_PREFIX);
  });
}

// Custom error types for better error handling
type ErrorResponse = {
    code: string;
    message: string;
    details?: any;
};

/**
 * Key points:
 * - Formats top 5 matches into a numbered list
 * - Excludes any match matching savedId
 * - Truncates content to 1000 chars for prompt size
 * - Used by findBestMatchFromList for LLM ranking
 */
function formatTopMatches(matches: matchWithCurrentContentType[], savedId: number | null): string {
    const topMatches = matches.slice(0, 5);
    
    return topMatches.map((match, index) => {
      // Skip if this source matches savedId
      if (match.explanation_id === savedId) {
        return null;
      }

      const number = index + 1; // Use original array index
      const title = match.current_title || 'Untitled';
      // Truncate content if it's too long to keep prompt size reasonable
      const contentPreview = match.current_content.substring(0, 1000) + 
        (match.current_content.length > 150 ? '...' : '');
      
      return `${number}. [${title}] ${contentPreview}`;
    }).filter(Boolean).join('\n\n');
  }
  

  
  /**
   * Key points:
   * - Uses LLM to select best match from top 5
   * - Handles force mode to bypass LLM selection
   * - Excludes those matching savedId
   * - Called by generateAiExplanation for matching
   * - Uses formatTopMatches and createMatchSelectionPrompt
   */
  async function findBestMatchFromListImpl(
    userQuery: string, 
    matches: matchWithCurrentContentType[],
    matchMode: MatchMode,
    savedId: number | null,
    userid: string
  ): Promise<{ 
    selectedIndex: number | null,
    explanationId: number | null,
    topicId: number | null,
    error: ErrorResponse | null 
  }> {
    try {
      if (!matches || matches.length === 0) {
        return {
          selectedIndex: null,
          explanationId: null,
          topicId: null,
          error: {
            code: 'NO_MATCHES',
            message: 'No matches available for selection'
          }
        };
      }
  
      // If in force mode and we have matches, return the first match that's not savedId
      if (matchMode === MatchMode.ForceMatch) {
        const firstNonSavedMatch = matches.find(match => match.explanation_id !== savedId);
        if (firstNonSavedMatch) {
          logger.debug('Force mode: returning first non-saveid match', {
            source: firstNonSavedMatch
          });
          return {
            selectedIndex: matches.indexOf(firstNonSavedMatch) + 1, // Convert to 1-based index
            explanationId: firstNonSavedMatch.explanation_id,
            topicId: firstNonSavedMatch.topic_id || null,
            error: null
          };
        }
      }

      const formattedMatches = formatTopMatches(matches, savedId);
      
      // Create the prompt for source selection
      const selectionPrompt = createMatchSelectionPrompt(userQuery, formattedMatches);
      
      // Call the LLM with the schema to force an integer response
      logger.debug('Calling GPT-4 for source selection', { prompt_length: selectionPrompt.length });
      const result = await callOpenAIModel(selectionPrompt, 'findBestMatchFromList', userid, default_model, false, null, matchFoundFromListSchema, 'matchSelection');
      
      // Parse the result
      const parsedResult = matchFoundFromListSchema.safeParse(JSON.parse(result));

      if (!parsedResult.success) {
        logger.debug('Match selection schema validation failed', { 
          errors: parsedResult.error.errors 
        });
        return {
          selectedIndex: null,
          explanationId: null,
          topicId: null,
          error: {
            code: 'INVALID_RESPONSE',
            message: 'AI response for match selection did not match expected format',
            details: parsedResult.error
          }
        };
      }
      
      let selectedIndex = parsedResult.data.selectedSourceIndex;
      
      // If the selected source matches savedId, find the next best match
      if (selectedIndex > 0 && selectedIndex <= matches.length && 
          matches[selectedIndex - 1].explanation_id === savedId) {
        // Find the next best source that's not savedId
        const nextBestSource = matches.find((match, index) => 
          match.explanation_id !== savedId && index !== selectedIndex - 1
        );
        if (nextBestSource) {
          selectedIndex = matches.indexOf(nextBestSource) + 1;
        } else {
          selectedIndex = 0; // No valid match found
        }
      }
      
      // If a valid source was selected (not 0), get its explanation ID and topic ID
      const explanationId = selectedIndex > 0 && selectedIndex <= matches.length 
        ? matches[selectedIndex - 1].explanation_id 
        : null;

      // Get topic ID from metadata if available
      const topicId = selectedIndex > 0 && selectedIndex <= matches.length
        ? matches[selectedIndex - 1].topic_id || null
        : null;

      logger.debug('Successfully selected match', {
        selected_index: selectedIndex,
        explanation_id: explanationId,
        topic_id: topicId
      });
      
      return { 
        selectedIndex, 
        explanationId,
        topicId,
        error: null 
      };
    } catch (error) {
      logger.error('Error in findBestMatchFromList', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        user_query: userQuery
      });
      
      return {
        selectedIndex: null,
        explanationId: null,
        topicId: null,
        error: {
          code: 'MATCH_SELECTION_ERROR',
          message: 'Failed to select best match',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

/**
 * Key points:
 * - Adds current content from database to vector search results
 * - Maps over results to fetch full explanations
 * - Adds diversity scores based on comparison with previous explanation
 * - Used by generateAiExplanation to enrich source data with diversity metrics
 * - Calls getExplanationById for each source
 * - Gracefully skips explanations that are inaccessible (deleted, RLS-blocked, etc.)
 */
async function enhanceMatchesWithCurrentContentAndDiversityImpl(similarTexts: VectorSearchResult[], diversityComparison: VectorSearchResult[] | null): Promise<matchWithCurrentContentType[]> {
    logger.debug('Starting enhanceMatchesWithCurrentContentAndDiversity', {
        input_count: similarTexts?.length || 0,
        diversity_comparison_count: diversityComparison?.length || 0,
        first_input: similarTexts?.[0],
        diversity_comparison_sample: diversityComparison?.slice(0, 2) || [],
        diversity_comparison_full: diversityComparison || null,
        diversity_comparison_keys: diversityComparison?.[0] ? Object.keys(diversityComparison[0]) : [],
        diversity_comparison_metadata_keys: diversityComparison?.[0]?.metadata ? Object.keys(diversityComparison[0].metadata) : []
    }, FILE_DEBUG);

    const results = await Promise.all(similarTexts.map(async (result: VectorSearchResult) => {
        logger.debug('Processing source', {
            metadata: result.metadata,
            score: result.score
        }, FILE_DEBUG);

        // Gracefully handle inaccessible explanations (deleted, RLS-blocked, stale vector entries)
        let explanation;
        try {
            explanation = await getExplanationById(result.metadata.explanation_id);
        } catch (error) {
            logger.warn('Skipping inaccessible explanation in vector results', {
                explanation_id: result.metadata.explanation_id,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return null; // Will be filtered out below
        }

        logger.debug('Retrieved explanation', {
            explanation_id: result.metadata.explanation_id,
            found: !!explanation,
            title: explanation?.explanation_title
        }, FILE_DEBUG);

        // Find diversity score for this explanation
        let diversityScore: number | null = null;
        if (diversityComparison && diversityComparison.length > 0) {
            const diversityMatch = diversityComparison.find((diversityResult: VectorSearchResult) =>
                diversityResult.metadata.explanation_id === result.metadata.explanation_id
            );
            if (diversityMatch) {
                diversityScore = diversityMatch.score ?? null;
                logger.debug('Found diversity score', {
                    explanation_id: result.metadata.explanation_id,
                    diversity_score: diversityScore
                }, FILE_DEBUG);
            } else {
                logger.debug('No diversity match found for explanation', {
                    explanation_id: result.metadata.explanation_id,
                    diversity_comparison_ids: diversityComparison.map((d: VectorSearchResult) => d.metadata.explanation_id)
                }, FILE_DEBUG);
            }
        } else {
            logger.debug('No diversity comparison data available', {
                explanation_id: result.metadata.explanation_id,
                diversity_comparison_null: diversityComparison === null,
                diversity_comparison_empty: diversityComparison?.length === 0
            }, FILE_DEBUG);
        }

        const enhancedSource = {
            text: result.metadata.text,
            explanation_id: result.metadata.explanation_id,
            topic_id: result.metadata.topic_id,
            current_title: explanation?.explanation_title || '',
            current_content: explanation?.content || '',
            summary_teaser: explanation?.summary_teaser ?? null,  // For card preview display
            timestamp: explanation?.timestamp ?? '',               // For card metadata display
            ranking: {
                similarity: result.score ?? 0, // score is always present in query results
                diversity_score: diversityScore
            }
        };

        logger.debug('Enhanced source with diversity created', {
            source: enhancedSource
        }, FILE_DEBUG);

        return enhancedSource;
    }));

    // Filter out null results (inaccessible explanations)
    return results.filter((result): result is matchWithCurrentContentType => result !== null);
}

// Wrap all async functions with automatic logging for entry/exit/timing
export const findBestMatchFromList = withLogging(
  findBestMatchFromListImpl,
  'findBestMatchFromList',
  { logErrors: true }
);

export const enhanceMatchesWithCurrentContentAndDiversity = withLogging(
  enhanceMatchesWithCurrentContentAndDiversityImpl,
  'enhanceMatchesWithCurrentContentAndDiversity',
  { logErrors: true }
);