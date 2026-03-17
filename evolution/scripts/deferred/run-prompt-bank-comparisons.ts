// Batch comparison script for the Arena prompt bank — runs pairwise comparisons for all
// topics with multiple rounds. Uses OpenSkill ratings for ranking. Reuses existing comparison logic.

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { PROMPT_BANK } from '../src/config/promptBankConfig';
import { compareWithBiasMitigation, type ComparisonResult } from '../src/lib/comparison';
import { createRating, updateRating, updateDraw, toEloScale, computeEloPerDollar, DECISIVE_CONFIDENCE_THRESHOLD, type Rating } from '../src/lib/core/rating';

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
      .from('evolution_arena_topics')
      .select('id')
      .ilike('prompt', p.prompt.trim().toLowerCase())
      .is('deleted_at', null)
      .single();

    if (!topic) {
      console.log(`  ⚠ Topic not found for "${p.prompt}" — skipping`);
      continue;
    }

    const { count } = await supabase
      .from('evolution_arena_entries')
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
      .from('evolution_arena_entries')
      .select('id, content, generation_method, model, total_cost_usd, metadata')
      .eq('topic_id', tm.topicId)
      .is('deleted_at', null);

    if (!entries || entries.length < 2) continue;

    // Fetch current ratings
    const { data: eloRows } = await supabase
      .from('evolution_arena_elo')
      .select('entry_id, mu, sigma, match_count')
      .eq('topic_id', tm.topicId);

    const ratingMap = new Map<string, { rating: Rating; matchCount: number }>();
    for (const row of eloRows ?? []) {
      ratingMap.set(row.entry_id, { rating: { mu: row.mu, sigma: row.sigma }, matchCount: row.match_count });
    }
    for (const entry of entries) {
      if (!ratingMap.has(entry.id)) {
        ratingMap.set(entry.id, { rating: createRating(), matchCount: 0 });
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

          await supabase.from('evolution_arena_comparisons').insert({
            topic_id: tm.topicId,
            entry_a_id: a.id,
            entry_b_id: b.id,
            winner_id: winnerId,
            confidence: result.confidence,
            judge_model: args.judgeModel,
          });

          const stateA = ratingMap.get(a.id)!;
          const stateB = ratingMap.get(b.id)!;

          let newA: Rating;
          let newB: Rating;
          if (result.winner === 'TIE' || result.confidence < DECISIVE_CONFIDENCE_THRESHOLD) {
            [newA, newB] = updateDraw(stateA.rating, stateB.rating);
          } else if (result.winner === 'A') {
            [newA, newB] = updateRating(stateA.rating, stateB.rating);
          } else {
            [newB, newA] = updateRating(stateB.rating, stateA.rating);
          }

          stateA.rating = newA;
          stateA.matchCount += 1;
          stateB.rating = newB;
          stateB.matchCount += 1;

          totalComparisons++;
        }
      }
    }

    // Persist updated ratings
    const costMap = new Map(entries.map((e) => [e.id, e.total_cost_usd]));
    for (const [entryId, state] of ratingMap) {
      const cost = costMap.get(entryId) ?? null;
      await supabase.from('evolution_arena_elo').upsert({
        topic_id: tm.topicId,
        entry_id: entryId,
        mu: state.rating.mu,
        sigma: state.rating.sigma,
        ordinal: 0,  // dummy for deploy-safety until migration drops the column
        elo_rating: toEloScale(state.rating.mu),
        elo_per_dollar: computeEloPerDollar(state.rating.mu, cost),
        match_count: state.matchCount,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'topic_id,entry_id' });
    }

    // Find winner for this topic
    const bestEntry = entries.reduce((best, e) => {
      const rE = ratingMap.get(e.id);
      const rBest = ratingMap.get(best.id);
      const muE = rE ? rE.rating.mu : 0;
      const muBest = rBest ? rBest.rating.mu : 0;
      return muE > muBest ? e : best;
    }, entries[0]);

    const bestLabel = getEntryLabel(bestEntry);
    const bestRating = ratingMap.get(bestEntry.id);
    console.log(`    Winner: ${bestLabel} (Rating: ${bestRating ? toEloScale(bestRating.rating.mu).toFixed(0) : 'N/A'})`);

    // Track per-method stats
    for (const entry of entries) {
      const label = getEntryLabel(entry);
      if (!methodStats.has(label)) {
        methodStats.set(label, { elos: [], wins: 0 });
      }
      const stats = methodStats.get(label)!;
      const r = ratingMap.get(entry.id);
      stats.elos.push(r ? toEloScale(r.rating.mu) : 1200);
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
