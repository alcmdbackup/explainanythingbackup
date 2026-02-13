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
  test('non-admin user is redirected to home page', async ({ authenticatedPage }) => {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3008';

    // Try to access admin panel as non-admin user
    await authenticatedPage.goto(`${baseUrl}/admin`);

    // Should be redirected away from admin - use pattern match instead of exact URL
    // Next.js server component redirect may include query params or trailing slash variations
    await authenticatedPage.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 30000 });

    // Verify we're not on admin
    await expect(authenticatedPage).not.toHaveURL(/\/admin/);
  });
});
