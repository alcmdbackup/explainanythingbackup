/**
 * Admin content management E2E tests.
 * Tests explanation table, detail modal, hide/restore actions.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { AdminContentPage } from '../../helpers/pages/admin/AdminContentPage';
import {
  createTestExplanation,
  cleanupTestExplanations,
  TestExplanation
} from '../../helpers/test-data-factory';

adminTest.describe('Admin Content Management', () => {
  let testExplanations: TestExplanation[] = [];

  adminTest.beforeAll(async () => {
    // Create test explanations for all tests
    testExplanations = [
      await createTestExplanation({ title: 'Admin Test Visible', status: 'published' }),
      await createTestExplanation({ title: 'Admin Test Draft', status: 'draft' }),
    ];
  });

  adminTest.afterAll(async () => {
    // Cleanup test data
    await cleanupTestExplanations(testExplanations);
  });

  /**
   * @critical - This test runs on every PR to main.
   * Verifies the content table loads and displays data.
   */
  adminTest(
    'content table loads with data @critical',
    async ({ adminPage }) => {
      const contentPage = new AdminContentPage(adminPage);
      await contentPage.gotoContent();

      // Verify page loaded
      await contentPage.expectContentPageLoaded();

      // Verify table has rows
      const rows = contentPage.table.locator('tbody tr');
      await expect(rows.first()).toBeVisible();
    }
  );

  adminTest(
    'search filters explanations',
    async ({ adminPage }) => {
      const contentPage = new AdminContentPage(adminPage);
      await contentPage.gotoContent();

      // Search for our test explanation
      await contentPage.search('[TEST] Admin Test Visible');

      // Should find our test explanation
      const row = contentPage.page.getByRole('row', { name: /Admin Test Visible/i });
      await expect(row).toBeVisible();
    }
  );

  adminTest(
    'status filter works',
    async ({ adminPage }) => {
      const contentPage = new AdminContentPage(adminPage);
      await contentPage.gotoContent();

      // Filter by draft
      await contentPage.filterByStatus('draft');

      // All visible rows should be draft
      const statusCells = contentPage.table.locator('tbody tr td:nth-child(4) span');
      const count = await statusCells.count();
      for (let i = 0; i < count; i++) {
        const cell = statusCells.nth(i);
        await expect(cell).toHaveText('draft');
      }
    }
  );

  adminTest(
    'detail modal opens and closes',
    async ({ adminPage }) => {
      const contentPage = new AdminContentPage(adminPage);
      await contentPage.gotoContent();

      // Get first explanation ID from table
      const firstRow = contentPage.table.locator('tbody tr').first();
      const idCell = firstRow.locator('td:nth-child(2)');
      const idText = await idCell.textContent();
      const explanationId = parseInt(idText || '0', 10);

      // Open modal
      await contentPage.openDetailModal(explanationId);

      // Verify modal is visible with ARIA attributes
      await expect(contentPage.detailModal).toBeVisible();
      await expect(contentPage.detailModal).toHaveAttribute('role', 'dialog');
      await expect(contentPage.detailModal).toHaveAttribute('aria-modal', 'true');

      // Close modal
      await contentPage.closeDetailModal();
      await expect(contentPage.detailModal).not.toBeVisible();
    }
  );

  adminTest(
    'hide and restore explanation from table',
    async ({ adminPage }) => {
      // Create a specific test explanation for this test
      const testExp = await createTestExplanation({
        title: 'Admin Hide Test',
        status: 'published'
      });
      testExplanations.push(testExp);
      const expId = parseInt(testExp.id, 10);

      const contentPage = new AdminContentPage(adminPage);
      await contentPage.gotoContent();

      // Search for our test explanation
      await contentPage.search('[TEST] Admin Hide Test');

      // Hide the explanation
      const hideButton = contentPage.getHideButton(expId);
      await hideButton.click();

      // Wait for action to complete (toast appears)
      await adminPage.waitForSelector('[data-sonner-toast]', { timeout: 5000 });

      // Verify toast message
      await expect(adminPage.locator('[data-sonner-toast]')).toContainText('hidden successfully');

      // Reload to see the hidden state
      await contentPage.gotoContent();
      await contentPage.search('[TEST] Admin Hide Test');

      // Verify restore button appears (meaning it's hidden)
      const restoreButton = contentPage.getRestoreButton(expId);
      await expect(restoreButton).toBeVisible();

      // Restore the explanation
      await restoreButton.click();

      // Wait for action to complete
      await adminPage.waitForSelector('[data-sonner-toast]', { timeout: 5000 });
      await expect(adminPage.locator('[data-sonner-toast]').last()).toContainText('restored successfully');
    }
  );

  adminTest(
    'hide and restore from modal',
    async ({ adminPage }) => {
      // Create a specific test explanation for this test
      const testExp = await createTestExplanation({
        title: 'Admin Modal Test',
        status: 'published'
      });
      testExplanations.push(testExp);
      const expId = parseInt(testExp.id, 10);

      const contentPage = new AdminContentPage(adminPage);
      await contentPage.gotoContent();

      // Search for our test explanation
      await contentPage.search('[TEST] Admin Modal Test');

      // Open modal
      await contentPage.openDetailModal(expId);

      // Hide from modal
      await contentPage.hideFromModal();

      // Verify toast
      await adminPage.waitForSelector('[data-sonner-toast]', { timeout: 5000 });
      await expect(adminPage.locator('[data-sonner-toast]')).toContainText('hidden successfully');

      // Search again and open modal
      await contentPage.search('[TEST] Admin Modal Test');
      await contentPage.openDetailModal(expId);

      // Restore from modal
      await contentPage.restoreFromModal();

      // Verify toast
      await adminPage.waitForSelector('[data-sonner-toast]', { timeout: 5000 });
      await expect(adminPage.locator('[data-sonner-toast]').last()).toContainText('restored successfully');
    }
  );

  adminTest(
    'bulk hide selected explanations',
    async ({ adminPage }) => {
      // Create test explanations for bulk operations
      const bulkExp1 = await createTestExplanation({
        title: 'Bulk Test 1',
        status: 'published'
      });
      const bulkExp2 = await createTestExplanation({
        title: 'Bulk Test 2',
        status: 'published'
      });
      testExplanations.push(bulkExp1, bulkExp2);
      const id1 = parseInt(bulkExp1.id, 10);
      const id2 = parseInt(bulkExp2.id, 10);

      const contentPage = new AdminContentPage(adminPage);
      await contentPage.gotoContent();

      // Search for our test explanations
      await contentPage.search('[TEST] Bulk Test');

      // Select both
      await contentPage.selectExplanations([id1, id2]);

      // Verify bulk hide button appears
      await expect(contentPage.bulkHideButton).toBeVisible();

      // Bulk hide
      await contentPage.bulkHide();

      // Verify toast
      await adminPage.waitForSelector('[data-sonner-toast]', { timeout: 5000 });
      await expect(adminPage.locator('[data-sonner-toast]')).toContainText('hidden successfully');
    }
  );

  adminTest(
    'modal has focus trap for accessibility',
    async ({ adminPage }) => {
      const contentPage = new AdminContentPage(adminPage);
      await contentPage.gotoContent();

      // Get first explanation ID
      const firstRow = contentPage.table.locator('tbody tr').first();
      const idCell = firstRow.locator('td:nth-child(2)');
      const idText = await idCell.textContent();
      const explanationId = parseInt(idText || '0', 10);

      // Open modal
      await contentPage.openDetailModal(explanationId);

      // Tab through the modal - focus should stay within
      await adminPage.keyboard.press('Tab');
      await adminPage.keyboard.press('Tab');
      await adminPage.keyboard.press('Tab');

      // Focus should still be in modal (not outside)
      const focusedInModal = await contentPage.detailModal.locator(':focus').count();
      expect(focusedInModal).toBeGreaterThan(0);

      // Close modal
      await contentPage.closeDetailModal();
    }
  );

  adminTest(
    'pagination works',
    async ({ adminPage }) => {
      const contentPage = new AdminContentPage(adminPage);
      await contentPage.gotoContent();

      // Check pagination is visible
      await expect(contentPage.pagination).toBeVisible();

      // Verify prev is disabled on first page
      await expect(contentPage.prevPageButton).toBeDisabled();

      // If there are more pages, test navigation
      const isNextEnabled = await contentPage.nextPageButton.isEnabled();
      if (isNextEnabled) {
        await contentPage.nextPageButton.click();
        await adminPage.waitForLoadState('networkidle');

        // Prev should now be enabled
        await expect(contentPage.prevPageButton).toBeEnabled();

        // Go back
        await contentPage.prevPageButton.click();
        await adminPage.waitForLoadState('networkidle');

        // Back to first page
        await expect(contentPage.prevPageButton).toBeDisabled();
      }
    }
  );
});
