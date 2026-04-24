// B094: LineageGraph detaches its D3 zoom listener synchronously on unmount so repeated
// mount/unmount cycles don't leak listeners on the SVG element. Smoke-test that the runs
// list page loads and that any pageerror surfaced during load doesn't mention d3/lineage.

import { adminTest, expect } from '../../fixtures/admin-auth';

adminTest.describe(
  'Admin evolution LineageGraph mount/unmount (B094)',
  { tag: '@evolution' },
  () => {
    adminTest('no uncaught d3/zoom errors on runs list', async ({ adminPage }) => {
      const errors: string[] = [];
      adminPage.on('pageerror', (e) => errors.push(e.message));

      await adminPage.goto('/admin/evolution/runs');
      await expect(adminPage.locator('body')).toBeVisible();
      await adminPage.waitForLoadState('domcontentloaded');

      expect(errors.filter((e) => /d3|zoom|lineage/i.test(e))).toEqual([]);
    });
  },
);
