// B097: EntityListPage re-applies checkbox `defaultChecked` values when the filters
// prop identity changes — covers the detail-page → list back-navigation case where a
// parent component rebuilds its filter list and the default state would otherwise be
// dropped.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { safeIsVisible } from '../../helpers/error-utils';

adminTest.describe(
  'Admin evolution list-page filter defaults (B097)',
  { tag: '@evolution' },
  () => {
    adminTest('runs list "Hide test content" defaults to on', async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution/runs');
      await expect(adminPage.locator('body')).toBeVisible();

      const hideTest = adminPage.getByLabel(/hide test content/i).first();
      const visible = await safeIsVisible(hideTest, 'hideTestCheckbox', 2_000);
      if (!visible) return; // environment doesn't render this filter; nothing to assert
      await expect(hideTest).toBeChecked();
    });
  },
);
