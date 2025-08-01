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
 * Preprocesses incomplete JSON during streaming to make it parseable
 * Handles cases where JSON is incomplete due to streaming nature
 * 
 * Scenarios handled:
 * 1. `{` → `{"explanation_title": "", "content": ""}`
 * 2. `{"expla` → `{"explanation_title": "", "content": ""}`
 * 3. `{"explanation_title"` → `{"explanation_title": "", "content": ""}`
 * 4. `{"explanation_title":"Partial` → `{"explanation_title": "Partial", "content": ""}`
 * 5. `{"explanation_title":"Complete","cont` → `{"explanation_title": "Complete", "content": ""}`
 * 6. `{"explanation_title":"Complete","content":"Partial` → `{"explanation_title": "Complete", "content": "Partial"}`
 * 7. Missing closing brace scenarios
 * 
 * @param jsonStr - The potentially incomplete JSON string
 * @returns A valid JSON string that can be parsed and validated against explanationBaseSchema
 */
function preprocessIncompleteJSON(jsonStr: string): string {
    let processed = jsonStr.trim();
    
    // If it doesn't start with {, return as is
    if (!processed.startsWith('{')) {
        return processed;
    }
    
    // If it already ends with }, it might be complete - try as is first
    if (processed.endsWith('}')) {
        return processed;
    }
    
    // Count quotes to see if we're in the middle of a string
    const quoteCount = (processed.match(/"/g) || []).length;
    
    // If odd number of quotes, we're in the middle of a string value - close it
    if (quoteCount % 2 === 1) {
        processed += '"';
    }
    
    // Simple approach: extract any existing values and build complete JSON
    
    // Start with just opening brace
    if (processed === '{') {
        return '{"explanation_title": "", "content": ""}';
    }
    
    // Extract any existing values using regex
    let titleValue = "";
    let contentValue = "";
    
    // Try to extract explanation_title value (handle both complete and incomplete)
    const titleMatch = processed.match(/"explanation_title":\s*"([^"]*)"/);
    if (titleMatch) {
        titleValue = titleMatch[1];
    } else {
        // Check for incomplete title value (missing closing quote)
        const incompleteTitleMatch = processed.match(/"explanation_title":\s*"([^"]*?)(?:[^"}]*)?$/);
        if (incompleteTitleMatch) {
            titleValue = incompleteTitleMatch[1];
        }
    }
    
    // Try to extract content value (handle both complete and incomplete)
    const contentMatch = processed.match(/"content":\s*"([^"]*)"/);
    if (contentMatch) {
        contentValue = contentMatch[1];
    } else {
        // Check for incomplete content value (missing closing quote)
        const incompleteContentMatch = processed.match(/"content":\s*"([^"]*?)(?:[^"}]*)?$/);
        if (incompleteContentMatch) {
            contentValue = incompleteContentMatch[1];
        }
    }
    
    // Build complete JSON with extracted values
    return `{"explanation_title": "${titleValue}", "content": "${contentValue}"}`;
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
                    
                    // Try to parse and format the content for display if it's structured JSON
                    let displayContent = accumulatedContent;
                    if (response_obj) {
                        try {
                            // Preprocess incomplete JSON to make it parseable
                            const preprocessedJson = preprocessIncompleteJSON(accumulatedContent);
                            const parsedJson = JSON.parse(preprocessedJson);
                            
                            // Validate using the explanation schema
                            const validationResult = response_obj.safeParse(parsedJson);
                            
                            // Only format if validation passes and we have both required fields
                            if (validationResult.success && 
                                validationResult.data.explanation_title && 
                                validationResult.data.content) {
                                displayContent = `# ${validationResult.data.explanation_title}\n\n${validationResult.data.content}`;
                            }
                        } catch (error) {
                            // If JSON is still unparseable or invalid, continue with raw content
                            // This is expected during early streaming stages
                        }
                    }
                    
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