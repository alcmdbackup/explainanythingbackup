/**
 * Admin content reports E2E tests.
 * Tests reports table, status filtering, and resolve actions.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { AdminReportsPage } from '../../helpers/pages/admin/AdminReportsPage';
import {
  createTestExplanation,
  createTestReport,
  cleanupTestReports,
  TestExplanation
} from '../../helpers/test-data-factory';

adminTest.describe('Admin Content Reports', () => {
  let testExplanation: TestExplanation;
  let testReportId: number;

  adminTest.beforeAll(async () => {
    // Create test explanation and report
    testExplanation = await createTestExplanation({
      title: 'Report Test Explanation',
      status: 'published'
    });
    testReportId = await createTestReport(parseInt(testExplanation.id, 10));
  });

  adminTest.afterAll(async () => {
    // Cleanup
    await cleanupTestReports();
    await testExplanation.cleanup();
  });

  /**
   * @critical - This test runs on every PR to main.
   * Verifies the reports table loads correctly.
   */
  adminTest(
    'reports table loads @critical',
    async ({ adminPage }) => {
      const reportsPage = new AdminReportsPage(adminPage);
      await reportsPage.gotoReports();

      // Verify page loaded
      await reportsPage.expectReportsPageLoaded();

      // Verify table has content
      const rows = reportsPage.table.locator('tbody tr');
      await expect(rows.first()).toBeVisible();
    }
  );

  adminTest(
    'status filter works',
    async ({ adminPage }) => {
      const reportsPage = new AdminReportsPage(adminPage);
      await reportsPage.gotoReports();

      // Filter by pending
      await reportsPage.filterByStatus('pending');

      // All visible status badges should be pending
      const statusBadges = reportsPage.table.locator('tbody tr td:nth-child(4) span');
      const count = await statusBadges.count();
      for (let i = 0; i < Math.min(count, 5); i++) {
        const badge = statusBadges.nth(i);
        await expect(badge).toHaveText('pending');
      }
    }
  );

  adminTest(
    'dismiss report shows toast',
    async ({ adminPage }) => {
      // Create a fresh report for this test
      const testExp = await createTestExplanation({
        title: 'Dismiss Test',
        status: 'published'
      });
      const reportId = await createTestReport(parseInt(testExp.id, 10));

      const reportsPage = new AdminReportsPage(adminPage);
      await reportsPage.gotoReports();

      // Dismiss the report
      await reportsPage.dismissReport(reportId);

      // Verify toast
      await adminPage.waitForSelector('[data-sonner-toast]', { timeout: 5000 });
      await expect(adminPage.locator('[data-sonner-toast]')).toContainText('dismissed successfully');

      // Cleanup
      await testExp.cleanup();
    }
  );

  adminTest(
    'mark reviewed shows toast',
    async ({ adminPage }) => {
      // Create a fresh report for this test
      const testExp = await createTestExplanation({
        title: 'Review Test',
        status: 'published'
      });
      const reportId = await createTestReport(parseInt(testExp.id, 10));

      const reportsPage = new AdminReportsPage(adminPage);
      await reportsPage.gotoReports();

      // Mark as reviewed
      await reportsPage.reviewReport(reportId);

      // Verify toast
      await adminPage.waitForSelector('[data-sonner-toast]', { timeout: 5000 });
      await expect(adminPage.locator('[data-sonner-toast]')).toContainText('reviewed successfully');

      // Cleanup
      await testExp.cleanup();
    }
  );

  adminTest(
    'hide content (action) shows toast',
    async ({ adminPage }) => {
      // Create a fresh report for this test
      const testExp = await createTestExplanation({
        title: 'Action Test',
        status: 'published'
      });
      const reportId = await createTestReport(parseInt(testExp.id, 10));

      const reportsPage = new AdminReportsPage(adminPage);
      await reportsPage.gotoReports();

      // Action the report (hide content)
      await reportsPage.actionReport(reportId);

      // Verify toast
      await adminPage.waitForSelector('[data-sonner-toast]', { timeout: 5000 });
      await expect(adminPage.locator('[data-sonner-toast]')).toContainText('hidden successfully');

      // Cleanup
      await testExp.cleanup();
    }
  );

  adminTest(
    'details modal opens and closes',
    async ({ adminPage }) => {
      const reportsPage = new AdminReportsPage(adminPage);
      await reportsPage.gotoReports();

      // Find a report with details button (our test report has details)
      const detailsButton = reportsPage.getDetailsButton(testReportId);

      // If our test report is visible with details, test the modal
      if (await detailsButton.isVisible()) {
        await reportsPage.openDetailsModal(testReportId);
        await expect(reportsPage.detailModal).toBeVisible();

        // Close modal
        await reportsPage.closeDetailsModal();
        await expect(reportsPage.detailModal).not.toBeVisible();
      } else {
        // Find any report with details
        const anyDetailsButton = reportsPage.page.locator('[data-testid^="admin-reports-details-"]').first();
        if (await anyDetailsButton.isVisible()) {
          await anyDetailsButton.click();
          await expect(reportsPage.detailModal).toBeVisible();
          await reportsPage.closeDetailsModal();
        }
      }
    }
  );

  adminTest(
    'pagination is visible',
    async ({ adminPage }) => {
      const reportsPage = new AdminReportsPage(adminPage);
      await reportsPage.gotoReports();

      // Pagination should be visible
      await expect(reportsPage.pagination).toBeVisible();
      await expect(reportsPage.prevPageButton).toBeVisible();
      await expect(reportsPage.nextPageButton).toBeVisible();
    }
  );
});
