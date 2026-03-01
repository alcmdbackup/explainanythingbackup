/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/**
 * LLM service for making API calls to OpenAI, DeepSeek, and Anthropic with structured output support.
 * Provides call tracking, tracing, and automatic logging. Routes to the correct provider based on model prefix.
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '@/lib/server_utilities';
import { z } from 'zod';
import { zodResponseFormat } from "openai/helpers/zod";
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { type LlmCallTrackingType, llmCallTrackingSchema, allowedLLMModelSchema, type AllowedLLMModelType } from '@/lib/schemas/schemas';
import { createLLMSpan } from '../../../instrumentation';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { ServiceError } from '@/lib/errors/serviceError';
import { ERROR_CODES } from '@/lib/errorHandling';
import { calculateLLMCost } from '@/config/llmPricing';
import { getLLMSemaphore } from './llmSemaphore';
import { getSpendingGate } from './llmSpendingGate';

/** Metadata about token usage and cost from an LLM call, passed to onUsage callbacks. */
export interface LLMUsageMetadata {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: number;
  model: string;
}

/** Options object replacing the positional onUsage parameter on callLLM. */
export interface CallLLMOptions {
  onUsage?: (usage: LLMUsageMetadata) => void;
  /** Evolution invocation UUID — passed through to saveLlmCallTracking for FK linkage. */
  evolutionInvocationId?: string;
}

// Define types
type ResponseObject = z.ZodObject<any> | null;
const FILE_DEBUG = false;

// Default model configuration
export const DEFAULT_MODEL: AllowedLLMModelType = 'gpt-4.1-mini';
export const LIGHTER_MODEL: AllowedLLMModelType = 'gpt-4.1-nano';

// Nil UUID for anonymous/unauthenticated users (RFC 4122 standard)
export const ANONYMOUS_USER_UUID = '00000000-0000-0000-0000-000000000000';

async function saveLlmCallTracking(trackingData: LlmCallTrackingType): Promise<void> {
    try {
        const validatedData = llmCallTrackingSchema.parse(trackingData);
        const supabase = await createSupabaseServiceClient();

        const { error } = await supabase
            .from('llmCallTracking')
            .insert(validatedData)
            .select()
            .single();

        if (error) {
            logger.error('Error saving LLM call tracking', {
                message: error.message,
                details: error.details,
                hint: error.hint,
                code: error.code
            });
            throw error;
        }
    } catch (error) {
        if (error instanceof z.ZodError) {
            throw new ServiceError(
                ERROR_CODES.VALIDATION_ERROR,
                'LLM call tracking validation failed',
                'saveLlmCallTracking',
                {
                    details: { errors: error.errors, callSource: trackingData.call_source },
                    cause: error
                }
            );
        }
        throw new ServiceError(
            ERROR_CODES.DATABASE_ERROR,
            'Failed to save LLM call tracking',
            'saveLlmCallTracking',
            {
                details: { callSource: trackingData.call_source, userId: trackingData.userid },
                cause: error instanceof Error ? error : undefined
            }
        );
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
            timeout: 60000  // Increased to 60 seconds for GPT-5 models
        });
    }

    return openai;
}

// DeepSeek client — uses OpenAI-compatible API at a different base URL
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
let deepseekClient: OpenAI | null = null;

function getDeepSeekClient(): OpenAI {
    if (typeof window !== 'undefined') {
        throw new Error('DeepSeek client cannot be used on the client side');
    }

    if (!process.env.DEEPSEEK_API_KEY) {
        throw new Error('DEEPSEEK_API_KEY not found in environment variables. Please check your .env file.');
    }

    if (!deepseekClient) {
        deepseekClient = new OpenAI({
            apiKey: process.env.DEEPSEEK_API_KEY,
            baseURL: DEEPSEEK_BASE_URL,
            maxRetries: 3,
            timeout: 60000,
        });
    }

    return deepseekClient;
}

/** Check if a model should be routed to DeepSeek. */
function isDeepSeekModel(model: string): boolean {
    return model.startsWith('deepseek-');
}

// Anthropic client — uses Anthropic Messages API
let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
    if (typeof window !== 'undefined') {
        throw new Error('Anthropic client cannot be used on the client side');
    }

    if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY required for Claude models. Please check your .env file.');
    }

    if (!anthropicClient) {
        anthropicClient = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
            maxRetries: 3,
            timeout: 60000,
        });
    }

    return anthropicClient;
}

/** Check if a model should be routed to Anthropic. */
export function isAnthropicModel(model: string): boolean {
    return model.startsWith('claude-');
}

async function callOpenAIModel(
    prompt: string,
    call_source: string,
    userid: string,
    model: AllowedLLMModelType,
    streaming: boolean,
    setText: ((text: string) => void) | null,
    response_obj: ResponseObject = null,
    response_obj_name: string | null = null,
    debug: boolean = true,
    options?: CallLLMOptions,
): Promise<string> {
    try {
        const validatedModel = allowedLLMModelSchema.parse(model);

        if (streaming && (setText === null || typeof setText !== 'function')) {
            throw new Error('setText must be a function when streaming is true');
        }
        if (!streaming && setText !== null) {
            throw new Error('setText must be null when streaming is false');
        }

        if (debug) logger.debug("Making API call");
        const systemContent = response_obj
            ? "You are a helpful assistant. Please provide your response in JSON format."
            : "You are a helpful assistant.";

        const requestOptions: OpenAI.Chat.ChatCompletionCreateParams = {
            model: validatedModel,
            messages: [
                { role: "system", content: systemContent },
                { role: "user", content: prompt }
            ],
            stream: streaming
        };

        if (response_obj && response_obj_name) {
            if (isDeepSeekModel(validatedModel)) {
                requestOptions.response_format = { type: 'json_object' };
            } else {
                requestOptions.response_format = zodResponseFormat(response_obj, response_obj_name);
            }
        }

        const span = createLLMSpan('openai.chat.completions.create', {
            'llm.model': requestOptions.model,
            'llm.prompt.length': prompt.length,
            'llm.call_source': call_source,
            'llm.structured_output': response_obj ? 'true' : 'false',
            'llm.streaming': streaming ? 'true' : 'false'
        });

        const client = isDeepSeekModel(validatedModel) ? getDeepSeekClient() : getOpenAIClient();

        let response: string;
        let usage: any = {};
        let finishReason = 'unknown';
        let modelUsed = '';
        let rawApiResponse: string;

        try {
            if (streaming) {
                const stream = await client.chat.completions.create(requestOptions) as any;
                let accumulatedContent = '';
                let lastChunk: any = null;

                for await (const chunk of stream) {
                    lastChunk = chunk;
                    const content = chunk.choices[0]?.delta?.content || '';
                    accumulatedContent += content;
                    setText!(accumulatedContent);
                }

                if (lastChunk) {
                    usage = lastChunk.usage || {};
                    finishReason = lastChunk.choices[0]?.finish_reason || 'unknown';
                    modelUsed = lastChunk.model || '';
                }

                response = accumulatedContent;
                rawApiResponse = JSON.stringify({
                    streaming: true,
                    final_content: accumulatedContent,
                    usage: usage,
                    model: modelUsed
                });
            } else {
                const completion = await client.chat.completions.create(requestOptions) as any;

                usage = completion.usage || {};
                finishReason = completion.choices[0]?.finish_reason || 'unknown';
                modelUsed = completion.model || '';
                response = completion.choices[0]?.message?.content || '';
                rawApiResponse = JSON.stringify(completion);
            }
            
            const spanPromptTokens = usage.prompt_tokens ?? 0;
            const spanCompletionTokens = usage.completion_tokens ?? 0;
            const spanReasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;
            const spanCostUsd = calculateLLMCost(modelUsed, spanPromptTokens, spanCompletionTokens, spanReasoningTokens);

            span.setAttributes({
                'llm.response.tokens.completion': spanCompletionTokens,
                'llm.response.tokens.prompt': spanPromptTokens,
                'llm.response.tokens.total': usage.total_tokens || 0,
                'llm.response.finish_reason': finishReason,
                'llm.cost_usd': spanCostUsd,
                'llm.prompt_tokens': spanPromptTokens,
                'llm.completion_tokens': spanCompletionTokens,
                'llm.reasoning_tokens': spanReasoningTokens,
            });
        } catch (error) {
            span.recordException(error as Error);
            span.setStatus({ code: 2, message: (error as Error).message });
            throw error;
        } finally {
            span.end();
        }

        const promptTokens = usage.prompt_tokens ?? 0;
        const completionTokens = usage.completion_tokens ?? 0;
        const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;
        const estimatedCostUsd = calculateLLMCost(modelUsed, promptTokens, completionTokens, reasoningTokens);

        const trackingData: LlmCallTrackingType = {
            userid,
            prompt,
            content: response,
            call_source,
            raw_api_response: rawApiResponse,
            model: modelUsed,
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: usage.total_tokens ?? 0,
            reasoning_tokens: reasoningTokens || undefined,
            finish_reason: finishReason,
            estimated_cost_usd: estimatedCostUsd,
            evolution_invocation_id: options?.evolutionInvocationId ?? undefined,
        };

        try {
            await saveLlmCallTracking(trackingData);
        } catch (trackingError) {
            logger.error('LLM call tracking save failed (non-fatal)', {
                error: trackingError instanceof Error ? trackingError.message : String(trackingError),
                call_source,
                model: modelUsed,
            });
        }

        if (options?.onUsage) {
            try {
                options.onUsage({
                    promptTokens,
                    completionTokens,
                    totalTokens: usage.total_tokens ?? 0,
                    reasoningTokens,
                    estimatedCostUsd,
                    model: modelUsed,
                });
            } catch (callbackError) {
                logger.error('onUsage callback failed', {
                    error: callbackError instanceof Error ? callbackError.message : String(callbackError),
                    call_source,
                });
            }
        }

        if (debug) {
            logger.debug("API call successful", {}, FILE_DEBUG);
            logger.debug("LLM Response", {
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
            logger.error(`Error in OpenAI-compatible call: ${errorMessage}`);
        }
        throw error;
    }
}

async function callAnthropicModel(
    prompt: string,
    call_source: string,
    userid: string,
    model: AllowedLLMModelType,
    streaming: boolean,
    setText: ((text: string) => void) | null,
    response_obj: ResponseObject = null,
    _response_obj_name: string | null = null,
    debug: boolean = true,
    options?: CallLLMOptions,
): Promise<string> {
    try {
        const validatedModel = allowedLLMModelSchema.parse(model);

        if (streaming && (setText === null || typeof setText !== 'function')) {
            throw new Error('setText must be a function when streaming is true');
        }
        if (!streaming && setText !== null) {
            throw new Error('setText must be null when streaming is false');
        }

        const client = getAnthropicClient();
        const systemMessage = response_obj
            ? 'You are a helpful assistant. Please provide your response in JSON format.'
            : 'You are a helpful assistant.';

        if (debug) logger.debug("Making Anthropic API call", { model: validatedModel });

        const span = createLLMSpan('anthropic.messages.create', {
            'llm.model': validatedModel,
            'llm.prompt.length': prompt.length,
            'llm.call_source': call_source,
            'llm.structured_output': response_obj ? 'true' : 'false',
            'llm.streaming': streaming ? 'true' : 'false'
        });

        let response: string;
        let usage: { input_tokens: number; output_tokens: number };

        try {
            if (streaming && setText) {
                let accumulated = '';
                const stream = client.messages.stream({
                    model: validatedModel,
                    max_tokens: 8192,
                    system: systemMessage,
                    messages: [{ role: 'user', content: prompt }],
                });
                for await (const event of stream) {
                    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                        accumulated += event.delta.text;
                        setText(accumulated);
                    }
                }
                const finalMessage = await stream.finalMessage();
                response = accumulated;
                usage = finalMessage.usage;
            } else {
                const message = await client.messages.create({
                    model: validatedModel,
                    max_tokens: 8192,
                    system: systemMessage,
                    messages: [{ role: 'user', content: prompt }],
                });
                response = message.content[0].type === 'text' ? message.content[0].text : '';
                usage = message.usage;
            }

            const anthropicCostUsd = calculateLLMCost(validatedModel, usage.input_tokens, usage.output_tokens, 0);

            span.setAttributes({
                'llm.response.tokens.completion': usage.output_tokens,
                'llm.response.tokens.prompt': usage.input_tokens,
                'llm.response.tokens.total': usage.input_tokens + usage.output_tokens,
                'llm.response.finish_reason': 'end_turn',
                'llm.cost_usd': anthropicCostUsd,
                'llm.prompt_tokens': usage.input_tokens,
                'llm.completion_tokens': usage.output_tokens,
                'llm.reasoning_tokens': 0,
            });
        } catch (error) {
            span.recordException(error as Error);
            span.setStatus({ code: 2, message: (error as Error).message });
            throw error;
        } finally {
            span.end();
        }

        const promptTokens = usage.input_tokens;
        const completionTokens = usage.output_tokens;
        const totalTokens = promptTokens + completionTokens;
        const estimatedCostUsd = calculateLLMCost(validatedModel, promptTokens, completionTokens, 0);

        if (options?.onUsage) {
            options.onUsage({
                promptTokens,
                completionTokens,
                totalTokens,
                reasoningTokens: 0,
                estimatedCostUsd,
                model: validatedModel,
            });
        }

        const trackingData: LlmCallTrackingType = {
            userid,
            prompt,
            content: response,
            call_source,
            raw_api_response: JSON.stringify({ provider: 'anthropic', model: validatedModel, usage }),
            model: validatedModel,
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
            reasoning_tokens: undefined,
            finish_reason: 'end_turn',
            estimated_cost_usd: estimatedCostUsd,
            evolution_invocation_id: options?.evolutionInvocationId ?? undefined,
        };

        try {
            await saveLlmCallTracking(trackingData);
        } catch (trackingError) {
            logger.error('LLM call tracking save failed (non-fatal)', {
                error: trackingError instanceof Error ? trackingError.message : String(trackingError),
                call_source,
                model: validatedModel,
            });
        }

        if (debug) {
            logger.debug("Anthropic API call successful", {}, FILE_DEBUG);
        }

        if (!response) {
            throw new Error('No response received from Anthropic');
        }

        return response;
    } catch (error) {
        if (error instanceof z.ZodError) {
            logger.error(`Invalid model parameter: ${model}. Allowed models: ${allowedLLMModelSchema.options.join(', ')}`);
            throw new Error(`Invalid model: ${model}. Must be one of: ${allowedLLMModelSchema.options.join(', ')}`);
        }
        if (debug) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Error in Anthropic call: ${errorMessage}`);
        }
        throw error;
    }
}

async function callLLMModelRaw(
    prompt: string,
    call_source: string,
    userid: string,
    model: AllowedLLMModelType,
    streaming: boolean,
    setText: ((text: string) => void) | null,
    response_obj: ResponseObject = null,
    response_obj_name: string | null = null,
    debug: boolean = true,
    options?: CallLLMOptions,
): Promise<string> {
    // Global spending gate: check budget before any LLM call
    const spendingGate = getSpendingGate();
    const estimatedCost = calculateLLMCost(model, 1000, 4096, 0); // Conservative estimate
    const reservedCost = await spendingGate.checkBudget(call_source, estimatedCost);

    try {
        const usesSemaphore = call_source.startsWith('evolution_');

        if (usesSemaphore) {
            const semaphore = getLLMSemaphore();
            await semaphore.acquire();
            try {
                return await routeLLMCall(prompt, call_source, userid, model, streaming, setText, response_obj, response_obj_name, debug, options);
            } finally {
                semaphore.release();
            }
        }

        return await routeLLMCall(prompt, call_source, userid, model, streaming, setText, response_obj, response_obj_name, debug, options);
    } finally {
        // Reconcile reservation after call completes (success or failure)
        spendingGate.reconcileAfterCall(reservedCost, call_source).catch((err) => {
            logger.error('Spending gate reconciliation failed', {
                error: err instanceof Error ? err.message : String(err),
                call_source,
            });
        });
    }
}

function routeLLMCall(
    prompt: string,
    call_source: string,
    userid: string,
    model: AllowedLLMModelType,
    streaming: boolean,
    setText: ((text: string) => void) | null,
    response_obj: ResponseObject = null,
    response_obj_name: string | null = null,
    debug: boolean = true,
    options?: CallLLMOptions,
): Promise<string> {
    if (isAnthropicModel(model)) {
        return callAnthropicModel(prompt, call_source, userid, model, streaming, setText, response_obj, response_obj_name, debug, options);
    }
    return callOpenAIModel(prompt, call_source, userid, model, streaming, setText, response_obj, response_obj_name, debug, options);
}

const callLLMWithLogging = withLogging(callLLMModelRaw, 'callLLM', {
    logInputs: false,
    logOutputs: false,
    logErrors: true
});

export { callLLMWithLogging as callLLM };
export { callLLMWithLogging as callLLMModel };
export { callLLMWithLogging as callOpenAIModel };
