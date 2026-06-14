// Builds the pinned judge-ensemble validation fixture (recordedCorpus.json) from a captured
// read-only export of recorded judge_eval_calls on the two frozen Phase-1 test sets. Keeps the
// offline simulator deterministic + CI-gateable (no live DB at test time).
//
// Regenerate with (read-only on dev/staging):
//   npm run query:staging -- --json "
//     WITH picked AS (
//       SELECT DISTINCT ON (r.test_set_id, r.judge_model) r.id AS run_id, r.test_set_id, r.judge_model
//       FROM judge_eval_runs r
//       WHERE r.test_set_id IN ('9acb42f5-fa9b-4ce8-b053-431fbe01e026','970494a4-d95b-4097-ad77-07702846a6ed')
//         AND r.temperature = 0
//       ORDER BY r.test_set_id, r.judge_model, r.created_at ASC)
//     SELECT p.test_set_id::text AS test_set, p.judge_model AS model, c.pair_label, c.pair_kind,
//            c.repeat_index, c.winner, c.confidence, c.forward_winner, c.reverse_winner,
//            c.expected_winner, c.gap_kind, c.cost_usd
//     FROM picked p JOIN judge_eval_calls c ON c.eval_run_id = p.run_id WHERE c.error IS NULL
//     ORDER BY p.test_set_id, c.pair_label, c.repeat_index, p.judge_model" > /tmp/corpus_raw.txt
//   npx tsx evolution/scripts/buildJudgeEnsembleFixture.ts /tmp/corpus_raw.txt

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const rawPath = process.argv[2] ?? '/tmp/corpus_raw.txt';
const raw = readFileSync(rawPath, 'utf8');
const start = raw.indexOf('[');
const end = raw.lastIndexOf(']');
if (start < 0 || end < 0) throw new Error(`no JSON array found in ${rawPath}`);

interface RawRow {
  test_set: string;
  model: string;
  pair_label: string;
  pair_kind: 'article' | 'paragraph';
  repeat_index: string | number;
  winner: string;
  confidence: string | number;
  forward_winner: string | null;
  reverse_winner: string | null;
  expected_winner: string | null;
  gap_kind: string | null;
  cost_usd: string | number | null;
}

const rows: RawRow[] = JSON.parse(raw.slice(start, end + 1));

const norm = rows.map((r) => ({
  testSet: r.test_set,
  model: r.model,
  pairLabel: r.pair_label,
  pairKind: r.pair_kind,
  repeatIndex: Number(r.repeat_index),
  winner: r.winner,
  confidence: Number(r.confidence),
  forwardWinner: r.forward_winner,
  reverseWinner: r.reverse_winner,
  expectedWinner: r.expected_winner,
  gapKind: r.gap_kind,
  costUsd: r.cost_usd == null ? 0 : Number(r.cost_usd),
}));

const out = path.join(
  __dirname,
  '../src/lib/shared/judgeEnsemble/fixtures/recordedCorpus.json',
);
writeFileSync(out, `${JSON.stringify(norm)}\n`);

const by: Record<string, number> = {};
for (const r of norm) {
  const k = `${r.testSet}|${r.pairKind}`;
  by[k] = (by[k] ?? 0) + 1;
}
console.log('rows', norm.length);
console.log('by set|kind', by);
const models = new Set(norm.map((r) => `${r.pairKind}:${r.model}`));
console.log('models', [...models].sort());
