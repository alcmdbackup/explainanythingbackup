// E2E for the Judge Lab Agreement Sweep. Seeds a pair-bank + frozen test set + a PRE-COMPLETED
// agreement run + calls + criterion verdicts directly (the leaderboard / run-detail read existing
// rows — no live sweep, no real LLM spend), then asserts the leaderboard renders, drill-down to run
// detail works, the kind toggle re-slices, and the per-criterion + disagreement tables render.
// Tagged @evolution (admin is host-gated). Cleanup via the tracked bank id (FK CASCADE removes the
// test set → agreement run → calls → criterion verdicts).
// (Compare_critera_judge_vs_whole_article_paragraph_judge_evolution_20260619)

import { adminTest, expect } from '../../fixtures/admin-auth';
import {
  getEvolutionServiceClient,
  trackEvolutionId,
  cleanupAllTrackedEvolutionData,
} from '../../helpers/evolution-test-data-factory';

const STAMP = Date.now();
const BANK_NAME = `[TEST_EVO] judge-lab agreement bank ${STAMP}`;
const TEST_SET_NAME = `[TEST_EVO] judge-lab agreement ts ${STAMP}`;
const VA = '11111111-1111-4111-8111-111111111111';
const VB = '22222222-2222-4222-8222-222222222222';
const RUBRIC_ID = '55555555-5555-4555-8555-555555555555';

adminTest.describe('Judge Lab · Agreement', { tag: '@evolution' }, () => {
  adminTest.afterAll(async () => {
    await cleanupAllTrackedEvolutionData();
  });

  adminTest('seeded agreement run renders in the leaderboard and run detail', async ({ adminPage }) => {
    const db = getEvolutionServiceClient();

    // Skip cleanly until the agreement migration (20260619000001) is on staging — probe a NEW column.
    const probe = await db.from('judge_eval_agreement_calls').select('rubric_matches_holistic').limit(1);
    if (probe.error) {
      // eslint-disable-next-line flakiness/no-test-skip -- infrastructure limitation: agreement migration deploys on merge to main; skip until columns exist on staging.
      adminTest.skip(true, 'judge_eval_agreement_* tables not deployed yet');
      return;
    }

    // Seed: pair-bank → test set + member → agreement run → calls → criterion verdicts.
    const bank = await db
      .from('judge_eval_pair_banks')
      .insert({
        name: BANK_NAME,
        pairs: [
          { label: 'art#1', pair_kind: 'article', variant_a_id: VA, variant_b_id: VB, text_a: 'a', text_b: 'b', mu_a: 40, mu_b: 20, sigma_a: 5, sigma_b: 5, expected_winner: 'A', gap_kind: 'large', baseline_confidence: 1.0 },
        ],
      })
      .select('id')
      .single();
    expect(bank.error).toBeNull();
    const bankId = bank.data!.id;
    trackEvolutionId('judge_eval_pair_bank', bankId);

    const ts = await db
      .from('judge_eval_test_sets')
      .insert({ pair_bank_id: bankId, name: TEST_SET_NAME, strategy: 'random', seed: 1, size_article: 1, size_paragraph: 0 })
      .select('id')
      .single();
    expect(ts.error).toBeNull();
    const testSetId = ts.data!.id;
    await db.from('judge_eval_test_set_members').insert({ test_set_id: testSetId, pair_label: 'art#1', pair_kind: 'article' });

    const run = await db
      .from('judge_eval_agreement_runs')
      .insert({
        test_set_id: testSetId,
        judge_model: 'qwen-2.5-7b-instruct',
        temperature: 0,
        kind_filter: 'both',
        judge_rubric_id: RUBRIC_ID,
        repeats: 2,
        settings_key: `agreement-e2e-${STAMP}`,
      })
      .select('id')
      .single();
    expect(run.error).toBeNull();
    const runId = run.data!.id;

    // repeat 0: holistic A / rubric A (agree). repeat 1: holistic A / rubric B (both decisive → disagreement).
    const callsRes = await db
      .from('judge_eval_agreement_calls')
      .insert([
        {
          agreement_run_id: runId, pair_label: 'art#1', pair_kind: 'article', repeat_index: 0,
          holistic_winner: 'A', holistic_confidence: 1.0, rubric_winner: 'A', rubric_confidence: 1.0,
          rubric_matches_holistic: true, cost_usd: 0.0004,
          mu_a: 40, mu_b: 20, sigma_a: 5, sigma_b: 5, baseline_confidence: 1.0,
          gap_kind: 'large', expected_winner: 'A', variant_a_id: VA, variant_b_id: VB,
        },
        {
          agreement_run_id: runId, pair_label: 'art#1', pair_kind: 'article', repeat_index: 1,
          holistic_winner: 'A', holistic_confidence: 1.0, rubric_winner: 'B', rubric_confidence: 1.0,
          rubric_matches_holistic: false, cost_usd: 0.0004,
          mu_a: 40, mu_b: 20, sigma_a: 5, sigma_b: 5, baseline_confidence: 1.0,
          gap_kind: 'large', expected_winner: 'A', variant_a_id: VA, variant_b_id: VB,
        },
      ])
      .select('id, repeat_index');
    expect(callsRes.error).toBeNull();
    const callId0 = callsRes.data!.find((c) => c.repeat_index === 0)!.id;
    await db.from('judge_eval_agreement_criterion_verdicts').insert([
      { agreement_call_id: callId0, criteria_id: '33333333-3333-4333-8333-333333333333', criteria_name: 'Clarity', weight: 0.5, dimension_winner: 'A', agrees_with_holistic: true, matches_ground_truth: true, position: 0 },
      { agreement_call_id: callId0, criteria_id: '44444444-4444-4444-8444-444444444444', criteria_name: 'Depth', weight: 0.5, dimension_winner: 'TIE', agrees_with_holistic: null, matches_ground_truth: null, position: 1 },
    ]);

    // Open the Agreement page and select the seeded test set (hydration: wait for option to load).
    await adminPage.goto('/admin/evolution/judge-lab/agreement');
    const select = adminPage.getByTestId('agreement-test-set-select');
    await expect(select).toBeVisible({ timeout: 30000 });
    await expect(select.locator(`option[value="${testSetId}"]`)).toHaveCount(1, { timeout: 30000 });
    await select.selectOption(testSetId);

    // Leaderboard shows a row that links to the run detail.
    const row = adminPage.getByTestId('agreement-leaderboard-row').first();
    await expect(row).toBeVisible({ timeout: 30000 });
    await expect(row.locator('a')).toHaveAttribute('href', `/admin/evolution/judge-lab/agreement/runs/${runId}`);

    // Drill into run detail.
    await adminPage.goto(`/admin/evolution/judge-lab/agreement/runs/${runId}`);
    // Hydration proof: the metric grid renders before we interact with the kind toggle.
    await expect(adminPage.getByTestId('agreement-metrics')).toBeVisible({ timeout: 30000 });
    await expect(adminPage.getByTestId('kind-block-both')).toBeVisible();
    // Per-criterion table renders both seeded criteria.
    await expect(adminPage.getByTestId('per-criterion-table')).toContainText('Clarity');
    await expect(adminPage.getByTestId('per-criterion-table')).toContainText('Depth');
    // The disagreement drill-down lists the repeat-1 conflict.
    await expect(adminPage.getByTestId('disagree-table')).toContainText('art#1');

    // Kind toggle re-slices to article (wait on the post-toggle kind block, not a point-in-time read).
    await adminPage.getByTestId('view-article').click();
    await expect(adminPage.getByTestId('kind-block-article')).toBeVisible({ timeout: 30000 });
  });

  adminTest('Agreement mode link from the Judge Lab launcher navigates to the sub-route', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/judge-lab');
    const agreementMode = adminPage.getByTestId('judge-lab-mode-agreement');
    await expect(agreementMode).toBeVisible({ timeout: 30000 }); // hydration proof before clicking
    await agreementMode.click();
    await expect(adminPage.getByTestId('judge-lab-agreement-launcher')).toBeVisible({ timeout: 30000 });
    await expect(adminPage.getByTestId('agreement-launch')).toBeVisible();
  });
});
