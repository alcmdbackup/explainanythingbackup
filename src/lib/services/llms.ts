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

export interface LLMUsageMetadata {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: number;
  model: string;
}

export interface CallLLMOptions {
  onUsage?: (usage: LLMUsageMetadata) => void;
  evolutionInvocationId?: string;
}

type ResponseObject = z.ZodObject<any> | null;
const FILE_DEBUG = false;

/** Validates that setText is provided iff streaming is enabled. */
function validateStreamingArgs(streaming: boolean, setText: ((text: string) => void) | null): void {
    if (streaming && (setText === null || typeof setText !== 'function')) {
        throw new Error('setText must be a function when streaming is true');
    }
    if (!streaming && setText !== null) {
        throw new Error('setText must be null when streaming is false');
    }
}

/** Re-throws with a clear message for ZodError (invalid model), or logs and re-throws other errors. */
function handleLLMCallError(error: unknown, model: string, provider: string): never {
    if (error instanceof z.ZodError) {
        const allowed = allowedLLMModelSchema.options.join(', ');
        logger.error(`Invalid model parameter: ${model}. Allowed models: ${allowed}`);
        throw new Error(`Invalid model: ${model}. Must be one of: ${allowed}`);
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error in ${provider} call: ${errorMessage}`);
    throw error;
}

export const DEFAULT_MODEL: AllowedLLMModelType = 'gpt-4.1-mini';
export const LIGHTER_MODEL: AllowedLLMModelType = 'gpt-4.1-nano';
export const ANONYMOUS_USER_UUID = '00000000-0000-0000-0000-000000000000';

/** Module-level tracking failure counter — escalates log level at threshold. */
let trackingFailureCount = 0;

async function saveLlmCallTracking(trackingData: LlmCallTrackingType): Promise<void> {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        if (trackingFailureCount === 0) {
            logger.warn('saveLlmCallTracking: SUPABASE_SERVICE_ROLE_KEY not set — tracking disabled');
        }
        trackingFailureCount++;
        return;
    }

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

/** Save tracking data and invoke the onUsage callback (both non-fatal on failure). */
async function saveTrackingAndNotify(
    trackingData: LlmCallTrackingType,
    usageMeta: LLMUsageMetadata,
    options?: CallLLMOptions,
): Promise<void> {
    try {
        await saveLlmCallTracking(trackingData);
    } catch (trackingError) {
        trackingFailureCount++;
        const logFn = trackingFailureCount >= 3 ? logger.error : logger.warn;
        logFn(`LLM call tracking save failed (non-fatal, failure #${trackingFailureCount})`, {
            error: trackingError instanceof Error ? trackingError.message : String(trackingError),
            call_source: trackingData.call_source,
            model: trackingData.model,
            evolution_invocation_id: trackingData.evolution_invocation_id ?? null,
        });
    }

    if (options?.onUsage) {
        try {
            options.onUsage(usageMeta);
        } catch (callbackError) {
            logger.error('onUsage callback failed', {
                error: callbackError instanceof Error ? callbackError.message : String(callbackError),
                call_source: trackingData.call_source,
            });
        }
    }
}

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

function isDeepSeekModel(model: string): boolean {
    return model.startsWith('deepseek-');
}

export function isLocalModel(model: string): boolean {
    return model.startsWith('LOCAL_');
}

let localClient: OpenAI | null = null;

function getLocalClient(): OpenAI {
    if (typeof window !== 'undefined') {
        throw new Error('Local LLM client cannot be used on the client side');
    }

    if (!localClient) {
        localClient = new OpenAI({
            apiKey: 'local',
            baseURL: process.env.LOCAL_LLM_BASE_URL || 'http://localhost:11434/v1',
            maxRetries: 3,
            timeout: 300000,
        });
    }

    return localClient;
}

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
        validateStreamingArgs(streaming, setText);

        if (debug) logger.debug("Making API call");
        const systemContent = response_obj
            ? "You are a helpful assistant. Please provide your response in JSON format."
            : "You are a helpful assistant.";

        const apiModel = isLocalModel(validatedModel) ? validatedModel.replace(/^LOCAL_/, '') : validatedModel;

        const requestOptions: OpenAI.Chat.ChatCompletionCreateParams = {
            model: apiModel,
            messages: [
                { role: "system", content: systemContent },
                { role: "user", content: prompt }
            ],
            stream: streaming
        };

        if (response_obj && response_obj_name) {
            if (isDeepSeekModel(validatedModel) || isLocalModel(validatedModel)) {
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

        let client: OpenAI;
        if (isLocalModel(validatedModel)) {
            client = getLocalClient();
        } else if (isDeepSeekModel(validatedModel)) {
            client = getDeepSeekClient();
        } else {
            client = getOpenAIClient();
        }

        let response: string;
        let usage: any = {};
        let finishReason = 'unknown';
        let modelUsed = '';
        let rawApiResponse: string;
        let promptTokens = 0;
        let completionTokens = 0;
        let reasoningTokens = 0;
        let estimatedCostUsd = 0;

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

            promptTokens = usage.prompt_tokens ?? 0;
            completionTokens = usage.completion_tokens ?? 0;
            reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;
            const costModel = isLocalModel(validatedModel) ? validatedModel : modelUsed;
            estimatedCostUsd = calculateLLMCost(costModel, promptTokens, completionTokens, reasoningTokens);

            span.setAttributes({
                'llm.response.tokens.completion': completionTokens,
                'llm.response.tokens.prompt': promptTokens,
                'llm.response.tokens.total': usage.total_tokens || 0,
                'llm.response.finish_reason': finishReason,
                'llm.cost_usd': estimatedCostUsd,
                'llm.prompt_tokens': promptTokens,
                'llm.completion_tokens': completionTokens,
                'llm.reasoning_tokens': reasoningTokens,
            });
        } catch (error) {
            span.recordException(error as Error);
            span.setStatus({ code: 2, message: (error as Error).message });
            throw error;
        } finally {
            span.end();
        }

        const totalTokens = usage.total_tokens ?? 0;
        const usageMeta: LLMUsageMetadata = { promptTokens, completionTokens, totalTokens, reasoningTokens, estimatedCostUsd, model: modelUsed };

        await saveTrackingAndNotify({
            userid,
            prompt,
            content: response,
            call_source,
            raw_api_response: rawApiResponse,
            model: modelUsed,
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
            reasoning_tokens: reasoningTokens || undefined,
            finish_reason: finishReason,
            estimated_cost_usd: estimatedCostUsd,
            evolution_invocation_id: options?.evolutionInvocationId ?? undefined,
        }, usageMeta, options);

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
        handleLLMCallError(error, model, 'OpenAI-compatible');
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
        validateStreamingArgs(streaming, setText);

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
        let promptTokens = 0;
        let completionTokens = 0;
        let estimatedCostUsd = 0;

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
                response = message.content[0]?.type === 'text' ? message.content[0].text : '';
                usage = message.usage;
            }

            promptTokens = usage.input_tokens;
            completionTokens = usage.output_tokens;
            estimatedCostUsd = calculateLLMCost(validatedModel, promptTokens, completionTokens, 0);

            span.setAttributes({
                'llm.response.tokens.completion': completionTokens,
                'llm.response.tokens.prompt': promptTokens,
                'llm.response.tokens.total': promptTokens + completionTokens,
                'llm.response.finish_reason': 'end_turn',
                'llm.cost_usd': estimatedCostUsd,
                'llm.prompt_tokens': promptTokens,
                'llm.completion_tokens': completionTokens,
                'llm.reasoning_tokens': 0,
            });
        } catch (error) {
            span.recordException(error as Error);
            span.setStatus({ code: 2, message: (error as Error).message });
            throw error;
        } finally {
            span.end();
        }

        const totalTokens = promptTokens + completionTokens;
        const usageMeta: LLMUsageMetadata = { promptTokens, completionTokens, totalTokens, reasoningTokens: 0, estimatedCostUsd, model: validatedModel };

        await saveTrackingAndNotify({
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
        }, usageMeta, options);

        if (debug) {
            logger.debug("Anthropic API call successful", {}, FILE_DEBUG);
        }

        if (!response) {
            throw new Error('No response received from Anthropic');
        }

        return response;
    } catch (error) {
        handleLLMCallError(error, model, 'Anthropic');
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
    const spendingGate = getSpendingGate();
    const estimatedCost = calculateLLMCost(model, 1000, 4096, 0);
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
