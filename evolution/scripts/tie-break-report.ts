// Tie-breaking partner ranking for the incumbent judge gemini-2.5-flash-lite. On large-gap pairs where
// the LEAD is indecisive (today = draws, no Elo signal), ranks each candidate escalation partner by how
// many of those ties it breaks (relative) AND what share of ALL pairs that recovers (absolute), plus
// break-accuracy + good:bad. first_decisive only fires on the lead's ties, so this is additive-only.
// Run: npx tsx evolution/scripts/tie-break-report.ts

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
for (const c of ['.env.local', '.env']) {
  const p = path.resolve(process.cwd(), c);
  if (fs.existsSync(p)) dotenv.config({ path: p, override: true });
}
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

const SETS = ['gate-article-lg150', 'gate-paragraph-lg150'];
const LEAD = 'google/gemini-2.5-flash-lite';
const PARTNERS = ['gpt-4o-mini', 'deepseek-chat', 'deepseek-v4-flash', 'deepseek-v4-pro', 'google/gemini-2.5-flash'];

interface V { winner: string | null; confidence: number; expected: string | null; gap: string | null }
const decisive = (v: V | undefined): boolean => !!v && (v.winner === 'A' || v.winner === 'B') && v.confidence > 0.6;
const pc = (n: number, d: number): string => (d === 0 ? '  n/a' : `${((n / d) * 100).toFixed(1)}%`);

async function pull(db: ReturnType<typeof createClient<Database>>): Promise<Map<string, Map<string, V>>> {
  const { data: sets } = await db.from('judge_eval_test_sets').select('id, name').in('name', SETS);
  const setIds = (sets ?? []).map((s) => s.id as string);
  const { data: runs } = await db.from('judge_eval_runs').select('id, judge_model').in('test_set_id', setIds);
  const modelByRun = new Map((runs ?? []).map((r) => [r.id as string, r.judge_model as string]));
  const runIds = [...modelByRun.keys()];
  const byPair = new Map<string, Map<string, V>>();
  // Paginate: PostgREST caps a single response at ~1000 rows regardless of .limit().
  for (let from = 0; ; from += 1000) {
    const { data: calls, error } = await db
      .from('judge_eval_calls')
      .select('eval_run_id, pair_label, pair_kind, winner, confidence, expected_winner, gap_kind')
      .in('eval_run_id', runIds)
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    const batch = (calls ?? []) as Array<Record<string, unknown>>;
    for (const c of batch) {
      const key = `${c.pair_kind}|${c.pair_label}`;
      if (!byPair.has(key)) byPair.set(key, new Map());
      byPair.get(key)!.set(modelByRun.get(c.eval_run_id as string) ?? '?', {
        winner: c.winner as string, confidence: (c.confidence as number) ?? 0,
        expected: (c.expected_winner as string) ?? null, gap: (c.gap_kind as string) ?? null,
      });
    }
    if (batch.length < 1000) break;
  }
  return byPair;
}

function report(mode: string, byPair: Map<string, Map<string, V>>): void {
  const keys = [...byPair.keys()].filter((k) => k.startsWith(`${mode}|`) && byPair.get(k)!.has(LEAD));
  const total = keys.length;
  const tieKeys = keys.filter((k) => !decisive(byPair.get(k)!.get(LEAD)));
  const ties = tieKeys.length;
  console.log(`\n══════ ${mode.toUpperCase()} (n=${total} large-gap pairs) ══════`);
  console.log(`  gemini-2.5-flash-lite alone: decisive on ${total - ties}/${total} (${pc(total - ties, total)}); INDECISIVE (ties → draws) on ${ties}/${total} (${pc(ties, total)})`);
  console.log(`  ${'partner'.padEnd(28)} ${'break/ties'.padEnd(12)} ${'rel%'.padEnd(7)} ${'abs%(of all)'.padEnd(13)} ${'correct/wrong'.padEnd(14)} break-acc`);
  const rows = PARTNERS.map((partner) => {
    let broken = 0, correct = 0, wrong = 0;
    for (const k of tieKeys) {
      const v = byPair.get(k)!.get(partner);
      if (!decisive(v)) continue;
      broken += 1;
      const lead = byPair.get(k)!.get(LEAD)!;
      if (lead.gap === 'large' && lead.expected != null) {
        if (v!.winner === lead.expected) correct += 1; else wrong += 1;
      }
    }
    return { partner, broken, correct, wrong };
  });
  // Rank by net correct recovered (correct − wrong), then by break-accuracy.
  rows.sort((a, b) => (b.correct - b.wrong) - (a.correct - a.wrong) || (b.correct / (b.correct + b.wrong || 1)) - (a.correct / (a.correct + a.wrong || 1)));
  for (const r of rows) {
    const dec = r.correct + r.wrong;
    console.log(
      `  ${r.partner.padEnd(28)} ${`${r.broken}/${ties}`.padEnd(12)} ${pc(r.broken, ties).padEnd(7)} ${pc(r.broken, total).padEnd(13)} ${`+${r.correct} / -${r.wrong}`.padEnd(14)} ${pc(r.correct, dec)}`,
    );
  }
  console.log('  (rel% = of gemini\'s ties; abs% = of ALL pairs; break-acc = correct share of decisive large-gap breaks)');
}

async function main(): Promise<void> {
  const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const byPair = await pull(db);
  console.log(`TIE-BREAKING PARTNER RANKING — lead = ${LEAD}, n=150 large-gap pairs/mode`);
  report('article', byPair);
  report('paragraph', byPair);
}

main().catch((e) => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
