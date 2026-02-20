// CLI script to run pairwise comparisons across all Hall of Fame entries for a topic.
// Uses bias-mitigated 2-pass reversal and updates Elo ratings in the DB.

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { compareWithBiasMitigation, type ComparisonResult } from '../src/lib/comparison';

// ─── Types ──────────────────────────────────────────────────────

interface CLIArgs {
  topicId: string;
  judgeModel: string;
  rounds: number;
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
    console.log(`Usage: npx tsx scripts/run-hall-of-fame-comparison.ts [options]

Options:
  --topic-id <uuid>       Topic ID to compare (required)
  --judge-model <name>    Judge model (default: gpt-4.1-nano)
  --rounds <n>            Number of comparison rounds (default: 1)
  --help                  Show this help message`);
    process.exit(0);
  }

  const topicId = getValue('topic-id');
  if (!topicId) {
    console.error('Error: --topic-id is required');
    process.exit(1);
  }

  return {
    topicId,
    judgeModel: getValue('judge-model') ?? 'gpt-4.1-nano',
    rounds: parseInt(getValue('rounds') ?? '1', 10),
  };
}

// ─── LLM Call (for judging) ──────────────────────────────────────

async function callJudgeLLM(prompt: string, model: string): Promise<string> {
  if (model.startsWith('claude-')) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY required for Claude judge models');
    const client = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 60000 });
    const message = await client.messages.create({
      model,
      max_tokens: 64,
      messages: [{ role: 'user', content: prompt }],
    });
    return message.content[0]?.type === 'text' ? message.content[0].text : '';
  }

  const isDeepSeek = model.startsWith('deepseek-');
  const apiKey = isDeepSeek ? process.env.DEEPSEEK_API_KEY : process.env.OPENAI_API_KEY;
  const keyName = isDeepSeek ? 'DEEPSEEK_API_KEY' : 'OPENAI_API_KEY';
  if (!apiKey) throw new Error(`${keyName} required for judge model ${model}`);

  const client = new OpenAI({
    apiKey,
    ...(isDeepSeek ? { baseURL: 'https://api.deepseek.com' } : {}),
    maxRetries: 3,
    timeout: 60000,
  });

  const response = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 64,
  });

  return response.choices[0]?.message?.content ?? '';
}

// ─── Elo Math ────────────────────────────────────────────────────

const INITIAL_ELO = 1200;
const ELO_K = 32;

function computeEloUpdate(
  ratingA: number, ratingB: number, scoreA: number,
): [number, number] {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;
  return [
    Math.max(0, ratingA + ELO_K * (scoreA - expectedA)),
    Math.max(0, ratingB + ELO_K * (1 - scoreA - expectedB)),
  ];
}

function computeEloPerDollar(eloRating: number, cost: number | null): number | null {
  if (cost === null || cost === 0) return null;
  return (eloRating - INITIAL_ELO) / cost;
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│  Hall of Fame Comparison Runner           │');
  console.log('└─────────────────────────────────────────┘\n');

  // Fetch topic
  const { data: topic } = await supabase
    .from('hall_of_fame_topics')
    .select('id, prompt, title')
    .eq('id', args.topicId)
    .is('deleted_at', null)
    .single();

  if (!topic) {
    console.error(`Error: Topic not found: ${args.topicId}`);
    process.exit(1);
  }

  console.log(`  Topic:      "${topic.prompt}"`);
  console.log(`  Judge:      ${args.judgeModel}`);
  console.log(`  Rounds:     ${args.rounds}`);

  // Fetch entries
  const { data: entries } = await supabase
    .from('hall_of_fame_entries')
    .select('id, content, generation_method, model, total_cost_usd')
    .eq('topic_id', args.topicId)
    .is('deleted_at', null);

  if (!entries || entries.length < 2) {
    console.error(`Error: Need at least 2 entries (found ${entries?.length ?? 0})`);
    process.exit(1);
  }

  console.log(`  Entries:    ${entries.length}`);
  const totalPairs = (entries.length * (entries.length - 1)) / 2;
  console.log(`  Pairs:      ${totalPairs} × ${args.rounds} rounds = ${totalPairs * args.rounds} comparisons\n`);

  // Fetch current Elo
  const { data: eloRows } = await supabase
    .from('hall_of_fame_elo')
    .select('entry_id, elo_rating, match_count')
    .eq('topic_id', args.topicId);

  const eloMap = new Map<string, { rating: number; matchCount: number }>();
  for (const row of eloRows ?? []) {
    eloMap.set(row.entry_id, { rating: row.elo_rating, matchCount: row.match_count });
  }
  for (const entry of entries) {
    if (!eloMap.has(entry.id)) {
      eloMap.set(entry.id, { rating: INITIAL_ELO, matchCount: 0 });
    }
  }

  // Run comparisons
  const callLLM = async (prompt: string) => callJudgeLLM(prompt, args.judgeModel);
  const cache = new Map<string, ComparisonResult>();
  let totalComparisons = 0;

  for (let round = 0; round < args.rounds; round++) {
    if (args.rounds > 1) console.log(`  ── Round ${round + 1}/${args.rounds} ──`);

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];

        const result = await compareWithBiasMitigation(a.content, b.content, callLLM, cache);

        let winnerId: string | null = null;
        if (result.winner === 'A') winnerId = a.id;
        else if (result.winner === 'B') winnerId = b.id;

        // Insert comparison record
        await supabase.from('hall_of_fame_comparisons').insert({
          topic_id: args.topicId,
          entry_a_id: a.id,
          entry_b_id: b.id,
          winner_id: winnerId,
          confidence: result.confidence,
          judge_model: args.judgeModel,
        });

        // Update in-memory Elo
        const eloA = eloMap.get(a.id)!;
        const eloB = eloMap.get(b.id)!;

        let scoreA: number;
        if (result.winner === 'A') scoreA = 0.5 + 0.5 * result.confidence;
        else if (result.winner === 'B') scoreA = 0.5 - 0.5 * result.confidence;
        else scoreA = 0.5;

        const [newA, newB] = computeEloUpdate(eloA.rating, eloB.rating, scoreA);
        eloA.rating = newA;
        eloA.matchCount += 1;
        eloB.rating = newB;
        eloB.matchCount += 1;

        const label = result.winner === 'TIE' ? 'TIE' : result.winner;
        console.log(
          `  ${a.generation_method}(${a.model}) vs ${b.generation_method}(${b.model}): ` +
          `${label} (conf: ${result.confidence.toFixed(2)})`,
        );

        totalComparisons++;
      }
    }
  }

  // Persist Elo updates
  const costMap = new Map(entries.map((e) => [e.id, e.total_cost_usd]));
  for (const [entryId, elo] of eloMap) {
    const cost = costMap.get(entryId) ?? null;
    await supabase.from('hall_of_fame_elo').upsert({
      topic_id: args.topicId,
      entry_id: entryId,
      elo_rating: Math.round(elo.rating * 100) / 100,
      elo_per_dollar: computeEloPerDollar(elo.rating, cost),
      match_count: elo.matchCount,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'topic_id,entry_id' });
  }

  // Print leaderboard
  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│  Leaderboard                             │');
  console.log('└─────────────────────────────────────────┘\n');

  const sorted = entries
    .map((e) => ({ ...e, elo: eloMap.get(e.id)?.rating ?? INITIAL_ELO }))
    .sort((a, b) => b.elo - a.elo);

  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const epdValue = computeEloPerDollar(e.elo, e.total_cost_usd);
    const epd = epdValue !== null ? `${epdValue.toFixed(1)} elo/$` : 'N/A';
    console.log(
      `  ${i + 1}. ${e.generation_method}(${e.model}) — ` +
      `Elo: ${e.elo.toFixed(1)}, Cost: $${e.total_cost_usd?.toFixed(4) ?? '?'}, ${epd}`,
    );
  }

  console.log(`\n  Comparisons: ${totalComparisons}`);
  console.log();
}

main().catch((error) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
