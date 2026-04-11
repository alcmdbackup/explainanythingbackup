// E2E tests for strategy detail page: config display, metrics, and tab navigation.
// Seeds a strategy via service client and verifies the detail page renders correctly.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

adminTest.describe('Evolution Strategy Detail (T17, T18)', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

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

  adminTest('detail loads+metrics: strategy detail shows config, status badge, and metrics tab', async ({ adminPage }) => {
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
    await expect(metricsContainer).toBeVisible({ timeout: 15000 });

    // Verify metric labels (run_count label is "Runs", total_cost label is "Total Cost")
    await expect(adminPage.locator('[data-testid="metric-runs"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="metric-total-cost"]')).toBeVisible();

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
});
