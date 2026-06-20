// Integration test for the Judge Lab Agreement Sweep persistence against a real Supabase. Asserts that
// a sweep's results land in ALL THREE new tables (judge_eval_agreement_runs / _calls /
// _criterion_verdicts), that the leaderboard VIEW aggregates them, and that deleting the run CASCADEs
// to calls + criterion verdicts. Drives persistence directly with synthetic AgreementCallResult rows
// (no LLM calls → deterministic, zero spend). Auto-skips until the agreement migration is deployed
// (probe judge_eval_agreement_calls.rubric_matches_holistic; CI's deploy-migrations applies it first).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { upsertPairBank, getOrCreateTestSet, loadPairBankByName } from '@evolution/lib/judgeEval/persist';
import { upsertAgreementRun, replaceAgreementCalls } from '@evolution/lib/judgeEval/agreementPersist';
import type { AgreementCallResult } from '@evolution/lib/judgeEval/agreement';
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
  label: 'art#agr1',
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

/** One agreement call: holistic A (decisive), rubric A (decisive) → agree; clarity agrees, depth abstains. */
function agreementRow(repeat: number): AgreementCallResult {
  return {
    pair_label: PAIR.label,
    pair_kind: 'article',
    repeat_index: repeat,
    holistic_winner: 'A',
    holistic_confidence: 1.0,
    rubric_winner: 'A',
    rubric_confidence: 1.0,
    rubric_matches_holistic: true,
    holistic_cost_usd: 0.0002,
    rubric_cost_usd: 0.0002,
    cost_usd: 0.0004,
    prompt_tokens: 40,
    output_tokens: 4,
    reasoning_tokens: 0,
    wall_ms: 120,
    holistic_forward_raw: 'A',
    holistic_reverse_raw: 'B',
    rubric_forward_raw: 'clarity: A',
    rubric_reverse_raw: 'clarity: B',
    error: null,
    mu_a: PAIR.mu_a,
    mu_b: PAIR.mu_b,
    sigma_a: PAIR.sigma_a,
    sigma_b: PAIR.sigma_b,
    baseline_confidence: PAIR.baseline_confidence,
    gap_kind: PAIR.gap_kind,
    expected_winner: PAIR.expected_winner,
    variant_a_id: VA,
    variant_b_id: VB,
    criterionVerdicts: [
      {
        criteria_id: '33333333-3333-4333-8333-333333333333',
        criteria_name: 'clarity',
        weight: 0.5,
        forward_verdict: 'A',
        reverse_verdict: 'A',
        dimension_winner: 'A',
        agrees_with_holistic: true,
        matches_ground_truth: true,
        position: 0,
      },
      {
        criteria_id: '44444444-4444-4444-8444-444444444444',
        criteria_name: 'depth',
        weight: 0.5,
        forward_verdict: 'A',
        reverse_verdict: 'B',
        dimension_winner: 'TIE',
        agrees_with_holistic: null, // abstain
        matches_ground_truth: null,
        position: 1,
      },
    ],
  };
}

const db = makeClient();
const BANK = `[TEST] judge-eval agreement bank ${Date.now()}`;
const TS = `[TEST] judge-eval agreement ts ${Date.now()}`;

(db ? describe : describe.skip)('judge-eval agreement persistence (integration)', () => {
  let enabled = false;
  let bankId = '';
  let testSetId = '';

  beforeAll(async () => {
    if (!db) return;
    // Probe a NEW-table column; skip until migration 20260619000001 is deployed.
    const { error } = await db.from('judge_eval_agreement_calls').select('rubric_matches_holistic').limit(1);
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
    // FK CASCADE: deleting the bank removes the test set → members; agreement runs cascade to
    // calls → criterion verdicts. Delete the bank AND any agreement run on the test set.
    if (testSetId) {
      await db.from('judge_eval_agreement_runs').delete().eq('test_set_id', testSetId);
    }
    await db.from('judge_eval_pair_banks').delete().eq('id', bankId);
  });

  it('persists across all 3 tables + leaderboard view, and CASCADEs on run delete', async () => {
    if (!db || !enabled) {
      console.warn('judge_eval_agreement_calls absent — skipping (deploy migration 20260619000001)');
      return;
    }

    const { runId } = await upsertAgreementRun(db, {
      testSetId,
      judgeModel: 'm-agree',
      temperature: 0,
      reasoningEffort: null,
      judgeRubricId: '55555555-5555-4555-8555-555555555555',
      kindFilter: 'article',
      repeats: 2,
    });

    const { callCount, criterionCount } = await replaceAgreementCalls(db, runId, [
      agreementRow(0),
      agreementRow(1),
    ]);
    expect(callCount).toBe(2);
    expect(criterionCount).toBe(4);

    // Calls landed with the paired winners + agreement flag.
    const callsRes = await db
      .from('judge_eval_agreement_calls')
      .select('id, holistic_winner, rubric_winner, rubric_matches_holistic, holistic_decisive, rubric_decisive')
      .eq('agreement_run_id', runId);
    expect(callsRes.error).toBeNull();
    expect(callsRes.data).toHaveLength(2);
    expect(callsRes.data!.every((c) => c.rubric_matches_holistic === true)).toBe(true);
    // GENERATED decisive columns computed from confidence > 0.6.
    expect(callsRes.data!.every((c) => c.holistic_decisive === true && c.rubric_decisive === true)).toBe(true);

    // Criterion verdicts landed (2 per call × 2 calls).
    const callIds = callsRes.data!.map((c) => c.id);
    const cvRes = await db
      .from('judge_eval_agreement_criterion_verdicts')
      .select('criteria_name, agrees_with_holistic')
      .in('agreement_call_id', callIds);
    expect(cvRes.error).toBeNull();
    expect(cvRes.data).toHaveLength(4);
    const clarity = cvRes.data!.filter((r) => r.criteria_name === 'clarity');
    const depth = cvRes.data!.filter((r) => r.criteria_name === 'depth');
    expect(clarity.every((r) => r.agrees_with_holistic === true)).toBe(true);
    expect(depth.every((r) => r.agrees_with_holistic === null)).toBe(true); // abstain

    // Leaderboard view aggregates the run (one row for the 'article' kind).
    const boardRes = await db
      .from('judge_eval_agreement_leaderboard')
      .select('agreement_run_id, pair_kind, n_calls, strict_agree_rate, holistic_accuracy, rubric_accuracy')
      .eq('agreement_run_id', runId);
    expect(boardRes.error).toBeNull();
    expect((boardRes.data ?? []).length).toBeGreaterThan(0);
    const articleRow = boardRes.data!.find((r) => r.pair_kind === 'article');
    expect(articleRow).toBeDefined();
    expect(Number(articleRow!.strict_agree_rate)).toBeCloseTo(1);
    expect(Number(articleRow!.rubric_accuracy)).toBeCloseTo(1);

    // CASCADE: deleting the run removes its calls + criterion verdicts.
    await db.from('judge_eval_agreement_runs').delete().eq('id', runId);
    const afterCalls = await db.from('judge_eval_agreement_calls').select('id').eq('agreement_run_id', runId);
    expect(afterCalls.data ?? []).toHaveLength(0);
    const afterCv = await db
      .from('judge_eval_agreement_criterion_verdicts')
      .select('id')
      .in('agreement_call_id', callIds);
    expect(afterCv.data ?? []).toHaveLength(0);
  });
});
