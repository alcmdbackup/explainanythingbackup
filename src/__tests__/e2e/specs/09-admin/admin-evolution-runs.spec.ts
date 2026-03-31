// E2E tests for evolution runs list and run detail pages.
// Covers status filtering, row navigation, detail tabs, and breadcrumb navigation.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

adminTest.describe('Evolution Runs (T4, T7, T8, T10)', { tag: '@evolution' }, () => {
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

  adminTest('runs list status filter works', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/runs');
    await adminPage.waitForLoadState('domcontentloaded');

    // Wait for table to render
    const table = adminPage.locator('[data-testid="runs-list-table"]');
    await expect(table).toBeVisible({ timeout: 15000 });

    // Uncheck "Hide test content" so seeded test data is visible
    const hideTestCheckbox = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    if (await hideTestCheckbox.isChecked()) {
      await hideTestCheckbox.click();
      await adminPage.waitForTimeout(500);
    }

    // Use the status filter dropdown
    const statusFilter = adminPage.locator('[data-testid="filter-status"]');
    await expect(statusFilter).toBeVisible();

    // Filter to "completed" — should show only completed runs
    await statusFilter.selectOption('completed');
    // Wait for the completed run row to appear (table reloads on filter change)
    await adminPage.locator(`[data-testid="run-row-${completedRunId}"]`).waitFor({ state: 'visible', timeout: 10000 });

    // The completed run should be visible
    const completedRow = adminPage.locator(`[data-testid="run-row-${completedRunId}"]`);
    await expect(completedRow).toBeVisible({ timeout: 10000 });

    // The failed run should not be visible when filtering to completed
    const failedRow = adminPage.locator(`[data-testid="run-row-${failedRunId}"]`);
    await expect(failedRow).not.toBeVisible();
  });

  adminTest('clicking run row navigates to detail page', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/runs');
    await adminPage.waitForLoadState('domcontentloaded');

    const table = adminPage.locator('[data-testid="runs-list-table"]');
    await expect(table).toBeVisible({ timeout: 15000 });

    // Uncheck "Hide test content" so seeded test data is visible
    const hideTestCheckbox = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    if (await hideTestCheckbox.isChecked()) {
      await hideTestCheckbox.click();
      await adminPage.waitForTimeout(500);
    }

    // Click the completed run row
    const runRow = adminPage.locator(`[data-testid="run-row-${completedRunId}"]`);
    await expect(runRow).toBeVisible({ timeout: 10000 });
    await runRow.click();

    // Verify URL navigated to the run detail page
    await adminPage.waitForURL(`**/admin/evolution/runs/${completedRunId}`, { timeout: 10000 });
    expect(adminPage.url()).toContain(`/admin/evolution/runs/${completedRunId}`);
  });

  adminTest('run detail page shows tabs', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${completedRunId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    // Wait for the detail header to render
    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 15000 });

    // Verify the tab bar renders with expected tabs (uses ARIA role="tab")
    await expect(adminPage.getByRole('tab', { name: 'Metrics' })).toBeVisible();
    await expect(adminPage.getByRole('tab', { name: 'Elo' })).toBeVisible();
    await expect(adminPage.getByRole('tab', { name: 'Lineage' })).toBeVisible();
    await expect(adminPage.getByRole('tab', { name: 'Variants' })).toBeVisible();
    await expect(adminPage.getByRole('tab', { name: 'Logs' })).toBeVisible();
  });

  adminTest('run detail breadcrumb navigation works', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${completedRunId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    // Verify breadcrumb renders
    const breadcrumb = adminPage.locator('[data-testid="evolution-breadcrumb"]');
    await expect(breadcrumb).toBeVisible({ timeout: 15000 });

    // Breadcrumb should contain "Runs" link
    const runsLink = breadcrumb.locator('a:has-text("Runs")');
    await expect(runsLink).toBeVisible();

    // Click the "Runs" breadcrumb link
    await runsLink.click();

    // Verify navigation back to runs list
    await adminPage.waitForURL('**/admin/evolution/runs', { timeout: 10000 });
    await expect(adminPage.locator('h1')).toContainText('Evolution Runs');
  });

  adminTest('failed run detail page shows error message in status badge', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${failedRunId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    // Wait for the detail header to render
    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 15000 });

    // The status badge should reflect the failed state (run-status variant uses status-badge-${status})
    const statusBadge = header.locator('[data-testid="status-badge-failed"]');
    await expect(statusBadge).toBeVisible();
    await expect(statusBadge).toContainText(/failed/i);
  });

  adminTest('run detail page renders variant tab with content', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${completedRunId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    // Wait for the tab bar to render
    const tabBar = adminPage.locator('[data-testid="tab-bar"]');
    await expect(tabBar).toBeVisible({ timeout: 15000 });

    // Click the Variants tab
    const variantsTab = adminPage.locator('[data-testid="tab-variants"]');
    await expect(variantsTab).toBeVisible();
    await variantsTab.click();

    // Tab content area should be visible after clicking
    const tabContent = adminPage.locator('[data-testid="tab-content"]');
    await expect(tabContent).toBeVisible({ timeout: 10000 });
  });
});
