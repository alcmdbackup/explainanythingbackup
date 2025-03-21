'use server';

import { callGPT4omini } from '@/lib/services/llms';

export async function generateAIResponse(prompt: string) {
    try {
        const result = await callGPT4omini(prompt);
        return { data: result, error: null };
    } catch (error) {
        return { 
            data: null, 
            error: error instanceof Error ? error.message : 'An error occurred' 
        };
    }
} 