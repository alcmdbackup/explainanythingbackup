// Tests gpt-oss-20b judge quality and latency with different reasoning effort levels.
// Uses OpenRouter's reasoning parameter. OSS 20B has mandatory reasoning — cannot be fully disabled.
//
// Usage:
//   npx tsx evolution/scripts/test-oss20b-thinking.ts
//   npx tsx evolution/scripts/test-oss20b-thinking.ts --calls 3
//   npx tsx evolution/scripts/test-oss20b-thinking.ts --pair A-vs-B

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import OpenAI from 'openai';
import { buildComparisonPrompt, parseWinner, aggregateWinners } from '../src/lib/shared/computeRatings';
import { createClient } from '@supabase/supabase-js';

// ── Config ───────────────────────────────────────────────────────────

const VARIANTS = {
  A: '4d3ced31-1872-431d-b9bd-abc709dd4784',
  B: '2f25e2b0-75ff-47f8-87eb-683a2c4c4122',
  C: '39d3275f-c898-4cdd-9d4c-ccdea7f02360',
  D: '2f25e2b0-75ff-47f8-87eb-683a2c4c4122',
};

interface ThinkingConfig {
  label: string;
  reasoning: Record<string, unknown> | undefined;
  temperature: number;
}

const THINKING_CONFIGS: ThinkingConfig[] = [
  { label: 'default (medium)',  reasoning: undefined,                temperature: 0 },
  { label: 'reasoning=low',    reasoning: { effort: 'low' },        temperature: 0 },
  { label: 'default temp=1',   reasoning: undefined,                temperature: 1.0 },
  { label: 'low temp=1',       reasoning: { effort: 'low' },        temperature: 1.0 },
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

async function callModel(prompt: string, temperature: number, reasoning: Record<string, unknown> | undefined): Promise<{ text: string; durationMs: number }> {
  const c = getClient();
  const start = Date.now();
  const params: Record<string, unknown> = {
    model: 'openai/gpt-oss-20b',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: prompt },
    ],
    stream: false,
    temperature,
  };
  if (reasoning) params.reasoning = reasoning;
  const resp = await c.chat.completions.create(params as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  return { text: resp.choices[0]?.message?.content?.trim() ?? '', durationMs: Date.now() - start };
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
  config: string;
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
}

// ── Core ─────────────────────────────────────────────────────────────

async function runComparison(textA: string, textB: string, temp: number, reasoning: Record<string, unknown> | undefined, configLabel: string, idx: number): Promise<CallResult> {
  const fwdPrompt = buildComparisonPrompt(textA, textB);
  const revPrompt = buildComparisonPrompt(textB, textA);
  const start = Date.now();
  const [fwd, rev] = await Promise.all([
    callModel(fwdPrompt, temp, reasoning),
    callModel(revPrompt, temp, reasoning),
  ]);
  const wallMs = Date.now() - start;
  const fp = parseWinner(fwd.text);
  const rp = parseWinner(rev.text);
  const agg = aggregateWinners(fp, rp);
  return {
    config: configLabel, temperature: temp, callIndex: idx,
    forwardRaw: fwd.text.slice(0, 200), reverseRaw: rev.text.slice(0, 200),
    forwardParsed: fp, reverseParsed: rp,
    winner: agg.winner, confidence: agg.confidence,
    wallMs, fwdMs: fwd.durationMs, revMs: rev.durationMs,
  };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  let pairs = [
    { label: 'A-vs-B (large gap)', firstId: VARIANTS.A, secondId: VARIANTS.B },
    { label: 'C-vs-D (close pair)', firstId: VARIANTS.C, secondId: VARIANTS.D },
  ];
  const pairIdx = args.indexOf('--pair');
  if (pairIdx !== -1 && args[pairIdx + 1]) {
    const p = args[pairIdx + 1];
    if (p === 'A-vs-B') pairs = [pairs[0]!];
    else if (p === 'C-vs-D') pairs = [pairs[1]!];
  }

  let callsPer = 5;
  const cIdx = args.indexOf('--calls');
  if (cIdx !== -1 && args[cIdx + 1]) callsPer = parseInt(args[cIdx + 1]!, 10);

  const total = pairs.length * THINKING_CONFIGS.length * callsPer * 2;
  console.log('=== gpt-oss-20b Thinking Mode Test ===');
  console.log(`Configs: ${THINKING_CONFIGS.map(c => c.label).join(', ')}`);
  console.log(`Pairs: ${pairs.map(p => p.label).join(', ')}`);
  console.log(`Calls per config: ${callsPer}`);
  console.log(`Total LLM calls: ${total}`);

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

  const groups: Array<{ pair: string; config: string; results: CallResult[] }> = [];

  for (const pair of pairs) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`PAIR: ${pair.label}`);
    const textA = contents.get(pair.firstId)!;
    const textB = contents.get(pair.secondId)!;

    for (const cfg of THINKING_CONFIGS) {
      console.log(`\n  --- ${cfg.label} (temp=${cfg.temperature}) ---`);
      const results: CallResult[] = [];
      for (let i = 0; i < callsPer; i++) {
        try {
          const r = await runComparison(textA, textB, cfg.temperature, cfg.reasoning, cfg.label, i);
          results.push(r);
          console.log(
            `    [${String(i+1).padStart(2)}/${callsPer}] ` +
            `fwd=${(r.forwardParsed ?? '?').padEnd(3)} rev=${(r.reverseParsed ?? '?').padEnd(3)} → ${r.winner.padEnd(3)} ` +
            `conf=${r.confidence.toFixed(1)} wall=${r.wallMs}ms (fwd=${r.fwdMs}ms rev=${r.revMs}ms)`
          );
        } catch (err) {
          console.log(`    [${String(i+1).padStart(2)}/${callsPer}] ERROR: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      groups.push({ pair: pair.label, config: cfg.label, results });
    }
  }

  // Summary
  console.log(`\n${'='.repeat(90)}`);
  console.log('SUMMARY');
  console.log(`${'='.repeat(90)}`);
  console.log('Config              | Pair              | Modal | Decisive | Avg Conf | Avg wall | P50 fwd');
  console.log('--------------------+-------------------+-------+----------+----------+----------+--------');
  for (const g of groups) {
    if (g.results.length === 0) continue;
    const ws = g.results.map(r => r.winner);
    const modal = mode(ws);
    const dec = ws.filter(w => w !== 'TIE').length;
    const avgC = g.results.map(r => r.confidence).reduce((a,b)=>a+b,0) / g.results.length;
    const avgW = Math.round(g.results.map(r => r.wallMs).reduce((a,b)=>a+b,0) / g.results.length);
    const fwds = g.results.map(r => r.fwdMs).sort((a,b)=>a-b);
    const p50f = fwds[Math.floor(fwds.length/2)]!;
    console.log(
      `${g.config.padEnd(19)} | ${g.pair.slice(0,17).padEnd(17)} | ${modal.padEnd(5)} | ` +
      `${String(dec).padStart(4)}/${String(g.results.length).padStart(2)}   | ${avgC.toFixed(2).padStart(8)} | ` +
      `${String(avgW).padStart(7)}ms | ${String(p50f).padStart(5)}ms`
    );
  }

  const outputPath = `evolution/scripts/oss20b-thinking-test-${Date.now()}.json`;
  const fs = await import('fs');
  fs.writeFileSync(outputPath, JSON.stringify({ groups }, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);
}

function mode<T extends string>(arr: T[]): T {
  const counts = new Map<T, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T = arr[0] as T;
  let bc = 0;
  for (const [v, c] of counts) { if (c > bc) { best = v; bc = c; } }
  return best;
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
