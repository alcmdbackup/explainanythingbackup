'use server';

import { callGPT4omini } from '@/lib/services/llms';
import { createExplanationPrompt } from '@/lib/prompts';
import { createExplanation, getExplanationById} from '@/lib/services/explanations';
import { logger } from '@/lib/server_utilities';
import { explanationInsertSchema, llmQuerySchema, type ExplanationInsertType, sourceWithCurrentContentType, type LlmQueryType, type UserQueryInsertType } from '@/lib/schemas/schemas';
import { processContentToStoreEmbedding } from '@/lib/services/vectorsim';
import { handleUserQuery } from '@/lib/services/vectorsim';
import { type ZodIssue } from 'zod';
import { createUserQuery } from '@/lib/services/userQueries';
import { userQueryInsertSchema } from '@/lib/schemas/schemas';
import { createTopic } from '@/lib/services/topics';

const FILE_DEBUG = false;

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

export async function generateAiExplanation(prompt: string): Promise<{
    data: UserQueryInsertType | null,
    error: ErrorResponse | null
}> {
    try {
        logger.debug('Starting generateAiExplanation', { prompt_length: prompt.length });

        if (!prompt.trim()) {
            logger.debug('Empty prompt detected');
            return {
                data: null,
                error: {
                    code: 'INVALID_INPUT',
                    message: 'Prompt cannot be empty'
                }
            };
        }

        // Get similar text snippets
        logger.debug('Fetching similar texts from vector search');
        const similarTexts = await handleUserQuery(prompt);
        logger.debug('Vector search results', { 
            count: similarTexts?.length || 0,
            first_result: similarTexts?.[0] 
        });

        const sources = await enhanceSourcesWithCurrentContent(similarTexts);
        logger.debug('Enhanced sources', { 
            sources_count: sources?.length || 0,
            first_source: sources?.[0] 
        });

        const formattedPrompt = createExplanationPrompt(prompt);
        logger.debug('Created formatted prompt', { 
            formatted_prompt_length: formattedPrompt.length 
        });

        logger.debug('Calling GPT-4', { prompt_length: formattedPrompt.length });
        const result = await callGPT4omini(formattedPrompt, llmQuerySchema, 'llmQuery');
        logger.debug('Received GPT-4 response', { 
            response_length: result?.length || 0 
        });
        
        // Parse the result to ensure it matches our schema
        logger.debug('Parsing LLM response with schema');
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
            user_query: prompt,
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
            data: validatedUserQuery.data,
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
            prompt,
            error: errorResponse
        });

        return { 
            data: null, 
            error: errorResponse
        };
    }
}

export async function saveExplanationAndTopic(prompt: string, explanationData: UserQueryInsertType) {
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
            await processContentToStoreEmbedding(combinedContent, savedExplanation.id);
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
            user_query_length: prompt.length
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
            user_query_length: prompt.length
        });
        
        return { 
            success: false, 
            error: 'Failed to save user query',
            id: null
        };
    }
} 