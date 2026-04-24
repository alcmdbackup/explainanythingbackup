// B101: EntityTable requires a string `id` on each row; missing id in dev throws so
// the stale-content-on-resort bug can't sneak through review. This spec asserts the
// runs list page loads without uncaught errors when sort toggles are exercised.

import { adminTest, expect } from '../../fixtures/admin-auth';

adminTest.describe(
  'Admin evolution table resort (B101)',
  { tag: '@evolution' },
  () => {
    adminTest('sort toggle renders without key collisions', async ({ adminPage }) => {
      const errors: string[] = [];
      adminPage.on('pageerror', (e) => errors.push(e.message));

      await adminPage.goto('/admin/evolution/runs');
      await expect(adminPage.locator('body')).toBeVisible();

      // Click the first sortable column header (Created). Use a short timeout so
      // we don't hang when no data has been seeded in this environment.
      const header = adminPage.locator('thead th').first();
      await expect(header).toBeVisible({ timeout: 5_000 });
      await header.click();
      await adminPage.waitForLoadState('domcontentloaded');
      await header.click();
      await adminPage.waitForLoadState('domcontentloaded');

      // Primary assertion: no React key-collision warnings in page errors.
      expect(errors.filter((m) => /key|EntityTable/.test(m))).toEqual([]);
    });
  },
);
