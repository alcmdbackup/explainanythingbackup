// Comparison table (cost / decisiveness / accuracy) for the important PARAGRAPH escalation sequences,
// computed offline on the recorded n=150 large-gap panel. Run: npx tsx evolution/scripts/paragraph-table.ts

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
for (const c of ['.env.local', '.env']) {
  const p = path.resolve(process.cwd(), c);
  if (fs.existsSync(p)) dotenv.config({ path: p, override: true });
}
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { firstDecisive } from '@evolution/lib/shared/judgeEnsemble/aggregation';
import { analyzeChain, type RecordedCall } from '@evolution/lib/shared/judgeEnsemble/offlineReaggregate';
import type { Verdict } from '@evolution/lib/shared/judgeEnsemble/types';

const SET = 'gate-paragraph-lg150';
const vv = (w: string | null): Verdict | null => (w === 'A' || w === 'B' || w === 'TIE' ? w : null);

// label -> chain (gemini = gemini-2.5-flash-lite, the incumbent judge)
const SEQS: Array<{ label: string; chain: string[] }> = [
  { label: 'gemini-2.5-flash-lite (current judge)', chain: ['google/gemini-2.5-flash-lite'] },
  { label: 'gpt-4o-mini (alt single)', chain: ['gpt-4o-mini'] },
  { label: 'gemini → gpt-4o-mini', chain: ['google/gemini-2.5-flash-lite', 'gpt-4o-mini'] },
  { label: 'gpt-4o-mini → gemini', chain: ['gpt-4o-mini', 'google/gemini-2.5-flash-lite'] },
  { label: 'gemini → gpt-4o-mini → deepseek-v4-pro  (REC)', chain: ['google/gemini-2.5-flash-lite', 'gpt-4o-mini', 'deepseek-v4-pro'] },
  { label: 'gpt-4o-mini → gemini → deepseek-v4-pro  (max dec)', chain: ['gpt-4o-mini', 'google/gemini-2.5-flash-lite', 'deepseek-v4-pro'] },
  { label: 'gemini → gpt-4o-mini → deepseek-v4-flash (cheap 3rd)', chain: ['google/gemini-2.5-flash-lite', 'gpt-4o-mini', 'deepseek-v4-flash'] },
];

async function pull(db: ReturnType<typeof createClient<Database>>): Promise<RecordedCall[]> {
  const { data: sets } = await db.from('judge_eval_test_sets').select('id, name').eq('name', SET);
  const { data: runs } = await db.from('judge_eval_runs').select('id, judge_model').in('test_set_id', (sets ?? []).map((s) => s.id as string));
  const modelByRun = new Map((runs ?? []).map((r) => [r.id as string, r.judge_model as string]));
  const out: RecordedCall[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('judge_eval_calls')
      .select('eval_run_id, pair_label, pair_kind, winner, confidence, forward_winner, reverse_winner, expected_winner, gap_kind, cost_usd')
      .in('eval_run_id', [...modelByRun.keys()]).order('id', { ascending: true }).range(from, from + 999);
    const batch = (data ?? []) as Array<Record<string, unknown>>;
    for (const c of batch) out.push({
      testSet: '', model: modelByRun.get(c.eval_run_id as string) ?? '?', pairLabel: c.pair_label as string,
      pairKind: c.pair_kind as 'article' | 'paragraph', repeatIndex: 0, winner: vv(c.winner as string) ?? 'TIE',
      confidence: (c.confidence as number) ?? 0, forwardWinner: vv(c.forward_winner as string), reverseWinner: vv(c.reverse_winner as string),
      expectedWinner: vv(c.expected_winner as string), gapKind: (c.gap_kind as string) ?? null, costUsd: (c.cost_usd as number) ?? 0,
    });
    if (batch.length < 1000) break;
  }
  return out;
}

async function main(): Promise<void> {
  const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const calls = (await pull(db)).filter((c) => c.pairKind === 'paragraph');
  const pct = (n: number | null): string => (n == null ? 'n/a' : `${(n * 100).toFixed(0)}%`);
  console.log(`PARAGRAPH sequences — n=150 large-gap pairs\n`);
  console.log(`${'sequence'.padEnd(52)} ${'decisive'.padEnd(9)} ${'accuracy'.padEnd(9)} ${'lone-wrong'.padEnd(11)} ${'$/decisive'.padEnd(11)} models/match`);
  console.log('─'.repeat(108));
  for (const s of SEQS) {
    const m = analyzeChain(calls, s.chain, firstDecisive, 3);
    console.log(`${s.label.padEnd(52)} ${pct(m.decisiveRate).padEnd(9)} ${pct(m.accuracyLargeGap).padEnd(9)} ${pct(m.loneDecisiveWrongRate).padEnd(11)} ${('$' + m.costPerDecisive.toFixed(5)).padEnd(11)} ${m.avgDepth.toFixed(2)}`);
  }
  console.log(`\n(decisive = share of pairs resolved; accuracy = of decisive large-gap pairs, share correct;`);
  console.log(` lone-wrong = of large-gap pairs resolved by ONE judge, share wrong; $/decisive = cost per decisive match;`);
  console.log(` models/match = avg judges actually called, i.e. cost scales — first_decisive stops early.)`);
}

main().catch((e) => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
