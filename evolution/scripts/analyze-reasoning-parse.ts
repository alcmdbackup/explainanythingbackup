// Read-only forensic: re-parses stored judge_eval_calls raw outputs offline to decide whether the
// reasoning/custom-prompt decisive-rate drop is a PARSE ARTIFACT (bug) or a REAL model effect.
// It performs NO writes (SELECT-only, DB-enforced readonly_local role). Run:
//   npx tsx evolution/scripts/analyze-reasoning-parse.ts [--limit N]
//
// For each call it recovers the parser the engine would have used (from the verdict instruction in
// forward_prompt), re-parses forward_raw/reverse_raw, and compares to the stored forward_winner/
// reverse_winner + confidence. It also runs a HARDENED reasoning parser (widened verdict-marker
// regex) to measure how many calls a better parser would "rescue" — if that number is material the
// drop was a bug; if it is ~0 and parse-match is ~100%, the recorded drop is a real effect.

import { Client } from 'pg';
import * as dns from 'dns';
import * as dotenv from 'dotenv';
import {
  parseWinner,
  parseVerdictFromReasoning,
  aggregateWinners,
} from '../src/lib/shared/computeRatings';

dns.setDefaultResultOrder('ipv4first');
dotenv.config({ path: '.env.staging.readonly' });

// Hardened candidate: same scan-for-LAST-marker logic but a wider set of verdict prefixes.
const HARDENED_RE =
  /(?:your answer|verdict|winner|decision|response|answer|choice)\s*:?\s*\*{0,2}\s*(A|B|TIE)\b/gi;
function parseHardened(response: string): 'A' | 'B' | 'TIE' | null {
  let last: 'A' | 'B' | 'TIE' | null = null;
  for (const m of response.matchAll(HARDENED_RE)) {
    const v = m[1]!.toUpperCase();
    if (v === 'A' || v === 'B' || v === 'TIE') last = v;
  }
  return last;
}

type Mode = 'explain_reasoning' | 'custom_no_reasoning' | 'default' | 'other';
function classify(forwardPrompt: string | null): Mode {
  if (!forwardPrompt) return 'other';
  if (forwardPrompt.includes('First, briefly explain your reasoning')) return 'explain_reasoning';
  if (forwardPrompt.includes('You may include reasoning. End your response'))
    return 'custom_no_reasoning';
  if (forwardPrompt.includes('Respond with ONLY one of these exact answers')) return 'default';
  return 'other';
}

interface Row {
  forward_raw: string | null;
  reverse_raw: string | null;
  forward_winner: string | null;
  reverse_winner: string | null;
  confidence: string | null; // numeric comes back as string from pg
  forward_prompt: string | null;
}

interface Acc {
  n: number;
  fwdMatch: number;
  revMatch: number;
  confMatch: number;
  storedDecisive: number;
  reparsedNull: number; // passes the engine parser re-parses to null
  hardenedRescued: number; // null under engine parser but non-null under hardened
  hardenedDecisive: number; // decisive under hardened re-parse
}
function emptyAcc(): Acc {
  return {
    n: 0,
    fwdMatch: 0,
    revMatch: 0,
    confMatch: 0,
    storedDecisive: 0,
    reparsedNull: 0,
    hardenedRescued: 0,
    hardenedDecisive: 0,
  };
}

async function main(): Promise<void> {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg >= 0 ? parseInt(process.argv[limitArg + 1] ?? '0', 10) : 0;
  const url = process.env.STAGING_READONLY_DATABASE_URL;
  if (!url) throw new Error('STAGING_READONLY_DATABASE_URL not set (.env.staging.readonly)');

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const sql = `SELECT forward_raw, reverse_raw, forward_winner, reverse_winner, confidence, forward_prompt
      FROM judge_eval_calls
      WHERE error IS NULL AND forward_raw IS NOT NULL AND reverse_raw IS NOT NULL
      ${limit > 0 ? `LIMIT ${limit}` : ''}`;
    const { rows } = await client.query<Row>(sql);

    const byMode: Record<Mode, Acc> = {
      explain_reasoning: emptyAcc(),
      custom_no_reasoning: emptyAcc(),
      default: emptyAcc(),
      other: emptyAcc(),
    };

    for (const r of rows) {
      const mode = classify(r.forward_prompt);
      const acc = byMode[mode];
      const useReasoning = mode === 'explain_reasoning' || mode === 'custom_no_reasoning';
      const engineParse = useReasoning ? parseVerdictFromReasoning : parseWinner;

      const f = engineParse(r.forward_raw ?? '');
      const rev = engineParse(r.reverse_raw ?? '');
      const fH = parseHardened(r.forward_raw ?? '');
      const revH = parseHardened(r.reverse_raw ?? '');

      acc.n += 1;
      if (f === r.forward_winner) acc.fwdMatch += 1;
      if (rev === r.reverse_winner) acc.revMatch += 1;

      const reConf = aggregateWinners(f, rev).confidence;
      const storedConf = r.confidence == null ? null : Number(r.confidence);
      if (storedConf != null && Math.abs(reConf - storedConf) < 1e-9) acc.confMatch += 1;
      if (storedConf != null && storedConf > 0.6) acc.storedDecisive += 1;

      if (f === null) acc.reparsedNull += 1;
      if (rev === null) acc.reparsedNull += 1;
      if (f === null && fH !== null) acc.hardenedRescued += 1;
      if (rev === null && revH !== null) acc.hardenedRescued += 1;

      if (aggregateWinners(fH, revH).confidence > 0.6) acc.hardenedDecisive += 1;
    }

    const pct = (x: number, d: number): string => (d === 0 ? '—' : `${((100 * x) / d).toFixed(2)}%`);
    console.log(`\nRe-parsed ${rows.length} calls (read-only). Per-mode results:\n`);
    for (const mode of Object.keys(byMode) as Mode[]) {
      const a = byMode[mode];
      if (a.n === 0) continue;
      console.log(`[${mode}]  n=${a.n}`);
      console.log(`  fwd winner re-parse match : ${pct(a.fwdMatch, a.n)}`);
      console.log(`  rev winner re-parse match : ${pct(a.revMatch, a.n)}`);
      console.log(`  confidence re-parse match : ${pct(a.confMatch, a.n)}`);
      console.log(`  engine-parser NULL passes : ${pct(a.reparsedNull, a.n * 2)} (of ${a.n * 2} passes)`);
      console.log(`  hardened-parser RESCUED   : ${a.hardenedRescued} passes`);
      console.log(`  decisive% stored          : ${pct(a.storedDecisive, a.n)}`);
      console.log(`  decisive% if hardened     : ${pct(a.hardenedDecisive, a.n)}`);
      console.log('');
    }
    console.log(
      'DECISION RULE: re-parse match >=99% AND hardened rescue ~0 AND decisive%(hardened) ~= stored\n' +
        '  => REAL effect (parsers sound). Large rescue / big decisive% lift => PARSE ARTIFACT (bug).',
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
