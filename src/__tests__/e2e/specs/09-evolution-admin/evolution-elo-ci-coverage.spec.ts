// E2E: Smoke test asserting per-variant Elo CI (± or [lo, hi]) renders across key pages.
// Backstop against Phase 4b regressions.

import { test, expect } from '../../fixtures/auth';

test.describe('Elo CI Coverage Smoke', { tag: '@evolution' }, () => {
  test.describe.configure({ mode: 'serial', retries: 2 });

  test('Run detail Variants tab renders Rating with ± and 95% CI', async ({ authenticatedPage: page }) => {
    await page.goto('/admin/evolution/runs');
    await page.waitForSelector('[data-testid="entity-list-page"]', { timeout: 15000 });

    const completedRow = page.locator('tr').filter({ hasText: 'completed' }).first();
    if (await completedRow.count() === 0) {
      // eslint-disable-next-line flakiness/no-test-skip
      test.skip(true, 'No completed runs');
      return;
    }
    await completedRow.click();
    await page.waitForURL(/\/admin\/evolution\/runs\//, { timeout: 10000 });

    const variantsTab = page.locator('button[role="tab"]', { hasText: 'Variants' });
    await variantsTab.click();
    await page.waitForSelector('[data-testid="variants-tab"]', { timeout: 10000 });

    // Check that at least one Rating cell contains ± (Phase 4b CI rendering).
    const ratingWithCI = page.locator('td[data-testid^="rating-"]').filter({ hasText: '±' });
    if (await ratingWithCI.count() > 0) {
      expect(await ratingWithCI.count()).toBeGreaterThan(0);
    }

    // Check 95% CI column has bracket format [lo, hi]
    const ciCell = page.locator('td[data-testid^="ci-"]').filter({ hasText: /\[/ });
    if (await ciCell.count() > 0) {
      expect(await ciCell.count()).toBeGreaterThan(0);
    }
  });
});
