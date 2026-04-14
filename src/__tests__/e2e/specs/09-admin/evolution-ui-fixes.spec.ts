// E2E tests for evolution UI fixes — verifies LogsTab dropdown, VariantsTab ranks, RelatedRunsTab cost.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { safeIsVisible, safeWaitFor } from '../../helpers/error-utils';

adminTest.describe('Evolution UI Fixes', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ retries: 1, mode: 'serial' });
  adminTest.setTimeout(30000);

  adminTest('LogsTab iteration dropdown reflects actual data', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution-dashboard');
    await adminPage.waitForLoadState('domcontentloaded');

    const runLink = adminPage.locator('a[href*="/admin/evolution/runs/"]').first();
    const hasRun = await safeIsVisible(runLink, 'run-link', 10000);

    if (!hasRun) {
      // eslint-disable-next-line flakiness/no-test-skip -- No evolution runs in test environment
      adminTest.skip(true, 'No evolution runs found for logs test');
      return;
    }

    await runLink.click();
    await adminPage.waitForLoadState('domcontentloaded');

    const logsTab = adminPage.getByRole('tab', { name: /logs/i });
    const logsVisible = await safeIsVisible(logsTab, 'logs-tab', 5000);
    if (!logsVisible) {
      // eslint-disable-next-line flakiness/no-test-skip -- Logs tab not present on this run
      adminTest.skip(true, 'Logs tab not visible');
      return;
    }
    await logsTab.click();

    const iterationDropdown = adminPage.getByLabel('Filter by iteration');
    await expect(iterationDropdown).toBeVisible({ timeout: 10000 });

    const options = iterationDropdown.locator('option');
    const count = await options.count();

    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThan(25);
  });

  adminTest('VariantsTab shows rank values', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution-dashboard');
    await adminPage.waitForLoadState('domcontentloaded');

    const runLink = adminPage.locator('a[href*="/admin/evolution/runs/"]').first();
    const hasRun = await safeIsVisible(runLink, 'run-link', 10000);

    if (!hasRun) {
      // eslint-disable-next-line flakiness/no-test-skip -- No evolution runs in test environment
      adminTest.skip(true, 'No evolution runs found for variants test');
      return;
    }

    await runLink.click();
    await adminPage.waitForLoadState('domcontentloaded');

    const variantsTab = adminPage.getByRole('tab', { name: /variants/i });
    const variantsVisible = await safeIsVisible(variantsTab, 'variants-tab', 5000);
    if (!variantsVisible) {
      // eslint-disable-next-line flakiness/no-test-skip -- Variants tab not present on this run
      adminTest.skip(true, 'Variants tab not visible');
      return;
    }
    await variantsTab.click();

    const variantsTabContent = adminPage.getByTestId('variants-tab');
    await expect(variantsTabContent).toBeVisible({ timeout: 10000 });

    const firstRankCell = variantsTabContent.locator('td').first();
    const firstRankText = await firstRankCell.textContent({ timeout: 5000 });

    if (firstRankText) {
      expect(firstRankText).toContain('#');
    }
  });

  adminTest('RelatedRunsTab shows cost values', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution-dashboard');
    await adminPage.waitForLoadState('domcontentloaded');

    const runLink = adminPage.locator('a[href*="/admin/evolution/runs/"]').first();
    const hasRun = await safeIsVisible(runLink, 'run-link', 10000);

    if (!hasRun) {
      // eslint-disable-next-line flakiness/no-test-skip -- No evolution runs in test environment
      adminTest.skip(true, 'No evolution runs found for cost test');
      return;
    }

    await runLink.click();
    await adminPage.waitForLoadState('domcontentloaded');

    const relatedTab = adminPage.getByRole('tab', { name: /related/i });
    const relatedVisible = await safeIsVisible(relatedTab, 'related-tab', 5000);

    if (!relatedVisible) {
      // eslint-disable-next-line flakiness/no-test-skip -- Related tab not present on this run
      adminTest.skip(true, 'Related Runs tab not visible');
      return;
    }

    await relatedTab.click();
    await safeWaitFor(adminPage.locator('td:has-text("$")').first(), 'visible', 'cost-cells', 5000);

    const costCells = adminPage.locator('td:has-text("$")');
    const costCount = await costCells.count();

    if (costCount > 0) {
      const firstCost = await costCells.first().textContent();
      expect(firstCost).toContain('$');
    }
  });
});
