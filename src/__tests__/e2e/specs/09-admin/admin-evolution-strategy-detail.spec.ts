// E2E tests for strategy detail page: config display, metrics, and tab navigation.
// Seeds a strategy via service client and verifies the detail page renders correctly.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

adminTest.describe('Evolution Strategy Detail (T17, T18)', { tag: '@evolution' }, () => {
  const testPrefix = `e2e-strat-${Date.now()}`;
  let strategyId: string;

  adminTest.beforeAll(async () => {
    const sb = getServiceClient();

    const { data: strategy, error } = await sb
      .from('evolution_strategies')
      .insert({
        name: `${testPrefix}-strategy`,
        label: `${testPrefix} Strategy Label`,
        description: 'A test strategy for E2E validation',
        config: { maxIterations: 5, populationSize: 8, mutationRate: 0.3 },
        config_hash: `hash-${testPrefix}`,
        status: 'active',
      })
      .select('id')
      .single();
    if (error) throw new Error(`Seed strategy: ${error.message}`);
    strategyId = strategy.id;
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();
    await sb.from('evolution_strategies').delete().eq('id', strategyId);
  });

  adminTest('strategy detail shows config and metrics', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/strategies/${strategyId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    // Verify the detail header renders
    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 15000 });

    // Strategy name should appear
    await expect(adminPage.locator('body')).toContainText(testPrefix);

    // Strategy status badge should be visible
    const statusBadge = adminPage.locator('[data-testid="strategy-status-badge"]');
    await expect(statusBadge).toBeVisible();
    await expect(statusBadge).toContainText('active');

    // Configuration section should render with config keys
    await expect(adminPage.locator('text=Configuration')).toBeVisible();

    // Metrics grid should be present
    const metricsGrid = adminPage.locator('[data-testid="strategy-metrics"]');
    await expect(metricsGrid).toBeVisible();

    // Verify some metric labels
    await expect(adminPage.locator('[data-testid="metric-run-count"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="metric-total-cost"]')).toBeVisible();
  });

  adminTest('strategy detail tab navigation works', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/strategies/${strategyId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    // Wait for content to load
    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 15000 });

    // Verify tab bar renders with Overview and Logs tabs
    const tabBar = adminPage.locator('[data-testid="tab-bar"]');
    await expect(tabBar).toBeVisible();

    const overviewTab = adminPage.locator('[data-testid="tab-overview"]');
    const logsTab = adminPage.locator('[data-testid="tab-logs"]');
    await expect(overviewTab).toBeVisible();
    await expect(logsTab).toBeVisible();

    // Overview tab should be active by default — config section visible
    await expect(adminPage.locator('text=Configuration')).toBeVisible();

    // Switch to Logs tab
    await logsTab.click();

    // Tab content should change — Configuration section should no longer be visible
    await expect(adminPage.locator('text=Configuration')).not.toBeVisible({ timeout: 5000 });

    // Switch back to Overview
    await overviewTab.click();
    await expect(adminPage.locator('text=Configuration')).toBeVisible({ timeout: 5000 });
  });
});
