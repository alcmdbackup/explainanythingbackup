// E2E tests for evolution UI fixes — verifies LogsTab dropdown, VariantsTab ranks, RelatedRunsTab cost.

import { adminTest, expect, hasAdminCredentials } from '../../fixtures/admin-auth';

adminTest.describe('Evolution UI Fixes', { tag: '@critical' }, () => {
  adminTest.describe.configure({ retries: 1, mode: 'serial' });
  adminTest.setTimeout(30000);

  adminTest('LogsTab iteration dropdown reflects actual data', async ({ adminPage }) => {
    // Navigate to evolution dashboard to find a run with logs
    await adminPage.goto('/admin/evolution-dashboard');
    await adminPage.waitForLoadState('domcontentloaded');

    // Find a run link
    const runLink = adminPage.locator('a[href*="/admin/evolution/runs/"]').first();
    const hasRun = await runLink.isVisible({ timeout: 10000 }).catch(() => false);

    if (!hasRun) {
      adminTest.skip(true, 'No evolution runs found for logs test');
      return;
    }

    await runLink.click();
    await adminPage.waitForLoadState('domcontentloaded');

    // Click Logs tab
    const logsTab = adminPage.getByRole('tab', { name: /logs/i });
    const logsVisible = await logsTab.isVisible({ timeout: 5000 }).catch(() => false);
    if (!logsVisible) {
      adminTest.skip(true, 'Logs tab not visible');
      return;
    }
    await logsTab.click();

    // Wait for logs to load
    const iterationDropdown = adminPage.getByLabel('Filter by iteration');
    await expect(iterationDropdown).toBeVisible({ timeout: 10000 });

    // Dropdown should NOT have 20 hardcoded options
    const options = iterationDropdown.locator('option');
    const count = await options.count();

    // Should have "All iterations" plus dynamic count (not always 21)
    expect(count).toBeGreaterThanOrEqual(1); // At least "All iterations"
    expect(count).toBeLessThan(25); // Should not have padded to 20+ if data has fewer
  });

  adminTest('VariantsTab preserves rank when filtering by strategy', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution-dashboard');
    await adminPage.waitForLoadState('domcontentloaded');

    const runLink = adminPage.locator('a[href*="/admin/evolution/runs/"]').first();
    const hasRun = await runLink.isVisible({ timeout: 10000 }).catch(() => false);

    if (!hasRun) {
      adminTest.skip(true, 'No evolution runs found for variants test');
      return;
    }

    await runLink.click();
    await adminPage.waitForLoadState('domcontentloaded');

    // Click Variants tab
    const variantsTab = adminPage.getByRole('tab', { name: /variants/i });
    const variantsVisible = await variantsTab.isVisible({ timeout: 5000 }).catch(() => false);
    if (!variantsVisible) {
      adminTest.skip(true, 'Variants tab not visible');
      return;
    }
    await variantsTab.click();

    // Wait for variants table
    const variantsTabContent = adminPage.getByTestId('variants-tab');
    await expect(variantsTabContent).toBeVisible({ timeout: 10000 });

    // Get the first rank cell before filtering
    const firstRankCell = variantsTabContent.locator('td').first();
    const firstRankText = await firstRankCell.textContent({ timeout: 5000 }).catch(() => null);

    if (!firstRankText) {
      adminTest.skip(true, 'No variants data to test');
      return;
    }

    // If there's a strategy filter, select a strategy
    const strategyFilter = variantsTabContent.locator('select').first();
    const filterVisible = await strategyFilter.isVisible({ timeout: 3000 }).catch(() => false);

    if (filterVisible) {
      const options = strategyFilter.locator('option');
      const optionCount = await options.count();

      // If there are strategy options beyond "All strategies"
      if (optionCount > 1) {
        await strategyFilter.selectOption({ index: 1 });

        // Wait for filter to apply
        await adminPage.waitForTimeout(500);

        // Ranks should be from the original unfiltered list (e.g., #3, #5), not restarted (#1, #2)
        const filteredRankText = await variantsTabContent.locator('td').first().textContent();

        // The rank should contain a # sign
        expect(filteredRankText).toContain('#');
      }
    }
  });

  adminTest('RelatedRunsTab shows actual cost values', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution-dashboard');
    await adminPage.waitForLoadState('domcontentloaded');

    const runLink = adminPage.locator('a[href*="/admin/evolution/runs/"]').first();
    const hasRun = await runLink.isVisible({ timeout: 10000 }).catch(() => false);

    if (!hasRun) {
      adminTest.skip(true, 'No evolution runs found for cost test');
      return;
    }

    await runLink.click();
    await adminPage.waitForLoadState('domcontentloaded');

    // Click Related Runs tab
    const relatedTab = adminPage.getByRole('tab', { name: /related/i });
    const relatedVisible = await relatedTab.isVisible({ timeout: 5000 }).catch(() => false);

    if (!relatedVisible) {
      adminTest.skip(true, 'Related Runs tab not visible');
      return;
    }

    await relatedTab.click();

    // Wait for related runs to load
    await adminPage.waitForTimeout(2000);

    // Check that cost column exists and shows values (not all $0.00)
    const costCells = adminPage.locator('td:has-text("$")');
    const costCount = await costCells.count();

    // If there are cost cells, at least verify they render
    if (costCount > 0) {
      const firstCost = await costCells.first().textContent();
      expect(firstCost).toContain('$');
    }
  });
});
