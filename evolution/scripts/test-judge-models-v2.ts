// Comprehensive judge model comparison: Qwen3 8B (on/off thinking), OSS 20B (default/low),
// Qwen 2.5 7B. Matches original research methodology: 10 calls × 4 temps × 2 pairs.
// Tracks output tokens including reasoning tokens for thinking models.
//
// Usage:
//   npx tsx evolution/scripts/test-judge-models-v2.ts
//   npx tsx evolution/scripts/test-judge-models-v2.ts --calls 5         # fewer calls
//   npx tsx evolution/scripts/test-judge-models-v2.ts --pair A-vs-B     # one pair only
//   npx tsx evolution/scripts/test-judge-models-v2.ts qwen3-on qwen3-off  # specific configs

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import OpenAI from 'openai';
import { buildComparisonPrompt, parseWinner, aggregateWinners } from '../src/lib/shared/computeRatings';
import { createClient } from '@supabase/supabase-js';

// ── Config ───────────────────────────────────────────────────────────

const TEMPERATURES = [0, 0.3, 0.7, 1.0];
const CALLS_PER_TEMP = 10;

const VARIANTS = {
  A: '4d3ced31-1872-431d-b9bd-abc709dd4784', // winner, mu=43.9
  B: '2f25e2b0-75ff-47f8-87eb-683a2c4c4122', // mu=18.66
  C: '39d3275f-c898-4cdd-9d4c-ccdea7f02360', // mu=18.75
  D: '2f25e2b0-75ff-47f8-87eb-683a2c4c4122', // mu=18.66
};

interface ModelConfig {
  id: string;           // short label for CLI and output
  apiModel: string;     // OpenRouter model path
  reasoning: Record<string, unknown> | undefined;
}

const ALL_CONFIGS: ModelConfig[] = [
  { id: 'qwen3-on',     apiModel: 'qwen/qwen3-8b',              reasoning: undefined },
  { id: 'qwen3-off',    apiModel: 'qwen/qwen3-8b',              reasoning: { effort: 'none' } },
  { id: 'oss20b-default', apiModel: 'openai/gpt-oss-20b',       reasoning: undefined },
  { id: 'oss20b-low',   apiModel: 'openai/gpt-oss-20b',         reasoning: { effort: 'low' } },
  { id: 'qwen25-7b',    apiModel: 'qwen/qwen-2.5-7b-instruct',  reasoning: undefined },
];

// ── OpenRouter client ────────────────────────────────────────────────

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set');
    client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      maxRetries: 3,
      timeout: 120_000,
    });
  }
  return client;
}

interface LLMCallResult {
  text: string;
  durationMs: number;
  completionTokens: number;
  reasoningTokens: number;
  promptTokens: number;
}

async function callModel(
  config: ModelConfig,
  prompt: string,
  temperature: number,
): Promise<LLMCallResult> {
  const c = getClient();
  const start = Date.now();

  const params: Record<string, unknown> = {
    model: config.apiModel,
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: prompt },
    ],
    stream: false,
    temperature,
  };
  if (config.reasoning) params.reasoning = config.reasoning;

  const resp = await c.chat.completions.create(params as OpenAI.Chat.ChatCompletionCreateParams);
  const durationMs = Date.now() - start;
  const text = resp.choices[0]?.message?.content?.trim() ?? '';

  const usage = resp.usage as Record<string, unknown> | undefined;
  const completionTokens = (usage?.completion_tokens as number) ?? 0;
  const promptTokens = (usage?.prompt_tokens as number) ?? 0;

  // Extract reasoning tokens — OpenRouter puts them in completion_tokens_details
  const details = usage?.completion_tokens_details as Record<string, unknown> | undefined;
  const reasoningTokens = (details?.reasoning_tokens as number) ??
    (usage?.reasoning_tokens as number) ?? 0;

  return { text, durationMs, completionTokens, reasoningTokens, promptTokens };
}

// ── Supabase ─────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

async function fetchVariant(id: string): Promise<string> {
  const db = getSupabase();
  const { data, error } = await db.from('evolution_variants').select('variant_content').eq('id', id).single();
  if (error || !data) throw new Error(`Failed to fetch variant ${id}: ${error?.message}`);
  return data.variant_content;
}

// ── Types ────────────────────────────────────────────────────────────

interface CallResult {
  configId: string;
  temperature: number;
  callIndex: number;
  forwardRaw: string;
  reverseRaw: string;
  forwardParsed: string | null;
  reverseParsed: string | null;
  winner: 'A' | 'B' | 'TIE';
  confidence: number;
  wallMs: number;
  fwdMs: number;
  revMs: number;
  fwdCompletionTokens: number;
  revCompletionTokens: number;
  fwdReasoningTokens: number;
  revReasoningTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
}

// ── Core comparison ──────────────────────────────────────────────────

async function runComparison(
  config: ModelConfig,
  textA: string,
  textB: string,
  temperature: number,
  callIndex: number,
): Promise<CallResult> {
  const fwdPrompt = buildComparisonPrompt(textA, textB);
  const revPrompt = buildComparisonPrompt(textB, textA);

  const start = Date.now();
  const [fwd, rev] = await Promise.all([
    callModel(config, fwdPrompt, temperature),
    callModel(config, revPrompt, temperature),
  ]);
  const wallMs = Date.now() - start;

  const fp = parseWinner(fwd.text);
  const rp = parseWinner(rev.text);
  const agg = aggregateWinners(fp, rp);

  return {
    configId: config.id,
    temperature,
    callIndex,
    forwardRaw: fwd.text.slice(0, 200),
    reverseRaw: rev.text.slice(0, 200),
    forwardParsed: fp,
    reverseParsed: rp,
    winner: agg.winner,
    confidence: agg.confidence,
    wallMs,
    fwdMs: fwd.durationMs,
    revMs: rev.durationMs,
    fwdCompletionTokens: fwd.completionTokens,
    revCompletionTokens: rev.completionTokens,
    fwdReasoningTokens: fwd.reasoningTokens,
    revReasoningTokens: rev.reasoningTokens,
    totalOutputTokens: fwd.completionTokens + rev.completionTokens,
    totalReasoningTokens: fwd.reasoningTokens + rev.reasoningTokens,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function mode<T>(arr: T[]): T {
  const counts = new Map<T, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = arr[0]!; let bc = 0;
  for (const [v, c] of counts) { if (c > bc) { best = v; bc = c; } }
  return best;
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Parse --pair
  let pairs = [
    { label: 'A-vs-B', firstId: VARIANTS.A, secondId: VARIANTS.B },
    { label: 'C-vs-D', firstId: VARIANTS.C, secondId: VARIANTS.D },
  ];
  const pairIdx = args.indexOf('--pair');
  if (pairIdx !== -1 && args[pairIdx + 1]) {
    const p = args[pairIdx + 1];
    if (p === 'A-vs-B') pairs = [pairs[0]!];
    else if (p === 'C-vs-D') pairs = [pairs[1]!];
    args.splice(pairIdx, 2);
  }

  // Parse --calls
  let callsPerTemp = CALLS_PER_TEMP;
  const cIdx = args.indexOf('--calls');
  if (cIdx !== -1 && args[cIdx + 1]) {
    callsPerTemp = parseInt(args[cIdx + 1], 10);
    args.splice(cIdx, 2);
  }

  // Filter configs by remaining args
  const configFilter = args.filter(a => !a.startsWith('-'));
  const configs = configFilter.length > 0
    ? ALL_CONFIGS.filter(c => configFilter.includes(c.id))
    : ALL_CONFIGS;

  if (configs.length === 0) {
    console.error(`No matching configs. Available: ${ALL_CONFIGS.map(c => c.id).join(', ')}`);
    process.exit(1);
  }

  const totalCalls = pairs.length * configs.length * TEMPERATURES.length * callsPerTemp * 2;
  console.log('=== Judge Model Comparison v2 ===');
  console.log(`Configs: ${configs.map(c => c.id).join(', ')}`);
  console.log(`Pairs: ${pairs.map(p => p.label).join(', ')}`);
  console.log(`Temperatures: ${TEMPERATURES.join(', ')}`);
  console.log(`Calls per temp: ${callsPerTemp}`);
  console.log(`Total LLM calls: ${totalCalls}`);

  // Fetch variants
  console.log('\nFetching variants...');
  const contents = new Map<string, string>();
  for (const pair of pairs) {
    for (const id of [pair.firstId, pair.secondId]) {
      if (!contents.has(id)) {
        contents.set(id, await fetchVariant(id));
        console.log(`  ${id}: ${contents.get(id)!.length} chars`);
      }
    }
  }

  // Results indexed by pair → config → temp
  interface GroupResult {
    pair: string;
    configId: string;
    temperature: number;
    results: CallResult[];
  }
  const groups: GroupResult[] = [];

  for (const pair of pairs) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`PAIR: ${pair.label}`);
    console.log(`${'='.repeat(70)}`);

    const textA = contents.get(pair.firstId)!;
    const textB = contents.get(pair.secondId)!;

    for (const config of configs) {
      console.log(`\n  MODEL: ${config.id} (${config.apiModel}${config.reasoning ? ', reasoning=' + JSON.stringify(config.reasoning) : ''})`);

      for (const temp of TEMPERATURES) {
        console.log(`\n    temp=${temp}:`);
        const results: CallResult[] = [];

        for (let i = 0; i < callsPerTemp; i++) {
          try {
            const r = await runComparison(config, textA, textB, temp, i);
            results.push(r);

            const fwd = r.forwardParsed ?? '?';
            const rev = r.reverseParsed ?? '?';
            const tkn = r.totalReasoningTokens > 0
              ? ` rTok=${r.totalReasoningTokens}`
              : '';
            const oTkn = ` oTok=${r.totalOutputTokens}`;
            console.log(
              `      [${String(i + 1).padStart(2)}/${callsPerTemp}] ` +
              `fwd=${fwd.padEnd(3)} rev=${rev.padEnd(3)} → ${r.winner.padEnd(3)} ` +
              `conf=${r.confidence.toFixed(1)} ` +
              `wall=${r.wallMs}ms` +
              oTkn + tkn
            );
          } catch (err) {
            console.log(
              `      [${String(i + 1).padStart(2)}/${callsPerTemp}] ` +
              `ERROR: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }

        groups.push({ pair: pair.label, configId: config.id, temperature: temp, results });
      }
    }
  }

  // ── Summary tables ─────────────────────────────────────────────────
  for (const pairLabel of pairs.map(p => p.label)) {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`SUMMARY: ${pairLabel}`);
    console.log(`${'='.repeat(100)}`);
    console.log(
      'Config           | Temp | Decisive   | Avg Conf | Med Wall | Med Fwd  | Avg oTok | Avg rTok'
    );
    console.log(
      '-----------------+------+------------+----------+----------+----------+----------+---------'
    );

    for (const config of configs) {
      for (const temp of TEMPERATURES) {
        const g = groups.find(g => g.pair === pairLabel && g.configId === config.id && g.temperature === temp);
        if (!g || g.results.length === 0) continue;

        const rs = g.results;
        const ws = rs.map(r => r.winner);
        const dec = ws.filter(w => w !== 'TIE').length;
        const avgConf = rs.map(r => r.confidence).reduce((a, b) => a + b, 0) / rs.length;
        const medWall = median(rs.map(r => r.wallMs));
        const medFwd = median(rs.map(r => r.fwdMs));
        const avgOTok = Math.round(rs.map(r => r.totalOutputTokens).reduce((a, b) => a + b, 0) / rs.length);
        const avgRTok = Math.round(rs.map(r => r.totalReasoningTokens).reduce((a, b) => a + b, 0) / rs.length);

        console.log(
          `${config.id.padEnd(16)} | ` +
          `${temp.toFixed(1).padStart(4)} | ` +
          `${String(dec).padStart(4)}/${String(rs.length).padStart(2)} (${(dec / rs.length * 100).toFixed(0).padStart(3)}%) | ` +
          `${avgConf.toFixed(2).padStart(8)} | ` +
          `${String(medWall).padStart(6)}ms | ` +
          `${String(medFwd).padStart(6)}ms | ` +
          `${String(avgOTok).padStart(8)} | ` +
          `${String(avgRTok).padStart(7)}`
        );
      }
      // separator between configs
      console.log(
        '-----------------+------+------------+----------+----------+----------+----------+---------'
      );
    }
  }

  // ── Save ───────────────────────────────────────────────────────────
  const outputPath = `evolution/scripts/judge-v2-results-${Date.now()}.json`;
  const fs = await import('fs');
  fs.writeFileSync(outputPath, JSON.stringify({
    configs: configs.map(c => ({ id: c.id, apiModel: c.apiModel, reasoning: c.reasoning })),
    pairs: pairs.map(p => p.label),
    temperatures: TEMPERATURES,
    callsPerTemp,
    groups,
  }, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
