// E2E: Strategy detail page has a Variants tab rendering variants across all runs of
// that strategy, with Elo CI columns.

import { test, expect } from '../../fixtures/auth';

test.describe('Strategy Variants Tab', { tag: '@evolution' }, () => {
  test('Variants tab renders on strategy detail page with CI columns', async ({ authenticatedPage: page }) => {
    // Navigate to strategy list and open the first strategy
    await page.goto('/admin/evolution/strategies');
    await page.waitForSelector('[data-testid="entity-list-page"]', { timeout: 15000 });

    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.count() === 0) {
      // eslint-disable-next-line flakiness/no-test-skip
      test.skip(true, 'No strategies in DB');
      return;
    }
    await firstRow.click();
    await page.waitForURL(/\/admin\/evolution\/strategies\//, { timeout: 10000 });

    // Click the Variants tab
    const variantsTab = page.locator('button[role="tab"]', { hasText: 'Variants' });
    await expect(variantsTab).toBeVisible({ timeout: 10000 });
    await variantsTab.click();

    // Variants table should appear
    const table = page.locator('[data-testid="variants-tab"]');
    await expect(table).toBeVisible({ timeout: 10000 });

    // If there are variants, check that CI header exists
    const ciHeader = page.locator('th', { hasText: '95% CI' });
    await expect(ciHeader).toBeVisible();
  });
});
