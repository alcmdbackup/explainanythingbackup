// Tests Qwen3 8B judge quality and latency with thinking mode ON vs OFF.
// Uses OpenRouter's reasoning parameter to control thinking mode.
//
// Usage:
//   npx tsx evolution/scripts/test-qwen3-thinking.ts              # both pairs
//   npx tsx evolution/scripts/test-qwen3-thinking.ts --pair A-vs-B
//   npx tsx evolution/scripts/test-qwen3-thinking.ts --pair C-vs-D
//   npx tsx evolution/scripts/test-qwen3-thinking.ts --calls 5     # fewer calls per config

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import OpenAI from 'openai';
import { buildComparisonPrompt, parseWinner, aggregateWinners } from '../src/lib/shared/computeRatings';
import { createClient } from '@supabase/supabase-js';

// ── Config ───────────────────────────────────────────────────────────

const CALLS_PER_CONFIG = 10;

// Variants from run 140f7bce (Federal Reserve articles) — same as original research
const VARIANTS = {
  A: '4d3ced31-1872-431d-b9bd-abc709dd4784', // winner, mu=43.9, grounding_enhance
  B: '2f25e2b0-75ff-47f8-87eb-683a2c4c4122', // mu=18.66, lexical_simplify
  C: '39d3275f-c898-4cdd-9d4c-ccdea7f02360', // mu=18.75, baseline
  D: '2f25e2b0-75ff-47f8-87eb-683a2c4c4122', // mu=18.66, lexical_simplify (same as B)
};

// Thinking mode configurations to test
interface ThinkingConfig {
  label: string;
  reasoning: Record<string, unknown> | undefined; // OpenRouter reasoning param
  temperature: number; // override temperature for this config
}

const THINKING_CONFIGS: ThinkingConfig[] = [
  { label: 'ON-temp0',   reasoning: undefined,              temperature: 0 },
  { label: 'OFF-temp0',  reasoning: { effort: 'none' },     temperature: 0 },
  { label: 'OFF-temp0.7', reasoning: { effort: 'none' },    temperature: 0.7 },
  { label: 'OFF-temp1.0', reasoning: { effort: 'none' },    temperature: 1.0 },
];

// ── OpenRouter client ────────────────────────────────────────────────

let openrouterClient: OpenAI | null = null;

function getOpenRouter(): OpenAI {
  if (!openrouterClient) {
    if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set');
    openrouterClient = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      maxRetries: 3,
      timeout: 120_000, // 2 min — thinking mode can be slow
    });
  }
  return openrouterClient;
}

// ── LLM call ─────────────────────────────────────────────────────────

async function callQwen3(
  prompt: string,
  temperature: number,
  reasoning: Record<string, unknown> | undefined,
): Promise<{ text: string; durationMs: number }> {
  const client = getOpenRouter();
  const start = Date.now();

  const requestParams: Record<string, unknown> = {
    model: 'qwen/qwen3-8b',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: prompt },
    ],
    stream: false,
    temperature,
  };

  // Add reasoning parameter if specified (OpenRouter-specific)
  if (reasoning) {
    requestParams.reasoning = reasoning;
  }

  const resp = await client.chat.completions.create(
    requestParams as OpenAI.Chat.ChatCompletionCreateParams,
  );

  const durationMs = Date.now() - start;
  const text = resp.choices[0]?.message?.content?.trim() ?? '';

  // Extract usage for logging
  const usage = resp.usage;
  const reasoningTokens = (usage as Record<string, unknown>)?.reasoning_tokens ??
    ((usage?.completion_tokens_details as Record<string, unknown>)?.reasoning_tokens) ?? 0;

  return { text, durationMs };
}

// ── Supabase ─────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars not set (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
  return createClient(url, key);
}

async function fetchVariantContent(id: string): Promise<string> {
  const db = getSupabase();
  const { data, error } = await db
    .from('evolution_variants')
    .select('variant_content')
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(`Failed to fetch variant ${id}: ${error?.message}`);
  return data.variant_content;
}

// ── Types ────────────────────────────────────────────────────────────

interface CallResult {
  thinkingConfig: string;
  temperature: number;
  callIndex: number;
  forwardRaw: string;
  reverseRaw: string;
  forwardParsed: string | null;
  reverseParsed: string | null;
  aggregatedWinner: 'A' | 'B' | 'TIE';
  confidence: number;
  durationMs: number;       // wall-clock for both parallel calls
  forwardDurationMs: number;
  reverseDurationMs: number;
}

// ── Core comparison ──────────────────────────────────────────────────

async function runSingleComparison(
  textA: string,
  textB: string,
  temperature: number,
  thinkingConfig: ThinkingConfig,
  callIndex: number,
): Promise<CallResult> {
  const forwardPrompt = buildComparisonPrompt(textA, textB);
  const reversePrompt = buildComparisonPrompt(textB, textA);

  const start = Date.now();

  const [forwardResult, reverseResult] = await Promise.all([
    callQwen3(forwardPrompt, temperature, thinkingConfig.reasoning),
    callQwen3(reversePrompt, temperature, thinkingConfig.reasoning),
  ]);

  const durationMs = Date.now() - start;
  const forwardParsed = parseWinner(forwardResult.text);
  const reverseParsed = parseWinner(reverseResult.text);
  const aggregated = aggregateWinners(forwardParsed, reverseParsed);

  return {
    thinkingConfig: thinkingConfig.label,
    temperature,
    callIndex,
    forwardRaw: forwardResult.text.slice(0, 200), // truncate for readability
    reverseRaw: reverseResult.text.slice(0, 200),
    forwardParsed,
    reverseParsed,
    aggregatedWinner: aggregated.winner,
    confidence: aggregated.confidence,
    durationMs,
    forwardDurationMs: forwardResult.durationMs,
    reverseDurationMs: reverseResult.durationMs,
  };
}

// ── Run one pair with one thinking config ────────────────────────────

async function runConfig(
  thinkingConfig: ThinkingConfig,
  textA: string,
  textB: string,
  callsPerConfig: number,
): Promise<CallResult[]> {
  console.log(`\n  --- ${thinkingConfig.label} (temp=${thinkingConfig.temperature}) ---`);
  const results: CallResult[] = [];

  const temp = thinkingConfig.temperature;

  for (let i = 0; i < callsPerConfig; i++) {
    try {
      const result = await runSingleComparison(textA, textB, temp, thinkingConfig, i);
      results.push(result);

      const fwd = result.forwardParsed ?? '?';
      const rev = result.reverseParsed ?? '?';
      console.log(
        `    [${String(i + 1).padStart(2)}/${callsPerConfig}] ` +
        `fwd=${fwd.padEnd(3)} rev=${rev.padEnd(3)} → ${result.aggregatedWinner.padEnd(3)} ` +
        `conf=${result.confidence.toFixed(1)} ` +
        `wall=${result.durationMs}ms ` +
        `(fwd=${result.forwardDurationMs}ms rev=${result.reverseDurationMs}ms)`
      );
    } catch (err) {
      console.log(
        `    [${String(i + 1).padStart(2)}/${callsPerConfig}] ` +
        `ERROR: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return results;
}

// ── Stats helpers ────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

function computeLatencyStats(durations: number[]) {
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    min: sorted[0]!,
    p50: percentile(sorted, 0.5),
    avg: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1]!,
  };
}

function mode<T>(arr: T[]): T {
  const counts = new Map<T, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T = arr[0]!;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return best;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Parse --pair flag
  let pairs: Array<{ label: string; firstId: string; secondId: string }> = [
    { label: 'A-vs-B (large gap, 25 mu)', firstId: VARIANTS.A, secondId: VARIANTS.B },
    { label: 'C-vs-D (close pair, 0.09 mu)', firstId: VARIANTS.C, secondId: VARIANTS.D },
  ];
  const pairIdx = args.indexOf('--pair');
  if (pairIdx !== -1 && args[pairIdx + 1]) {
    const pair = args[pairIdx + 1];
    if (pair === 'A-vs-B') pairs = [pairs[0]!];
    else if (pair === 'C-vs-D') pairs = [pairs[1]!];
    else { console.error(`Unknown pair: ${pair}. Use A-vs-B or C-vs-D`); process.exit(1); }
  }

  // Parse --calls flag
  let callsPerConfig = CALLS_PER_CONFIG;
  const callsIdx = args.indexOf('--calls');
  if (callsIdx !== -1 && args[callsIdx + 1]) {
    callsPerConfig = parseInt(args[callsIdx + 1], 10);
    if (isNaN(callsPerConfig) || callsPerConfig < 1) { console.error('--calls must be a positive integer'); process.exit(1); }
  }

  const totalLLMCalls = pairs.length * THINKING_CONFIGS.length * callsPerConfig * 2;
  console.log('=== Qwen3 8B Thinking Mode Test ===');
  console.log(`Model: qwen/qwen3-8b via OpenRouter`);
  console.log(`Pairs: ${pairs.map(p => p.label).join(', ')}`);
  console.log(`Thinking configs: ${THINKING_CONFIGS.map(c => c.label).join(', ')}`);
  console.log(`Calls per config: ${callsPerConfig}`);
  console.log(`Temperatures: ${THINKING_CONFIGS.map(c => c.temperature).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`);
  console.log(`Total LLM calls: ${totalLLMCalls}`);

  // Fetch variant content
  console.log('\nFetching variants from staging DB...');
  const variantContents = new Map<string, string>();
  for (const pair of pairs) {
    for (const id of [pair.firstId, pair.secondId]) {
      if (!variantContents.has(id)) {
        const content = await fetchVariantContent(id);
        variantContents.set(id, content);
        console.log(`  ${id}: ${content.length} chars`);
      }
    }
  }

  const allResults: CallResult[] = [];

  for (const pair of pairs) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`PAIR: ${pair.label}`);
    console.log(`${'='.repeat(60)}`);

    const textA = variantContents.get(pair.firstId)!;
    const textB = variantContents.get(pair.secondId)!;

    for (const config of THINKING_CONFIGS) {
      const results = await runConfig(config, textA, textB, callsPerConfig);
      allResults.push(...results);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(80)}`);
  console.log('SUMMARY');
  console.log(`${'='.repeat(80)}`);
  console.log('Config              | Pair              | Modal | Decisive | Avg Conf | Avg ms | P50 ms | P90 ms');
  console.log('--------------------+-------------------+-------+----------+----------+--------+--------+-------');

  for (const pair of pairs) {
    for (const config of THINKING_CONFIGS) {
      const results = allResults.filter(
        r => r.thinkingConfig === config.label &&
        // Match pair by checking if results came from this config run
        allResults.indexOf(r) >= 0 // all included
      ).filter(r => r.thinkingConfig === config.label);

      // Get results for this specific pair+config combo
      // We need to track which pair each result belongs to — use index ranges
      const pairResults = allResults.filter(r => r.thinkingConfig === config.label);

      // Simpler: slice from allResults based on ordering
    }
  }

  // Actually, let's restructure to track pair properly
  interface TaggedResult extends CallResult { pair: string; }
  const tagged: TaggedResult[] = [];
  let idx = 0;
  for (const pair of pairs) {
    for (const config of THINKING_CONFIGS) {
      const configResults = allResults.filter((_, i) => {
        // Results are in order: pair1-config1, pair1-config2, pair1-config3, pair2-config1...
        const expectedStart = idx;
        return false; // this approach is fragile
      });
    }
  }

  // Simpler: re-derive from allResults using config label + index math
  const resultsPerGroup = callsPerConfig;
  let groupIdx = 0;
  const groups: Array<{ pair: string; config: string; results: CallResult[] }> = [];
  for (const pair of pairs) {
    for (const config of THINKING_CONFIGS) {
      const start = groupIdx * resultsPerGroup;
      const groupResults = allResults.slice(start, start + resultsPerGroup);
      groups.push({ pair: pair.label, config: config.label, results: groupResults });
      groupIdx++;
    }
  }

  for (const group of groups) {
    if (group.results.length === 0) continue;
    const winners = group.results.map(r => r.aggregatedWinner);
    const modal = mode(winners);
    const decisive = winners.filter(w => w !== 'TIE').length;
    const avgConf = group.results.map(r => r.confidence).reduce((a, b) => a + b, 0) / group.results.length;
    const wallDurations = group.results.map(r => r.durationMs);
    const stats = computeLatencyStats(wallDurations);

    console.log(
      `${group.config.padEnd(19)} | ` +
      `${group.pair.slice(0, 17).padEnd(17)} | ` +
      `${modal.padEnd(5)} | ` +
      `${String(decisive).padStart(4)}/${group.results.length.toString().padStart(2)}   | ` +
      `${avgConf.toFixed(2).padStart(8)} | ` +
      `${String(stats.avg).padStart(6)} | ` +
      `${String(stats.p50).padStart(6)} | ` +
      `${String(stats.p90).padStart(5)}`
    );
  }

  // ── Latency comparison ─────────────────────────────────────────────
  console.log(`\n${'='.repeat(60)}`);
  console.log('LATENCY COMPARISON (per-call, forward pass only)');
  console.log(`${'='.repeat(60)}`);
  console.log('Config              | Min    | P50    | Avg    | P90    | Max');
  console.log('--------------------+--------+--------+--------+--------+------');

  for (const config of THINKING_CONFIGS) {
    const configResults = allResults.filter(r => r.thinkingConfig === config.label);
    if (configResults.length === 0) continue;
    const fwdDurations = configResults.map(r => r.forwardDurationMs);
    const stats = computeLatencyStats(fwdDurations);
    console.log(
      `${config.label.padEnd(19)} | ` +
      `${String(stats.min).padStart(5)}ms | ` +
      `${String(stats.p50).padStart(5)}ms | ` +
      `${String(stats.avg).padStart(5)}ms | ` +
      `${String(stats.p90).padStart(5)}ms | ` +
      `${String(stats.max).padStart(5)}ms`
    );
  }

  // ── Save results ───────────────────────────────────────────────────
  const outputPath = `evolution/scripts/qwen3-thinking-test-${Date.now()}.json`;
  const fs = await import('fs');
  fs.writeFileSync(outputPath, JSON.stringify({
    model: 'qwen/qwen3-8b',
    thinkingConfigs: THINKING_CONFIGS.map(c => c.label),
    pairs: pairs.map(p => p.label),
    callsPerConfig,
    temperature: 0,
    groups: groups.map(g => ({ pair: g.pair, config: g.config, results: g.results })),
  }, null, 2));
  console.log(`\nRaw results saved to: ${outputPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
