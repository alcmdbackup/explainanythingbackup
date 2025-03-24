'use server';

import { callGPT4omini } from '@/lib/services/llms';
import { createExplanationPrompt } from '@/lib/prompts';
import { createSearch } from '@/lib/services/explanations';
import { logger } from '@/lib/server_utilities';
import { searchInsertSchema, llmQuerySchema, type SearchInsertType } from '@/lib/schemas/search';
import { processContentToStoreEmbedding } from '@/lib/services/vectorsim';

// Custom error types for better error handling
type ErrorResponse = {
    code: string;
    message: string;
    details?: any;
};

export async function generateAIResponse(prompt: string) {
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

        return { data: parsedResult.data, error: null };
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

export async function saveSearch(prompt: string, searchData: SearchInsertType) {
    try {
        // Validate the search data against our schema
        const validatedData = searchInsertSchema.safeParse({
            title: searchData.title,
            content: searchData.content,
            user_query: searchData.user_query
        });

        if (!validatedData.success) {
            return {
                success: false,
                error: `Invalid search data format: ${validatedData.error.errors.map(err => 
                    `${err.path.join('.')} - ${err.message}`
                ).join(', ')}`,
                id: null
            };
        }

        // Format content for embedding in the same way as displayed in the UI
        const combinedContent = `# ${searchData.title}\n\n${searchData.content}`;
        
        // Create embeddings for the combined content
        try {
            await processContentToStoreEmbedding(combinedContent);
        } catch (embeddingError) {
            logger.error('Failed to create embeddings', {
                error: embeddingError,
                title_length: searchData.title.length,
                content_length: searchData.content.length
            });
            return {
                success: false,
                error: 'Failed to process content for search',
                id: null
            };
        }

        // Save to database
        const savedSearch = await createSearch(searchData);
        
        return { 
            success: true, 
            error: null,
            id: savedSearch.id 
        };
    } catch (error: any) {
        logger.error('Failed to save search to database', { 
            error,
            error_name: error?.name || 'UnknownError',
            error_message: error?.message || 'No error message available',
            user_query_length: prompt.length
        });
        
        return { 
            success: false, 
            error: 'Failed to save search',
            id: null
        };
    }
} 