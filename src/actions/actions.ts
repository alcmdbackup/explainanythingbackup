'use server';

import { callGPT4omini } from '@/lib/services/llms';
import { createExplanationPrompt } from '@/lib/prompts';
import { createExplanation, getExplanationById} from '@/lib/services/explanations';
import { logger } from '@/lib/server_utilities';
import { explanationInsertSchema, llmQuerySchema, matchingSourceLLMSchema, type ExplanationInsertType, sourceWithCurrentContentType, type LlmQueryType, type UserQueryInsertType, type matchingSourceLLMType, type QueryResponseType, matchingSourceReturnSchema } from '@/lib/schemas/schemas';
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
 * Formats top 5 sources with numbered prefixes for LLM ranking
 * @param sources - Array of sources with content
 * @returns string - Formatted sources as a numbered list
 * Sample output format: "1. [Title 1] Content excerpt...\n2. [Title 2] Content excerpt...\n..."
 */
function formatTopSources(sources: sourceWithCurrentContentType[]): string {
    const topSources = sources.slice(0, 5);
    
    return topSources.map((source, index) => {
      const number = index + 1;
      const title = source.current_title || 'Untitled';
      // Truncate content if it's too long to keep prompt size reasonable
      const contentPreview = source.current_content.substring(0, 1000) + 
        (source.current_content.length > 150 ? '...' : '');
      
      return `${number}. [${title}] ${contentPreview}`;
    }).join('\n\n');
  }
  
  /**
   * Creates a prompt for source selection
   * @param userQuery - The original user query
   * @param formattedSources - The numbered list of sources
   * @returns string - Complete prompt for the LLM
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
   * Uses LLM to select the best source from the top 5 based on user query
   * @param userQuery - The original user query
   * @param sources - Array of potential sources
   * @returns Promise<number> - Index (1-5) of the selected source
   * Sample output: 3
   */
  export async function findMatchingSource(
    userQuery: string, 
    sources: sourceWithCurrentContentType[]
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
  
      // Format the top sources with numbers
      const formattedSources = formatTopSources(sources);
      
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
      
      const selectedIndex = parsedResult.data.selectedSourceIndex;
      
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
 * Enhances source data with current content from the database
 * @param similarTexts - Array of similar text results from vector search
 * @returns Promise<sourceWithCurrentContentType[]> - Array of enhanced sources with current content
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

export async function generateAiExplanation(
    userQuery: string,
    savedId: number | null,
    skipMatch: boolean
): Promise<{
    data: QueryResponseType | null,
    error: ErrorResponse | null
}> {
    try {
        logger.debug('Starting generateAiExplanation', { 
            userQuery_length: userQuery.length,
            savedId,
            skipMatch
        }, FILE_DEBUG);

        if (!userQuery.trim()) {
            logger.debug('Empty userQuery detected');
            return {
                data: null,
                error: {
                    code: 'INVALID_INPUT',
                    message: 'userQuery cannot be empty'
                }
            };
        }

        // Get similar text snippets
        logger.debug('Fetching similar texts from vector search');
        const similarTexts = await handleUserQuery(userQuery);
        logger.debug('Vector search results', { 
            count: similarTexts?.length || 0,
            first_result: similarTexts?.[0] 
        }, FILE_DEBUG);

        // Filter out sources with matching savedId if provided
        const filteredSimilarTexts = savedId 
            ? similarTexts.filter(text => text.metadata.explanation_id !== savedId)
            : similarTexts;

        const sources = await enhanceSourcesWithCurrentContent(filteredSimilarTexts);
        logger.debug('Enhanced sources', { 
            sources_count: sources?.length || 0,
            first_source: sources?.[0],
            filtered_out: similarTexts.length - filteredSimilarTexts.length
        }, FILE_DEBUG);

        // Add the call to selectBestSource here
        const bestSourceResult = await findMatchingSource(userQuery, sources);
        logger.debug('Best source selection result', {
            selectedIndex: bestSourceResult.selectedIndex,
            explanationId: bestSourceResult.explanationId,
            topicId: bestSourceResult.topicId,
            hasError: !!bestSourceResult.error,
            errorCode: bestSourceResult.error?.code,
            skipmatch: skipMatch
        }, FILE_DEBUG);

        // If we found a matching source and we're not skipping matches, return early with that data
        if (!skipMatch && 
            bestSourceResult.selectedIndex && 
            bestSourceResult.selectedIndex > 0 && 
            bestSourceResult.explanationId && 
            bestSourceResult.topicId) {
            
            return {
                data: {
                    match_found: true,
                    data: {
                        explanation_id: bestSourceResult.explanationId,
                        topic_id: bestSourceResult.topicId
                    }
                },
                error: null
            };
        }

        const formattedPrompt = createExplanationPrompt(userQuery);
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
                }
            };
        }

        logger.debug('Successfully generated AI explanation', {
            has_sources: !!sources?.length,
            response_data_keys: Object.keys(parsedResult.data)
        });

        // Validate against userQueryInsertSchema before returning
        const userQueryData = {
            user_query: userQuery,
            explanation_title: parsedResult.data.explanation_title,
            content: parsedResult.data.content,
            sources: sources
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
                }
            };
        }

        return {
            data: {
                match_found: false,
                data: validatedUserQuery.data
            },
            error: null
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
            error: errorResponse
        };
    }
}

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