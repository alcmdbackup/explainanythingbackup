// Pulls the recorded single-judge verdicts for the large-gap gate test sets, replays them through the
// offline escalation simulator, and prints the properly-powered (n=60) acceptance-gate table.
// Run: npx tsx evolution/scripts/gate-live-report.ts

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

const SETS = ['gate-article-lg60', 'gate-paragraph-lg60'];
const CHAINS: Record<string, string[]> = {
  article: ['gpt-4o-mini', 'deepseek-chat'],
  paragraph: ['google/gemini-2.5-flash-lite', 'deepseek-v4-flash', 'google/gemini-2.5-flash'],
};

const v = (w: string | null): Verdict | null => (w === 'A' || w === 'B' || w === 'TIE' ? w : null);
const pct = (n: number | null): string => (n == null ? 'n/a' : `${(n * 100).toFixed(1)}%`);

async function pull(db: ReturnType<typeof createClient<Database>>): Promise<RecordedCall[]> {
  const { data: sets } = await db.from('judge_eval_test_sets').select('id, name').in('name', SETS);
  const setIds = (sets ?? []).map((s) => s.id as string);
  const { data: runs } = await db.from('judge_eval_runs').select('id, judge_model').in('test_set_id', setIds);
  const modelByRun = new Map((runs ?? []).map((r) => [r.id as string, r.judge_model as string]));
  const runIds = [...modelByRun.keys()];

  const out: RecordedCall[] = [];
  const pageSize = 1000;
  for (let i = 0; i < runIds.length; i += 50) {
    const batch = runIds.slice(i, i + 50);
    const { data: calls } = await db
      .from('judge_eval_calls')
      .select('eval_run_id, pair_label, pair_kind, repeat_index, winner, confidence, forward_winner, reverse_winner, expected_winner, gap_kind, cost_usd')
      .in('eval_run_id', batch)
      .limit(pageSize * 5);
    for (const c of (calls ?? []) as Array<Record<string, unknown>>) {
      out.push({
        testSet: '', model: modelByRun.get(c.eval_run_id as string) ?? '?',
        pairLabel: c.pair_label as string, pairKind: c.pair_kind as 'article' | 'paragraph',
        repeatIndex: (c.repeat_index as number) ?? 0,
        winner: (v(c.winner as string) ?? 'TIE'), confidence: (c.confidence as number) ?? 0,
        forwardWinner: v(c.forward_winner as string), reverseWinner: v(c.reverse_winner as string),
        expectedWinner: v(c.expected_winner as string), gapKind: (c.gap_kind as string) ?? null,
        costUsd: (c.cost_usd as number) ?? 0,
      });
    }
  }
  return out;
}

function gate(mode: 'article' | 'paragraph', calls: RecordedCall[]): void {
  const modeCalls = calls.filter((c) => c.pairKind === mode);
  const models = [...new Set(modeCalls.map((c) => c.model))];
  const chain = CHAINS[mode]!;
  console.log(`\n══════ ${mode.toUpperCase()} — n=${new Set(modeCalls.map((c) => c.pairLabel)).size} large-gap pairs (${modeCalls.length} calls) ══════`);

  const singles = models.map((m) => ({ m, met: analyzeChain(modeCalls, [m], firstDecisive) }));
  singles.sort((a, b) => b.met.decisiveRate - a.met.decisiveRate);
  for (const s of singles) {
    console.log(`  single ${s.m.padEnd(34)} dec ${pct(s.met.decisiveRate)}  acc ${pct(s.met.accuracyLargeGap)}  loneWrong ${pct(s.met.loneDecisiveWrongRate)}  $/dec ${s.met.costPerDecisive.toFixed(5)}  nLG ${s.met.nLargeGap}`);
  }
  const cm = analyzeChain(modeCalls, chain, firstDecisive);
  console.log(`  CHAIN  [${chain.join(' -> ')}]`);
  console.log(`         dec ${pct(cm.decisiveRate)}  acc ${pct(cm.accuracyLargeGap)}  loneWrong ${pct(cm.loneDecisiveWrongRate)}  $/dec ${cm.costPerDecisive.toFixed(5)}  depth ${cm.avgDepth.toFixed(2)}  nLG ${cm.nLargeGap}`);

  const cheap = singles.filter((s) => chain.includes(s.m));
  const bestCheap = cheap.length ? Math.max(...cheap.map((s) => s.met.decisiveRate)) : 0;
  const accS = singles.filter((s) => s.met.accuracyLargeGap != null);
  const strong = accS.slice().sort((a, b) => (b.met.accuracyLargeGap! - a.met.accuracyLargeGap!) || b.met.decisiveRate - a.met.decisiveRate)[0];
  const mark = (b: boolean | null): string => (b == null ? '⊘' : b ? '✓ PASS' : '✗ FAIL');
  console.log(`  GATE (strong=${strong?.m ?? 'n/a'}, n_large=${cm.nLargeGap}):`);
  console.log(`    uplift ≥0.10      ${mark(cm.decisiveRate >= bestCheap + 0.1)}  chain ${pct(cm.decisiveRate)} vs best-cheap ${pct(bestCheap)}`);
  console.log(`    accuracy guard    ${mark(strong && cm.accuracyLargeGap != null ? cm.accuracyLargeGap >= strong.met.accuracyLargeGap! - 0.03 : null)}  chain ${pct(cm.accuracyLargeGap)} vs strong ${pct(strong?.met.accuracyLargeGap ?? null)}`);
  console.log(`    lone-wrong ≤0.10   ${mark(cm.loneDecisiveWrongRate != null ? cm.loneDecisiveWrongRate <= 0.1 : null)}  chain ${pct(cm.loneDecisiveWrongRate)}`);
  console.log(`    cost ≤ strong      ${mark(strong ? cm.costPerDecisive <= strong.met.costPerDecisive : null)}  chain $${cm.costPerDecisive.toFixed(5)} vs strong $${strong?.met.costPerDecisive.toFixed(5) ?? 'n/a'}`);
}

async function main(): Promise<void> {
  const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const calls = await pull(db);
  console.log(`pulled ${calls.length} recorded calls`);
  gate('article', calls);
  gate('paragraph', calls);
}

main().catch((e) => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
