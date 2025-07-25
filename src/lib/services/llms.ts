import OpenAI from 'openai';
import { logger } from '@/lib/server_utilities';
import { z } from 'zod';
import { zodResponseFormat } from "openai/helpers/zod";
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { type LlmCallTrackingType, llmCallTrackingSchema } from '@/lib/schemas/schemas';
import { createLLMSpan } from '../../../instrumentation';

// Define types
type ResponseObject = z.ZodObject<any> | null;
const FILE_DEBUG = false;

/**
 * Saves LLM call tracking data to Supabase database
 * • Validates input data against llmCallTrackingSchema before saving
 * • Inserts call metrics and details into llmCallTracking table
 * • Handles validation and database errors gracefully with logging
 * • Used by callGPT4omini to persist API call information
 * • Called after successful API completion to track usage
 */
async function saveLlmCallTracking(trackingData: LlmCallTrackingType): Promise<void> {
    try {
        // Validate input data against schema
        const validatedData = llmCallTrackingSchema.parse(trackingData);
        
        const supabase = await createSupabaseServerClient();
        
        const { data, error } = await supabase
            .from('llmCallTracking')
            .insert(validatedData)
            .select()
            .single();

        if (error) {
            console.error('Error saving LLM call tracking:', error);
            console.error('Error details:', {
                message: error.message,
                details: error.details,
                hint: error.hint,
                code: error.code
            });
            throw error;
        }
        
        console.log('Successfully saved LLM call tracking:', data);
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.error('LLM call tracking validation failed:', error.errors);
            console.error('Invalid data:', trackingData);
        } else {
            console.error('Failed to save LLM call tracking:', error);
        }
        // Don't throw here to avoid breaking the main LLM call flow
    }
}

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
 * @param call_source - Identifier for the source/context making this call
 * @param response_obj - Optional Zod schema for structured output
 * @param response_obj_name - Optional name for the response schema
 * @param debug - Enable debug logging
 * @returns Promise<string> - The model's response
 */
async function callGPT4omini(
    prompt: string,
    call_source: string,
    userid: string,
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
        console.log('🤖 Tracing OpenAI call');
        const span = createLLMSpan('openai.chat.completions.create', {
            'llm.model': requestOptions.model,
            'llm.prompt.length': prompt.length,
            'llm.call_source': call_source,
            'llm.structured_output': response_obj ? 'true' : 'false'
        });
        
        let completion;
        try {
            completion = await getOpenAIClient().chat.completions.create(requestOptions);
            
            span.setAttributes({
                'llm.response.tokens.completion': completion.usage?.completion_tokens || 0,
                'llm.response.tokens.prompt': completion.usage?.prompt_tokens || 0,
                'llm.response.tokens.total': completion.usage?.total_tokens || 0,
                'llm.response.finish_reason': completion.choices[0]?.finish_reason || 'unknown'
            });
        } catch (error) {
            span.recordException(error as Error);
            span.setStatus({ code: 2, message: (error as Error).message });
            throw error;
        } finally {
            span.end();
        }
        
        // Print raw API output to terminal
        console.log('=== RAW API OUTPUT ===');
        console.log(JSON.stringify(completion, null, 2));
        console.log('=== END RAW API OUTPUT ===');
        
        // Save LLM call tracking data to database
        const trackingData: LlmCallTrackingType = {
            userid, 
            prompt,
            content: completion.choices[0]?.message?.content || '',
            call_source,
            raw_api_response: JSON.stringify(completion),
            model: completion.model || '',
            prompt_tokens: completion.usage?.prompt_tokens ?? 0,
            completion_tokens: completion.usage?.completion_tokens ?? 0,
            total_tokens: completion.usage?.total_tokens ?? 0,
            reasoning_tokens: completion.usage?.completion_tokens_details?.reasoning_tokens,
            finish_reason: completion.choices[0]?.finish_reason || '',
        };
        
        console.log('=== TRACKING DATA ===');
        console.log(JSON.stringify(trackingData, null, 2));
        console.log('=== END TRACKING DATA ===');
        
        await saveLlmCallTracking(trackingData);
        
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
 * @param call_source - Identifier for the source/context making this call
 * @param response_obj - Zod schema for structured output
 * @param response_obj_name - Name of the response schema
 * @param debug - Enable debug logging
 * @returns Promise<string> - The model's response
 */
async function main(
    prompt: string,
    call_source: string,
    response_obj: ResponseObject,
    response_obj_name: string | null,
    debug: boolean = false
): Promise<string> {
    try {
        if (debug) logger.debug("Starting main function", null, FILE_DEBUG);
        const response = await callGPT4omini(
            prompt, 
            call_source,
            "1",
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