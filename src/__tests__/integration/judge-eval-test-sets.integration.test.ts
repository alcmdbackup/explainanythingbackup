// Integration tests for the Judge Lab test-set frozen-membership contract, against real Supabase.
// Asserts the contract NEGATIVELY: editing a set's metadata leaves its members (and the
// membership-determining strategy/seed/size) untouched, and a manual clone produces a NEW set with
// a distinct member population while the source set's members are unchanged. Auto-skips when the
// judge_eval_* tables aren't deployed to the dev DB.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  updateTestSetMetadata,
  cloneTestSet,
} from '@evolution/lib/judgeEval/persist';

const STAMP = Date.now();
const BANK_NAME = `[TEST_EVO] frozen-contract bank ${STAMP}`;
const SET_NAME = `[TEST_EVO] frozen-contract src ${STAMP}`;
const CLONE_NAME = `[TEST_EVO] frozen-contract clone ${STAMP}`;
const VA = '11111111-1111-4111-8111-111111111111';
const VB = '22222222-2222-4222-8222-222222222222';

function bankPair(label: string) {
  return {
    label,
    pair_kind: 'article' as const,
    variant_a_id: VA,
    variant_b_id: VB,
    text_a: `${label} a`,
    text_b: `${label} b`,
    mu_a: 35,
    mu_b: 25,
    sigma_a: 5,
    sigma_b: 5,
    expected_winner: 'A' as const,
    gap_kind: 'large' as const,
    baseline_confidence: 1.0,
  };
}

async function memberLabels(db: SupabaseClient, testSetId: string): Promise<string[]> {
  const { data } = await db
    .from('judge_eval_test_set_members')
    .select('pair_label')
    .eq('test_set_id', testSetId);
  return (data ?? []).map((m) => m.pair_label as string).sort();
}

describe('Judge Lab test-set frozen-contract (integration)', () => {
  let supabase: SupabaseClient;
  let tablesExist = false;
  let bankId: string | undefined;
  let testSetId: string | undefined;

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    const probe = await supabase.from('judge_eval_pair_banks').select('id').limit(1);
    tablesExist = !probe.error;
    if (!tablesExist) return;

    const bank = await supabase
      .from('judge_eval_pair_banks')
      .insert({ name: BANK_NAME, pairs: [bankPair('art#1'), bankPair('art#2')] })
      .select('id')
      .single();
    bankId = bank.data!.id as string;

    const ts = await supabase
      .from('judge_eval_test_sets')
      .insert({ pair_bank_id: bankId, name: SET_NAME, strategy: 'manual', seed: 1, size_article: 2, size_paragraph: 0 })
      .select('id')
      .single();
    testSetId = ts.data!.id as string;

    await supabase.from('judge_eval_test_set_members').insert([
      { test_set_id: testSetId, pair_label: 'art#1', pair_kind: 'article' },
      { test_set_id: testSetId, pair_label: 'art#2', pair_kind: 'article' },
    ]);
  });

  afterAll(async () => {
    // CASCADE from the bank removes test sets, members, and the clone.
    if (bankId) await supabase.from('judge_eval_pair_banks').delete().eq('id', bankId);
  });

  test('editing metadata leaves membership + strategy/seed/size unchanged', async () => {
    if (!tablesExist) return;
    const before = await memberLabels(supabase, testSetId!);
    const ts0 = (await supabase.from('judge_eval_test_sets').select('*').eq('id', testSetId!).single()).data!;

    await updateTestSetMetadata(supabase, { testSetId: testSetId!, description: 'edited via integration' });

    const ts1 = (await supabase.from('judge_eval_test_sets').select('*').eq('id', testSetId!).single()).data!;
    expect(ts1.description).toBe('edited via integration');
    // Membership-determining fields are untouched.
    expect(ts1.name).toBe(ts0.name);
    expect(ts1.strategy).toBe(ts0.strategy);
    expect(ts1.seed).toBe(ts0.seed);
    expect(ts1.size_article).toBe(ts0.size_article);
    expect(ts1.size_paragraph).toBe(ts0.size_paragraph);
    // Members are byte-for-byte unchanged — there is no code path that mutates them for an existing id.
    expect(await memberLabels(supabase, testSetId!)).toEqual(before);
  });

  test('manual clone yields a NEW set with a distinct member population; source untouched', async () => {
    if (!tablesExist) return;
    const srcBefore = await memberLabels(supabase, testSetId!);

    const { testSet: clone, created } = await cloneTestSet(supabase, {
      sourceTestSetId: testSetId!,
      newName: CLONE_NAME,
      strategy: 'manual',
      manualLabels: ['art#2'], // curated subset: drop art#1
    });
    expect(created).toBe(true);
    expect(clone.id).not.toBe(testSetId);

    // Clone has exactly the curated membership; source is unchanged.
    expect(await memberLabels(supabase, clone.id)).toEqual(['art#2']);
    expect(await memberLabels(supabase, testSetId!)).toEqual(srcBefore);
    // Manual clone records honest per-kind sizes.
    expect(clone.size_article).toBe(1);
    expect(clone.size_paragraph).toBe(0);
  });
});
