// E2E tests for the invocations list page.
// Verifies the page loads, table renders, expected columns, and agent name filter.

import { adminTest, expect } from '../../fixtures/admin-auth';

adminTest.describe('Evolution Invocations (T25)', { tag: '@evolution' }, () => {
  adminTest('invocations list smoke: page loads with columns, breadcrumb, filters, and cost/iteration formatting', async ({ adminPage }) => {
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

    // Agent name filter input should render
    const agentInput = adminPage.locator('input[placeholder="Filter by agent..."]');
    await expect(agentInput).toBeVisible({ timeout: 10000 });

    // If rows exist, cost and iteration cells should contain expected formats
    const rows = entityList.locator('tbody tr');
    const rowCount = await rows.count();
    if (rowCount > 0) {
      // Cost is the 6th column (0-indexed: 5)
      const firstCostCell = rows.first().locator('td').nth(5);
      await expect(firstCostCell).toBeVisible();
      const costText = await firstCostCell.textContent();
      // formatCostDetailed returns either "$0.0000" style or "—"
      expect(costText?.trim()).toMatch(/^\$|—/);

      // Iteration is the 4th column (0-indexed: 3)
      const firstIterationCell = rows.first().locator('td').nth(3);
      await expect(firstIterationCell).toBeVisible();
      const iterText = await firstIterationCell.textContent();
      // iteration renders as a number or '—'
      expect(iterText?.trim()).toMatch(/^\d+$|—/);
    }

    // If there are multiple pages, jump-to-page renders; otherwise just verify filter bar works
    const pagination = adminPage.locator('[data-testid="pagination"]');
    const hasPagination = await pagination.isVisible();
    if (hasPagination) {
      const jumpInput = adminPage.locator('input[aria-label="Jump to page"]');
      await expect(jumpInput).toBeVisible();
    }
  });
});
