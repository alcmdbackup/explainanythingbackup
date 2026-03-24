// E2E tests for the invocations list page.
// Verifies the page loads, table renders, and expected columns are present.

import { adminTest, expect } from '../../fixtures/admin-auth';

adminTest.describe('Evolution Invocations (T25)', { tag: '@evolution' }, () => {
  adminTest('invocations list renders with columns', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/invocations');
    await adminPage.waitForLoadState('domcontentloaded');

    // EntityListPage container should render
    const entityList = adminPage.locator('[data-testid="entity-list-page"]');
    await expect(entityList).toBeVisible({ timeout: 15000 });

    // Verify the page title
    await expect(adminPage.locator('h1')).toContainText('Invocations');

    // Verify expected column headers are present in the table
    const expectedColumns = ['ID', 'Run ID', 'Agent', 'Iteration', 'Success', 'Cost', 'Duration', 'Created'];
    for (const col of expectedColumns) {
      await expect(adminPage.locator(`th:has-text("${col}")`)).toBeVisible();
    }

    // Breadcrumb should be present
    const breadcrumb = adminPage.locator('[data-testid="evolution-breadcrumb"]');
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb).toContainText('Invocations');
  });
});
