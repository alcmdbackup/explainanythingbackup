// Integration test for the judge-eval persistence layer against a real Supabase. Materializes
// a frozen test set, runs TWO eval runs (different settings) against the SAME test_set_id, and
// asserts both appear in the leaderboard view scoped to that test set (cross-run comparability)
// + settings_key idempotency. Auto-skips until the judge_eval_* migration is deployed.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { upsertPairBank, getOrCreateTestSet, loadPairBankByName, upsertRun, replaceCalls, loadTestSetPairs } from '@evolution/lib/judgeEval/persist';
import type { JudgeEvalPair, JudgeEvalCallResult } from '@evolution/lib/judgeEval/schemas';

function makeClient(): SupabaseClient<Database> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

/** judge_eval-SPECIFIC probe (evolutionTablesExist only checks evolution_runs). 42P01 = skip. */
async function judgeEvalTablesExist(db: SupabaseClient<Database>): Promise<boolean> {
  const { error } = await db.from('judge_eval_pair_banks').select('id').limit(1);
  return !error;
}

const VA = '11111111-1111-4111-8111-111111111111';
const VB = '22222222-2222-4222-8222-222222222222';

function pair(label: string, kind: 'article' | 'paragraph'): JudgeEvalPair {
  return {
    label, pair_kind: kind, variant_a_id: VA, variant_b_id: VB,
    text_a: 'alpha', text_b: 'beta', mu_a: 40, mu_b: 20, sigma_a: 5, sigma_b: 5,
    expected_winner: 'A', gap_kind: 'large', baseline_confidence: 1.0,
  };
}

function call(label: string, kind: 'article' | 'paragraph', i: number, conf: number): JudgeEvalCallResult {
  return {
    pair_label: label, pair_kind: kind, comparison_mode: kind, repeat_index: i,
    forward_winner: 'A', reverse_winner: 'A', winner: 'A', confidence: conf,
    wall_ms: 100, fwd_ms: 50, rev_ms: 50, prompt_tokens: 100, output_tokens: 3, reasoning_tokens: 0,
    cost_usd: 0.0001, forward_raw: 'A', reverse_raw: 'A', error: null,
    // Audit + ground-truth snapshot (mirrors what the engine writes; values match pair()).
    forward_prompt: '## Text A\nalpha\n## Text B\nbeta\nYour answer:', reverse_prompt: '## Text A\nbeta\n## Text B\nalpha\nYour answer:',
    forward_reasoning: 'A is stronger.', reverse_reasoning: 'A is stronger.', reasoning_trace_format: 'verbatim',
    mu_a: 40, mu_b: 20, sigma_a: 5, sigma_b: 5, baseline_confidence: 1.0,
    gap_kind: 'large', expected_winner: 'A', variant_a_id: VA, variant_b_id: VB,
  };
}

const db = makeClient();
const BANK = `[TEST] judge-eval bank ${Date.now()}`;
const TS = `[TEST] judge-eval ts ${Date.now()}`;

(db ? describe : describe.skip)('judge-eval persistence (integration)', () => {
  let enabled = false;
  let bankId = '';
  const testSetIds: string[] = [];

  beforeAll(async () => {
    if (!db) return;
    enabled = await judgeEvalTablesExist(db);
  });

  afterAll(async () => {
    if (!db || !enabled || !bankId) return;
    // FK CASCADE: deleting the bank removes test sets → members; runs/calls cascade from runs.
    await db.from('judge_eval_pair_banks').delete().eq('id', bankId);
  });

  it('materializes a frozen test set and compares two runs on the same pairs', async () => {
    if (!db || !enabled) {
      console.warn('judge_eval_* tables absent — skipping (deploy migration to staging first)');
      return;
    }
    bankId = await upsertPairBank(db, {
      name: BANK,
      pairs: [pair('art#1', 'article'), pair('art#2', 'article'), pair('para#1', 'paragraph')],
    });
    const bank = await loadPairBankByName(db, BANK);
    expect(bank).not.toBeNull();

    const { testSet, created } = await getOrCreateTestSet(db, bank!, {
      name: TS, strategy: 'random', seed: 1, sizeArticle: 2, sizeParagraph: 1,
    });
    expect(created).toBe(true);
    testSetIds.push(testSet.id);

    // Frozen members resolve back to 3 pairs (kind=both).
    const { pairs } = await loadTestSetPairs(db, testSet.id, 'both');
    expect(pairs.length).toBe(3);

    // Two runs, different settings, SAME test set.
    const runA = await upsertRun(db, {
      testSetId: testSet.id, judgeModel: 'qwen-2.5-7b-instruct', temperature: 0,
      reasoningEffort: null, kindFilter: 'both', promptVariant: null, repeats: 1,
    });
    const runB = await upsertRun(db, {
      testSetId: testSet.id, judgeModel: 'gpt-4.1-nano', temperature: 1,
      reasoningEffort: null, kindFilter: 'both', promptVariant: null, repeats: 1,
    });
    expect(runA.runId).not.toBe(runB.runId);

    await replaceCalls(db, runA.runId, [call('art#1', 'article', 0, 1.0), call('para#1', 'paragraph', 0, 1.0)]);
    await replaceCalls(db, runB.runId, [call('art#1', 'article', 0, 0.5), call('para#1', 'paragraph', 0, 0.5)]);

    // Idempotency: same settings → same run id (upsert by settings_key).
    const runAagain = await upsertRun(db, {
      testSetId: testSet.id, judgeModel: 'qwen-2.5-7b-instruct', temperature: 0,
      reasoningEffort: null, kindFilter: 'both', promptVariant: null, repeats: 1,
    });
    expect(runAagain.runId).toBe(runA.runId);

    // Leaderboard scoped to the test set shows both runs, comparable.
    const { data: board, error } = await db
      .from('judge_eval_settings_leaderboard')
      .select('*')
      .eq('test_set_id', testSet.id);
    if (error) throw error;
    const runIds = new Set((board ?? []).map((r) => r.eval_run_id));
    expect(runIds.has(runA.runId)).toBe(true);
    expect(runIds.has(runB.runId)).toBe(true);

    // Audit + ground-truth snapshot round-trip: the new columns persist and read back intact.
    const { data: persisted, error: readErr } = await db
      .from('judge_eval_calls')
      .select('pair_label, forward_prompt, forward_reasoning, reasoning_trace_format, mu_a, mu_b, gap_kind, expected_winner, variant_a_id')
      .eq('eval_run_id', runA.runId)
      .eq('pair_label', 'art#1')
      .single();
    if (readErr) throw readErr;
    expect(persisted!.forward_prompt).toContain('## Text A');
    expect(persisted!.forward_reasoning).toBe('A is stronger.');
    expect(persisted!.reasoning_trace_format).toBe('verbatim');
    expect(Number(persisted!.mu_a)).toBe(40);
    expect(Number(persisted!.mu_b)).toBe(20);
    expect(persisted!.gap_kind).toBe('large');
    expect(persisted!.expected_winner).toBe('A');
    expect(persisted!.variant_a_id).toBe(VA);
  }, 30000);
});
