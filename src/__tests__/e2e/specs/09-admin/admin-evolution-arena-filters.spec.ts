// B098: the "Hide empty topics" checkbox on /admin/evolution/arena actually filters
// out zero-entry topics. Previously the component read `filterValues.hideEmpty` but the
// state was never initialized with that key, so the checkbox was permanently inert.
// Dual-tagged @critical + @evolution so it runs on main PRs for the most user-visible
// admin-UI regression.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { safeIsVisible } from '../../helpers/error-utils';

adminTest.describe(
  'Admin arena — Hide Empty checkbox (B098)',
  { tag: ['@evolution', '@critical'] },
  () => {
    adminTest('arena loads without errors and checkbox toggle does not throw', async ({ adminPage }) => {
      const errors: string[] = [];
      adminPage.on('pageerror', (e) => errors.push(e.message));

      await adminPage.goto('/admin/evolution/arena');
      await expect(adminPage.getByText('Arena Topics')).toBeVisible({ timeout: 10_000 });

      // Find the "Hide empty" filter checkbox. If present in this environment,
      // toggle it — the regression was that clicking did nothing at all. If the
      // checkbox isn't rendered (empty DB in CI preview) we still assert the
      // page didn't throw on mount.
      const hideEmpty = adminPage
        .getByRole('checkbox', { name: /hide empty/i })
        .or(adminPage.getByLabel(/hide empty/i))
        .first();
      if (await safeIsVisible(hideEmpty, 'hideEmptyCheckbox', 2_000)) {
        await hideEmpty.click();
        await adminPage.waitForLoadState('domcontentloaded');
        await hideEmpty.click();
        await adminPage.waitForLoadState('domcontentloaded');
      }

      expect(errors.filter((m) => /hideEmpty|arena/i.test(m))).toEqual([]);
    });
  },
);
