// Integration tests for rubric-based judging: the runtime resolver
// (getJudgeRubricForEvaluation) + validateJudgeRubricId against real Supabase.
// Verifies normalize-on-read weights, soft-deleted/archived criteria are dropped +
// renormalized, all-archived → null, and validation behavior.
// [TEST_EVO]-prefixed rows with afterAll cleanup (require-test-cleanup).

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getJudgeRubricForEvaluation,
  validateJudgeRubricId,
} from '@evolution/services/judgeRubricActions';

const STAMP = `${Date.now()}`;
// evolution_criteria_name_format requires `^[A-Za-z][a-zA-Z0-9_-]*$` (must start with a
// letter; no brackets/spaces), so the usual [TEST_EVO] prefix is illegal for criteria. The
// embedded `-<13-digit ms>-` is still matched by evolution_is_test_name → is_test_content.
const critName = (k: string): string => `TESTEVO-judgerubric-${k}-${STAMP}-c`;

describe('Evolution Judge Rubric Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesExist = false;
  const cid: { a: string; b: string; c: string } = { a: '', b: '', c: '' };
  let rubricId = '';

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    // Probe the new tables; skip cleanly if migrations haven't been applied locally.
    const probe = await supabase.from('evolution_judge_rubrics').select('id').limit(1);
    tablesExist = !probe.error;
    if (!tablesExist) return;

    // Three criteria (conciseness/structure/style-equivalent).
    for (const [k, name] of [['a', critName('a')], ['b', critName('b')], ['c', critName('c')]] as const) {
      const { data, error } = await supabase
        .from('evolution_criteria')
        .insert({ name, description: `dim ${k}`, min_rating: 1, max_rating: 10 })
        .select('id')
        .single();
      if (error) throw error;
      cid[k] = data!.id as string;
    }

    const { data: rub, error: rErr } = await supabase
      .from('evolution_judge_rubrics')
      .insert({ name: `[TEST_EVO]_rubric_${STAMP}`, description: 'test rubric' })
      .select('id')
      .single();
    if (rErr) throw rErr;
    rubricId = rub!.id as string;

    // Raw weights 30/40/30 → expect normalized .30/.40/.30.
    await supabase.from('evolution_judge_rubric_dimensions').insert([
      { rubric_id: rubricId, criteria_id: cid.a, weight: 30, position: 0 },
      { rubric_id: rubricId, criteria_id: cid.b, weight: 40, position: 1 },
      { rubric_id: rubricId, criteria_id: cid.c, weight: 30, position: 2 },
    ]);
  });

  afterAll(async () => {
    if (!tablesExist) return;
    // Rubric delete cascades dimensions; then criteria (RESTRICT no longer blocks).
    if (rubricId) await supabase.from('evolution_judge_rubrics').delete().eq('id', rubricId);
    const ids = Object.values(cid);
    if (ids.length) await supabase.from('evolution_criteria').delete().in('id', ids);
  });

  it('resolves the rubric with normalize-on-read weights', async () => {
    if (!tablesExist) return;
    const resolved = await getJudgeRubricForEvaluation(supabase, rubricId);
    expect(resolved).not.toBeNull();
    expect(resolved!.rubricId).toBe(rubricId);
    const byCrit = new Map(resolved!.dimensions.map((d) => [d.criteriaId, d.weight]));
    expect(byCrit.get(cid.a)).toBeCloseTo(0.3, 6);
    expect(byCrit.get(cid.b)).toBeCloseTo(0.4, 6);
    expect(byCrit.get(cid.c)).toBeCloseTo(0.3, 6);
    const sum = resolved!.dimensions.reduce((s, d) => s + d.weight, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('validateJudgeRubricId passes for a valid rubric with ≥1 active dimension', async () => {
    if (!tablesExist) return;
    await expect(validateJudgeRubricId(rubricId, supabase)).resolves.toBeUndefined();
  });

  it('drops a soft-deleted/archived criterion and renormalizes survivors', async () => {
    if (!tablesExist) return;
    // Archive criterion c → remaining a(30)+b(40) renormalize to ~.4286/.5714.
    await supabase.from('evolution_criteria').update({ status: 'archived' }).eq('id', cid.c);
    const resolved = await getJudgeRubricForEvaluation(supabase, rubricId);
    expect(resolved!.dimensions).toHaveLength(2);
    const byCrit = new Map(resolved!.dimensions.map((d) => [d.criteriaId, d.weight]));
    expect(byCrit.has(cid.c)).toBe(false);
    expect(byCrit.get(cid.a)).toBeCloseTo(30 / 70, 6);
    expect(byCrit.get(cid.b)).toBeCloseTo(40 / 70, 6);
    // restore for other tests / determinism
    await supabase.from('evolution_criteria').update({ status: 'active' }).eq('id', cid.c);
  });

  it('returns null (holistic fallback) when all dimensions are archived', async () => {
    if (!tablesExist) return;
    await supabase.from('evolution_criteria').update({ status: 'archived' }).in('id', Object.values(cid));
    const resolved = await getJudgeRubricForEvaluation(supabase, rubricId);
    expect(resolved).toBeNull();
    await expect(validateJudgeRubricId(rubricId, supabase)).rejects.toThrow();
    await supabase.from('evolution_criteria').update({ status: 'active' }).in('id', Object.values(cid));
  });

  it('returns null for a missing rubric id', async () => {
    if (!tablesExist) return;
    const resolved = await getJudgeRubricForEvaluation(supabase, '00000000-0000-4000-8000-000000000000');
    expect(resolved).toBeNull();
  });
});
