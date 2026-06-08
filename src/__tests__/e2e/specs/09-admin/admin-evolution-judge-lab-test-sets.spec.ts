// E2E for Judge Lab Test Set view/edit/clone (improve_judge_lab_evolution_20260707 Phase 3-4).
// Seeds a pair-bank + frozen test set + members directly, then exercises: View → contents detail
// (Elo columns), Edit metadata (description), and Clone → a new frozen set. No live sweep / LLM
// spend. Cleanup cascades from the tracked pair-bank (covers test sets, members, and the clone).

import { adminTest, expect } from '../../fixtures/admin-auth';
import { safeGoto } from '@/lib/testing/safe-goto';
import {
  getEvolutionServiceClient,
  trackEvolutionId,
  cleanupAllTrackedEvolutionData,
} from '../../helpers/evolution-test-data-factory';

const STAMP = Date.now();
const BANK_NAME = `[TEST_EVO] judge-lab ts-crud bank ${STAMP}`;
const TEST_SET_NAME = `[TEST_EVO] ts-crud ${STAMP}`;
const CLONE_NAME = `[TEST_EVO] ts-crud-clone ${STAMP}`;
const VA = '11111111-1111-4111-8111-111111111111';
const VB = '22222222-2222-4222-8222-222222222222';

adminTest.describe('Judge Lab — Test Set view/edit/clone', { tag: '@evolution' }, () => {
  adminTest.afterAll(async () => {
    await cleanupAllTrackedEvolutionData();
  });

  adminTest('views contents, edits metadata, and clones a frozen test set', async ({ adminPage }) => {
    const db = getEvolutionServiceClient();

    const probe = await db.from('judge_eval_pair_banks').select('id').limit(1);
    if (probe.error) {
      // eslint-disable-next-line flakiness/no-test-skip -- infrastructure limitation: judge_eval_* migration deploys on merge to main; skip until the tables exist on staging.
      adminTest.skip(true, 'judge_eval_* tables not deployed yet');
      return;
    }

    // Seed: pair-bank → frozen test set + member.
    const bank = await db
      .from('judge_eval_pair_banks')
      .insert({
        name: BANK_NAME,
        pairs: [
          { label: 'art#1', pair_kind: 'article', variant_a_id: VA, variant_b_id: VB, text_a: 'alpha text', text_b: 'beta text', mu_a: 40, mu_b: 20, sigma_a: 5, sigma_b: 5, expected_winner: 'A', gap_kind: 'large', baseline_confidence: 1.0 },
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

    // View contents: the detail page renders the per-pair table with the pair row.
    await safeGoto(adminPage, `/admin/evolution/judge-lab/test-sets/${testSetId}`);
    await expect(adminPage.getByTestId('test-set-pairs-table')).toBeVisible({ timeout: 30000 });
    await expect(adminPage.getByTestId('pair-row').first()).toBeVisible({ timeout: 30000 });

    // From the list, locate the seeded row (newest-first, no pagination on this page).
    await safeGoto(adminPage, '/admin/evolution/judge-lab/test-sets');
    const row = adminPage.getByTestId('test-set-row').filter({ hasText: TEST_SET_NAME });
    await expect(row).toBeVisible({ timeout: 30000 });

    // Edit metadata: change description, save, panel closes.
    await row.getByTestId('ts-edit').click();
    const editPanel = adminPage.getByTestId('test-set-edit');
    await expect(editPanel).toBeVisible();
    await editPanel.getByTestId('edit-description').fill('edited via e2e');
    await editPanel.getByTestId('edit-save').click();
    await expect(adminPage.getByTestId('test-set-edit')).toBeHidden({ timeout: 30000 });

    // Clone: create a new frozen set; it appears as a new row.
    await row.getByTestId('ts-clone').click();
    const clonePanel = adminPage.getByTestId('test-set-clone');
    await expect(clonePanel).toBeVisible();
    await clonePanel.getByTestId('clone-name').fill(CLONE_NAME);
    await clonePanel.getByTestId('clone-submit').click();
    await expect(
      adminPage.getByTestId('test-set-row').filter({ hasText: CLONE_NAME }),
    ).toBeVisible({ timeout: 30000 });
  });
});
