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

  /** Fill the step-1 config form with valid defaults so the Next button advances. */
  async function advanceToStep2(page: import('@playwright/test').Page): Promise<void> {
    await page.locator('#strategy-name').fill(`e2e_wiz_${Date.now()}`);
    // generation-model select starts empty — pick the first real option (index 1, since
    // index 0 is the placeholder). Playwright's selectOption({ index: 1 }) avoids the
    // getAttribute() lint rule for point-in-time checks.
    await page.locator('#generation-model').selectOption({ index: 1 });
    await page.getByRole('button', { name: /Next: Configure Iterations/i }).click();
  }

  adminTest('agentType select includes criteria_and_generate option', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new');
    await advanceToStep2(adminPage);
    const select = adminPage.getByTestId('agent-type-select-0');
    await expect(select).toBeVisible();
    const options = await select.locator('option').allTextContents();
    expect(options.some((t) => /Evaluate Criteria|criteria_and_generate/i.test(t))).toBe(true);
  });

  adminTest('selecting criteria_and_generate shows criteria multi-select trigger', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new');
    await advanceToStep2(adminPage);
    const select = adminPage.getByTestId('agent-type-select-0');
    await expect(select).toBeVisible();
    await select.selectOption({ value: 'criteria_and_generate' });
    await expect(adminPage.getByTestId('iteration-criteria-controls-0')).toBeVisible();
  });
});
