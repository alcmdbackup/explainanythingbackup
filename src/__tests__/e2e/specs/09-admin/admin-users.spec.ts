/**
 * Admin users management E2E tests.
 * Tests users table, search, and user detail modal.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { AdminUsersPage } from '../../helpers/pages/admin/AdminUsersPage';

adminTest.describe('Admin Users Management', () => {
  /**
   * @critical - This test runs on every PR to main.
   * Verifies the users table loads correctly.
   */
  adminTest(
    'users table loads @critical',
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
