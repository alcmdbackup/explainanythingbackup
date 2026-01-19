/**
 * Admin whitelist management E2E tests.
 * Tests whitelist table, create/edit modals, and aliases.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { AdminWhitelistPage } from '../../helpers/pages/admin/AdminWhitelistPage';

adminTest.describe('Admin Whitelist Management', () => {
  /**
   * @critical - This test runs on every PR to main.
   * Verifies the whitelist table loads correctly.
   */
  adminTest(
    'whitelist table loads @critical',
    async ({ adminPage }) => {
      const whitelistPage = new AdminWhitelistPage(adminPage);
      await whitelistPage.gotoWhitelist();

      // Verify page loaded
      await whitelistPage.expectWhitelistPageLoaded();

      // Table should be visible
      await expect(whitelistPage.table).toBeVisible();
    }
  );

  adminTest(
    'create term modal opens and has ARIA attributes',
    async ({ adminPage }) => {
      const whitelistPage = new AdminWhitelistPage(adminPage);
      await whitelistPage.gotoWhitelist();

      // Open create modal
      await whitelistPage.openCreateModal();

      // Modal should have ARIA attributes
      await expect(whitelistPage.modal).toHaveAttribute('role', 'dialog');
      await expect(whitelistPage.modal).toHaveAttribute('aria-modal', 'true');

      // Form fields should be visible
      await expect(whitelistPage.canonicalTermInput).toBeVisible();
      await expect(whitelistPage.standaloneTitleInput).toBeVisible();
      await expect(whitelistPage.descriptionInput).toBeVisible();
      await expect(whitelistPage.isActiveCheckbox).toBeVisible();

      // Close modal
      await whitelistPage.closeModal();
      await expect(whitelistPage.modal).not.toBeVisible();
    }
  );

  adminTest(
    'modal has focus trap for accessibility',
    async ({ adminPage }) => {
      const whitelistPage = new AdminWhitelistPage(adminPage);
      await whitelistPage.gotoWhitelist();

      // Open create modal
      await whitelistPage.openCreateModal();
      await expect(whitelistPage.modal).toBeVisible();

      // Tab through the modal - focus should stay within
      await adminPage.keyboard.press('Tab');
      await adminPage.keyboard.press('Tab');
      await adminPage.keyboard.press('Tab');

      // Focus should still be in modal
      const focusedInModal = await whitelistPage.modal.locator(':focus').count();
      expect(focusedInModal).toBeGreaterThan(0);

      // Close modal
      await whitelistPage.closeModal();
    }
  );

  adminTest(
    'cancel button closes create modal',
    async ({ adminPage }) => {
      const whitelistPage = new AdminWhitelistPage(adminPage);
      await whitelistPage.gotoWhitelist();

      // Open create modal
      await whitelistPage.openCreateModal();
      await expect(whitelistPage.modal).toBeVisible();

      // Click cancel
      await whitelistPage.cancelButton.click();
      await expect(whitelistPage.modal).not.toBeVisible();
    }
  );

  adminTest(
    'edit button opens modal for existing term',
    async ({ adminPage }) => {
      const whitelistPage = new AdminWhitelistPage(adminPage);
      await whitelistPage.gotoWhitelist();

      // Find first edit button
      const firstEditButton = adminPage.locator('[data-testid^="admin-whitelist-edit-"]').first();

      // Skip if no terms exist
      if (await firstEditButton.count() === 0) {
        adminTest.skip();
        return;
      }

      await firstEditButton.click();
      await expect(whitelistPage.modal).toBeVisible();

      // Form should be pre-filled
      const canonicalValue = await whitelistPage.canonicalTermInput.inputValue();
      expect(canonicalValue.length).toBeGreaterThan(0);

      // Close modal
      await whitelistPage.closeModal();
    }
  );

  adminTest(
    'aliases button opens aliases modal',
    async ({ adminPage }) => {
      const whitelistPage = new AdminWhitelistPage(adminPage);
      await whitelistPage.gotoWhitelist();

      // Find first aliases button
      const firstAliasesButton = adminPage.locator('[data-testid^="admin-whitelist-aliases-"]').first();

      // Skip if no terms exist
      if (await firstAliasesButton.count() === 0) {
        adminTest.skip();
        return;
      }

      await firstAliasesButton.click();
      await expect(whitelistPage.modal).toBeVisible();

      // Alias input and add button should be visible
      await expect(whitelistPage.aliasInput).toBeVisible();
      await expect(whitelistPage.addAliasButton).toBeVisible();

      // Close aliases modal
      await whitelistPage.closeAliasesButton.click();
      await expect(whitelistPage.modal).not.toBeVisible();
    }
  );

  adminTest(
    'term count is displayed',
    async ({ adminPage }) => {
      const whitelistPage = new AdminWhitelistPage(adminPage);
      await whitelistPage.gotoWhitelist();

      // Check for term count text
      const termCountText = adminPage.locator('text=/\\d+ terms? in whitelist/');
      await expect(termCountText).toBeVisible();
    }
  );
});
