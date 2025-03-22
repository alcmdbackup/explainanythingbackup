'use server';

import { callGPT4omini } from '@/lib/services/llms';
import { createExplanationPrompt } from '@/lib/prompts';
import { createSearch } from '@/lib/services/searchService';
import { logger } from '@/lib/utilities';
import { searchSchema, type SearchInput } from '@/lib/schemas/search';
import { type SearchInsert } from '@/types/database';

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
        const result = await callGPT4omini(formattedPrompt, searchSchema, 'searchResult');
        
        // Parse the result to ensure it matches our schema
        const parsedResult = searchSchema.safeParse(JSON.parse(result));
        
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

export async function saveSearch(prompt: string, searchData: SearchInsert) {
    try {
        // Validate the search data against our schema
        const validatedData = searchSchema.safeParse({
            title: searchData.title,
            content: searchData.content,
            userQuery: searchData.user_query
        });

        if (!validatedData.success) {
            return {
                success: false,
                error: `Invalid search data format: ${validatedData.error.errors.map(err => 
                    `${err.path.join('.')} - ${err.message}`
                ).join(', ')}`
            };
        }

        await createSearch(searchData);
        
        return { success: true, error: null };
    } catch (error: any) {
        logger.error('Failed to save search to database', { 
            error,
            error_name: error?.name || 'UnknownError',
            error_message: error?.message || 'No error message available',
            user_query_length: prompt.length
        });
        
        return { 
            success: false, 
            error: 'Failed to save search'
        };
    }
} 