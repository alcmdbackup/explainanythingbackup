import OpenAI from 'openai';
import { logger } from '@/lib/server_utilities';
import { z } from 'zod';
import { zodResponseFormat } from "openai/helpers/zod";
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { type LlmCallTrackingType, llmCallTrackingSchema, allowedLLMModelSchema, type AllowedLLMModelType } from '@/lib/schemas/schemas';
import { createLLMSpan } from '../../../instrumentation';

// Define types
type ResponseObject = z.ZodObject<any> | null;
const FILE_DEBUG = false;

/**
 * Saves LLM call tracking data to Supabase database
 * • Validates input data against llmCallTrackingSchema before saving
 * • Inserts call metrics and details into llmCallTracking table
 * • Handles validation and database errors gracefully with logging
 * • Used by callOpenAIModel to persist API call information
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
            console.error('Full tracking data:', validatedData);
            throw error;
        }
        

    } catch (error) {
        if (error instanceof z.ZodError) {
            console.error('LLM call tracking validation failed:', error.errors);
            console.error('Invalid data:', trackingData);
            console.error('Call source:', trackingData.call_source);
        } else {
            console.error('Failed to save LLM call tracking:', error);
            console.error('Call source:', trackingData.call_source);
            console.error('User ID:', trackingData.userid);
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
 * Makes a call to Openai model with structured output support
 * @param prompt - The input prompt to send to the model
 * @param call_source - Identifier for the source/context making this call
 * @param userid - User identifier for tracking purposes
 * @param model - The LLM model to use for the completion
 * @param streaming - Whether to enable streaming responses
 * @param setText - State setter function for streaming text updates (required when streaming=true, must be null when streaming=false)
 * @param response_obj - Optional Zod schema for structured output
 * @param response_obj_name - Optional name for the response schema
 * @param debug - Enable debug logging
 * @returns Promise<string> - The model's response
 */
async function callOpenAIModel(
    prompt: string,
    call_source: string,
    userid: string,
    model: AllowedLLMModelType,
    streaming: boolean,
    setText: ((text: string) => void) | null,
    response_obj: ResponseObject = null,
    response_obj_name: string | null = null,
    debug: boolean = true
): Promise<string> {
    try {
        // Validate model parameter
        const validatedModel = allowedLLMModelSchema.parse(model);
        
        // Validate setText parameter based on streaming mode
        if (streaming && (setText === null || typeof setText !== 'function')) {
            throw new Error('setText must be a function when streaming is true');
        }
        if (!streaming && setText !== null) {
            throw new Error('setText must be null when streaming is false');
        }
        
        if (debug) logger.debug("Making API call");
        const requestOptions: OpenAI.Chat.ChatCompletionCreateParams = {
            model: validatedModel,  
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
            ],
            stream: streaming
        };
        if (response_obj && response_obj_name) {
            requestOptions.response_format = zodResponseFormat(response_obj, response_obj_name);
        }

        const span = createLLMSpan('openai.chat.completions.create', {
            'llm.model': requestOptions.model,
            'llm.prompt.length': prompt.length,
            'llm.call_source': call_source,
            'llm.structured_output': response_obj ? 'true' : 'false',
            'llm.streaming': streaming ? 'true' : 'false'
        });
        
        let response: string;
        let usage: any = {};
        let finishReason = 'unknown';
        let modelUsed = '';
        let rawApiResponse: string;

        try {
            if (streaming) {
                // Handle streaming response
                const stream = await getOpenAIClient().chat.completions.create(requestOptions) as any;
                let accumulatedContent = '';
                let lastChunk: any = null;
                
                for await (const chunk of stream) {
                    lastChunk = chunk;
                    const content = chunk.choices[0]?.delta?.content || '';
                    accumulatedContent += content;
                    
                    // For streaming responses, display the accumulated content directly
                    // Since the response is now just a string, no JSON parsing is needed
                    const displayContent = accumulatedContent;
                    
                    // Update the text state with formatted content for display
                    setText!(displayContent);
                }
                
                // Extract metadata from the last chunk
                if (lastChunk) {
                    usage = lastChunk.usage || {};
                    finishReason = lastChunk.choices[0]?.finish_reason || 'unknown';
                    modelUsed = lastChunk.model || '';
                }
                
                // Return raw JSON for further processing by calling code
                response = accumulatedContent;
                rawApiResponse = JSON.stringify({ 
                    streaming: true, 
                    final_content: accumulatedContent,
                    usage: usage,
                    model: modelUsed
                });
            } else {
                // Handle non-streaming response
                const completion = await getOpenAIClient().chat.completions.create(requestOptions) as any;
                
                usage = completion.usage || {};
                finishReason = completion.choices[0]?.finish_reason || 'unknown';
                modelUsed = completion.model || '';
                response = completion.choices[0]?.message?.content || '';
                rawApiResponse = JSON.stringify(completion);
            }
            
            span.setAttributes({
                'llm.response.tokens.completion': usage.completion_tokens || 0,
                'llm.response.tokens.prompt': usage.prompt_tokens || 0,
                'llm.response.tokens.total': usage.total_tokens || 0,
                'llm.response.finish_reason': finishReason
            });
        } catch (error) {
            span.recordException(error as Error);
            span.setStatus({ code: 2, message: (error as Error).message });
            throw error;
        } finally {
            span.end();
        }
        
        // Save LLM call tracking data to database
        const trackingData: LlmCallTrackingType = {
            userid, 
            prompt,
            content: response,
            call_source,
            raw_api_response: rawApiResponse,
            model: modelUsed,
            prompt_tokens: usage.prompt_tokens ?? 0,
            completion_tokens: usage.completion_tokens ?? 0,
            total_tokens: usage.total_tokens ?? 0,
            reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens,
            finish_reason: finishReason,
        };
        
        await saveLlmCallTracking(trackingData);
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
        if (error instanceof z.ZodError) {
            logger.error(`Invalid model parameter: ${model}. Allowed models: ${allowedLLMModelSchema.options.join(', ')}`);
            throw new Error(`Invalid model: ${model}. Must be one of: ${allowedLLMModelSchema.options.join(', ')}`);
        }
        if (debug) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Error in GPT4omini call: ${errorMessage}`);
        }
        throw error;
    }
}
export { callOpenAIModel };