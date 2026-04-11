// E2E tests for the invocations list page.
// Verifies the page loads, table renders, expected columns, and agent name filter.

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
    const table = adminPage.locator('[data-testid="entity-list-table"]');
    await expect(table).toBeVisible({ timeout: 15000 });
    const expectedColumns = ['Run ID', 'Agent', 'Iteration', 'Status', 'Cost', 'Duration', 'Created'];
    for (const col of expectedColumns) {
      await expect(table.locator(`th:has-text("${col}")`)).toBeVisible();
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

  adminTest('agent name filter input is visible', { tag: '@critical' }, async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/invocations');
    await adminPage.waitForLoadState('domcontentloaded');

    const entityList = adminPage.locator('[data-testid="entity-list-page"]');
    await expect(entityList).toBeVisible({ timeout: 15000 });

    // Agent name filter input should render
    const agentInput = adminPage.locator('input[placeholder="Filter by agent..."]');
    await expect(agentInput).toBeVisible({ timeout: 10000 });
  });

  adminTest('jump-to-page input renders when pagination visible', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/invocations');
    await adminPage.waitForLoadState('domcontentloaded');

    const entityList = adminPage.locator('[data-testid="entity-list-page"]');
    await expect(entityList).toBeVisible({ timeout: 15000 });

    // If there are multiple pages, jump-to-page renders; otherwise just verify filter bar works
    const pagination = adminPage.locator('[data-testid="pagination"]');
    const hasPagination = await pagination.isVisible();
    if (hasPagination) {
      const jumpInput = adminPage.locator('input[aria-label="Jump to page"]');
      await expect(jumpInput).toBeVisible();
    }
  });
});
