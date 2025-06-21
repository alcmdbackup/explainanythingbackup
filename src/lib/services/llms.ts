import OpenAI from 'openai';
import { logger } from '@/lib/server_utilities';
import { z } from 'zod';
import { zodResponseFormat } from "openai/helpers/zod";
// Define types
type ResponseObject = z.ZodObject<any> | null;
const FILE_DEBUG = false;

// Initialize OpenAI client lazily to avoid client-side environment variable access
let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
    if (typeof window !== 'undefined') {
        throw new Error('OpenAI client cannot be used on the client side');
    }
    
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY not found in environment variables. Please check your .env file exists and contains a valid API key.');
    }
    
    if (!openai) {
        openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            maxRetries: 3,
            timeout: 30000
        });
    }
    
    return openai;
}

/**
 * Makes a call to GPT-4-mini model with structured output support
 * @param prompt - The input prompt to send to the model
 * @param response_obj - Optional Zod schema for structured output
 * @param response_obj_name - Optional name for the response schema
 * @param debug - Enable debug logging
 * @returns Promise<string> - The model's response
 */
async function callGPT4omini(
    prompt: string,
    response_obj: ResponseObject = null,
    response_obj_name: string | null = null,
    debug: boolean = true
): Promise<string> {
    try {
        if (debug) logger.debug("Making API call");
        const requestOptions: OpenAI.Chat.ChatCompletionCreateParams = {
            model: "gpt-4o-mini",  
            messages: [
                {
                    role: "system", 
                    content: response_obj 
                        ? "You are a helpful assistant. Please provide your response in JSON format."
                        : "You are a helpful assistant."
                },
                {
                    role: "user",
                    content: prompt
                }
            ]
        };
        if (response_obj && response_obj_name) {
            requestOptions.response_format = zodResponseFormat(response_obj, response_obj_name);
        }
        const completion = await getOpenAIClient().chat.completions.create(requestOptions);
        const response = completion.choices[0].message.content;
        if (debug) {
            logger.debug("API call successful", {}, FILE_DEBUG);
            logger.debug("GPT4omini Response", {
                prompt,
                response
            }, FILE_DEBUG);
        }
        if (!response) {
            throw new Error('No response received from OpenAI');
        }
        return response;
    } catch (error) {
        if (debug) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Error in GPT4omini call: ${errorMessage}`);
        }
        throw error;
    }
}
/**
 * Main function to handle LLM calls with structured output
 * @param prompt - Input prompt
 * @param response_obj - Zod schema for structured output
 * @param response_obj_name - Name of the response schema
 * @param debug - Enable debug logging
 * @returns Promise<string> - The model's response
 */
async function main(
    prompt: string,
    response_obj: ResponseObject,
    response_obj_name: string | null,
    debug: boolean = false
): Promise<string> {
    try {
        if (debug) logger.debug("Starting main function", null, FILE_DEBUG);
        const response = await callGPT4omini(
            prompt, 
            response_obj,  
            response_obj_name,  
            debug
        );
        if (debug) logger.debug(`Response: ${response}`, null, FILE_DEBUG);
        return response;
    } catch (error) {
        if (debug) logger.error(`Error in main: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}
export { callGPT4omini };