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

  adminTest('invocations list has Cost column with formatted values', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/invocations');
    await adminPage.waitForLoadState('domcontentloaded');

    const entityList = adminPage.locator('[data-testid="entity-list-page"]');
    await expect(entityList).toBeVisible({ timeout: 15000 });

    // The Cost column header should be present
    const costHeader = adminPage.locator('th:has-text("Cost")');
    await expect(costHeader).toBeVisible();

    // If rows exist, cost cells should contain a dollar sign or dash
    const rows = entityList.locator('tbody tr');
    const rowCount = await rows.count();
    if (rowCount > 0) {
      // Cost is the 6th column (0-indexed: 5)
      const firstCostCell = rows.first().locator('td').nth(5);
      await expect(firstCostCell).toBeVisible();
      const costText = await firstCostCell.textContent();
      // formatCostDetailed returns either "$0.0000" style or "—"
      expect(costText?.trim()).toMatch(/^\$|—/);
    }
  });

  adminTest('invocations list has Iteration column with values', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/invocations');
    await adminPage.waitForLoadState('domcontentloaded');

    const entityList = adminPage.locator('[data-testid="entity-list-page"]');
    await expect(entityList).toBeVisible({ timeout: 15000 });

    // The Iteration column header should be present
    const iterationHeader = adminPage.locator('th:has-text("Iteration")');
    await expect(iterationHeader).toBeVisible();

    // If rows exist, iteration cells should contain a number or dash
    const rows = entityList.locator('tbody tr');
    const rowCount = await rows.count();
    if (rowCount > 0) {
      // Iteration is the 4th column (0-indexed: 3)
      const firstIterationCell = rows.first().locator('td').nth(3);
      await expect(firstIterationCell).toBeVisible();
      const iterText = await firstIterationCell.textContent();
      // iteration renders as a number or '—'
      expect(iterText?.trim()).toMatch(/^\d+$|—/);
    }
  });
});
