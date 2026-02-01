// CLI script to generate a full article from a short topic prompt using any supported LLM model.
// Standalone from Next.js — uses direct SDK clients for OpenAI, DeepSeek, and Anthropic.

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { createTitlePrompt, createExplanationPrompt } from '../src/lib/prompts';
import { titleQuerySchema } from '../src/lib/schemas/schemas';
import { calculateLLMCost, getModelPricing, formatCost } from '../src/config/llmPricing';
import { addEntryToBank } from './lib/bankUtils';

// ─── Types ────────────────────────────────────────────────────────

interface CLIArgs {
  prompt: string;
  model: string;
  output: string;
  maxCost: number;
  bank: boolean;
}

interface LLMCallResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
}

// ─── CLI Argument Parsing ────────────────────────────────────────

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);

  function getValue(name: string): string | undefined {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  }

  function getFlag(name: string): boolean {
    return args.includes(`--${name}`);
  }

  if (getFlag('help') || args.length === 0) {
    console.log(`Usage: npx tsx scripts/generate-article.ts [options]

Options:
  --prompt <text>       Topic prompt (required)
  --model <name>        LLM model (default: gpt-4.1)
  --output <path>       Output markdown path (default: auto-generated)
  --max-cost <n>        Max cost cap in USD (default: 5.00)
  --bank                Add generated article to article bank
  --help                Show this help message`);
    process.exit(0);
  }

  const prompt = getValue('prompt');
  if (!prompt) {
    console.error('Error: --prompt is required');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
  const defaultOutput = `article_${slug}_${timestamp}.md`;

  return {
    prompt,
    model: getValue('model') ?? 'gpt-4.1',
    output: getValue('output') ?? defaultOutput,
    maxCost: parseFloat(getValue('max-cost') ?? '5.00'),
    bank: getFlag('bank'),
  };
}

// ─── Supabase Client ─────────────────────────────────────────────

function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ─── LLM Call Tracking ───────────────────────────────────────────

async function trackLLMCall(
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

// ─── Cost Estimation ─────────────────────────────────────────────

function estimateCost(promptText: string, model: string): number {
  const estimatedInputTokens = Math.ceil(promptText.length / 4);
  const estimatedOutputTokens = Math.ceil(estimatedInputTokens * 3); // articles are typically 3x the prompt
  const pricing = getModelPricing(model);
  return (
    (estimatedInputTokens / 1_000_000) * pricing.inputPer1M +
    (estimatedOutputTokens / 1_000_000) * pricing.outputPer1M
  );
}

// ─── LLM Call (multi-provider) ───────────────────────────────────

async function callLLM(
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

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const supabase = getSupabase();
  const callSource = `oneshot_${args.model}`;

  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│  Article Generator — 1-Shot CLI          │');
  console.log('└─────────────────────────────────────────┘\n');

  console.log(`  Prompt:    "${args.prompt}"`);
  console.log(`  Model:     ${args.model}`);
  console.log(`  Max cost:  ${formatCost(args.maxCost)}`);
  console.log(`  Output:    ${args.output}`);
  console.log(`  DB track:  ${supabase ? 'yes' : 'no'}`);
  console.log(`  Bank:      ${args.bank ? 'yes' : 'no'}\n`);

  // Step 1: Estimate cost and check cap
  const titlePromptText = createTitlePrompt(args.prompt);
  const explanationEstimate = estimateCost(args.prompt, args.model);
  const titleEstimate = estimateCost(titlePromptText, args.model);
  const totalEstimate = explanationEstimate + titleEstimate;

  console.log(`  Estimated cost: ${formatCost(totalEstimate)}`);

  if (totalEstimate > args.maxCost) {
    console.error(`\n  ✗ Estimated cost ${formatCost(totalEstimate)} exceeds cap ${formatCost(args.maxCost)}. Aborting.`);
    console.error(`    Use --max-cost to increase the cap.`);
    process.exit(1);
  }

  // Step 2: Generate title
  console.log('\n  Generating title...');
  const startTime = Date.now();

  const titleResult = await callLLM(
    titlePromptText,
    args.model,
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

  await trackLLMCall(supabase, {
    prompt: titlePromptText,
    content: titleResult.content,
    callSource,
    model: titleResult.model,
    promptTokens: titleResult.promptTokens,
    completionTokens: titleResult.completionTokens,
    costUsd: titleCost,
    rawResponse: JSON.stringify({ provider: args.model.startsWith('claude-') ? 'anthropic' : 'openai', model: titleResult.model }),
    finishReason: args.model.startsWith('claude-') ? 'end_turn' : 'stop',
  });

  console.log(`  Title: "${title}" (${formatCost(titleCost)})`);

  // Step 3: Check running cost against cap
  if (titleCost > args.maxCost) {
    console.error(`\n  ✗ Title generation cost ${formatCost(titleCost)} already exceeds cap. Aborting.`);
    process.exit(1);
  }

  // Step 4: Generate article
  console.log('  Generating article...');

  const explanationPrompt = createExplanationPrompt(title, []);
  const articleResult = await callLLM(explanationPrompt, args.model);

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
    rawResponse: JSON.stringify({ provider: args.model.startsWith('claude-') ? 'anthropic' : 'openai', model: articleResult.model }),
    finishReason: args.model.startsWith('claude-') ? 'end_turn' : 'stop',
  });

  const totalCost = titleCost + articleCost;
  const durationMs = Date.now() - startTime;

  // Step 5: Write output
  const articleContent = `# ${title}\n\n${articleResult.content}`;
  const outputPath = path.resolve(args.output);
  fs.writeFileSync(outputPath, articleContent, 'utf-8');

  // Step 6: Add to bank if requested
  let bankResult: { topic_id: string; entry_id: string } | null = null;
  if (args.bank && supabase) {
    console.log('  Adding to article bank...');
    bankResult = await addEntryToBank(supabase, {
      prompt: args.prompt,
      title,
      content: articleContent,
      generation_method: 'oneshot',
      model: args.model,
      total_cost_usd: totalCost,
      metadata: {
        model: args.model,
        generation_time_ms: durationMs,
        prompt_tokens: titleResult.promptTokens + articleResult.promptTokens,
        completion_tokens: titleResult.completionTokens + articleResult.completionTokens,
        call_source: callSource,
        prompt_templates: ['createTitlePrompt', 'createExplanationPrompt'],
        generation_started_at: new Date(startTime).toISOString(),
        generation_ended_at: new Date().toISOString(),
      },
    });
  } else if (args.bank && !supabase) {
    console.warn('  ⚠ --bank requires Supabase credentials. Skipping bank insertion.');
  }

  // Print summary
  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│  Generation Complete                     │');
  console.log('└─────────────────────────────────────────┘\n');
  console.log(`  Title:      "${title}"`);
  console.log(`  Words:      ${articleResult.content.split(/\s+/).length}`);
  console.log(`  Cost:       ${formatCost(totalCost)} (title: ${formatCost(titleCost)}, article: ${formatCost(articleCost)})`);
  console.log(`  Duration:   ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  Output:     ${outputPath}`);
  if (bankResult) {
    console.log(`  Bank topic: ${bankResult.topic_id}`);
    console.log(`  Bank entry: ${bankResult.entry_id}`);
  }
  console.log();
}

main().catch((error) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
