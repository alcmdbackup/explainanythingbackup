import { callGPT4omini } from '@/lib/services/llms';
import { getExplanationById } from '@/lib/services/explanations';
import { logger } from '@/lib/server_utilities';
import { matchingSourceLLMSchema, type matchWithCurrentContentType, MatchMode } from '@/lib/schemas/schemas';

// Custom error types for better error handling
type ErrorResponse = {
    code: string;
    message: string;
    details?: any;
};

/**
 * Key points:
 * - Formats top 5 sources into a numbered list
 * - Excludes any source matching savedId
 * - Truncates content to 1000 chars for prompt size
 * - Used by findMatchingSource for LLM ranking
 */
function formatTopSources(sources: matchWithCurrentContentType[], savedId: number | null): string {
    const topSources = sources.slice(0, 5);
    
    return topSources.map((source, index) => {
      // Skip if this source matches savedId
      if (source.explanation_id === savedId) {
        return null;
      }

      const number = index + 1; // Use original array index
      const title = source.current_title || 'Untitled';
      // Truncate content if it's too long to keep prompt size reasonable
      const contentPreview = source.current_content.substring(0, 1000) + 
        (source.current_content.length > 150 ? '...' : '');
      
      return `${number}. [${title}] ${contentPreview}`;
    }).filter(Boolean).join('\n\n');
  }
  
  /**
   * Key points:
   * - Creates a prompt for LLM to select best source
   * - Uses numbered list from formatTopSources
   * - Forces single integer response (0-5)
   * - Used by findMatchingSource for source selection
   */
  function createSourceSelectionPrompt(userQuery: string, formattedSources: string): string {
    return `
  User Query: "${userQuery}"
  
  Below are the top 5 potential sources that might answer this query:
  
  ${formattedSources}
  
  Based on the user query, which ONE source (numbered 1-5) exactly matches the user query described above. 
  Choose only the number of the most relevant source. If there is no match, then answer with 0.
  
  Your response must be a single integer between 0 and 5.
  `;
  }
  
  /**
   * Key points:
   * - Uses LLM to select best matching source from top 5
   * - Handles force mode to bypass LLM selection
   * - Excludes sources matching savedId
   * - Called by generateAiExplanation for source matching
   * - Uses formatTopSources and createSourceSelectionPrompt
   */
  export async function findMatchingSource(
    userQuery: string, 
    sources: matchWithCurrentContentType[],
    matchMode: MatchMode,
    savedId: number | null
  ): Promise<{ 
    selectedIndex: number | null,
    explanationId: number | null,
    topicId: number | null,
    error: ErrorResponse | null 
  }> {
    try {
      if (!sources || sources.length === 0) {
        return {
          selectedIndex: null,
          explanationId: null,
          topicId: null,
          error: {
            code: 'NO_SOURCES',
            message: 'No sources available for selection'
          }
        };
      }
  
      // If in force mode and we have sources, return the first source that's not savedId
      if (matchMode === MatchMode.ForceMatch) {
        const firstNonSavedSource = sources.find(source => source.explanation_id !== savedId);
        if (firstNonSavedSource) {
          logger.debug('Force mode: returning first non-saveid source', {
            source: firstNonSavedSource
          });
          return {
            selectedIndex: sources.indexOf(firstNonSavedSource) + 1, // Convert to 1-based index
            explanationId: firstNonSavedSource.explanation_id,
            topicId: firstNonSavedSource.topic_id || null,
            error: null
          };
        }
      }

      // Format the top sources with numbers
      const formattedSources = formatTopSources(sources, savedId);
      
      // Create the prompt for source selection
      const selectionPrompt = createSourceSelectionPrompt(userQuery, formattedSources);
      
      // Call the LLM with the schema to force an integer response
      logger.debug('Calling GPT-4 for source selection', { prompt_length: selectionPrompt.length });
      const result = await callGPT4omini(selectionPrompt, matchingSourceLLMSchema, 'sourceSelection');
      
      // Parse the result
      const parsedResult = matchingSourceLLMSchema.safeParse(JSON.parse(result));

      if (!parsedResult.success) {
        logger.debug('Source selection schema validation failed', { 
          errors: parsedResult.error.errors 
        });
        return {
          selectedIndex: null,
          explanationId: null,
          topicId: null,
          error: {
            code: 'INVALID_RESPONSE',
            message: 'AI response for source selection did not match expected format',
            details: parsedResult.error
          }
        };
      }
      
      let selectedIndex = parsedResult.data.selectedSourceIndex;
      
      // If the selected source matches savedId, find the next best match
      if (selectedIndex > 0 && selectedIndex <= sources.length && 
          sources[selectedIndex - 1].explanation_id === savedId) {
        // Find the next best source that's not savedId
        const nextBestSource = sources.find((source, index) => 
          source.explanation_id !== savedId && index !== selectedIndex - 1
        );
        if (nextBestSource) {
          selectedIndex = sources.indexOf(nextBestSource) + 1;
        } else {
          selectedIndex = 0; // No valid match found
        }
      }
      
      // If a valid source was selected (not 0), get its explanation ID and topic ID
      const explanationId = selectedIndex > 0 && selectedIndex <= sources.length 
        ? sources[selectedIndex - 1].explanation_id 
        : null;

      // Get topic ID from metadata if available
      const topicId = selectedIndex > 0 && selectedIndex <= sources.length
        ? sources[selectedIndex - 1].topic_id || null
        : null;

      logger.debug('Successfully selected source', {
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
      logger.error('Error in findMatchingSource', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        user_query: userQuery
      });
      
      return {
        selectedIndex: null,
        explanationId: null,
        topicId: null,
        error: {
          code: 'SOURCE_SELECTION_ERROR',
          message: 'Failed to select best source',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

/**
 * Key points:
 * - Adds current content from database to vector search results
 * - Maps over results to fetch full explanations
 * - Used by generateAiExplanation to enrich source data
 * - Calls getExplanationById for each source
 */
export async function enhanceSourcesWithCurrentContent(similarTexts: any[]): Promise<matchWithCurrentContentType[]> {
    logger.debug('Starting enhanceSourcesWithCurrentContent', {
        input_count: similarTexts?.length || 0,
        first_input: similarTexts?.[0]
    }, true);

    return Promise.all(similarTexts.map(async (result: any) => {
        logger.debug('Processing source', {
            metadata: result.metadata,
            score: result.score
        }, true);

        const explanation = await getExplanationById(result.metadata.explanation_id);
        logger.debug('Retrieved explanation', {
            explanation_id: result.metadata.explanation_id,
            found: !!explanation,
            title: explanation?.explanation_title
        }, true);

        const enhancedSource = {
            text: result.metadata.text,
            explanation_id: result.metadata.explanation_id,
            topic_id: result.metadata.topic_id,
            current_title: explanation?.explanation_title || '',
            current_content: explanation?.content || '',
            ranking: {
                similarity: result.score
            }
        };

        logger.debug('Enhanced source created', {
            source: enhancedSource
        }, true);

        return enhancedSource;
    }));
} 