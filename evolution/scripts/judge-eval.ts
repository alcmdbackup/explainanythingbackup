// CLI for the systematic judge-evaluation tool. Seed a pair-bank from an arena topic,
// materialize a frozen test set, and run a settings sweep (cost-capped via the shared guard,
// --dry-run for an estimate). Headless counterpart to the Judge Lab admin page.
//
// Usage:
//   npx tsx evolution/scripts/judge-eval.ts seed --topic a546b7e9... --bank "Federal Reserve 2"
//   npx tsx evolution/scripts/judge-eval.ts create-test-set --bank "Federal Reserve 2" \
//       --name fr2-smoke --size-article 10 --size-paragraph 10 --strategy stratified_confidence --seed 1
//   npx tsx evolution/scripts/judge-eval.ts sweep --test-set fr2-smoke \
//       --models qwen-2.5-7b-instruct,gpt-4.1-nano --temperatures 0,1 --repeats 5 [--dry-run]

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { seedPairBankFromTopic } from '@evolution/lib/judgeEval/seed';
import { loadPairBankByName, loadTestSetByName, getOrCreateTestSet } from '@evolution/lib/judgeEval/persist';
import { executeSweep } from '@evolution/lib/judgeEval/executeSweep';
import { executeEscalationSweep } from '@evolution/lib/judgeEval/executeEscalationSweep';
import { computeMetrics } from '@evolution/lib/judgeEval/metrics';
import type { JudgeReasoningEffort, JudgeKindFilter } from '@evolution/lib/judgeEval/schemas';

const FEDERAL_RESERVE_2_TOPIC = 'a546b7e9-f066-403d-9589-f5e0d2c9fa4f';

function loadEnv(): SupabaseClient<Database> {
  for (const c of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), c);
    if (fs.existsSync(p)) dotenv.config({ path: p, override: true });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
function has(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}
function num(v: string | undefined, fallback: number): number {
  const n = v != null ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
function list(v: string | undefined): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const db = loadEnv();

  if (cmd === 'seed') {
    const topic = flag(args, 'topic') ?? FEDERAL_RESERVE_2_TOPIC;
    const bank = flag(args, 'bank') ?? 'Federal Reserve 2';
    const r = await seedPairBankFromTopic(db, {
      topicId: topic,
      bankName: bank,
      // 0 = uncapped (risks overflowing the single-row JSONB upsert on large topics).
      maxArticle: num(flag(args, 'max-article'), 400),
      maxParagraph: num(flag(args, 'max-paragraph'), 1500),
    });
    console.log(`Seeded bank "${bank}" (${r.bankId}): ${r.articlePairs} article + ${r.paragraphPairs} paragraph pairs (${r.skipped} skipped: deleted variants or per-kind cap).`);
    return;
  }

  if (cmd === 'create-test-set') {
    const bankName = flag(args, 'bank');
    const name = flag(args, 'name');
    if (!bankName || !name) throw new Error('create-test-set requires --bank and --name');
    const bank = await loadPairBankByName(db, bankName);
    if (!bank) throw new Error(`Pair-bank not found: ${bankName}`);
    const { testSet, created } = await getOrCreateTestSet(db, bank, {
      name,
      strategy: (flag(args, 'strategy') as 'random' | 'stratified_confidence' | 'stratified_gap' | 'manual') ?? 'stratified_confidence',
      seed: num(flag(args, 'seed'), 1),
      sizeArticle: num(flag(args, 'size-article'), 0),
      sizeParagraph: num(flag(args, 'size-paragraph'), 0),
    });
    console.log(`${created ? 'Created' : 'Exists (frozen)'} test set "${name}" (${testSet.id}): ${testSet.size_article} art / ${testSet.size_paragraph} para, strategy=${testSet.strategy}, seed=${testSet.seed}.`);
    return;
  }

  if (cmd === 'sweep') {
    const testSetName = flag(args, 'test-set');
    if (!testSetName) throw new Error('sweep requires --test-set');
    const testSet = await loadTestSetByName(db, testSetName);
    if (!testSet) throw new Error(`Test set not found: ${testSetName}`);

    const reasoning = list(flag(args, 'reasoning'));
    const promptFile = flag(args, 'prompt-file');
    const promptVariant = promptFile ? fs.readFileSync(promptFile, 'utf8') : null;
    const dryRun = has(args, 'dry-run');

    const outcome = await executeSweep(
      db,
      {
        testSetId: testSet.id,
        kindFilter: (flag(args, 'kind') as JudgeKindFilter) ?? 'both',
        models: list(flag(args, 'models')),
        temperatures: list(flag(args, 'temperatures')).map((t) => Number(t)),
        reasoningEfforts: reasoning.length > 0 ? (reasoning as Array<JudgeReasoningEffort | null>) : [null],
        promptVariant,
        explainReasoning: has(args, 'explain-reasoning'),
        repeats: num(flag(args, 'repeats'), 10),
      },
      { dryRun, trackingDb: db, userId: undefined },
    );

    console.log(`Test set ${testSetName} (${outcome.testSetId}) · ${outcome.pairCount} pairs`);
    console.log(`Grid: ${outcome.estimate.cells} cells · ${outcome.estimate.comparisons} comparisons · planned ${outcome.plannedCalls} calls · est $${outcome.estimate.estimatedCostUsd.toFixed(4)}`);
    if (dryRun) {
      console.log('(dry run — no LLM calls made)');
      return;
    }

    // Per-cell leaderboard summary, split by kind, from the persisted calls.
    for (const cell of outcome.cells) {
      const { data: calls } = await db.from('judge_eval_calls').select('*').eq('eval_run_id', cell.runId);
      const rows = calls ?? [];
      for (const kind of ['article', 'paragraph'] as const) {
        const sub = rows.filter((r) => r.pair_kind === kind);
        if (sub.length === 0) continue;
        const m = computeMetrics(sub.map((r) => ({
          forward_winner: r.forward_winner as 'A' | 'B' | 'TIE' | null,
          reverse_winner: r.reverse_winner as 'A' | 'B' | 'TIE' | null,
          winner: r.winner as 'A' | 'B' | 'TIE', confidence: r.confidence,
          wall_ms: r.wall_ms, fwd_ms: r.fwd_ms,
          output_tokens: r.output_tokens, reasoning_tokens: r.reasoning_tokens, cost_usd: r.cost_usd,
        })));
        console.log(`  ${cell.judgeModel} t=${cell.temperature} r=${cell.reasoningEffort ?? 'none'} [${kind}] decisive=${(m.decisiveRate * 100).toFixed(0)}% conf=${m.avgConfidence.toFixed(2)} posBias=${(m.positionBiasRate * 100).toFixed(0)}% cost/dec=${m.costPerDecisiveUsd != null ? '$' + m.costPerDecisiveUsd.toFixed(5) : '∞'}`);
      }
    }
    return;
  }

  if (cmd === 'escalation-sweep') {
    const testSetName = flag(args, 'test-set');
    if (!testSetName) throw new Error('escalation-sweep requires --test-set');
    const testSet = await loadTestSetByName(db, testSetName);
    if (!testSet) throw new Error(`Test set not found: ${testSetName}`);

    const promptFile = flag(args, 'prompt-file');
    const promptVariant = promptFile ? fs.readFileSync(promptFile, 'utf8') : null;
    const reasoning = flag(args, 'reasoning');
    const rule = flag(args, 'rule') ?? 'first_decisive';
    const cap = num(flag(args, 'cap'), 3);
    const dryRun = has(args, 'dry-run');

    const outcome = await executeEscalationSweep(
      db,
      {
        testSetId: testSet.id,
        kindFilter: (flag(args, 'kind') as JudgeKindFilter) ?? 'both',
        chain: {
          name: flag(args, 'chain-name') ?? `${rule} cap${cap}`,
          article: list(flag(args, 'article-models')),
          paragraph: list(flag(args, 'paragraph-models')),
          rule,
          ruleVersion: num(flag(args, 'rule-version'), 1),
          cap,
        },
        temperature: num(flag(args, 'temperature'), 0),
        reasoningEffort: (reasoning && reasoning !== 'none' ? reasoning : null) as JudgeReasoningEffort | null,
        promptVariant,
        explainReasoning: has(args, 'explain-reasoning'),
        repeats: num(flag(args, 'repeats'), 10),
      },
      { dryRun, trackingDb: db, userId: undefined },
    );

    console.log(`Test set ${testSetName} (${outcome.testSetId}) · ${outcome.pairCount} pairs`);
    console.log(`Chain "${rule} cap${cap}" · worst-case ${outcome.plannedCalls} calls · est $${outcome.estimate.estimatedCostUsd.toFixed(4)}`);
    if (dryRun || outcome.runId == null) {
      console.log('(dry run — no LLM calls made)');
      return;
    }
    console.log(`Run ${outcome.runId} · ${outcome.callCount} submatch rows`);

    // Match-level summary (group submatch rows by submatch_group_key; the final submatch = the
    // consolidated verdict). Computed inline so it works before the leaderboard VIEW migration deploys.
    const { data: calls } = await db.from('judge_eval_calls').select('*').eq('eval_run_id', outcome.runId);
    const rows = calls ?? [];
    for (const kind of ['article', 'paragraph'] as const) {
      const kRows = rows.filter((r) => r.pair_kind === kind);
      if (kRows.length === 0) continue;
      const finals = new Map<string, { step: number; decisive: boolean }>();
      let cost = 0;
      for (const r of kRows) {
        cost += r.cost_usd ?? 0;
        const gk = r.submatch_group_key ?? `${r.pair_label}#${r.repeat_index}`;
        const step = r.escalation_step ?? 0;
        const cur = finals.get(gk);
        if (!cur || step >= cur.step) finals.set(gk, { step, decisive: r.confidence > 0.6 });
      }
      const matches = [...finals.values()];
      const decisive = matches.filter((m) => m.decisive).length;
      const rate = matches.length ? decisive / matches.length : 0;
      const avgDepth = matches.length ? kRows.length / matches.length : 0;
      const costPerDec = decisive ? cost / decisive : null;
      console.log(
        `  [${kind}] matches=${matches.length} decisive=${(rate * 100).toFixed(0)}% ` +
          `cost/dec=${costPerDec != null ? '$' + costPerDec.toFixed(5) : '∞'} avgDepth=${avgDepth.toFixed(2)}`,
      );
    }
    return;
  }

  console.error('Unknown command. Use: seed | create-test-set | sweep | escalation-sweep');
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
