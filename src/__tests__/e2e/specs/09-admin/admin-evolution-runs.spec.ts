// E2E tests for evolution runs list and run detail pages.
// Covers status filtering, row navigation, detail tabs, and breadcrumb navigation.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { randomUUID } from 'crypto';

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

adminTest.describe('Evolution Runs (T4, T7, T8, T10)', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  const testPrefix = `e2e-runs-${Date.now()}`;
  let strategyId: string;
  let promptId: string;
  const runIds: string[] = [];
  let completedRunId: string;
  let failedRunId: string;

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

    // Seed runs with different statuses
    completedRunId = randomUUID();
    failedRunId = randomUUID();
    const pendingRunId = randomUUID();
    const runInserts = [
      { id: completedRunId, status: 'completed', strategy_id: strategyId, prompt_id: promptId, budget_cap_usd: 1.0, completed_at: new Date().toISOString() },
      { id: failedRunId, status: 'failed', strategy_id: strategyId, prompt_id: promptId, budget_cap_usd: 1.0, error_message: 'test error' },
      { id: pendingRunId, status: 'pending', strategy_id: strategyId, prompt_id: promptId, budget_cap_usd: 1.0 },
    ];
    const { error: rErr } = await sb.from('evolution_runs').insert(runInserts);
    if (rErr) throw new Error(`Seed runs: ${rErr.message}`);
    runIds.push(completedRunId, failedRunId, pendingRunId);
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();
    await sb.from('evolution_runs').delete().in('id', runIds);
    await sb.from('evolution_strategies').delete().eq('id', strategyId);
    await sb.from('evolution_prompts').delete().eq('id', promptId);
  });

  adminTest('list+status filter: runs list renders and status filter shows correct rows', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/runs', { timeout: 30000 });
    await adminPage.waitForLoadState('domcontentloaded');

    // Wait for table to render
    const table = adminPage.locator('[data-testid="runs-list-table"]');
    await expect(table).toBeVisible({ timeout: 30000 });

    // Uncheck "Hide test content" so seeded test data is visible
    const hideTestCheckbox = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if (await hideTestCheckbox.isChecked()) {
      await hideTestCheckbox.click();
      // Wait for table to reload after filter change
      await table.waitFor({ state: 'visible' });
    }

    // Use the status filter dropdown
    const statusFilter = adminPage.locator('[data-testid="filter-status"]');
    await expect(statusFilter).toBeVisible();

    // Filter to "completed" — should show only completed runs
    await statusFilter.selectOption('completed');
    // Wait for the completed run row to appear (table reloads on filter change)
    await adminPage.locator(`[data-testid="run-row-${completedRunId}"]`).waitFor({ state: 'visible', timeout: 15000 });

    // The completed run should be visible
    const completedRow = adminPage.locator(`[data-testid="run-row-${completedRunId}"]`);
    await expect(completedRow).toBeVisible({ timeout: 15000 });

    // The failed run should not be visible when filtering to completed
    const failedRow = adminPage.locator(`[data-testid="run-row-${failedRunId}"]`);
    await expect(failedRow).not.toBeVisible();
  });

  adminTest('detail tabs: run detail page shows all expected tabs and variant tab content', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${completedRunId}`, { timeout: 30000 });
    await adminPage.waitForLoadState('domcontentloaded');

    // Wait for the detail header to render
    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 30000 });

    // Verify the tab bar renders
    const tabBar = adminPage.locator('[data-testid="tab-bar"]');
    await expect(tabBar).toBeVisible();

    // Verify each expected tab exists (run detail uses: metrics, elo, lineage, variants, logs)
    await expect(adminPage.locator('[data-testid="tab-metrics"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="tab-elo"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="tab-lineage"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="tab-variants"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="tab-logs"]')).toBeVisible();

    // Click the Variants tab
    const variantsTab = adminPage.locator('[data-testid="tab-variants"]');
    await variantsTab.click();

    // Tab content area should be visible after clicking
    const tabContent = adminPage.locator('[data-testid="tab-content"]');
    await expect(tabContent).toBeVisible({ timeout: 15000 });

    // Failed run detail should show failed status badge
    await adminPage.goto(`/admin/evolution/runs/${failedRunId}`, { timeout: 30000 });
    await adminPage.waitForLoadState('domcontentloaded');
    const failedHeader = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(failedHeader).toBeVisible({ timeout: 30000 });
    const statusBadge = failedHeader.locator('[data-testid="status-badge-failed"]');
    await expect(statusBadge).toBeVisible();
    await expect(statusBadge).toContainText(/failed/i);
  });

  adminTest('breadcrumb+strategy filter: breadcrumb nav works and strategy filter renders', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${completedRunId}`, { timeout: 30000 });
    await adminPage.waitForLoadState('domcontentloaded');

    // Verify breadcrumb renders
    const breadcrumb = adminPage.locator('[data-testid="evolution-breadcrumb"]');
    await expect(breadcrumb).toBeVisible({ timeout: 30000 });

    // Breadcrumb should contain "Runs" link
    const runsLink = breadcrumb.locator('a:has-text("Runs")');
    await expect(runsLink).toBeVisible();

    // Click the "Runs" breadcrumb link
    await runsLink.click();

    // Verify navigation back to runs list
    await adminPage.waitForURL('**/admin/evolution/runs', { timeout: 15000 });
    await expect(adminPage.locator('h1')).toContainText('Evolution Runs');

    // Strategy filter select should render (populated after strategies load)
    const strategySelect = adminPage.locator('select').filter({ hasText: 'All strategies' });
    await expect(strategySelect).toBeVisible({ timeout: 15000 });
  });
});
