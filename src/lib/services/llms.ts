/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/**
 * LLM service for making API calls to OpenAI, DeepSeek, Anthropic, and OpenRouter with structured output support.
 * Provides call tracking, tracing, and automatic logging. Routes to the correct provider based on model prefix.
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '@/lib/server_utilities';
import { z } from 'zod';
import { zodResponseFormat } from "openai/helpers/zod";
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { CallSource } from '@/lib/services/llmCallSource';
import { CALL_SOURCE_SHAPE, captureCallerName } from '@/lib/services/llmCallSource';
import { isTestLlmCall } from '@/lib/services/llmCostAttribution';
import { type LlmCallTrackingType, llmCallTrackingSchema, allowedLLMModelSchema, type AllowedLLMModelType } from '@/lib/schemas/schemas';
import { createLLMSpan } from '../../../instrumentation';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { ServiceError } from '@/lib/errors/serviceError';
import { ERROR_CODES } from '@/lib/errorHandling';
import { calculateLLMCost } from '@/config/llmPricing';
import { isOpenRouterModel as registryIsOpenRouterModel, getOpenRouterApiModelId, getModelMaxTemperature, getModelDefaultReasoningEffort, modelSupportsReasoning, modelSupportsJsonSchema, MODEL_REGISTRY } from '@/config/modelRegistry';

/** Clamp temperature to model's max. Returns undefined if model doesn't support temperature or temp not set. */
function clampTemperature(temperature: number | undefined, model: string): number | undefined {
    if (temperature === undefined) return undefined;
    const maxTemp = getModelMaxTemperature(model);
    if (maxTemp === null || maxTemp === undefined) return undefined;
    return Math.min(temperature, maxTemp);
}
import { getLLMSemaphore } from './llmSemaphore';
import { getSpendingGate } from './llmSpendingGate';

/**
 * Build the provider request fields that carry reasoning effort, applying per-model hygiene so a
 * model never receives a reasoning param it can't accept:
 *  - models with `supportsReasoning === false` (gemini-2.5-flash-lite, qwen-2.5-7b-instruct,
 *    gpt-4.1-mini, deepseek-*, claude-*) NEVER receive a reasoning param. Previously the judge
 *    UI's default `reasoning='none'` was forwarded as `reasoning:{effort:'none'}` to these.
 *  - `'none'` is only a meaningful value for OpenRouter models that opt into a disabled-thinking
 *    mode (e.g. qwen3-8b, whose registry default IS 'none'). For a mandatory-reasoning model
 *    (registry default is low/medium/high, e.g. gpt-oss-20b) a requested `'none'` is coerced to
 *    that default rather than sent. For OpenAI o-series, `'none'` is invalid → omit entirely.
 * Caller override wins over the registry default. Returns the fields to merge into the request
 * body ({} when nothing should be attached).
 */
export function resolveReasoningRequestFields(
    model: string,
    requestedEffort: 'none' | 'low' | 'medium' | 'high' | undefined,
): Record<string, unknown> {
    if (!modelSupportsReasoning(model)) return {};
    let effort = requestedEffort ?? getModelDefaultReasoningEffort(model);
    if (!effort) return {};
    if (isOpenRouterModel(model)) {
        if (effort === 'none') {
            // 'none' disables thinking — valid only when the model opts in (its default is 'none').
            // For mandatory-reasoning models, coerce to the registry default instead of sending 'none'.
            const def = getModelDefaultReasoningEffort(model);
            if (def && def !== 'none') effort = def;
        }
        // include_reasoning surfaces the trace; pointless when thinking is disabled ('none').
        return effort === 'none'
            ? { reasoning: { effort } }
            : { reasoning: { effort }, include_reasoning: true };
    }
    // OpenAI o-series: 'none' is not a valid value → omit reasoning entirely.
    if (effort === 'none') return {};
    return { reasoning_effort: effort, reasoning: { summary: 'auto' } };
}

export interface LLMUsageMetadata {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  /** Cache-hit subset of promptTokens (provider context caching). Carried so cost paths
   *  downstream of onUsage (e.g. the evolution budget gate) can bill cache-aware. */
  cachedPromptTokens?: number;
  estimatedCostUsd: number;
  model: string;
  /** Provider-extracted reasoning trace text (when available + permitted).
   *  bring_back_debate_agent_20260506 Phase 1.20.
   *
   *  - OpenRouter (qwen3-8b, gpt-oss-20b): verbatim from response.choices[0].message.reasoning_details[].
   *  - OpenAI o-series + GPT-5: summary only via reasoning: { summary: 'auto' } opt-in
   *    (raw chain-of-thought extraction is prohibited by AUP).
   *  - Anthropic Sonnet 4: summary in `thinking` content blocks (currently dead in v1
   *    since registry has supportsReasoning=false for all claude-* entries).
   *
   *  Three-state semantics paired with reasoningTraceFormat:
   *    - reasoningTokens === 0 + reasoningTraceFormat undefined → no thinking requested.
   *    - reasoningTokens > 0 + reasoningTraceFormat 'verbatim'|'summary' → trace surfaced.
   *    - reasoningTokens > 0 + reasoningTraceFormat 'unavailable' → thinking happened
   *      (token count proves it) but provider dropped trace text. */
  reasoningTrace?: string;
  reasoningTraceFormat?: 'verbatim' | 'summary' | 'unavailable';
}

export interface CallLLMOptions {
  onUsage?: (usage: LLMUsageMetadata) => void;
  evolutionInvocationId?: string;
  /** LLM sampling temperature. Omit to use provider default. Clamped to model's maxTemperature. */
  temperature?: number;
  /** Reasoning effort for reasoning-capable models (OpenRouter thinking/reasoning models,
   *  OpenAI o-series). Values: 'none' | 'low' | 'medium' | 'high'. Omit to use the model's
   *  registry default. Ignored for non-reasoning models. */
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  /** Pre-built Supabase client for the llmCallTracking write. Required when calling from
   *  non-Next.js contexts (e.g. evolution batch runners) — the default
   *  `createSupabaseServiceClient` lives in a `'use server'` file that misbehaves in CLI.
   *  When omitted, falls back to the Next.js-resolved service client. */
  trackingDb?: SupabaseClient<Database>;
  /** Hard cap on output tokens for THIS call, forwarded as OpenAI `max_tokens` on the
   *  OpenAI/OpenRouter/DeepSeek path. Omit to let the provider use its default (the model max,
   *  which on OpenRouter inflates the credit-affordability pre-check and can 402). Set by the
   *  evolution pipeline (see claimAndExecuteRun). IGNORED for reasoning-capable models, where
   *  `max_tokens` would cap reasoning+completion together and could truncate the trace. */
  maxOutputTokens?: number;
  /** FAIL-CLOSED tracking. When `true`, a failure to write the `llmCallTracking` row RE-THROWS
   *  (blocking the call) instead of being swallowed. Set by every evolution call site so evolution
   *  spend can never be silently lost (the 2026-02-23 audit gap). The full would-be-row payload is
   *  always dead-lettered to an `error` log before the throw, so spent dollars stay recoverable even
   *  when the DB write fails. Main-app calls omit this and keep best-effort (swallow-and-log). */
  requireTracking?: boolean;
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

/** Module-level tracking failure counter. Resets to 0 on a successful write. Used to
 *  flag burst regressions (the audit gap between 2026-02-22 and 2026-04-23 went unnoticed
 *  because warn-level logs were the only signal). */
let trackingFailureCount = 0;

/** Save one llmCallTracking row. When `injectedDb` is provided, uses that client
 *  (required from non-Next.js contexts). Otherwise falls back to the Next.js-resolved
 *  service client — which is currently broken from the CLI batch runner, see
 *  `docs/planning/debug_evolution_run_cost_20260426`. */
export async function saveLlmCallTracking(
    trackingData: LlmCallTrackingType,
    injectedDb?: SupabaseClient<Database>,
): Promise<void> {
    if (!injectedDb && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        // No way to construct a client — a configuration error. ALWAYS throw: the swallow-vs-throw
        // decision lives in the caller (saveTrackingAndNotify, gated on requireTracking), so this
        // surfaces on the first failure regardless of environment.
        logger.error('saveLlmCallTracking: no client available — SUPABASE_SERVICE_ROLE_KEY unset and no injectedDb provided', {
            call_source: trackingData.call_source,
            model: trackingData.model,
        });
        trackingFailureCount++;
        throw new ServiceError(
            ERROR_CODES.DATABASE_ERROR,
            'saveLlmCallTracking: no client available (set SUPABASE_SERVICE_ROLE_KEY or pass trackingDb)',
            'saveLlmCallTracking',
            { details: { callSource: trackingData.call_source } },
        );
    }

    try {
        // Derive the test/mock discriminator at this single chokepoint (both OpenAI and
        // Anthropic save paths flow through here) unless a caller already set it.
        const dataWithTestFlag: LlmCallTrackingType = {
            ...trackingData,
            is_test: trackingData.is_test ?? isTestLlmCall({
                userid: trackingData.userid,
                callSource: trackingData.call_source,
                content: trackingData.content,
            }),
        };
        const validatedData = llmCallTrackingSchema.parse(dataWithTestFlag);
        const supabase = injectedDb ?? await createSupabaseServiceClient();

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
                code: error.code,
                call_source: trackingData.call_source,
                model: trackingData.model,
            });
            throw error;
        }

        // Reset on success so a single transient blip doesn't permanently elevate logs.
        if (trackingFailureCount > 0) {
            logger.info('saveLlmCallTracking recovered', { previousFailureCount: trackingFailureCount });
            trackingFailureCount = 0;
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

/** Save tracking data and invoke the onUsage callback.
 *
 *  Tracking failures are always LOUD (logged at `error` level with the full would-be-row payload
 *  so spent dollars are recoverable from logs — the dead-letter of last resort).
 *
 *  FAIL-CLOSED: when `options.requireTracking` is set (every evolution call site), a tracking
 *  failure RE-THROWS so the LLM call is treated as failed and the run cannot silently continue —
 *  this is what closes the 2026-02-23 evolution audit gap. Main-app calls omit `requireTracking`
 *  and keep best-effort swallow-and-log (a tracking blip must not fail a user-facing call).
 *
 *  `onUsage` fires BEFORE any re-throw so the caller's usage/cost accounting reflects the real
 *  spend that already occurred, even on a call whose tracking then fails. */
export async function saveTrackingAndNotify(
    trackingData: LlmCallTrackingType,
    usageMeta: LLMUsageMetadata,
    options?: CallLLMOptions,
): Promise<void> {
    // Fire onUsage first — the provider was already billed, so caller accounting must reflect it
    // regardless of whether the tracking write below succeeds or throws.
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

    try {
        await saveLlmCallTracking(trackingData, options?.trackingDb);
    } catch (trackingError) {
        trackingFailureCount++;
        // Dead-letter: full would-be-row payload at error level so the spend is never invisible,
        // even when the DB row write fails. (Warn-level was why the audit gap hid for 2 months.)
        logger.error(`LLM call tracking save failed (failure #${trackingFailureCount})`, {
            error: trackingError instanceof Error ? trackingError.message : String(trackingError),
            require_tracking: options?.requireTracking ?? false,
            call_source: trackingData.call_source,
            model: trackingData.model,
            userid: trackingData.userid,
            prompt_tokens: trackingData.prompt_tokens,
            completion_tokens: trackingData.completion_tokens,
            reasoning_tokens: trackingData.reasoning_tokens ?? null,
            total_tokens: trackingData.total_tokens,
            estimated_cost_usd: trackingData.estimated_cost_usd,
            is_test: trackingData.is_test ?? null,
            evolution_invocation_id: trackingData.evolution_invocation_id ?? null,
            had_injected_db: options?.trackingDb ? true : false,
            tracking_failure_count: trackingFailureCount,
        });
        // FAIL-CLOSED: evolution (and any requireTracking) call must fail when its spend can't be recorded.
        // Kill-switch: LLM_REQUIRE_TRACKING_DISABLED=true reverts to best-effort swallow WITHOUT a
        // deploy if fail-closed starts failing runs (rollback for the Layer-1 guarantee). The env
        // check WINS over requireTracking so the rollback path is unambiguous.
        if (options?.requireTracking && process.env.LLM_REQUIRE_TRACKING_DISABLED !== 'true') {
            throw trackingError;
        }
    }
}

/** Test-only: reset module-level state. Exposed for unit tests, not part of the public API. */
export function __resetTrackingFailureCount(): void {
    trackingFailureCount = 0;
}

/** Test-only: read the current failure counter. */
export function __getTrackingFailureCount(): number {
    return trackingFailureCount;
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
            // Disable SDK retries — createEvolutionLLMClient has its own retry
            // loop (MAX_RETRIES=3) with backoff. Stacking SDK retries on top
            // amplified worst-case wait to 3 attempts × 60s × 4 outer = 720s,
            // blowing past pipeline-test beforeAll budgets. Single attempt
            // per outer call keeps max wait at 60s × 4 = 240s.
            maxRetries: 0,
            timeout: 60000,
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
            // Disable SDK retries — createEvolutionLLMClient has its own retry
            // loop (MAX_RETRIES=3) with backoff. Stacking SDK retries on top
            // amplified worst-case wait to 3 attempts × 60s × 4 outer = 720s,
            // blowing past pipeline-test beforeAll budgets. Single attempt
            // per outer call keeps max wait at 60s × 4 = 240s.
            maxRetries: 0,
            timeout: 60000,
        });
    }

    return deepseekClient;
}

export function isDeepSeekModel(model: string): boolean {
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
            // Disable SDK retries — createEvolutionLLMClient has its own retry
            // loop (MAX_RETRIES=3) with backoff. Stacking SDK retries on top
            // amplified worst-case wait to 3 attempts × 60s × 4 outer = 720s,
            // blowing past pipeline-test beforeAll budgets. Single attempt
            // per outer call keeps max wait at 60s × 4 = 240s.
            maxRetries: 0,
            timeout: 300000,
        });
    }

    return localClient;
}

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
let openRouterClient: OpenAI | null = null;

function getOpenRouterClient(): OpenAI {
    if (typeof window !== 'undefined') {
        throw new Error('OpenRouter client cannot be used on the client side');
    }

    if (!process.env.OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY not found in environment variables. Please check your .env file.');
    }

    if (!openRouterClient) {
        openRouterClient = new OpenAI({
            apiKey: process.env.OPENROUTER_API_KEY,
            baseURL: OPENROUTER_BASE_URL,
            // Disable SDK retries — createEvolutionLLMClient has its own retry
            // loop (MAX_RETRIES=3) with backoff. Stacking SDK retries on top
            // amplified worst-case wait to 3 attempts × 60s × 4 outer = 720s,
            // blowing past pipeline-test beforeAll budgets. Single attempt
            // per outer call keeps max wait at 60s × 4 = 240s.
            maxRetries: 0,
            timeout: 60000,
        });
    }

    return openRouterClient;
}

export function isOpenRouterModel(model: string): boolean {
    return registryIsOpenRouterModel(model);
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
            // Disable SDK retries — createEvolutionLLMClient has its own retry
            // loop (MAX_RETRIES=3) with backoff. Stacking SDK retries on top
            // amplified worst-case wait to 3 attempts × 60s × 4 outer = 720s,
            // blowing past pipeline-test beforeAll budgets. Single attempt
            // per outer call keeps max wait at 60s × 4 = 240s.
            maxRetries: 0,
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
    call_source: CallSource,
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

        const apiModel = isLocalModel(validatedModel)
            ? validatedModel.replace(/^LOCAL_/, '')
            : isOpenRouterModel(validatedModel)
                ? getOpenRouterApiModelId(validatedModel)
                : validatedModel;

        const requestOptions: OpenAI.Chat.ChatCompletionCreateParams = {
            model: apiModel,
            messages: [
                { role: "system", content: systemContent },
                { role: "user", content: prompt }
            ],
            stream: streaming
        };

        const clampedTemp = clampTemperature(options?.temperature, validatedModel);
        if (clampedTemp !== undefined) {
            requestOptions.temperature = clampedTemp;
        }

        // Per-call output cap (D5 — fix_structured_judging_evolution_bugs). The cap exists
        // SOLELY to dodge OpenRouter's credit-affordability pre-check, which otherwise reserves
        // the model max (~65535) and 402s on a low balance even though real output is ~1-2K
        // tokens. Direct OpenAI/DeepSeek/Local clients have no such pre-check — capping them
        // just truncates legitimate output (e.g. gpt-5-mini coordinator at 4096; caught
        // 2026-06-20 staging canary B5 — 50% of paragraph_recombine invocations hit the guard
        // because gpt-5-mini's internal reasoning tokens count against the cap). So: gate on
        // isOpenRouterModel — non-OpenRouter calls use the provider default. Reasoning models
        // stay exempted regardless, since their cap covers reasoning+completion together.
        if (
            options?.maxOutputTokens !== undefined &&
            !modelSupportsReasoning(validatedModel) &&
            isOpenRouterModel(validatedModel)
        ) {
            requestOptions.max_tokens = options.maxOutputTokens;
        }

        // Reasoning effort — caller override wins over the registry default; hygiene rules
        // (drop 'none', skip non-reasoning models) live in resolveReasoningRequestFields so a
        // model never receives a reasoning param it can't accept. Phase 1.20 trace opt-ins
        // (include_reasoning for OpenRouter, reasoning.summary for OpenAI) are preserved there.
        const requestedReasoningEffort = options?.reasoningEffort ?? getModelDefaultReasoningEffort(validatedModel);
        const reasoningFields = resolveReasoningRequestFields(validatedModel, requestedReasoningEffort);
        Object.assign(requestOptions, reasoningFields);
        // True iff thinking was actually requested (a non-'none' effort) — drives trace extraction
        // below. Both trace opt-ins (reasoning_effort for OpenAI, include_reasoning for OpenRouter)
        // are emitted only when effort !== 'none', so their presence is the signal. A disabled-
        // thinking 'none' (e.g. qwen3-8b) emits neither and stays false.
        const reasoningRequested =
            reasoningFields.reasoning_effort !== undefined || reasoningFields.include_reasoning === true;

        // DeepSeek defaults thinking ON. For non-reasoning DeepSeek models, explicitly disable
        // it so they behave as plain chat models (temperature honored, no chain-of-thought
        // tokens billed). The OpenAI SDK forwards this unknown field to api.deepseek.com, same
        // as the reasoning/reasoning_effort fields above. Guard keeps it DeepSeek-only.
        if (isDeepSeekModel(validatedModel) && !modelSupportsReasoning(validatedModel)) {
            (requestOptions as unknown as Record<string, unknown>).thinking = { type: 'disabled' };
        }

        if (response_obj && response_obj_name) {
            if (isOpenRouterModel(validatedModel) && modelSupportsJsonSchema(validatedModel)) {
                // Flagged OpenRouter model (e.g. Gemini): use schema-enforced json_schema so the
                // model conforms to the Zod shape (plain json_object does NOT enforce the schema,
                // which broke title-gen on Gemini — see fix_openrouter_json_schema_structured_output).
                // Drop `strict` (zodResponseFormat defaults it to true); Gemini-via-OpenRouter rejects
                // strict mode for some schemas, while non-strict still enforces the field shape.
                const rf = zodResponseFormat(response_obj, response_obj_name);
                rf.json_schema.strict = false;
                requestOptions.response_format = rf;
            } else if (isDeepSeekModel(validatedModel) || isLocalModel(validatedModel) || isOpenRouterModel(validatedModel)) {
                // DeepSeek/Local/unflagged-OpenRouter: JSON-forced but not schema-enforced.
                requestOptions.response_format = { type: 'json_object' };
            } else {
                // OpenAI: schema-enforced json_schema (strict).
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
        } else if (isOpenRouterModel(validatedModel)) {
            client = getOpenRouterClient();
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
        let cachedPromptTokens = 0;
        let estimatedCostUsd = 0;
        // bring_back_debate_agent_20260506 Phase 1.20 — provider-specific reasoning trace.
        let reasoningTrace: string | undefined;
        let reasoningTraceFormat: 'verbatim' | 'summary' | 'unavailable' | undefined;

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
                    // Fall back to the model actually sent to the provider (apiModel is already
                    // the OpenRouter-mapped id) instead of '' when the response omits `model`.
                    // Prevents the model='' tracking bucket that masked real-vs-mock spend.
                    modelUsed = lastChunk.model || apiModel;
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
                // Fall back to the provider-mapped model (apiModel) when the response omits
                // `model` — see streaming branch above; kills the model='' tracking bucket.
                modelUsed = completion.model || apiModel;
                response = completion.choices[0]?.message?.content || '';
                rawApiResponse = JSON.stringify(completion);
            }

            // D5 truncation guard: if WE imposed an output cap (only OpenRouter — see above)
            // and the provider truncated the response at it (finish_reason='length'), fail
            // loudly instead of returning silently-partial text. Main-app calls don't set a
            // cap so they're unaffected. For evolution this surfaces as a thrown error → the
            // agent records the invocation success=false (D1), never a silent partial.
            if (requestOptions.max_tokens !== undefined && finishReason === 'length') {
                throw new Error(
                    `LLM response truncated at output cap=${requestOptions.max_tokens} ` +
                    `(finish_reason='length', model=${validatedModel}). Increase the evolution ` +
                    `output cap (EVOLUTION_MAX_OUTPUT_TOKENS) or check the prompt size.`,
                );
            }

            promptTokens = usage.prompt_tokens ?? 0;
            completionTokens = usage.completion_tokens ?? 0;
            reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;
            // DeepSeek context caching: prompt_cache_hit_tokens is the cache-hit subset of
            // prompt_tokens (the OpenAI-compatible prompt_tokens_details.cached_tokens is the
            // fallback for other providers). Feeds the cache-aware rate in calculateLLMCost.
            cachedPromptTokens = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;

            // bring_back_debate_agent_20260506 Phase 1.20 — extract reasoning trace text
            // per provider, only when reasoning was actually requested + thinking happened.
            // Three-state semantics: 'verbatim'/'summary' = trace surfaced; 'unavailable' =
            // thinking happened but provider dropped trace; undefined = no thinking requested.
            if (reasoningRequested && reasoningTokens > 0) {
                if (isOpenRouterModel(validatedModel)) {
                    // OpenRouter: parse choices[0].message.reasoning_details[] (verbatim).
                    // Some providers behind OpenRouter silently drop this — flag observability.
                    const completion = !streaming ? JSON.parse(rawApiResponse) : null;
                    const message = completion?.choices?.[0]?.message;
                    const details = message?.reasoning_details;
                    if (Array.isArray(details) && details.length > 0) {
                        const concatenated = details
                            .map((d: { text?: string }) => d?.text ?? '')
                            .filter((s: string) => s.length > 0)
                            .join('\n\n');
                        if (concatenated.length > 0) {
                            reasoningTrace = concatenated;
                            reasoningTraceFormat = 'verbatim';
                        } else {
                            reasoningTraceFormat = 'unavailable';
                        }
                    } else if (typeof message?.reasoning === 'string' && message.reasoning.length > 0) {
                        // Some OpenRouter providers surface trace as a single 'reasoning' string instead.
                        reasoningTrace = message.reasoning;
                        reasoningTraceFormat = 'verbatim';
                    } else {
                        reasoningTraceFormat = 'unavailable';
                        logger.warn('OpenRouter reasoning trace silently dropped', {
                            model: validatedModel,
                            provider: 'openrouter',
                            reasoningTokens,
                        });
                    }
                } else if (isAnthropicModel(validatedModel)) {
                    // ANTHROPIC BRANCH IS DEAD CODE IN v1: every claude-* registry entry has
                    // supportsReasoning=false (Phase 1.19), so the cascade resolver returns
                    // undefined and effectiveReasoningEffort never fires for Anthropic models.
                    // This branch is implemented future-ready: when ops flips Sonnet 4 to
                    // supportsReasoning=true, the extraction Just Works without further changes.
                    // Defensive throw-guard catches activation-without-test-coverage:
                    if (!Object.values(MODEL_REGISTRY).some(m => m.provider === 'anthropic' && m.supportsReasoning)) {
                        throw new Error(
                            'Anthropic reasoning extraction reached but no claude-* model has ' +
                            'supportsReasoning=true; verify Phase 1.19 registry update before ' +
                            'relying on this branch.',
                        );
                    }
                    // (Live extraction would parse response.content[].thinking blocks here.)
                    reasoningTraceFormat = 'unavailable';
                } else {
                    // OpenAI o-series + GPT-5: parse summary from response output.
                    // Per Phase 1.20 + AUP: summary only, NOT raw chain-of-thought.
                    // Field path differs by API client version; try both Chat Completions
                    // (`message.reasoning`) and Responses-API (`output[].summary`) shapes.
                    const completion = !streaming ? JSON.parse(rawApiResponse) : null;
                    const message = completion?.choices?.[0]?.message;
                    let summaryText = '';
                    if (typeof message?.reasoning === 'string') {
                        summaryText = message.reasoning;
                    } else if (Array.isArray(completion?.output)) {
                        const reasoningItem = completion.output.find((o: { type?: string }) => o?.type === 'reasoning');
                        const summary = reasoningItem?.summary;
                        if (Array.isArray(summary) && summary.length > 0) {
                            summaryText = summary.map((s: { text?: string }) => s?.text ?? '').filter(Boolean).join('\n\n');
                        }
                    }
                    if (summaryText.length > 0) {
                        reasoningTrace = summaryText;
                        reasoningTraceFormat = 'summary';
                    } else {
                        reasoningTraceFormat = 'unavailable';
                    }
                }
            }

            const costModel = (isLocalModel(validatedModel) || isOpenRouterModel(validatedModel)) ? validatedModel : modelUsed;
            // B021 guard: calculateLLMCost now throws on non-finite/negative
            // tokens to expose upstream tracking bugs; we must not let that
            // crash the user-facing LLM call — tracking is non-fatal by design.
            try {
              estimatedCostUsd = calculateLLMCost(costModel, promptTokens, completionTokens, reasoningTokens, cachedPromptTokens);
            } catch (err) {
              logger.warn('LLM call tracking save failed (non-fatal cost calc)', {
                call_source,
                model: modelUsed,
                error: err instanceof Error ? err.message : String(err),
              });
              estimatedCostUsd = 0;
            }

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
        const usageMeta: LLMUsageMetadata = {
          promptTokens, completionTokens, totalTokens, reasoningTokens, cachedPromptTokens, estimatedCostUsd, model: modelUsed,
          reasoningTrace,
          reasoningTraceFormat,
        };

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
    call_source: CallSource,
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

        const anthropicTemp = clampTemperature(options?.temperature, validatedModel);

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
                    ...(anthropicTemp !== undefined ? { temperature: anthropicTemp } : {}),
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
                    ...(anthropicTemp !== undefined ? { temperature: anthropicTemp } : {}),
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

/** Test-only model override. When `TEST_LLM_MODEL` is set, force that model for every LLM
 *  call so the nightly real-AI smoke can run on a cheap model regardless of the caller's
 *  requested model. Hard-guarded against a real production runtime (mirrors
 *  `returnExplanation/route.ts:17-19`) so a stray env var can never repoint prod traffic; CI
 *  is trusted. Validates the override id against `allowedLLMModelSchema` so a typo fails loudly
 *  instead of silently running the production model. */
export function applyTestLlmModelOverride(model: AllowedLLMModelType): AllowedLLMModelType {
    const override = process.env.TEST_LLM_MODEL;
    if (!override) return model;
    if (process.env.NODE_ENV === 'production' && !process.env.CI) return model;
    return allowedLLMModelSchema.parse(override);
}

async function callLLMModelRaw(
    prompt: string,
    call_source: CallSource,
    userid: string,
    model: AllowedLLMModelType,
    streaming: boolean,
    setText: ((text: string) => void) | null,
    response_obj: ResponseObject = null,
    response_obj_name: string | null = null,
    debug: boolean = true,
    options?: CallLLMOptions,
): Promise<string> {
    // Layer 2 runtime guard: a valid call_source is mandatory. The branded type (Layer 0) +
    // lint rule (Layer 1) make this unreachable from typed TS, but JS callers / `as` casts can
    // still slip a blank/malformed source through. Never let it be silently unattributed.
    if (!call_source || !CALL_SOURCE_SHAPE.test(call_source)) {
        const caller = captureCallerName();
        if (process.env.NODE_ENV !== 'production') {
            throw new Error(`callLLM: invalid/blank call_source (caller: ${caller})`);
        }
        logger.error('callLLM: unattributed call_source — using stack fallback', { caller });
        call_source = `unattributed:${caller}` as CallSource;
    }

    // Apply the test-only model override (no-op in prod / when unset) before cost estimation,
    // routing, and tracking so every downstream step uses the effective model.
    const effectiveModel = applyTestLlmModelOverride(model);
    const spendingGate = getSpendingGate();
    const estimatedCost = calculateLLMCost(effectiveModel, 1000, 4096, 0);

    // Per-user gate (reserve-before-spend; Phase 0 of build_website_for_evolutiOn_20260626).
    // Enforced only for the demo guest user (which is also the userid the public /edit
    // surface passes via process.env.GUEST_USER_ID — by design, /edit traffic shares
    // the same $10/day pool as the existing public-site guest auto-login traffic).
    // Cap is now config-driven via `llm_cost_config.guest_user_daily_cap_usd` (default $10);
    // previously hard-coded as `10` at this site.
    const guestUserId = process.env.GUEST_USER_ID;
    let perUserReservedCost = 0;
    if (guestUserId && userid === guestUserId) {
      const guestCap = await spendingGate.getGuestUserCap();
      perUserReservedCost = await spendingGate.reserveForUser(userid, estimatedCost, guestCap);
    }

    const reservedCost = await spendingGate.checkBudget(call_source, estimatedCost);

    try {
        const usesSemaphore = call_source.startsWith('evolution_');

        if (usesSemaphore) {
            const semaphore = getLLMSemaphore();
            await semaphore.acquire();
            try {
                return await routeLLMCall(prompt, call_source, userid, effectiveModel, streaming, setText, response_obj, response_obj_name, debug, options);
            } finally {
                semaphore.release();
            }
        }

        return await routeLLMCall(prompt, call_source, userid, effectiveModel, streaming, setText, response_obj, response_obj_name, debug, options);
    } finally {
        // B083: surface reconcile failures beyond the log so callers can react (e.g., retry
        // the reconcile or proactively invalidate the cache). We still swallow the throw in
        // the finally block — the caller's primary return value must not be clobbered by a
        // reconcile error — but we do invalidate the local cache on failure so the next call
        // sees fresh DB state and doesn't trust a cache that's known to be out of sync.
        spendingGate.reconcileAfterCall(reservedCost, call_source).catch((err) => {
            logger.error('Spending gate reconciliation failed; invalidating cache', {
                error: err instanceof Error ? err.message : String(err),
                call_source,
            });
            try {
                spendingGate.invalidateCache();
            } catch (invErr) {
                logger.error('Failed to invalidate spending cache after reconcile failure', {
                    error: invErr instanceof Error ? invErr.message : String(invErr),
                });
            }
        });
        // Phase 0: reconcile the per-user reservation. The llmCallTracking AFTER INSERT
        // trigger writes the actual cost to per_user_daily_cost_rollups (separate table);
        // we only release the reservation here, never re-add the actual.
        if (perUserReservedCost > 0 && guestUserId) {
            spendingGate.recordActualForUser(guestUserId, perUserReservedCost).catch((err) => {
                logger.error('Per-user reservation reconcile failed (swallowed)', {
                    error: err instanceof Error ? err.message : String(err),
                });
            });
        }
    }
}

function routeLLMCall(
    prompt: string,
    call_source: CallSource,
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
