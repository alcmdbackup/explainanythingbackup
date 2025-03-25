'use server';

import { callGPT4omini } from '@/lib/services/llms';
import { createExplanationPrompt } from '@/lib/prompts';
import { createExplanation, getExplanationById} from '@/lib/services/explanations';
import { logger } from '@/lib/server_utilities';
import { explanationInsertSchema, llmQuerySchema, type ExplanationInsertType, type EnhancedSourceType, sourceWithCurrentContentType } from '@/lib/schemas/schemas';
import { processContentToStoreEmbedding } from '@/lib/services/vectorsim';
import { handleUserQuery } from '@/lib/services/vectorsim';
import { type ZodIssue } from 'zod';
import { createUserQuery } from '@/lib/services/userQueries';
import { userQueryInsertSchema } from '@/lib/schemas/schemas';

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
    return Promise.all(similarTexts.map(async (result: any) => {
        const explanation = await getExplanationById(result.metadata.explanation_id);
        return {
            text: result.metadata.text,
            explanation_id: result.metadata.explanation_id,
            current_title: explanation?.title || '',
            current_content: explanation?.content || '',
            ranking: {
                similarity: result.score
            }
        };
    }));
}

export async function generateAiExplanation(prompt: string) {
    try {
        if (!prompt.trim()) {
            return {
                data: null,
                error: {
                    code: 'INVALID_INPUT',
                    message: 'Prompt cannot be empty'
                }
            };
        }

        // Get similar text snippets
        const similarTexts = await handleUserQuery(prompt);
        const sources = await enhanceSourcesWithCurrentContent(similarTexts);

        const formattedPrompt = createExplanationPrompt(prompt);
        const result = await callGPT4omini(formattedPrompt, llmQuerySchema, 'llmQuery');
        
        // Parse the result to ensure it matches our schema
        const parsedResult = llmQuerySchema.safeParse(JSON.parse(result));
        
        if (!parsedResult.success) {
            return {
                data: null,
                error: {
                    code: 'INVALID_RESPONSE',
                    message: 'AI response did not match expected format',
                    details: parsedResult.error
                }
            };
        }

        // Include both the LLM response and similar sources in the result
        return { 
            data: {
                ...parsedResult.data,
                sources
            }, 
            error: null 
        };
    } catch (error) {
        let errorResponse: ErrorResponse;

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

export async function saveExplanation(prompt: string, explanationData: ExplanationInsertType) {
    try {
        // Validate the explanation data against our schema
        const validatedData = explanationInsertSchema.safeParse({
            title: explanationData.title,
            content: explanationData.content,
            sources: explanationData.sources || []
        });

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
        const savedExplanation = await createExplanation(explanationData);

        // Format content for embedding in the same way as displayed in the UI
        const combinedContent = `# ${explanationData.title}\n\n${explanationData.content}`;
        
        // Create embeddings for the combined content
        try {
            await processContentToStoreEmbedding(combinedContent, savedExplanation.id);
        } catch (embeddingError) {
            logger.error('Failed to create embeddings', {
                error: embeddingError,
                title_length: explanationData.title.length,
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

export async function saveUserQuery(prompt: string, response: { title: string; content: string }) {
    try {
        const userQuery = {
            user_query: prompt,
            title: response.title,
            content: response.content
        };

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