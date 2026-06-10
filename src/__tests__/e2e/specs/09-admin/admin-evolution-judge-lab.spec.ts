// E2E for the Judge Lab admin tool. Seeds a pair-bank + frozen test set + a PRE-COMPLETED
// eval run + calls directly (the leaderboard/drill-down read existing rows — no live sweep
// needed), then asserts the leaderboard renders per-kind rows and drill-down to run detail
// works. Live-sweep launch is exercised via the engine's E2E_TEST_MODE stub elsewhere; here
// we avoid it to keep the spec deterministic and free of real LLM spend.
// (create_tool_systematic_judge_evaluation_evolution_20260606)

import { adminTest, expect } from '../../fixtures/admin-auth';
import { safeGoto } from '@/lib/testing/safe-goto';
import {
  getEvolutionServiceClient,
  trackEvolutionId,
  cleanupAllTrackedEvolutionData,
} from '../../helpers/evolution-test-data-factory';

const STAMP = Date.now();
const BANK_NAME = `[TEST_EVO] judge-lab bank ${STAMP}`;
const TEST_SET_NAME = `[TEST_EVO] judge-lab ts ${STAMP}`;
const VA = '11111111-1111-4111-8111-111111111111';
const VB = '22222222-2222-4222-8222-222222222222';

adminTest.describe('Judge Lab', { tag: '@evolution' }, () => {
  adminTest.afterAll(async () => {
    await cleanupAllTrackedEvolutionData();
  });

  adminTest('shows the leaderboard for a seeded eval run and drills into run detail', async ({ adminPage }) => {
    const db = getEvolutionServiceClient();

    // Skip cleanly if the judge_eval_* migration hasn't been deployed to staging yet.
    const probe = await db.from('judge_eval_pair_banks').select('id').limit(1);
    if (probe.error) {
      // eslint-disable-next-line flakiness/no-test-skip -- infrastructure limitation: judge_eval_* migration deploys on merge to main; skip until the tables exist on staging.
      adminTest.skip(true, 'judge_eval_* tables not deployed yet');
      return;
    }

    // Seed: pair-bank → test set + members → completed run → calls.
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
      .from('judge_eval_runs')
      .insert({ test_set_id: testSetId, judge_model: 'qwen-2.5-7b-instruct', temperature: 0, kind_filter: 'both', prompt_variant_hash: 'e2ehash', repeats: 1, settings_key: `e2e-${STAMP}` })
      .select('id')
      .single();
    expect(run.error).toBeNull();
    const runId = run.data!.id;
    // Two calls on the same pair: repeat 0 = fully-populated audit + snapshot; repeat 1 = a legacy
    // pre-migration row (all audit/snapshot columns NULL) to exercise the empty-state render path.
    const callsRes = await db.from('judge_eval_calls').insert([
      {
        eval_run_id: runId, pair_label: 'art#1', pair_kind: 'article', comparison_mode: 'article',
        repeat_index: 0, forward_winner: 'A', reverse_winner: 'A', winner: 'A', confidence: 1.0,
        forward_prompt: '## Text A\nalpha article body\n## Text B\nbeta article body\nYour answer: A|B|TIE',
        reverse_prompt: '## Text A\nbeta article body\n## Text B\nalpha article body\nYour answer: A|B|TIE',
        forward_reasoning: 'A reads more clearly.', reverse_reasoning: 'A still reads more clearly.',
        reasoning_trace_format: 'verbatim', forward_raw: 'Your answer: A', reverse_raw: 'Your answer: B',
        mu_a: 40, mu_b: 20, sigma_a: 5, sigma_b: 5, baseline_confidence: 1.0,
        gap_kind: 'large', expected_winner: 'A', variant_a_id: VA, variant_b_id: VB,
      },
      {
        eval_run_id: runId, pair_label: 'art#1', pair_kind: 'article', comparison_mode: 'article',
        repeat_index: 1, forward_winner: 'A', reverse_winner: 'B', winner: 'TIE', confidence: 0.5,
      },
    ]);
    expect(callsRes.error).toBeNull();

    // Open Judge Lab and select the seeded test set (hydration: wait for the select to load options).
    await safeGoto(adminPage, '/admin/evolution/judge-lab');
    const select = adminPage.getByTestId('test-set-select');
    await expect(select).toBeVisible({ timeout: 30000 });
    // Options are keyed by test-set id; wait for the seeded option to hydrate, then select it.
    await expect(select.locator(`option[value="${testSetId}"]`)).toHaveCount(1, { timeout: 30000 });
    await select.selectOption(testSetId);

    // Leaderboard shows at least one row for this run.
    const rows = adminPage.getByTestId('leaderboard-row');
    await expect(rows.first()).toBeVisible({ timeout: 30000 });

    // Drill into run detail.
    await safeGoto(adminPage, `/admin/evolution/judge-lab/runs/${runId}`);
    await expect(adminPage.getByTestId('run-kind-aggregates')).toBeVisible({ timeout: 30000 });
    await expect(adminPage.getByTestId('kind-block-article')).toContainText(/decisive/i);

    // Match history: open the dedicated view, expand the populated match, assert the full judge
    // I/O + both content pieces are shown.
    await safeGoto(adminPage, `/admin/evolution/judge-lab/runs/${runId}/matches`);
    await expect(adminPage.getByTestId('matches-table')).toBeVisible({ timeout: 30000 });
    await expect(adminPage.getByTestId('match-row').first()).toBeVisible({ timeout: 30000 });
    await adminPage.getByTestId('match-expand').first().click();
    await expect(adminPage.getByTestId('match-audit-detail').first()).toBeVisible({ timeout: 30000 });
    await expect(adminPage.getByTestId('match-text-a').first()).toContainText('alpha article body');
    await expect(adminPage.getByTestId('judge-input-forward').first()).toContainText('## Text A');
    await expect(adminPage.getByTestId('judge-output-forward').first()).toContainText('A');
    await expect(adminPage.getByTestId('reasoning-format-state').first()).toContainText(/verbatim/i);

    // Backward-compat: the legacy all-null row expands without crashing and shows the empty state.
    await adminPage.getByTestId('match-expand').nth(1).click();
    await expect(adminPage.getByTestId('match-audit-detail').nth(1)).toBeVisible({ timeout: 30000 });
    await expect(adminPage.getByTestId('reasoning-format-state').nth(1)).toContainText(/not requested/i);
  });
});
