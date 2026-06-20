// Offline escalation-sequence explorer on the recorded n=150 large-gap panel (6 models/mode). Two parts:
//  (1) best THIRD model after [gemini-2.5-flash-lite -> gpt-4o-mini] — ranks candidates on the residual
//      ties (pairs where BOTH abstain), by correct breaks.
//  (2) ranks all 2-3 model first_decisive sequences by accuracy / lone-wrong / decisiveness / cost.
// No new LLM calls. Run: npx tsx evolution/scripts/sequence-explore.ts

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

const SETS = ['gate-article-lg150', 'gate-paragraph-lg150'];
const MODELS = ['google/gemini-2.5-flash-lite', 'gpt-4o-mini', 'deepseek-chat', 'deepseek-v4-flash', 'deepseek-v4-pro', 'google/gemini-2.5-flash'];
const short = (m: string): string => m.replace('google/', '');
const vv = (w: string | null): Verdict | null => (w === 'A' || w === 'B' || w === 'TIE' ? w : null);
const pct = (n: number | null): string => (n == null ? 'n/a' : `${(n * 100).toFixed(0)}%`);
const decisive = (c: RecordedCall | undefined): boolean => !!c && (c.winner === 'A' || c.winner === 'B') && c.confidence > 0.6;

async function pull(db: ReturnType<typeof createClient<Database>>): Promise<RecordedCall[]> {
  const { data: sets } = await db.from('judge_eval_test_sets').select('id, name').in('name', SETS);
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

function perms(models: string[], len: number): string[][] {
  const out: string[][] = [];
  const rec = (pre: string[], rest: string[]): void => {
    if (pre.length === len) { out.push([...pre]); return; }
    for (let i = 0; i < rest.length; i += 1) rec([...pre, rest[i]!], [...rest.slice(0, i), ...rest.slice(i + 1)]);
  };
  rec([], models);
  return out;
}

function thirdModel(mode: 'article' | 'paragraph', calls: RecordedCall[]): void {
  const byPair = new Map<string, Map<string, RecordedCall>>();
  for (const c of calls) {
    if (c.pairKind !== mode) continue;
    const k = c.pairLabel;
    if (!byPair.has(k)) byPair.set(k, new Map());
    byPair.get(k)!.set(c.model, c);
  }
  // residual ties: both gemini-lite AND gpt-4o-mini abstain
  const residual = [...byPair.values()].filter((m) => !decisive(m.get('google/gemini-2.5-flash-lite')) && !decisive(m.get('gpt-4o-mini')));
  console.log(`\n  [${mode}] after gemini-2.5-flash-lite -> gpt-4o-mini: ${residual.length} pairs STILL tied (both abstain). Best 3rd model:`);
  const cands = MODELS.filter((m) => m !== 'google/gemini-2.5-flash-lite' && m !== 'gpt-4o-mini');
  const rows = cands.map((m) => {
    let broken = 0, correct = 0, wrong = 0;
    for (const pm of residual) {
      const c = pm.get(m);
      if (!decisive(c)) continue;
      broken += 1;
      const anchor = pm.get('google/gemini-2.5-flash-lite')!;
      if (anchor.gapKind === 'large' && anchor.expectedWinner != null) { if (c!.winner === anchor.expectedWinner) correct += 1; else wrong += 1; }
    }
    return { m, broken, correct, wrong };
  }).sort((a, b) => (b.correct - b.wrong) - (a.correct - a.wrong));
  for (const r of rows) console.log(`    ${short(r.m).padEnd(26)} breaks ${r.broken}/${residual.length}  correct ${r.correct} / wrong ${r.wrong}  acc ${pct(r.correct + r.wrong ? r.correct / (r.correct + r.wrong) : null)}`);
}

function sequences(mode: 'article' | 'paragraph', calls: RecordedCall[]): void {
  const modeCalls = calls.filter((c) => c.pairKind === mode);
  const seqs = [...perms(MODELS, 2), ...perms(MODELS, 3)].map((chain) => ({ chain, m: analyzeChain(modeCalls, chain, firstDecisive, 3) }));
  // Safe + complementary: accuracy ≥85%, lone-wrong ≤12%, then rank by decisiveness, then cheaper.
  const safe = seqs.filter((s) => (s.m.accuracyLargeGap ?? 0) >= 0.85 && (s.m.loneDecisiveWrongRate ?? 1) <= 0.12)
    .sort((a, b) => b.m.decisiveRate - a.m.decisiveRate || a.m.costPerDecisive - b.m.costPerDecisive);
  console.log(`\n  [${mode}] top complementary 2-3 model sequences (acc ≥85%, lone-wrong ≤12%), by decisiveness then cost:`);
  for (const s of safe.slice(0, 8)) {
    console.log(`    dec ${pct(s.m.decisiveRate).padStart(4)}  acc ${pct(s.m.accuracyLargeGap).padStart(4)}  loneW ${pct(s.m.loneDecisiveWrongRate).padStart(4)}  $/dec ${s.m.costPerDecisive.toFixed(5)}  depth ${s.m.avgDepth.toFixed(2)}  [${s.chain.map(short).join(' -> ')}]`);
  }
  // cheapest safe option
  const cheapest = safe.slice().sort((a, b) => a.m.costPerDecisive - b.m.costPerDecisive)[0];
  if (cheapest) console.log(`    cheapest-safe: $/dec ${cheapest.m.costPerDecisive.toFixed(5)} dec ${pct(cheapest.m.decisiveRate)} acc ${pct(cheapest.m.accuracyLargeGap)} [${cheapest.chain.map(short).join(' -> ')}]`);
}

async function main(): Promise<void> {
  const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const calls = await pull(db);
  console.log(`pulled ${calls.length} recorded calls (n=150 panel)`);
  console.log('\n=== PART 1: best THIRD model after gemini-2.5-flash-lite -> gpt-4o-mini ===');
  thirdModel('article', calls); thirdModel('paragraph', calls);
  console.log('\n=== PART 2: complementary 2-3 model sequence ranking ===');
  sequences('article', calls); sequences('paragraph', calls);
}

main().catch((e) => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
