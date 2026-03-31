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

    // Seed propagation metrics so detail/list pages show real values (not "—")
    const metricRows = [
      { entity_type: 'strategy', entity_id: strategyId, metric_name: 'run_count', value: 3 },
      { entity_type: 'strategy', entity_id: strategyId, metric_name: 'total_cost', value: 0.045 },
      { entity_type: 'strategy', entity_id: strategyId, metric_name: 'avg_final_elo', value: 1350, sigma: 42, ci_lower: 1308, ci_upper: 1392, aggregation_method: 'bootstrap_mean' },
      { entity_type: 'strategy', entity_id: strategyId, metric_name: 'best_final_elo', value: 1480, sigma: 55, ci_lower: 1425, ci_upper: 1535 },
    ];
    const { error: mErr } = await sb.from('evolution_metrics').insert(metricRows);
    if (mErr) throw new Error(`Seed metrics: ${mErr.message}`);
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();
    await sb.from('evolution_metrics').delete().eq('entity_id', strategyId);
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

    // Metrics tab should be present (detail page uses tabbed interface)
    const metricsTab = adminPage.locator('[data-testid="tab-metrics"]');
    await metricsTab.click();

    const metricsContainer = adminPage.locator('[data-testid="entity-metrics-tab"]');
    await expect(metricsContainer).toBeVisible({ timeout: 10000 });

    // Verify metric labels (run_count label is "Runs", total_cost label is "Total Cost")
    await expect(adminPage.locator('[data-testid="metric-runs"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="metric-total-cost"]')).toBeVisible();
  });

  adminTest('strategy metrics tab shows propagated values with CI', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/strategies/${strategyId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 15000 });

    // Metrics tab should be default (first tab)
    const metricsTab = adminPage.locator('[data-testid="tab-metrics"]');
    await metricsTab.click();

    const metricsContainer = adminPage.locator('[data-testid="entity-metrics-tab"]');
    await expect(metricsContainer).toBeVisible({ timeout: 10000 });

    // Verify metric values are numeric, not "—"
    const avgEloCell = adminPage.locator('[data-testid="metric-avg-winner-elo"]');
    await expect(avgEloCell).toBeVisible();
    await expect(avgEloCell).not.toContainText('—');
    // Should contain a CI range display (brackets from MetricGrid)
    await expect(avgEloCell).toContainText('[');

    const bestEloCell = adminPage.locator('[data-testid="metric-best-winner-elo"]');
    await expect(bestEloCell).toBeVisible();
    await expect(bestEloCell).not.toContainText('—');

    const runsCell = adminPage.locator('[data-testid="metric-runs"]');
    await expect(runsCell).toBeVisible();
    await expect(runsCell).toContainText('3');

    const costCell = adminPage.locator('[data-testid="metric-total-cost"]');
    await expect(costCell).toBeVisible();
    await expect(costCell).not.toContainText('—');
  });

  adminTest('strategy detail tab navigation works', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/strategies/${strategyId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    // Wait for content to load
    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 15000 });

    // Verify tab bar renders with Metrics, Runs, Config, and Logs tabs
    const tabBar = adminPage.locator('[data-testid="tab-bar"]');
    await expect(tabBar).toBeVisible();

    const metricsTab = adminPage.locator('[data-testid="tab-metrics"]');
    const configTab = adminPage.locator('[data-testid="tab-config"]');
    const logsTab = adminPage.locator('[data-testid="tab-logs"]');
    await expect(metricsTab).toBeVisible();
    await expect(configTab).toBeVisible();
    await expect(logsTab).toBeVisible();

    // Metrics tab should be active by default — metrics container visible
    await expect(adminPage.locator('[data-testid="entity-metrics-tab"]')).toBeVisible({ timeout: 10000 });

    // Switch to Config tab — StrategyConfigDisplay renders "Models" heading in tab content
    await configTab.click();
    await expect(adminPage.locator('[data-testid="tab-content"] h4:has-text("Models")')).toBeVisible({ timeout: 5000 });

    // Switch to Logs tab
    await logsTab.click();

    // Tab content should change — Config's "Models" heading should no longer be visible
    await expect(adminPage.locator('[data-testid="tab-content"] h4:has-text("Models")')).not.toBeVisible({ timeout: 5000 });

    // Switch back to Metrics
    await metricsTab.click();
    await expect(adminPage.locator('[data-testid="entity-metrics-tab"]')).toBeVisible({ timeout: 5000 });
  });
});
