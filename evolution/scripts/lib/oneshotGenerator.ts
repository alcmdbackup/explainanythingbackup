// Shared oneshot article generation logic extracted from generate-article.ts.
// Generates a title + article for a given prompt and model using direct LLM SDK calls.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { createTitlePrompt, createExplanationPrompt } from '../../../src/lib/prompts';
import { calculateLLMCost } from '../../../src/config/llmPricing';
import { generateTitle } from '../../src/lib/pipeline/seed-article';

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

export interface OutlineOneshotResult extends OneshotResult {
  outline: string;
  steps: Array<{ name: string; score: number; costUsd: number }>;
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
  let titleResult: LLMCallResult;
  const title = await generateTitle(prompt, async (titlePromptText) => {
    titleResult = await callLLM(
      titlePromptText,
      model,
      'You are a helpful assistant. Please provide your response in JSON format.',
    );
    return titleResult.content;
  });

  const titleCost = calculateLLMCost(
    titleResult!.model, titleResult!.promptTokens, titleResult!.completionTokens, 0,
  );

  const isAnthropic = model.startsWith('claude-');
  await trackLLMCall(supabase, {
    prompt: createTitlePrompt(prompt),
    content: titleResult!.content,
    callSource,
    model: titleResult!.model,
    promptTokens: titleResult!.promptTokens,
    completionTokens: titleResult!.completionTokens,
    costUsd: titleCost,
    rawResponse: JSON.stringify({ provider: isAnthropic ? 'anthropic' : 'openai', model: titleResult!.model }),
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
    promptTokens: titleResult!.promptTokens + articleResult.promptTokens,
    completionTokens: titleResult!.completionTokens + articleResult.completionTokens,
    durationMs,
  };
}

// ─── Outline Oneshot Generation ──────────────────────────────────

/** Generate an article via outline → expand → polish pipeline (no evolution). */
export async function generateOutlineOneshotArticle(
  prompt: string,
  model: string,
  supabase: SupabaseClient | null,
): Promise<OutlineOneshotResult> {
  const callSource = `oneshot_outline_${model}`;
  const startTime = Date.now();
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalCost = 0;
  const isAnthropic = model.startsWith('claude-');
  const finishReason = isAnthropic ? 'end_turn' : 'stop';
  const provider = isAnthropic ? 'anthropic' : 'openai';
  const steps: Array<{ name: string; score: number; costUsd: number }> = [];

  // Helper to make an LLM call and track it
  async function trackedCall(promptText: string, system?: string): Promise<LLMCallResult> {
    const result = await callLLM(promptText, model, system);
    const cost = calculateLLMCost(result.model, result.promptTokens, result.completionTokens, 0);
    totalPromptTokens += result.promptTokens;
    totalCompletionTokens += result.completionTokens;
    totalCost += cost;
    await trackLLMCall(supabase, {
      prompt: promptText,
      content: result.content,
      callSource,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      costUsd: cost,
      rawResponse: JSON.stringify({ provider, model: result.model }),
      finishReason,
    });
    return result;
  }

  // Step 1: Generate title
  const title = await generateTitle(prompt, async (titlePromptText) => {
    const titleResult = await trackedCall(
      titlePromptText,
      'You are a helpful assistant. Please provide your response in JSON format.',
    );
    return titleResult.content;
  });

  // Step 2: Outline
  const outlinePrompt = `You are a writing expert. Create a detailed section outline for an explanatory article about: ${title}

Each section should have a heading and 1-2 sentence summary of what it covers. Format as markdown headings (## Section Title) followed by the summary.

Output ONLY the outline, no additional commentary.`;
  const outlineResult = await trackedCall(outlinePrompt);
  const outlineCost = calculateLLMCost(outlineResult.model, outlineResult.promptTokens, outlineResult.completionTokens, 0);
  steps.push({ name: 'outline', score: 1, costUsd: outlineCost });

  // Step 3: Expand
  const expandPrompt = `You are a writing expert. Expand this outline into a full, detailed explanatory article.

## Outline
${outlineResult.content}

## Instructions
- Expand each section into rich, detailed prose with examples and explanations
- Maintain the section structure from the outline
- Write for an educated general audience
- Include concrete examples and analogies where helpful

Output ONLY the expanded article text, no additional commentary.`;
  const expandResult = await trackedCall(expandPrompt);
  const expandCost = calculateLLMCost(expandResult.model, expandResult.promptTokens, expandResult.completionTokens, 0);
  steps.push({ name: 'expand', score: 1, costUsd: expandCost });

  // Step 4: Polish
  const polishPrompt = `You are a writing expert. Polish and improve this explanatory article for readability and flow.

## Article
${expandResult.content}

## Instructions
- Improve transitions between sections
- Ensure consistent tone and style throughout
- Fix any awkward phrasing or redundancy
- Ensure the article flows naturally from introduction to conclusion

Output ONLY the polished article text, no additional commentary.`;
  const polishResult = await trackedCall(polishPrompt);
  const polishCost = calculateLLMCost(polishResult.model, polishResult.promptTokens, polishResult.completionTokens, 0);
  steps.push({ name: 'polish', score: 1, costUsd: polishCost });

  const durationMs = Date.now() - startTime;

  return {
    title,
    content: `# ${title}\n\n${polishResult.content}`,
    outline: outlineResult.content,
    steps,
    model,
    totalCostUsd: totalCost,
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens,
    durationMs,
  };
}
