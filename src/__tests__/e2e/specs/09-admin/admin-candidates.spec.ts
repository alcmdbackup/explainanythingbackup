/**
 * Admin candidates management E2E tests.
 * Tests candidates table, status filter, and approval modal.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { AdminCandidatesPage } from '../../helpers/pages/admin/AdminCandidatesPage';

adminTest.describe('Admin Candidates Management', () => {
  /**
   * @critical - This test runs on every PR to main.
   * Verifies the candidates table loads correctly.
   */
  adminTest(
    'candidates table loads @critical',
    async ({ adminPage }) => {
      const candidatesPage = new AdminCandidatesPage(adminPage);
      await candidatesPage.gotoCandidates();

      // Verify page loaded
      await candidatesPage.expectCandidatesPageLoaded();

      // Table should be visible
      await expect(candidatesPage.table).toBeVisible();
    }
  );

  adminTest(
    'status filter is visible and functional',
    async ({ adminPage }) => {
      const candidatesPage = new AdminCandidatesPage(adminPage);
      await candidatesPage.gotoCandidates();

      // Status filter should be visible
      await expect(candidatesPage.statusFilter).toBeVisible();

      // Try different filter values
      await candidatesPage.filterByStatus('all');
      await expect(candidatesPage.statusFilter).toHaveValue('all');

      await candidatesPage.filterByStatus('pending');
      await expect(candidatesPage.statusFilter).toHaveValue('pending');
    }
  );

  adminTest(
    'approve modal opens with ARIA attributes',
    async ({ adminPage }) => {
      const candidatesPage = new AdminCandidatesPage(adminPage);
      await candidatesPage.gotoCandidates();

      // Find first approve button
      const firstApproveButton = adminPage.locator('[data-testid^="admin-candidates-approve-"]').first();

      // Skip if no pending candidates
      if (await firstApproveButton.count() === 0) {
        adminTest.skip();
        return;
      }

      await firstApproveButton.click();
      await expect(candidatesPage.modal).toBeVisible();

      // Modal should have ARIA attributes
      await expect(candidatesPage.modal).toHaveAttribute('role', 'dialog');
      await expect(candidatesPage.modal).toHaveAttribute('aria-modal', 'true');

      // Form elements should be visible
      await expect(candidatesPage.standaloneTitleInput).toBeVisible();

      // Close modal
      await candidatesPage.closeModal();
      await expect(candidatesPage.modal).not.toBeVisible();
    }
  );

  adminTest(
    'modal has focus trap for accessibility',
    async ({ adminPage }) => {
      const candidatesPage = new AdminCandidatesPage(adminPage);
      await candidatesPage.gotoCandidates();

      // Find first approve button
      const firstApproveButton = adminPage.locator('[data-testid^="admin-candidates-approve-"]').first();

      // Skip if no pending candidates
      if (await firstApproveButton.count() === 0) {
        adminTest.skip();
        return;
      }

      await firstApproveButton.click();
      await expect(candidatesPage.modal).toBeVisible();

      // Tab through the modal - focus should stay within
      await adminPage.keyboard.press('Tab');
      await adminPage.keyboard.press('Tab');
      await adminPage.keyboard.press('Tab');

      // Focus should still be in modal
      const focusedInModal = await candidatesPage.modal.locator(':focus').count();
      expect(focusedInModal).toBeGreaterThan(0);

      // Close modal
      await candidatesPage.closeModal();
    }
  );

  adminTest(
    'cancel button closes approve modal',
    async ({ adminPage }) => {
      const candidatesPage = new AdminCandidatesPage(adminPage);
      await candidatesPage.gotoCandidates();

      // Find first approve button
      const firstApproveButton = adminPage.locator('[data-testid^="admin-candidates-approve-"]').first();

      // Skip if no pending candidates
      if (await firstApproveButton.count() === 0) {
        adminTest.skip();
        return;
      }

      await firstApproveButton.click();
      await expect(candidatesPage.modal).toBeVisible();

      // Click cancel
      await candidatesPage.cancelButton.click();
      await expect(candidatesPage.modal).not.toBeVisible();
    }
  );

  adminTest(
    'standalone title input is pre-filled',
    async ({ adminPage }) => {
      const candidatesPage = new AdminCandidatesPage(adminPage);
      await candidatesPage.gotoCandidates();

      // Find first approve button
      const firstApproveButton = adminPage.locator('[data-testid^="admin-candidates-approve-"]').first();

      // Skip if no pending candidates
      if (await firstApproveButton.count() === 0) {
        adminTest.skip();
        return;
      }

      await firstApproveButton.click();
      await expect(candidatesPage.modal).toBeVisible();

      // Standalone title should be pre-filled with "What is {term}?" format
      const titleValue = await candidatesPage.standaloneTitleInput.inputValue();
      expect(titleValue).toMatch(/^What is .+\?$/);

      // Close modal
      await candidatesPage.closeModal();
    }
  );

  adminTest(
    'candidate count is displayed',
    async ({ adminPage }) => {
      const candidatesPage = new AdminCandidatesPage(adminPage);
      await candidatesPage.gotoCandidates();

      // Check for candidate count text
      const candidateCountText = adminPage.locator('text=/\\d+ candidates?/');
      await expect(candidateCountText).toBeVisible();
    }
  );

  adminTest(
    'tab switching works correctly',
    async ({ adminPage }) => {
      const candidatesPage = new AdminCandidatesPage(adminPage);
      await candidatesPage.gotoCandidates();

      // Candidates tab should be active
      await expect(candidatesPage.table).toBeVisible();

      // Switch to whitelist tab
      await candidatesPage.whitelistTab.click();
      await candidatesPage.page.waitForLoadState('networkidle');

      // Candidates table should no longer be visible
      await expect(candidatesPage.table).not.toBeVisible();

      // Whitelist table should be visible
      await expect(adminPage.getByTestId('admin-whitelist-table')).toBeVisible();
    }
  );
});
