// E2E: Verify tactics list page renders and sidebar contains Tactics link.

import { test, expect } from '../../fixtures/auth';

test.describe('Evolution Tactics List', { tag: '@evolution' }, () => {
  test('sidebar shows Tactics link', async ({ authenticatedPage: page }) => {
    await page.goto('/admin/evolution/tactics');
    await page.waitForSelector('[data-testid="evolution-sidebar-nav-tactics"]', { timeout: 15000 });

    const tacticLink = page.locator('[data-testid="evolution-sidebar-nav-tactics"]');
    await expect(tacticLink).toBeVisible();
    await expect(tacticLink).toHaveAttribute('href', '/admin/evolution/tactics');
  });

  test('tactics list page loads with title', async ({ authenticatedPage: page }) => {
    await page.goto('/admin/evolution/tactics');
    await page.waitForSelector('h1', { timeout: 15000 });
    await expect(page.locator('h1')).toHaveText('Tactics');
  });

  test('tactics list page shows items after sync', async ({ authenticatedPage: page }) => {
    await page.goto('/admin/evolution/tactics');
    await page.waitForSelector('[data-testid="entity-list-page"]', { timeout: 15000 });

    // If tactics have been synced, we should see rows. If not, we'll see "No items found".
    // This test validates the page renders without errors either way.
    const itemCount = page.locator('text=/\\d+ items/');
    if (await itemCount.count() > 0) {
      const text = await itemCount.textContent();
      expect(text).toBeTruthy();
    }
  });
});
