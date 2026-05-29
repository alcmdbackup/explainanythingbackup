/**
 * Admin users management E2E tests.
 * Tests users table, search, and user detail modal.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { AdminUsersPage } from '../../helpers/pages/admin/AdminUsersPage';

adminTest.describe('Admin Users Management', { tag: '@evolution' }, () => {
  /**
   * @evolution - This test runs on the evolution host.
   * Verifies the users table loads correctly.
   */
  adminTest(
    'users table loads',
    async ({ adminPage }) => {
      const usersPage = new AdminUsersPage(adminPage);
      await usersPage.gotoUsers();

      // Verify page loaded
      await usersPage.expectUsersPageLoaded();

      // Verify table has rows
      const rows = usersPage.table.locator('tbody tr');
      await expect(rows.first()).toBeVisible();
    }
  );

  adminTest(
    'search filters users',
    async ({ adminPage }) => {
      const usersPage = new AdminUsersPage(adminPage);
      await usersPage.gotoUsers();

      // Get first user email from table
      const firstRowEmail = usersPage.table.locator('tbody tr:first-child td:first-child div:first-child');
      const email = await firstRowEmail.textContent();

      if (email) {
        // Search for this user
        await usersPage.search(email);

        // Should still see the user
        await expect(usersPage.table.locator(`text=${email}`)).toBeVisible();
      }
    }
  );

  adminTest(
    'user detail modal opens and closes',
    async ({ adminPage }) => {
      const usersPage = new AdminUsersPage(adminPage);
      await usersPage.gotoUsers();

      // Get first user's view button
      const firstViewButton = usersPage.page.locator('[data-testid^="admin-users-view-"]').first();
      await firstViewButton.click();

      // Modal should be visible with ARIA attributes
      await expect(usersPage.detailModal).toBeVisible();
      await expect(usersPage.detailModal).toHaveAttribute('role', 'dialog');
      await expect(usersPage.detailModal).toHaveAttribute('aria-modal', 'true');

      // Close modal
      await usersPage.closeDetailModal();
      await expect(usersPage.detailModal).not.toBeVisible();
    }
  );

  adminTest(
    'modal has focus trap for accessibility',
    async ({ adminPage }) => {
      const usersPage = new AdminUsersPage(adminPage);
      await usersPage.gotoUsers();

      // Open first user modal
      const firstViewButton = usersPage.page.locator('[data-testid^="admin-users-view-"]').first();
      await firstViewButton.click();
      await expect(usersPage.detailModal).toBeVisible();

      // Tab through the modal - focus should stay within
      await adminPage.keyboard.press('Tab');
      await adminPage.keyboard.press('Tab');
      await adminPage.keyboard.press('Tab');

      // Focus should still be in modal
      const focusedInModal = await usersPage.detailModal.locator(':focus').count();
      expect(focusedInModal).toBeGreaterThan(0);

      // Close modal
      await usersPage.closeDetailModal();
    }
  );

  adminTest(
    'admin notes textarea is visible in modal',
    async ({ adminPage }) => {
      const usersPage = new AdminUsersPage(adminPage);
      await usersPage.gotoUsers();

      // Open first user modal
      const firstViewButton = usersPage.page.locator('[data-testid^="admin-users-view-"]').first();
      await firstViewButton.click();
      await expect(usersPage.detailModal).toBeVisible();

      // Notes textarea should be visible
      await expect(usersPage.notesTextarea).toBeVisible();

      // Close modal
      await usersPage.closeDetailModal();
    }
  );

  adminTest(
    'pagination is visible',
    async ({ adminPage }) => {
      const usersPage = new AdminUsersPage(adminPage);
      await usersPage.gotoUsers();

      // Pagination should be visible
      await expect(usersPage.pagination).toBeVisible();
      await expect(usersPage.prevPageButton).toBeVisible();
      await expect(usersPage.nextPageButton).toBeVisible();
    }
  );

  adminTest(
    'show disabled filter works',
    async ({ adminPage }) => {
      const usersPage = new AdminUsersPage(adminPage);
      await usersPage.gotoUsers();

      // Wait for hydration proof (testing_overview.md Rule 18) before toggling
      // the filter: assert a real data row exists, not just any tbody tr (the
      // "Loading..." placeholder is itself a tr, so `tbody tr.first()` would
      // match it and give a false-positive ready signal).
      //
      // The 30s timeout accommodates the local dev server's cold-start latency:
      // getAdminUsersAction does auth.admin.listUsers() + per-user stat queries
      // and, under `npm run dev` with full OTel/Sentry instrumentation (no
      // FAST_DEV), the first load can exceed the default 10s. CI's webServer
      // runs with FAST_DEV=true and resolves well under 10s.
      await expect(
        usersPage.table.locator('tbody tr[data-testid^="admin-users-row-"]').first()
      ).toBeVisible({ timeout: 30000 });

      // Show disabled checkbox should be visible and checked by default
      await expect(usersPage.showDisabledCheckbox).toBeVisible();
      await expect(usersPage.showDisabledCheckbox).toBeChecked();

      // Uncheck it
      await usersPage.toggleShowDisabled();
      await expect(usersPage.showDisabledCheckbox).not.toBeChecked();

      // Re-check it
      await usersPage.toggleShowDisabled();
      await expect(usersPage.showDisabledCheckbox).toBeChecked();
    }
  );
});
