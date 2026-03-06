// CLI script to generate a full article from a short topic prompt using any supported LLM model.
// Delegates LLM calls to shared oneshotGenerator; handles CLI args, cost cap, file output, and Hall of Fame insertion.

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { createTitlePrompt } from '../src/lib/prompts';
import { getModelPricing, formatCost } from '../src/config/llmPricing';
import { addEntryToHallOfFame } from '../evolution/scripts/lib/hallOfFameUtils';
import { generateOneshotArticle, getSupabaseClient } from '../evolution/scripts/lib/oneshotGenerator';

// ─── Types ────────────────────────────────────────────────────────

interface CLIArgs {
  prompt: string;
  model: string;
  output: string;
  maxCost: number;
  bank: boolean;
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
  --bank                Add generated article to Hall of Fame
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

// ─── Cost Estimation ─────────────────────────────────────────────

function estimateCost(promptText: string, model: string): number {
  const estimatedInputTokens = Math.ceil(promptText.length / 4);
  const estimatedOutputTokens = Math.ceil(estimatedInputTokens * 3);
  const pricing = getModelPricing(model);
  return (
    (estimatedInputTokens / 1_000_000) * pricing.inputPer1M +
    (estimatedOutputTokens / 1_000_000) * pricing.outputPer1M
  );
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const supabase = getSupabaseClient();

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

  // Step 2: Generate title + article via shared function
  console.log('\n  Generating title + article...');

  const result = await generateOneshotArticle(args.prompt, args.model, supabase);

  if (result.totalCostUsd > args.maxCost) {
    console.error(`\n  ✗ Actual cost ${formatCost(result.totalCostUsd)} exceeds cap ${formatCost(args.maxCost)}. Aborting.`);
    process.exit(1);
  }

  console.log(`  Title: "${result.title}" (${formatCost(result.totalCostUsd)})`);

  // Step 3: Write output
  const outputPath = path.resolve(args.output);
  fs.writeFileSync(outputPath, result.content, 'utf-8');

  // Step 4: Add to bank if requested
  let bankResult: { topic_id: string; entry_id: string } | null = null;
  if (args.bank && supabase) {
    console.log('  Adding to Hall of Fame...');
    bankResult = await addEntryToHallOfFame(supabase, {
      prompt: args.prompt,
      title: result.title,
      content: result.content,
      generation_method: 'oneshot',
      model: args.model,
      total_cost_usd: result.totalCostUsd,
      metadata: {
        model: args.model,
        generation_time_ms: result.durationMs,
        prompt_tokens: result.promptTokens,
        completion_tokens: result.completionTokens,
        call_source: `oneshot_${args.model}`,
        prompt_templates: ['createTitlePrompt', 'createExplanationPrompt'],
        generation_started_at: new Date(Date.now() - result.durationMs).toISOString(),
        generation_ended_at: new Date().toISOString(),
      },
    });
  } else if (args.bank && !supabase) {
    console.warn('  ⚠ --bank requires Supabase credentials. Skipping bank insertion.');
  }

  // Print summary
  const wordCount = result.content.replace(/^# .+\n\n/, '').split(/\s+/).length;
  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│  Generation Complete                     │');
  console.log('└─────────────────────────────────────────┘\n');
  console.log(`  Title:      "${result.title}"`);
  console.log(`  Words:      ${wordCount}`);
  console.log(`  Cost:       ${formatCost(result.totalCostUsd)}`);
  console.log(`  Duration:   ${(result.durationMs / 1000).toFixed(1)}s`);
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
