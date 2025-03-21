'use server';

import { callGPT4omini } from '@/lib/services/llms';
import { createExplanationPrompt } from '@/lib/prompts';

export async function generateAIResponse(prompt: string) {
    try {
        const formattedPrompt = createExplanationPrompt(prompt);
        const result = await callGPT4omini(formattedPrompt);
        return { data: result, error: null };
    } catch (error) {
        return { 
            data: null, 
            error: error instanceof Error ? error.message : 'An error occurred' 
        };
    }
} 