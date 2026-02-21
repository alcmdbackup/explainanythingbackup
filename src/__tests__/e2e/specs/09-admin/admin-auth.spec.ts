/**
 * Admin authentication E2E tests.
 * Tests admin panel access control and dashboard loading.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { test } from '../../fixtures/auth';
import { AdminBasePage } from '../../helpers/pages/admin/AdminBasePage';

adminTest.describe('Admin Authentication', () => {
  /**
   * @critical - This test runs on every PR to main.
   * Verifies the admin dashboard loads correctly for admin users.
   */
  adminTest(
    'admin dashboard loads for admin user @critical',
    async ({ adminPage }) => {
      const adminBasePage = new AdminBasePage(adminPage);

      // Navigate to admin dashboard
      await adminBasePage.goto();

      // Verify dashboard loaded
      await adminBasePage.expectDashboardLoaded();

      // Verify all nav items are visible
      await expect(adminBasePage.navDashboard).toBeVisible();
      await expect(adminBasePage.navContent).toBeVisible();
      await expect(adminBasePage.navUsers).toBeVisible();
      await expect(adminBasePage.navCosts).toBeVisible();
      await expect(adminBasePage.navWhitelist).toBeVisible();
      await expect(adminBasePage.navAudit).toBeVisible();
      await expect(adminBasePage.navSettings).toBeVisible();
      await expect(adminBasePage.backToApp).toBeVisible();
    }
  );
});

test.describe('Admin Access Control', () => {
  /**
   * Verifies non-admin users are redirected away from admin panel.
   * Uses regular TEST_USER (not admin) to verify access control.
   */
  // Skip: CI test user (abecha@gmail.com) is seeded as admin, so no redirect occurs.
  // This test needs a dedicated non-admin user to validate access control.
  // eslint-disable-next-line flakiness/no-test-skip
  test.skip('non-admin user is redirected to home page', async ({ authenticatedPage }) => {
    // Try to access admin panel as non-admin user
    await authenticatedPage.goto('/admin');

    // Should be redirected to home page (use glob pattern for full URL matching)
    await authenticatedPage.waitForURL('**/', { timeout: 60000 });

    // Verify we're on the home page, not admin
    await expect(authenticatedPage).not.toHaveURL(/\/admin/);
  });
});
