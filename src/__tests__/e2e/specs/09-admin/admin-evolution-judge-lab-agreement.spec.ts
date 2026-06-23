// E2E for the Judge Lab Agreement Sweep. Seeds a pair-bank + frozen test set + a PRE-COMPLETED
// agreement run + calls + criterion verdicts directly (the leaderboard / run-detail read existing
// rows — no live sweep, no real LLM spend), then asserts the UX-overhaul affordances:
//   - launcher: tooltips on column headers + <details>What do these mean?</summary> block
//   - launcher: live debounced cost preview updates when `repeats` changes
//   - leaderboard: rows render with CI brackets [low, high] + worst-criterion column
//   - detail page: 6 tiles (per-pair / per-repeat / both-decisive / single-abstain + 2 position-bias)
//   - detail page: "View all matches →" link navigates to the new /matches sub-route
//   - /matches sub-route: rows render; expand fetches audit detail; `?disagree=1` filter narrows
//
// Tagged @evolution (admin is host-gated). Cleanup via the tracked bank id (FK CASCADE removes the
// test set → agreement run → calls → criterion verdicts).
// (Compare_critera_judge_vs_whole_article_paragraph_judge_evolution_20260619 +
//  UX overhaul: fix_ux_bugs_judge_lab_agreement_20260621)

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

  adminTest('seeded agreement run renders in the leaderboard, detail, and matches sub-route', async ({ adminPage }) => {
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
          holistic_forward_raw: 'A', holistic_reverse_raw: 'A',
          rubric_forward_raw: 'Clarity: A\nDepth: A', rubric_reverse_raw: 'Clarity: A\nDepth: A',
          mu_a: 40, mu_b: 20, sigma_a: 5, sigma_b: 5, baseline_confidence: 1.0,
          gap_kind: 'large', expected_winner: 'A', variant_a_id: VA, variant_b_id: VB,
        },
        {
          agreement_run_id: runId, pair_label: 'art#1', pair_kind: 'article', repeat_index: 1,
          holistic_winner: 'A', holistic_confidence: 1.0, rubric_winner: 'B', rubric_confidence: 1.0,
          rubric_matches_holistic: false, cost_usd: 0.0004,
          holistic_forward_raw: 'A', holistic_reverse_raw: 'B', // forward != reverse → holistic position bias
          rubric_forward_raw: 'Clarity: B\nDepth: B', rubric_reverse_raw: 'Clarity: B\nDepth: B',
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

    // ── Launcher: tooltips + definitions block + leaderboard CI brackets ─────────────────────────
    await adminPage.goto('/admin/evolution/judge-lab/agreement');
    const select = adminPage.getByTestId('agreement-test-set-select');
    await expect(select).toBeVisible({ timeout: 30000 });
    await expect(select.locator(`option[value="${testSetId}"]`)).toHaveCount(1, { timeout: 30000 });
    await select.selectOption(testSetId);

    // <details>What do these mean?</summary> block present + expandable.
    await expect(adminPage.getByTestId('agreement-definitions').first()).toBeVisible();

    // Title attributes on terse leaderboard headers.
    const perRepHeader = adminPage.locator('[data-testid="agreement-leaderboard"] th[title]', { hasText: 'Per-rep' });
    await expect(perRepHeader).toHaveAttribute('title', /Per-repeat agreement/);

    // Leaderboard row link to run detail; CI bracket [lo, hi] format renders on rate cells.
    const row = adminPage.getByTestId('agreement-leaderboard-row').first();
    await expect(row).toBeVisible({ timeout: 30000 });
    await expect(row.locator('a')).toHaveAttribute('href', `/admin/evolution/judge-lab/agreement/runs/${runId}`);
    await expect(row.getByTestId('agreement-leaderboard-per-rep')).toContainText('[');

    // ── Detail page: 6 tiles + new position-bias tiles + View-all-matches link ───────────────────
    await adminPage.goto(`/admin/evolution/judge-lab/agreement/runs/${runId}`);
    await expect(adminPage.getByTestId('agreement-metrics')).toBeVisible({ timeout: 30000 });
    await expect(adminPage.getByText('Per-pair (most-common) agreement')).toBeVisible();
    await expect(adminPage.getByText('Per-repeat agreement')).toBeVisible();
    await expect(adminPage.getByText('Both-decisive agreement')).toBeVisible();
    await expect(adminPage.getByText('Single-judge abstain')).toBeVisible();
    await expect(adminPage.getByText('Holistic position bias')).toBeVisible();
    await expect(adminPage.getByText('Rubric position bias')).toBeVisible();

    // Per-criterion table renders both seeded criteria.
    await expect(adminPage.getByTestId('per-criterion-table')).toContainText('Clarity');
    await expect(adminPage.getByTestId('per-criterion-table')).toContainText('Depth');

    // Kind toggle re-slices to article.
    await adminPage.getByTestId('view-article').click();
    await expect(adminPage.getByTestId('kind-block-article')).toBeVisible({ timeout: 30000 });

    // View all matches → /matches sub-route.
    await adminPage.getByTestId('agreement-view-all-matches').click();
    await expect(adminPage).toHaveURL(/\/matches$/);

    // ── /matches sub-route: rows render; expand fetches audit; ?disagree=1 narrows ───────────────
    const matchesTable = adminPage.getByTestId('agreement-matches-table');
    await expect(matchesTable).toBeVisible({ timeout: 30000 });
    const rows = adminPage.getByTestId('agreement-match-row');
    const allCount = await rows.count();
    expect(allCount).toBeGreaterThanOrEqual(2);

    // Disagree filter narrows to the both-decisive opposite-winner call (repeat 1).
    await adminPage.getByTestId('agreement-disagree-only').check();
    await expect(adminPage).toHaveURL(/disagree=1/);
    await expect.poll(() => rows.count(), { timeout: 5000 }).toBeLessThan(allCount);
    await adminPage.getByTestId('agreement-disagree-only').uncheck();
    await expect(adminPage).not.toHaveURL(/disagree=1/);

    // Expand first row → lazy audit fetch shows the 4 raws + per-criterion table.
    await rows.first().getByTestId('agreement-match-expand').click();
    await expect(adminPage.getByTestId('agreement-audit-detail')).toBeVisible({ timeout: 5000 });
    await expect(adminPage.getByTestId('agreement-criterion-detail')).toBeVisible();
  });

  adminTest('launcher: live cost preview updates as repeats changes', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/judge-lab/agreement');
    const repeatsInput = adminPage.getByTestId('agreement-repeats-input');
    const preview = adminPage.getByTestId('agreement-cost-preview');
    await expect(repeatsInput).toBeVisible({ timeout: 30000 });
    await expect(preview).toBeVisible();

    // Change repeats to a distinctive value and wait for the debounced preview to reflect it.
    // Playwright's expect(locator).toContainText auto-retries until the assertion passes or
    // the timeout fires — the right pattern for a debounced UI update.
    await repeatsInput.fill('15');
    await expect(preview).toContainText(/15 repeats|Cost preview unavailable/, { timeout: 8000 });
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
