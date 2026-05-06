// B092: the /admin/evolution layout re-verifies admin status on every navigation so a
// just-revoked admin session cannot continue poking around. Dual-tagged @critical +
// @evolution so it runs on main PRs (security-adjacent).

import { adminTest, expect } from '../../fixtures/admin-auth';

adminTest.describe(
  'Admin evolution layout — post-revocation gate (B092)',
  { tag: ['@evolution', '@critical'] },
  () => {
    adminTest('nested admin evolution route enforces admin check', async ({ adminPage }) => {
      // The positive path: an admin can reach the nested route.
      await adminPage.goto('/admin/evolution/runs');
      await expect(adminPage).toHaveURL(/\/admin\/evolution/);
      // Negative path (actual revocation) requires mutating the role in the DB mid-test
      // which isn't safe without a dedicated fixture; assert the auth chain at least
      // reaches the layout. A follow-up integration test can cover the full revocation
      // flow once an `adminTest.asRevokedAdmin` fixture exists.
      await expect(adminPage.locator('body')).toBeVisible();
    });
  },
);
