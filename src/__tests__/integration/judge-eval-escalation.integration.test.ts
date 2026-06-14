// Integration test for escalation-sweep persistence against a real Supabase. Asserts the core
// fix the live sweep surfaced: a match has MULTIPLE submatch rows sharing (eval_run_id, pair_label,
// repeat_index), distinguished by escalation_step — which the original UNIQUE constraint blocked
// (migration 20260614000002 replaces it with partial unique indexes). Also checks the run appears
// in the leaderboard view. Auto-skips until the escalation migrations are deployed (CI's
// deploy-migrations job applies them before these tests run; locally the multi-submatch insert
// raises 23505 until then, which we treat as "not deployed → skip").

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { upsertPairBank, getOrCreateTestSet, loadPairBankByName } from '@evolution/lib/judgeEval/persist';
import {
  upsertEscalationRun,
  replaceEscalationCalls,
  submatchToCallRow,
  submatchGroupKey,
} from '@evolution/lib/judgeEval/escalationPersist';
import type { SubmatchRecord } from '@evolution/lib/judgeEval/escalation';
import type { JudgeEvalPair } from '@evolution/lib/judgeEval/schemas';

function makeClient(): SupabaseClient<Database> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

const VA = '11111111-1111-4111-8111-111111111111';
const VB = '22222222-2222-4222-8222-222222222222';

const PAIR: JudgeEvalPair = {
  label: 'art#esc1',
  pair_kind: 'article',
  variant_a_id: VA,
  variant_b_id: VB,
  text_a: 'alpha',
  text_b: 'beta',
  mu_a: 40,
  mu_b: 20,
  sigma_a: 5,
  sigma_b: 5,
  expected_winner: 'A',
  gap_kind: 'large',
  baseline_confidence: 1.0,
};

function sub(model: string, step: number, winner: 'A' | 'B' | 'TIE', confidence: number): SubmatchRecord {
  return {
    model,
    escalationStep: step,
    triggeredEscalation: step === 0,
    forwardWinner: winner === 'TIE' ? 'A' : winner,
    reverseWinner: winner === 'TIE' ? 'A' : winner === 'A' ? 'B' : 'A',
    winner,
    confidence,
    costUsd: 0.0002,
    promptTokens: 20,
    outputTokens: 2,
    reasoningTokens: 0,
    forwardRaw: winner,
    reverseRaw: winner,
    forwardPrompt: '## Text A\nalpha\n## Text B\nbeta\nYour answer:',
    reversePrompt: '## Text A\nbeta\n## Text B\nalpha\nYour answer:',
    forwardReasoning: null,
    reverseReasoning: null,
    error: null,
  };
}

const db = makeClient();
const BANK = `[TEST] judge-eval escalation bank ${Date.now()}`;
const TS = `[TEST] judge-eval escalation ts ${Date.now()}`;

(db ? describe : describe.skip)('judge-eval escalation persistence (integration)', () => {
  let enabled = false;
  let bankId = '';
  let testSetId = '';

  beforeAll(async () => {
    if (!db) return;
    // Probe: the submatch column must exist (PR #1213). The CONSTRAINT fix (20260614000002) is
    // probed by the insert itself below (it raises 23505 until deployed -> we skip).
    const { error } = await db.from('judge_eval_calls').select('submatch_group_key').limit(1);
    enabled = !error;
    if (!enabled) return;

    bankId = await upsertPairBank(db, { name: BANK, pairs: [PAIR] });
    const bank = await loadPairBankByName(db, BANK);
    const { testSet } = await getOrCreateTestSet(db, bank!, {
      name: TS,
      strategy: 'manual',
      seed: 1,
      sizeArticle: 1,
      sizeParagraph: 0,
      manualLabels: [PAIR.label],
    });
    testSetId = testSet.id;
  });

  afterAll(async () => {
    if (!db || !bankId) return;
    // FK CASCADE: deleting the bank removes test sets → members; runs/calls cascade from runs.
    await db.from('judge_eval_pair_banks').delete().eq('id', bankId);
  });

  it('persists 1-3 submatch rows per match (constraint fix) and lands in the leaderboard', async () => {
    if (!db || !enabled) {
      console.warn('judge_eval submatch column absent — skipping (deploy migration first)');
      return;
    }

    const { data: chainRow } = await db
      .from('judge_eval_chains')
      .insert({
        name: 'esc-int-test',
        article_models: ['m1', 'm2'],
        paragraph_models: [],
        aggregation_rule: 'first_decisive',
        aggregation_rule_version: 1,
        cap: 3,
      })
      .select('id')
      .single();
    const { runId } = await upsertEscalationRun(db, {
      testSetId,
      chainId: chainRow!.id,
      chainModels: { article: ['m1', 'm2'], paragraph: [] },
      aggregationRule: 'first_decisive',
      aggregationRuleVersion: 1,
      cap: 3,
      temperature: 0,
      reasoningEffort: null,
      kindFilter: 'article',
      promptVariant: null,
      repeats: 1,
    });

    // A 2-submatch match: m1 abstains (TIE @ 0.5), m2 resolves (A @ 1.0). Same (pair, repeat).
    const gk = submatchGroupKey(PAIR.label, 0);
    const rows = [
      submatchToCallRow(PAIR, sub('m1', 0, 'TIE', 0.5), gk, 0),
      submatchToCallRow(PAIR, sub('m2', 1, 'A', 1.0), gk, 0),
    ];

    try {
      await replaceEscalationCalls(db, runId, rows);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        console.warn('escalation unique-constraint fix (20260614000002) not deployed — skipping');
        return;
      }
      throw e;
    }

    const { data: persisted, error } = await db
      .from('judge_eval_calls')
      .select('escalation_step, submatch_group_key, judge_model, winner, confidence')
      .eq('eval_run_id', runId)
      .order('escalation_step');
    expect(error).toBeNull();
    expect(persisted).toHaveLength(2);
    expect(persisted!.map((r) => r.escalation_step)).toEqual([0, 1]);
    expect(persisted!.every((r) => r.submatch_group_key === gk)).toBe(true);
    expect(persisted!.map((r) => r.judge_model)).toEqual(['m1', 'm2']);

    // The run appears in the leaderboard view (escalation rows aggregated per match by 20260614000001).
    const { data: board } = await db
      .from('judge_eval_settings_leaderboard')
      .select('eval_run_id, pair_kind, n_calls, decisive_rate')
      .eq('eval_run_id', runId);
    expect((board ?? []).length).toBeGreaterThan(0);
  });
});
