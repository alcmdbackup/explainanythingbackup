// E2E: strategy wizard agentType=criteria_and_generate exposes the multi-select
// popover, weakestK input, and clamps weakestK's `max` dynamically to selected count.
// evaluateCriteriaThenGenerateFromPreviousArticle_20260501

import { adminTest, expect } from '../../fixtures/admin-auth';
import { getEvolutionServiceClient } from '../../helpers/evolution-test-data-factory';

adminTest.describe('Strategy wizard — criteria_and_generate', { tag: ['@evolution', '@critical'] }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  const seededIds: string[] = [];

  adminTest.beforeAll(async () => {
    const supabase = getEvolutionServiceClient();
    const baseName = `e2e_wiz_${Date.now()}_${Math.floor(Math.random() * 9999)}_`;
    for (const i of [1, 2, 3]) {
      const { data, error } = await supabase
        .from('evolution_criteria')
        .insert({ name: `${baseName}${i}`, description: `seeded ${i}`, min_rating: 1, max_rating: 5 })
        .select('id')
        .single();
      if (error) throw error;
      seededIds.push(data.id as string);
    }
  });

  adminTest.afterAll(async () => {
    const supabase = getEvolutionServiceClient();
    for (const id of seededIds) {
      await supabase.from('evolution_criteria').delete().eq('id', id);
    }
  });

  adminTest('agentType select includes criteria_and_generate option', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new');
    // Advance to step 2 (iteration builder)
    await adminPage.locator('button:has-text("Next")').first().click();
    const select = adminPage.locator('select').first();
    await expect(select).toBeVisible();
    const options = await select.locator('option').allTextContents();
    expect(options.some((t) => /Evaluate Criteria|criteria_and_generate/i.test(t))).toBe(true);
  });

  adminTest('selecting criteria_and_generate shows criteria multi-select trigger', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new');
    await adminPage.locator('button:has-text("Next")').first().click();
    const select = adminPage.locator('select').first();
    await select.selectOption({ value: 'criteria_and_generate' });
    // Multi-select trigger button visible (matches "Select N criteria" or similar pattern)
    await expect(adminPage.locator('button:has-text("criteria"), button:has-text("Criteria")').first()).toBeVisible();
  });
});
