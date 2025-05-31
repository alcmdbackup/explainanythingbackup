'use server';

import { callGPT4omini } from '@/lib/services/llms';
import { createExplanationPrompt, createTitlePrompt } from '@/lib/prompts';
import { createExplanation, getExplanationById} from '@/lib/services/explanations';
import { logger } from '@/lib/server_utilities';
import { explanationInsertSchema, llmQuerySchema, matchingSourceLLMSchema, type ExplanationInsertType, sourceWithCurrentContentType, type LlmQueryType, type UserQueryInsertType, type matchingSourceLLMType, type QueryResponseType, matchingSourceReturnSchema, MatchMode, titleQuerySchema } from '@/lib/schemas/schemas';
import { processContentToStoreEmbedding } from '@/lib/services/vectorsim';
import { handleUserQuery } from '@/lib/services/vectorsim';
import { type ZodIssue } from 'zod';
import { createUserQuery } from '@/lib/services/userQueries';
import { userQueryInsertSchema } from '@/lib/schemas/schemas';
import { createTopic } from '@/lib/services/topics';

const FILE_DEBUG = true;

// Custom error types for better error handling
type ErrorResponse = {
    code: string;
    message: string;
    details?: any;
};

// Type for vector search results
type VectorSearchResult = {
    text: string;
    explanation_id: number;
    similarity: number;
};

/**
 * Key points:
 * - Formats top 5 sources into a numbered list
 * - Excludes any source matching savedId
 * - Truncates content to 1000 chars for prompt size
 * - Used by findMatchingSource for LLM ranking
 */
function formatTopSources(sources: sourceWithCurrentContentType[], savedId: number | null): string {
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
    sources: sourceWithCurrentContentType[],
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
export async function enhanceSourcesWithCurrentContent(similarTexts: any[]): Promise<sourceWithCurrentContentType[]> {
    logger.debug('Starting enhanceSourcesWithCurrentContent', {
        input_count: similarTexts?.length || 0,
        first_input: similarTexts?.[0]
    });

    return Promise.all(similarTexts.map(async (result: any) => {
        logger.debug('Processing source', {
            metadata: result.metadata,
            score: result.score
        });

        const explanation = await getExplanationById(result.metadata.explanation_id);
        logger.debug('Retrieved explanation', {
            explanation_id: result.metadata.explanation_id,
            found: !!explanation,
            title: explanation?.explanation_title
        });

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
        });

        return enhancedSource;
    }));
}

/**
 * Key points:
 * - Enhances user query for better matching
 * - Uses LLM to add detail while preserving intent
 * - Called by generateAiExplanation for query improvement
 * - Uses callGPT4omini for enhancement
 */
async function enhanceQueryDetails(userQuery: string, fullResponse: boolean): Promise<string> {
    try {
        const prompt = fullResponse 
            ? userQuery 
            : `Make this user query more detailed and precise while keeping the intent the same. Write concisely and do not add additional sentences: "${userQuery}"`;
        const enhancedQuery = await callGPT4omini(prompt, null, null, FILE_DEBUG);
        return enhancedQuery.trim().replace(/^"|"$/g, '');
    } catch (error) {
        logger.error('Error enhancing query details', {
            error: error instanceof Error ? error.message : 'Unknown error',
            userQuery
        });
        // Return original query if enhancement fails
        return userQuery;
    }
}

/**
 * Key points:
 * - Main function for generating AI explanations
 * - Handles both matching and new explanation generation
 * - Uses vector search and LLM for content creation
 * - Generates article titles using the original user query (not enhanced)
 * - Uses the first generated title for vector search (handleUserQuery)
 * - Called by saveExplanationAndTopic for new explanations
 * - Uses enhanceQueryDetails, handleUserQuery, enhanceSourcesWithCurrentContent, findMatchingSource
 */
export async function generateAiExplanation(
    userQuery: string,
    savedId: number | null,
    matchMode: MatchMode
): Promise<{
    data: (QueryResponseType & { title: string }) | null,
    error: ErrorResponse | null,
    originalUserQuery: string
}> {
    try {
        logger.debug('Starting generateAiExplanation', { 
            userQuery_length: userQuery.length,
            savedId,
            matchMode
        }, FILE_DEBUG);

        if (!userQuery.trim()) {
            logger.debug('Empty userQuery detected');
            return {
                data: null,
                error: {
                    code: 'INVALID_INPUT',
                    message: 'userQuery cannot be empty'
                },
                originalUserQuery: userQuery
            };
        }

        // Generate article titles using the ORIGINAL user query
        const titlePrompt = createTitlePrompt(userQuery);
        logger.debug('Created title prompt', { title_prompt_length: titlePrompt.length }, FILE_DEBUG);
        const titleResult = await callGPT4omini(titlePrompt, titleQuerySchema, 'titleQuery');
        const parsedTitles = titleQuerySchema.safeParse(JSON.parse(titleResult));
        if (parsedTitles.success) {
            logger.debug('Generated article titles', {
                title1: parsedTitles.data.title1,
                title2: parsedTitles.data.title2,
                title3: parsedTitles.data.title3
            }, FILE_DEBUG);
        } else {
            logger.debug('Failed to parse article titles', { errors: parsedTitles.error.errors }, FILE_DEBUG);
        }

        // Get similar text snippets using the FIRST TITLE if available, else throw error
        logger.debug('Fetching similar texts from vector search');
       
        if (!parsedTitles.success || !parsedTitles.data.title1) {
            logger.debug('No valid title1 found in parsedTitles', { parsedTitles }, FILE_DEBUG);
            return {
                data: null,
                error: {
                    code: 'NO_TITLE_FOR_VECTOR_SEARCH',
                    message: 'No valid title1 found for vector search. Cannot proceed.'
                },
                originalUserQuery: userQuery
            };
        }
        
        const firstTitle = parsedTitles.data.title1;
        const similarTexts = await handleUserQuery(firstTitle);
        logger.debug('Vector search results', { 
            count: similarTexts?.length || 0,
            first_result: similarTexts?.[0] 
        }, FILE_DEBUG);

        const sources = await enhanceSourcesWithCurrentContent(similarTexts);
        logger.debug('Enhanced sources', { 
            sources_count: sources?.length || 0,
            first_source: sources?.[0]
        }, FILE_DEBUG);

        // Add the call to selectBestSource here
        const bestSourceResult = await findMatchingSource(firstTitle, sources, matchMode, savedId);
        logger.debug('Best source selection result', {
            selectedIndex: bestSourceResult.selectedIndex,
            explanationId: bestSourceResult.explanationId,
            topicId: bestSourceResult.topicId,
            hasError: !!bestSourceResult.error,
            errorCode: bestSourceResult.error?.code,
            matchMode: matchMode
        }, FILE_DEBUG);

        // Update the match condition to use matchMode
        if ((matchMode === MatchMode.Normal || matchMode === MatchMode.ForceMatch) && 
            bestSourceResult.selectedIndex && 
            bestSourceResult.selectedIndex > 0 && 
            bestSourceResult.explanationId && 
            bestSourceResult.topicId) {
            
            return {
                data: {
                    match_found: true,
                    data: {
                        explanation_id: bestSourceResult.explanationId,
                        topic_id: bestSourceResult.topicId,
                        sources: sources
                    },
                    title: firstTitle
                },
                error: null,
                originalUserQuery: userQuery
            };
        }

        const formattedPrompt = createExplanationPrompt(firstTitle);
        logger.debug('Created formatted prompt', { 
            formatted_prompt_length: formattedPrompt.length 
        }, FILE_DEBUG);

        logger.debug('Calling GPT-4', { prompt_length: formattedPrompt.length });
        const result = await callGPT4omini(formattedPrompt, llmQuerySchema, 'llmQuery');
        logger.debug('Received GPT-4 response', { 
            response_length: result?.length || 0 
        }, FILE_DEBUG);
        
        // Parse the result to ensure it matches our schema
        logger.debug('Parsing LLM response with schema', {}, FILE_DEBUG);
        const parsedResult = llmQuerySchema.safeParse(JSON.parse(result));

        if (!parsedResult.success) {
            logger.debug('Schema validation failed', { 
                errors: parsedResult.error.errors 
            });
            return {
                data: null,
                error: {
                    code: 'INVALID_RESPONSE',
                    message: 'AI response did not match expected format',
                    details: parsedResult.error
                },
                originalUserQuery: userQuery
            };
        }

        logger.debug('Successfully generated AI explanation', {
            has_sources: !!sources?.length,
            response_data_keys: Object.keys(parsedResult.data)
        });

        // Validate against userQueryInsertSchema before returning
        const userQueryData = {
            user_query: userQuery,
            explanation_title: firstTitle,
            content: parsedResult.data.content,
            sources: sources // Include the sources from vector search
        };
        
        const validatedUserQuery = userQueryInsertSchema.safeParse(userQueryData);
        
        if (!validatedUserQuery.success) {
            logger.debug('User query validation failed', { 
                errors: validatedUserQuery.error.errors 
            }, FILE_DEBUG);
            return {
                data: null,
                error: {
                    code: 'INVALID_USER_QUERY',
                    message: 'Generated response does not match user query schema',
                    details: validatedUserQuery.error
                },
                originalUserQuery: userQuery
            };
        }

        return {
            data: {
                match_found: false,
                data: validatedUserQuery.data,
                title: firstTitle
            },
            error: null,
            originalUserQuery: userQuery
        };
    } catch (error) {
        let errorResponse: ErrorResponse;

        logger.debug('Error details', {
            error_type: error instanceof Error ? error.constructor.name : typeof error,
            error_message: error instanceof Error ? error.message : 'Unknown error',
            error_stack: error instanceof Error ? error.stack : undefined
        });

        if (error instanceof Error) {
            // Categorize different types of errors
            if (error.message.includes('API')) {
                errorResponse = {
                    code: 'LLM_API_ERROR',
                    message: 'Error communicating with AI service',
                    details: error.message
                };
            } else if (error.message.includes('timeout')) {
                errorResponse = {
                    code: 'TIMEOUT_ERROR',
                    message: 'Request timed out!',
                    details: error.message
                };
            } else {
                errorResponse = {
                    code: 'UNKNOWN_ERROR',
                    message: error.message
                };
            }
        } else {
            errorResponse = {
                code: 'UNKNOWN_ERROR',
                message: 'An unexpected error occurred'
            };
        }

        // Log the error with full context
        logger.error('Error in generateAIResponse', {
            userQuery,
            error: errorResponse
        });

        return { 
            data: null, 
            error: errorResponse,
            originalUserQuery: userQuery
        };
    }
}

/**
 * Key points:
 * - Saves new explanations and topics to database
 * - Creates embeddings for vector search
 * - Called after generateAiExplanation for new content
 * - Uses createTopic, createExplanation, processContentToStoreEmbedding
 */
export async function saveExplanationAndTopic(userQuery: string, explanationData: UserQueryInsertType) {
    try {
        // Create a topic first using the explanation title, if it doesn't already exist
        const topic = await createTopic({
            topic_title: explanationData.explanation_title
        });

        // Add the topic ID to the explanation data
        const explanationWithTopic: ExplanationInsertType = {
            explanation_title: explanationData.explanation_title,
            content: explanationData.content,
            sources: explanationData.sources,
            primary_topic_id: topic.id
        };

        // Validate the explanation data against our schema
        const validatedData = explanationInsertSchema.safeParse(explanationWithTopic);

        if (!validatedData.success) {
            return {
                success: false,
                error: `Invalid explanation data format: ${validatedData.error.errors.map((err: ZodIssue) => 
                    `${err.path.join('.')} - ${err.message}`
                ).join(', ')}`,
                id: null
            };
        }

        // Save to database
        const savedExplanation = await createExplanation(explanationWithTopic);

        // Format content for embedding in the same way as displayed in the UI
        const combinedContent = `# ${explanationData.explanation_title}\n\n${explanationData.content}`;
        
        // Create embeddings for the combined content
        try {
            await processContentToStoreEmbedding(combinedContent, savedExplanation.id, topic.id);
        } catch (embeddingError) {
            logger.error('Failed to create embeddings', {
                error: embeddingError,
                title_length: explanationData.explanation_title.length,
                content_length: explanationData.content.length
            });
            return {
                success: false,
                error: 'Failed to process content for explanation',
                id: null
            };
        }
        
        return { 
            success: true, 
            error: null,
            id: savedExplanation.id 
        };
    } catch (error: any) {
        logger.error('Failed to save explanation to database', { 
            error,
            error_name: error?.name || 'UnknownError',
            error_message: error?.message || 'No error message available',
            user_query_length: userQuery.length
        });
        
        return { 
            success: false, 
            error: 'Failed to save explanation',
            id: null
        };
    }
}

/**
 * Key points:
 * - Saves user queries to database
 * - Validates query data against schema
 * - Called by generateAiExplanation for query tracking
 * - Uses createUserQuery for database storage
 */
export async function saveUserQuery(userQuery: UserQueryInsertType) {
    try {
        // Validate the user query data against our schema
        const validatedData = userQueryInsertSchema.safeParse(userQuery);

        if (!validatedData.success) {
            return {
                success: false,
                error: `Invalid user query data format: ${validatedData.error.errors.map((err: ZodIssue) => 
                    `${err.path.join('.')} - ${err.message}`
                ).join(', ')}`,
                id: null
            };
        }

        // Save to database
        const savedQuery = await createUserQuery(validatedData.data);
        
        return { 
            success: true, 
            error: null,
            id: savedQuery.id 
        };
    } catch (error: any) {
        logger.error('Failed to save user query to database', { 
            error,
            error_name: error?.name || 'UnknownError',
            error_message: error?.message || 'No error message available',
            user_query_length: userQuery.length
        });
        
        return { 
            success: false, 
            error: 'Failed to save user query',
            id: null
        };
    }
} 