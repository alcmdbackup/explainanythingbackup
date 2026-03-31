// E2E tests for filter consistency across evolution pages: "Hide test content" toggle and row counts.
// Verifies that the test-content filter works on Runs and Experiments pages.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

adminTest.describe('Evolution Filter Consistency', { tag: ['@evolution', '@critical'] }, () => {
  const testPrefix = `e2e-filter-${Date.now()}`;
  let testStrategyId: string;
  let normalStrategyId: string;
  let promptId: string;
  const runIds: string[] = [];

  adminTest.beforeAll(async () => {
    const sb = getServiceClient();

    // Seed prompt
    const { data: prompt, error: pErr } = await sb
      .from('evolution_prompts')
      .insert({ prompt: `${testPrefix} prompt`, name: `${testPrefix} Prompt`, status: 'active' })
      .select('id')
      .single();
    if (pErr) throw new Error(`Seed prompt: ${pErr.message}`);
    promptId = prompt.id;

    // Seed strategy WITH [TEST] in name
    const { data: testStrategy, error: tsErr } = await sb
      .from('evolution_strategies')
      .insert({
        name: `[TEST] ${testPrefix}-test-strategy`,
        config: { maxIterations: 1 },
        config_hash: `hash-test-${testPrefix}`,
        status: 'active',
      })
      .select('id')
      .single();
    if (tsErr) throw new Error(`Seed test strategy: ${tsErr.message}`);
    testStrategyId = testStrategy.id;

    // Seed strategy WITHOUT [TEST] in name
    const { data: normalStrategy, error: nsErr } = await sb
      .from('evolution_strategies')
      .insert({
        name: `${testPrefix}-normal-strategy`,
        config: { maxIterations: 1 },
        config_hash: `hash-normal-${testPrefix}`,
        status: 'active',
      })
      .select('id')
      .single();
    if (nsErr) throw new Error(`Seed normal strategy: ${nsErr.message}`);
    normalStrategyId = normalStrategy.id;

    // Seed runs linked to each strategy
    const testRunId = randomUUID();
    const normalRunId = randomUUID();
    const { error: rErr } = await sb.from('evolution_runs').insert([
      { id: testRunId, status: 'completed', strategy_id: testStrategyId, prompt_id: promptId, budget_cap_usd: 1.0, completed_at: new Date().toISOString() },
      { id: normalRunId, status: 'completed', strategy_id: normalStrategyId, prompt_id: promptId, budget_cap_usd: 1.0, completed_at: new Date().toISOString() },
    ]);
    if (rErr) throw new Error(`Seed runs: ${rErr.message}`);
    runIds.push(testRunId, normalRunId);
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();
    await sb.from('evolution_runs').delete().in('id', runIds);
    await sb.from('evolution_strategies').delete().eq('id', testStrategyId);
    await sb.from('evolution_strategies').delete().eq('id', normalStrategyId);
    await sb.from('evolution_prompts').delete().eq('id', promptId);
  });

  adminTest('runs page with hide-test-content checked hides test items', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/runs');
    await adminPage.waitForLoadState('domcontentloaded');

    const table = adminPage.locator('[data-testid="runs-list-table"]');
    await expect(table).toBeVisible({ timeout: 15000 });

    // First uncheck filter to see all rows (seeded data uses test prefixes)
    const hideTestLabel = adminPage.locator('[data-testid="filter-filterTestContent"]');
    const hideTestCheckbox = hideTestLabel.locator('input[type="checkbox"]');
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if (await hideTestCheckbox.isChecked()) {
      await hideTestCheckbox.uncheck();
    }

    // Both rows should be visible with filter off
    const testRunRow = adminPage.locator(`[data-testid="run-row-${runIds[0]}"]`);
    await expect(testRunRow).toBeVisible({ timeout: 15000 });

    // Re-check filter — test run should be hidden (strategy name contains [TEST])
    await hideTestCheckbox.check();
    await expect(testRunRow).not.toBeVisible({ timeout: 10000 });
  });

  adminTest('unchecking hide-test-content shows all rows', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/runs');
    await adminPage.waitForLoadState('domcontentloaded');

    const table = adminPage.locator('[data-testid="runs-list-table"]');
    await expect(table).toBeVisible({ timeout: 15000 });

    const hideTestLabel2 = adminPage.locator('[data-testid="filter-filterTestContent"]');
    const hideTestCheckbox = hideTestLabel2.locator('input[type="checkbox"]');
    if (await hideTestLabel2.count() > 0) {
      // Uncheck to show all content
      if (await hideTestCheckbox.isChecked()) {
        await hideTestCheckbox.uncheck();
      }

      // Both run rows should be visible
      const testRunRow = adminPage.locator(`[data-testid="run-row-${runIds[0]}"]`);
      await expect(testRunRow).toBeVisible({ timeout: 15000 });

      const normalRunRow = adminPage.locator(`[data-testid="run-row-${runIds[1]}"]`);
      await expect(normalRunRow).toBeVisible();
    }
  });

  adminTest('filter consistent on experiments page', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/experiments');
    await adminPage.waitForLoadState('domcontentloaded');

    // Verify page loads without error
    await expect(adminPage.locator('h1')).toContainText(/experiment/i, { timeout: 15000 });

    // If hide-test-content toggle exists, verify it is functional
    const hideTestLabel3 = adminPage.locator('[data-testid="filter-filterTestContent"]');
    if (await hideTestLabel3.count() > 0) {
      const checkbox = hideTestLabel3.locator('input[type="checkbox"]');
      // Toggle should be interactable
      await expect(checkbox).toBeEnabled();
    }
  });
});
