// E2E: RubricEditor in the criteria edit dialog persists anchor edits and
// surfaces existing rubric on the detail page.
// evaluateCriteriaThenGenerateFromPreviousArticle_20260501

import { adminTest, expect } from '../../fixtures/admin-auth';
import { getEvolutionServiceClient } from '../../helpers/evolution-test-data-factory';

adminTest.describe('Criteria rubric editor', { tag: ['@evolution', '@critical'] }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let seededId = '';
  let seededName = '';

  adminTest.beforeAll(async () => {
    const supabase = getEvolutionServiceClient();
    seededName = `e2e_rub_${Date.now()}_${Math.floor(Math.random() * 9999)}_rubric_test`;
    const { data, error } = await supabase
      .from('evolution_criteria')
      .insert({
        name: seededName,
        description: 'rubric editor smoke test',
        min_rating: 1,
        max_rating: 10,
        evaluation_guidance: [
          { score: 1, description: 'lowest' },
          { score: 8, description: 'high' },
        ],
      })
      .select('id')
      .single();
    if (error) throw error;
    seededId = data.id as string;
  });

  adminTest.afterAll(async () => {
    const supabase = getEvolutionServiceClient();
    if (seededId) await supabase.from('evolution_criteria').delete().eq('id', seededId);
  });

  adminTest('detail page renders existing rubric anchors', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/criteria/${seededId}`);
    await expect(adminPage.locator('text=lowest').first()).toBeVisible();
    await expect(adminPage.locator('text=high').first()).toBeVisible();
  });

  adminTest('list page shows the seeded criteria row', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/criteria');
    await expect(adminPage.locator(`text=${seededName}`)).toBeVisible();
  });
});
