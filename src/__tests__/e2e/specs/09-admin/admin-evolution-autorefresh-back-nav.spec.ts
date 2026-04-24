// B095: AutoRefreshProvider triggers an immediate refresh on browser history back/
// forward navigation (via `pageshow`) in addition to `visibilitychange`. Smoke-test
// that back/forward navigation doesn't surface uncaught errors related to the provider.

import { adminTest, expect } from '../../fixtures/admin-auth';

adminTest.describe(
  'Admin evolution auto-refresh on back-nav (B095)',
  { tag: '@evolution' },
  () => {
    adminTest('no uncaught AutoRefresh/pageshow errors on back-nav', async ({ adminPage }) => {
      const errors: string[] = [];
      adminPage.on('pageerror', (e) => errors.push(e.message));

      await adminPage.goto('/admin/evolution/runs');
      await expect(adminPage.getByText(/Evolution/i).first()).toBeVisible({ timeout: 10_000 });
      await adminPage.goto('/admin/evolution/arena');
      await adminPage.waitForLoadState('domcontentloaded');
      await adminPage.goBack();
      await adminPage.waitForLoadState('domcontentloaded');
      await adminPage.goForward();
      await adminPage.waitForLoadState('domcontentloaded');
      expect(errors.filter((m) => /AutoRefresh|pageshow/i.test(m))).toEqual([]);
    });
  },
);
