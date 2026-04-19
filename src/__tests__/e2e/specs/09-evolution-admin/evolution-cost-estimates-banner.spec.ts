// E2E: Cost Estimates tab banner logic — distinguishes pre-instrumentation from rollup-missing.

import { test, expect } from '../../fixtures/auth';

test.describe('Cost Estimates Banner', { tag: '@evolution' }, () => {
  test('Cost Estimates tab renders on a completed run without crashing', async ({ authenticatedPage: page }) => {
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

    const costEstimatesTab = page.locator('button[role="tab"]', { hasText: 'Cost Estimates' });
    await costEstimatesTab.click();

    // Wait for either the tab content, the pre-instrumentation badge, or the rollup-missing badge.
    await page.waitForSelector(
      '[data-testid="cost-estimates-tab"], [data-testid="cost-estimates-pre-instrumentation"], [data-testid="cost-estimates-rollup-missing"]',
      { timeout: 15000 },
    );

    // The summary section should always render
    const summary = page.locator('[data-testid="cost-estimates-summary"]');
    await expect(summary).toBeVisible();
  });
});
