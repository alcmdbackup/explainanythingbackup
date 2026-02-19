// Batch comparison script for the Hall of Fame prompt bank — runs pairwise comparisons for all
// topics with multiple rounds. Reuses existing comparison logic.

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { PROMPT_BANK } from '../src/config/promptBankConfig';
import { compareWithBiasMitigation, type ComparisonResult } from '../src/lib/comparison';

// ─── Types ────────────────────────────────────────────────────────

interface CLIArgs {
  judgeModel: string;
  rounds: number;
  prompts: string[];
  minEntries: number;
}

// ─── CLI Argument Parsing ────────────────────────────────────────

export function parseArgs(argv: string[] = process.argv.slice(2)): CLIArgs {
  function getValue(name: string): string | undefined {
    const idx = argv.indexOf(`--${name}`);
    return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
  }

  function getFlag(name: string): boolean {
    return argv.includes(`--${name}`);
  }

  if (getFlag('help')) {
    console.log(`Usage: npx tsx scripts/run-prompt-bank-comparisons.ts [options]

Options:
  --judge-model <name>   Judge model (default: gpt-4.1-nano)
  --rounds <n>           Comparison rounds per topic (default: 3)
  --prompts <list>       Filter prompts by index or difficulty tier
  --min-entries <n>      Skip topics with fewer than N entries (default: 2)
  --help                 Show help`);
    process.exit(0);
  }

  return {
    judgeModel: getValue('judge-model') ?? 'gpt-4.1-nano',
    rounds: parseInt(getValue('rounds') ?? '3', 10),
    prompts: getValue('prompts')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [],
    minEntries: parseInt(getValue('min-entries') ?? '2', 10),
  };
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

// ─── LLM Call ────────────────────────────────────────────────────

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

// ─── Prompt Filtering ────────────────────────────────────────────

function filterPrompts(filter: string[]) {
  if (filter.length === 0) return PROMPT_BANK.prompts;
  const difficulties = ['easy', 'medium', 'hard'];
  return PROMPT_BANK.prompts.filter((p, idx) => {
    return filter.some((f) => {
      if (difficulties.includes(f)) return p.difficulty === f;
      const num = parseInt(f, 10);
      if (!isNaN(num)) return idx === num;
      return false;
    });
  });
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
  console.log('│  Prompt Bank — Batch Comparisons         │');
  console.log('└─────────────────────────────────────────┘\n');

  const prompts = filterPrompts(args.prompts);
  console.log(`  Prompts:     ${prompts.length}`);
  console.log(`  Judge:       ${args.judgeModel}`);
  console.log(`  Rounds:      ${args.rounds}`);
  console.log(`  Min entries: ${args.minEntries}\n`);

  // Match prompts to topics
  const topicMatches: Array<{
    prompt: string;
    difficulty: string;
    topicId: string;
    entryCount: number;
  }> = [];

  for (const p of prompts) {
    const { data: topic } = await supabase
      .from('hall_of_fame_topics')
      .select('id')
      .ilike('prompt', p.prompt.trim().toLowerCase())
      .is('deleted_at', null)
      .single();

    if (!topic) {
      console.log(`  ⚠ Topic not found for "${p.prompt}" — skipping`);
      continue;
    }

    const { count } = await supabase
      .from('hall_of_fame_entries')
      .select('id', { count: 'exact', head: true })
      .eq('topic_id', topic.id)
      .is('deleted_at', null);

    if ((count ?? 0) < args.minEntries) {
      console.log(`  ⚠ "${p.prompt}" has ${count ?? 0} entries (< ${args.minEntries}) — skipping`);
      continue;
    }

    topicMatches.push({
      prompt: p.prompt,
      difficulty: p.difficulty,
      topicId: topic.id,
      entryCount: count ?? 0,
    });
  }

  if (topicMatches.length === 0) {
    console.log('  No topics with enough entries for comparison.\n');
    return;
  }

  console.log(`\n  Topics to compare: ${topicMatches.length}\n`);

  // Run comparisons per topic
  let totalComparisons = 0;
  const methodStats = new Map<string, { elos: number[]; wins: number }>();

  for (let t = 0; t < topicMatches.length; t++) {
    const tm = topicMatches[t];
    console.log(`  ── Topic ${t + 1}/${topicMatches.length}: "${tm.prompt}" (${tm.entryCount} entries) ──`);

    // Fetch entries
    const { data: entries } = await supabase
      .from('hall_of_fame_entries')
      .select('id, content, generation_method, model, total_cost_usd, metadata')
      .eq('topic_id', tm.topicId)
      .is('deleted_at', null);

    if (!entries || entries.length < 2) continue;

    // Fetch current Elo
    const { data: eloRows } = await supabase
      .from('hall_of_fame_elo')
      .select('entry_id, elo_rating, match_count')
      .eq('topic_id', tm.topicId);

    const eloMap = new Map<string, { rating: number; matchCount: number }>();
    for (const row of eloRows ?? []) {
      eloMap.set(row.entry_id, { rating: row.elo_rating, matchCount: row.match_count });
    }
    for (const entry of entries) {
      if (!eloMap.has(entry.id)) {
        eloMap.set(entry.id, { rating: INITIAL_ELO, matchCount: 0 });
      }
    }

    // Run all-pairs comparisons
    const callLLM = async (prompt: string) => callJudgeLLM(prompt, args.judgeModel);
    const cache = new Map<string, ComparisonResult>();

    for (let round = 0; round < args.rounds; round++) {
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = entries[i];
          const b = entries[j];

          const result = await compareWithBiasMitigation(a.content, b.content, callLLM, cache);

          let winnerId: string | null = null;
          if (result.winner === 'A') winnerId = a.id;
          else if (result.winner === 'B') winnerId = b.id;

          await supabase.from('hall_of_fame_comparisons').insert({
            topic_id: tm.topicId,
            entry_a_id: a.id,
            entry_b_id: b.id,
            winner_id: winnerId,
            confidence: result.confidence,
            judge_model: args.judgeModel,
          });

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

          totalComparisons++;
        }
      }
    }

    // Persist Elo updates
    const costMap = new Map(entries.map((e) => [e.id, e.total_cost_usd]));
    for (const [entryId, elo] of eloMap) {
      const cost = costMap.get(entryId) ?? null;
      await supabase.from('hall_of_fame_elo').upsert({
        topic_id: tm.topicId,
        entry_id: entryId,
        elo_rating: Math.round(elo.rating * 100) / 100,
        elo_per_dollar: computeEloPerDollar(elo.rating, cost),
        match_count: elo.matchCount,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'topic_id,entry_id' });
    }

    // Find winner for this topic
    const bestEntry = entries.reduce((best, e) => {
      const elo = eloMap.get(e.id)?.rating ?? 0;
      const bestElo = eloMap.get(best.id)?.rating ?? 0;
      return elo > bestElo ? e : best;
    }, entries[0]);

    const bestLabel = getEntryLabel(bestEntry);
    console.log(`    Winner: ${bestLabel} (Elo: ${eloMap.get(bestEntry.id)!.rating.toFixed(0)})`);

    // Track per-method stats
    for (const entry of entries) {
      const label = getEntryLabel(entry);
      if (!methodStats.has(label)) {
        methodStats.set(label, { elos: [], wins: 0 });
      }
      const stats = methodStats.get(label)!;
      stats.elos.push(eloMap.get(entry.id)!.rating);
      if (entry.id === bestEntry.id) stats.wins++;
    }
  }

  // Print aggregate summary
  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│  Aggregate Summary                       │');
  console.log('└─────────────────────────────────────────┘\n');

  console.log(`  Total comparisons: ${totalComparisons}\n`);

  const sortedMethods = [...methodStats.entries()]
    .map(([label, stats]) => ({
      label,
      avgElo: stats.elos.reduce((a, b) => a + b, 0) / stats.elos.length,
      wins: stats.wins,
      winRate: stats.wins / topicMatches.length,
      count: stats.elos.length,
    }))
    .sort((a, b) => b.avgElo - a.avgElo);

  console.log('  Method'.padEnd(35) + 'Avg Elo'.padEnd(12) + 'Win Rate'.padEnd(12) + 'Topics');
  console.log('  ' + '─'.repeat(65));

  for (const m of sortedMethods) {
    console.log(
      `  ${m.label.padEnd(33)} ${m.avgElo.toFixed(0).padEnd(12)} ${(m.winRate * 100).toFixed(0).padStart(3)}%`.padEnd(47) +
      `        ${m.count}`,
    );
  }
  console.log();
}

function getEntryLabel(entry: { generation_method: string; model: string; metadata: unknown }): string {
  const meta = entry.metadata as Record<string, unknown> | null;
  if (entry.generation_method === 'evolution_winner' && meta?.iterations) {
    return `evolution_${entry.model}_${meta.iterations}iter`;
  }
  return `${entry.generation_method}_${entry.model}`;
}

main().catch((error) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
