// E2E tests for the evolution dashboard page: metric cards with seeded data and empty state.
// Verifies MetricGrid rendering and cost value display.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

adminTest.describe('Evolution Dashboard (T1-T3)', { tag: '@evolution' }, () => {
  adminTest.describe('dashboard with seeded data', { tag: '@evolution' }, () => {
    const testPrefix = `e2e-dash-${Date.now()}`;
    let strategyId: string;
    let promptId: string;
    const runIds: string[] = [];

    adminTest.beforeAll(async () => {
      const sb = getServiceClient();

      // Seed prompt
      const { data: prompt, error: pErr } = await sb
        .from('evolution_prompts')
        .insert({ prompt: `${testPrefix} prompt`, title: `${testPrefix} Prompt`, status: 'active' })
        .select('id')
        .single();
      if (pErr) throw new Error(`Seed prompt: ${pErr.message}`);
      promptId = prompt.id;

      // Seed strategy
      const { data: strategy, error: sErr } = await sb
        .from('evolution_strategies')
        .insert({
          name: `${testPrefix}-strategy`,
          config: { maxIterations: 3 },
          config_hash: `hash-${testPrefix}`,
          status: 'active',
        })
        .select('id')
        .single();
      if (sErr) throw new Error(`Seed strategy: ${sErr.message}`);
      strategyId = strategy.id;

      // Seed 2 completed runs + 1 failed run
      const runInserts = [
        { id: randomUUID(), status: 'completed', strategy_id: strategyId, prompt_id: promptId, budget_cap_usd: 1.0, completed_at: new Date().toISOString() },
        { id: randomUUID(), status: 'completed', strategy_id: strategyId, prompt_id: promptId, budget_cap_usd: 1.0, completed_at: new Date().toISOString() },
        { id: randomUUID(), status: 'failed', strategy_id: strategyId, prompt_id: promptId, budget_cap_usd: 1.0, error_message: 'test failure' },
      ];
      const { error: rErr } = await sb.from('evolution_runs').insert(runInserts);
      if (rErr) throw new Error(`Seed runs: ${rErr.message}`);
      runIds.push(...runInserts.map((r) => r.id));
    });

    adminTest.afterAll(async () => {
      const sb = getServiceClient();
      await sb.from('evolution_runs').delete().in('id', runIds);
      await sb.from('evolution_strategies').delete().eq('id', strategyId);
      await sb.from('evolution_prompts').delete().eq('id', promptId);
    });

    adminTest('dashboard shows metric cards with seeded data', async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution-dashboard');
      await adminPage.waitForLoadState('domcontentloaded');

      // Dashboard content should render (not error state)
      const content = adminPage.locator('[data-testid="dashboard-content"]');
      await expect(content).toBeVisible({ timeout: 15000 });

      // MetricGrid should be present
      const metricGrid = adminPage.locator('[data-testid="dashboard-metrics"]');
      await expect(metricGrid).toBeVisible();

      // Verify specific metric labels render
      await expect(adminPage.locator('[data-testid="metric-completed-runs"]')).toBeVisible();
      await expect(adminPage.locator('[data-testid="metric-failed-runs"]')).toBeVisible();
      await expect(adminPage.locator('[data-testid="metric-total-cost"]')).toBeVisible();

      // Error state should not be showing
      await expect(adminPage.locator('text=Failed to load')).not.toBeVisible();
    });
  });

  adminTest.describe('dashboard empty state', { tag: '@evolution' }, () => {
    adminTest('dashboard handles empty state gracefully', async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution-dashboard');
      await adminPage.waitForLoadState('domcontentloaded');

      // Either dashboard content loads with zero metrics or we see "No data available"
      const content = adminPage.locator('[data-testid="dashboard-content"]');
      const emptyMsg = adminPage.locator('text=No data available');

      const loaded = await Promise.race([
        content.waitFor({ state: 'visible', timeout: 15000 }).then(() => 'content'),
        emptyMsg.waitFor({ state: 'visible', timeout: 15000 }).then(() => 'empty'),
      ]);
      expect(['content', 'empty']).toContain(loaded);

      // Error state should not appear
      await expect(adminPage.locator('text=Failed to load')).not.toBeVisible();
    });
  });
});
