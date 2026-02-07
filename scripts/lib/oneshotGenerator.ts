// Shared oneshot article generation logic extracted from generate-article.ts.
// Generates a title + article for a given prompt and model using direct LLM SDK calls.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { createTitlePrompt, createExplanationPrompt } from '../../src/lib/prompts';
import { titleQuerySchema } from '../../src/lib/schemas/schemas';
import { calculateLLMCost } from '../../src/config/llmPricing';

// ─── Types ────────────────────────────────────────────────────────

interface LLMCallResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
}

export interface OneshotResult {
  title: string;
  content: string;
  model: string;
  totalCostUsd: number;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

// ─── Supabase Helper ──────────────────────────────────────────────

/** Create a Supabase service-role client from env vars. Returns null if vars missing. */
export function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ─── LLM Call Tracking ───────────────────────────────────────────

export async function trackLLMCall(
  supabase: SupabaseClient | null,
  params: {
    prompt: string;
    content: string;
    callSource: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    rawResponse: string;
    finishReason: string;
  },
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('llmCallTracking').insert({
      userid: '00000000-0000-0000-0000-000000000000',
      prompt: params.prompt,
      content: params.content,
      call_source: params.callSource,
      raw_api_response: params.rawResponse,
      model: params.model,
      prompt_tokens: params.promptTokens,
      completion_tokens: params.completionTokens,
      total_tokens: params.promptTokens + params.completionTokens,
      reasoning_tokens: 0,
      finish_reason: params.finishReason,
      estimated_cost_usd: params.costUsd,
    });
  } catch {
    // Non-critical: don't fail generation on tracking errors
  }
}

// ─── LLM Call (multi-provider) ───────────────────────────────────

export async function callLLM(
  prompt: string,
  model: string,
  systemMessage: string = 'You are a helpful assistant.',
): Promise<LLMCallResult> {
  if (model.startsWith('claude-')) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY required for Claude models');
    const client = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 60000 });

    const message = await client.messages.create({
      model,
      max_tokens: 8192,
      system: systemMessage,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = message.content[0]?.type === 'text' ? message.content[0].text : '';
    return {
      content,
      promptTokens: message.usage.input_tokens,
      completionTokens: message.usage.output_tokens,
      model,
    };
  }

  // OpenAI / DeepSeek (OpenAI-compatible)
  const isDeepSeek = model.startsWith('deepseek-');
  const apiKey = isDeepSeek ? process.env.DEEPSEEK_API_KEY : process.env.OPENAI_API_KEY;
  const keyName = isDeepSeek ? 'DEEPSEEK_API_KEY' : 'OPENAI_API_KEY';
  if (!apiKey) throw new Error(`${keyName} required for model ${model}`);

  const client = new OpenAI({
    apiKey,
    ...(isDeepSeek ? { baseURL: 'https://api.deepseek.com' } : {}),
    maxRetries: 3,
    timeout: 60000,
  });

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: prompt },
    ],
  });

  return {
    content: response.choices[0]?.message?.content ?? '',
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
    model: response.model ?? model,
  };
}

// ─── Main Generation Function ─────────────────────────────────────

/** Generate a complete article (title + content) for a prompt using the specified model. */
export async function generateOneshotArticle(
  prompt: string,
  model: string,
  supabase: SupabaseClient | null,
): Promise<OneshotResult> {
  const callSource = `oneshot_${model}`;
  const startTime = Date.now();

  // Step 1: Generate title
  const titlePromptText = createTitlePrompt(prompt);
  const titleResult = await callLLM(
    titlePromptText,
    model,
    'You are a helpful assistant. Please provide your response in JSON format.',
  );

  let title: string;
  try {
    const parsed = titleQuerySchema.parse(JSON.parse(titleResult.content));
    title = parsed.title1;
  } catch {
    // Fallback: use the raw response as title if JSON parsing fails
    title = titleResult.content.replace(/["\n]/g, '').trim().slice(0, 200);
  }

  const titleCost = calculateLLMCost(
    titleResult.model, titleResult.promptTokens, titleResult.completionTokens, 0,
  );

  const isAnthropic = model.startsWith('claude-');
  await trackLLMCall(supabase, {
    prompt: titlePromptText,
    content: titleResult.content,
    callSource,
    model: titleResult.model,
    promptTokens: titleResult.promptTokens,
    completionTokens: titleResult.completionTokens,
    costUsd: titleCost,
    rawResponse: JSON.stringify({ provider: isAnthropic ? 'anthropic' : 'openai', model: titleResult.model }),
    finishReason: isAnthropic ? 'end_turn' : 'stop',
  });

  // Step 2: Generate article
  const explanationPrompt = createExplanationPrompt(title, []);
  const articleResult = await callLLM(explanationPrompt, model);

  const articleCost = calculateLLMCost(
    articleResult.model, articleResult.promptTokens, articleResult.completionTokens, 0,
  );

  await trackLLMCall(supabase, {
    prompt: explanationPrompt,
    content: articleResult.content,
    callSource,
    model: articleResult.model,
    promptTokens: articleResult.promptTokens,
    completionTokens: articleResult.completionTokens,
    costUsd: articleCost,
    rawResponse: JSON.stringify({ provider: isAnthropic ? 'anthropic' : 'openai', model: articleResult.model }),
    finishReason: isAnthropic ? 'end_turn' : 'stop',
  });

  const totalCost = titleCost + articleCost;
  const durationMs = Date.now() - startTime;

  return {
    title,
    content: `# ${title}\n\n${articleResult.content}`,
    model,
    totalCostUsd: totalCost,
    promptTokens: titleResult.promptTokens + articleResult.promptTokens,
    completionTokens: titleResult.completionTokens + articleResult.completionTokens,
    durationMs,
  };
}
