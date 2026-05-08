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

      // Wait for actual destination content (not just `domcontentloaded`) before
      // each subsequent nav — otherwise goBack/goForward race with the prior
      // page's auto-refresh effect, surfacing as `net::ERR_ABORTED; maybe frame
      // was detached?`. Auto-refresh re-fires on `pageshow`, which fires AFTER
      // `domcontentloaded` settles.
      await adminPage.goto('/admin/evolution/runs');
      await expect(adminPage.getByText(/Evolution/i).first()).toBeVisible({ timeout: 10_000 });

      await adminPage.goto('/admin/evolution/arena');
      await adminPage.waitForURL('**/admin/evolution/arena');
      // Wait for the breadcrumb's "Arena" label to surface — proves the page's
      // initial render has settled (not just `domcontentloaded`).
      await expect(adminPage.getByText('Arena').first()).toBeVisible({ timeout: 10_000 });

      await adminPage.goBack();
      await adminPage.waitForURL('**/admin/evolution/runs');
      await expect(adminPage.getByText(/Evolution/i).first()).toBeVisible({ timeout: 10_000 });

      await adminPage.goForward();
      await adminPage.waitForURL('**/admin/evolution/arena');
      await expect(adminPage.getByText('Arena').first()).toBeVisible({ timeout: 10_000 });

      expect(errors.filter((m) => /AutoRefresh|pageshow/i.test(m))).toEqual([]);
    });
  },
);
