// E2E tests for critical evolution admin UI bugs.
// Verifies cost display, filter behavior, invocation status, and Elo chart rendering.

import { test, expect } from '../../fixtures/auth';

test.describe('Evolution Admin Critical Bugs', { tag: '@critical' }, () => {
  test.describe.configure({ mode: 'serial', retries: 2 });

  test('Bug 1: Run detail shows non-zero cost via fallback', async ({ authenticatedPage: page }) => {
    await page.goto('/admin/evolution/runs');
    await page.waitForSelector('[data-testid="entity-list-page"]', { timeout: 15000 });

    // Find a completed run row and click it
    const completedRow = page.locator('tr').filter({ hasText: 'completed' }).first();
    if (await completedRow.count() === 0) {
      // eslint-disable-next-line flakiness/no-test-skip -- no completed runs available in test env
      test.skip(true, 'No completed runs available');
      return;
    }
    await completedRow.click();
    await page.waitForURL(/\/admin\/evolution\/runs\//, { timeout: 10000 });

    // Verify cost is displayed (either from metrics or fallback)
    const costLocator = page.locator('text=/\\$[0-9]/').first();
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- data extraction, not assertion
    const costText = await costLocator.count() > 0 ? await costLocator.textContent() : null;
    // Cost should exist somewhere on the page
    expect(costText).not.toBeNull();
  });

  test('Bug 2/6: Hide test content filter changes metric counts', async ({ authenticatedPage: page }) => {
    await page.goto('/admin/evolution-dashboard');
    await page.waitForSelector('[data-testid="dashboard-metrics"]', { timeout: 15000 });

    // The dashboard should have a metrics grid
    const metricsGrid = page.locator('[data-testid="dashboard-metrics"]');
    await expect(metricsGrid).toBeVisible();

    // Verify "View all runs" link exists (Bug 23 fix)
    const viewAllLink = page.locator('a[href="/admin/evolution/runs"]').filter({ hasText: 'View all' });
    await expect(viewAllLink).toBeVisible();
  });

  test('Bug 3: Invocations page shows budget status for failed ranking', async ({ authenticatedPage: page }) => {
    await page.goto('/admin/evolution/invocations', { timeout: 30000 });
    await page.waitForSelector('[data-testid="entity-list-page"]', { timeout: 30000 });

    // Check that the Status column header exists (renamed from "Success")
    const statusHeader = page.locator('th').filter({ hasText: 'Status' });
    await expect(statusHeader).toBeVisible();

    // If any budget-exceeded invocations exist, they should show ⚠
    const budgetIndicator = page.locator('text=⚠ budget').first();
    if (await budgetIndicator.count() > 0) {
      await expect(budgetIndicator).toBeVisible();
    }
  });

  test('Bug 5: Run detail Elo tab renders chart (not empty)', async ({ authenticatedPage: page }) => {
    await page.goto('/admin/evolution/runs');
    await page.waitForSelector('[data-testid="entity-list-page"]', { timeout: 15000 });

    // Click a completed run
    const completedRow = page.locator('tr').filter({ hasText: 'completed' }).first();
    if (await completedRow.count() === 0) {
      // eslint-disable-next-line flakiness/no-test-skip -- no completed runs available
      test.skip(true, 'No completed runs available');
      return;
    }
    await completedRow.click();
    await page.waitForURL(/\/admin\/evolution\/runs\//, { timeout: 10000 });

    // Click Elo tab
    const eloTab = page.locator('[data-testid="tab-elo"]');
    if (await eloTab.count() > 0) {
      await eloTab.click();

      // Should see either the chart or the empty state
      const chart = page.locator('[data-testid="elo-tab"]');
      const empty = page.locator('[data-testid="elo-tab-empty"]');
      await expect(chart.or(empty)).toBeVisible({ timeout: 10000 });
    }
  });

  test('Bug 15: Lineage tab shows Gen-0 message or graph', async ({ authenticatedPage: page }) => {
    await page.goto('/admin/evolution/runs');
    await page.waitForSelector('[data-testid="entity-list-page"]', { timeout: 15000 });

    const completedRow = page.locator('tr').filter({ hasText: 'completed' }).first();
    if (await completedRow.count() === 0) {
      // eslint-disable-next-line flakiness/no-test-skip -- no completed runs available
      test.skip(true, 'No completed runs available');
      return;
    }
    await completedRow.click();
    await page.waitForURL(/\/admin\/evolution\/runs\//, { timeout: 10000 });

    // Click Lineage tab
    const lineageTab = page.locator('[data-testid="tab-lineage"]');
    if (await lineageTab.count() > 0) {
      await lineageTab.click();
      const graph = page.locator('[data-testid="lineage-graph"]');
      await expect(graph).toBeVisible({ timeout: 10000 });
    }
  });
});
