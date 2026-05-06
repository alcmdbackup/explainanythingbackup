// E2E tests for the evolution experiments list page.
// Covers table rendering, status filtering, row navigation, breadcrumbs, and empty state.

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

adminTest.describe('Evolution Experiments List', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  const testPrefix = `e2e-experiments-${Date.now()}`;
  let strategyId: string;
  let promptId: string;
  let runId: string;
  const experimentIds: string[] = [];
  let activeExperimentId: string;
  let cancelledExperimentId: string;

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

    // Seed experiments with different statuses
    activeExperimentId = randomUUID();
    cancelledExperimentId = randomUUID();
    const experimentInserts = [
      {
        id: activeExperimentId,
        name: `${testPrefix}-active-experiment`,
        prompt_id: promptId,
        status: 'running',
      },
      {
        id: cancelledExperimentId,
        name: `${testPrefix}-cancelled-experiment`,
        prompt_id: promptId,
        status: 'cancelled',
      },
    ];
    const { error: eErr } = await sb.from('evolution_experiments').insert(experimentInserts);
    if (eErr) throw new Error(`Seed experiments: ${eErr.message}`);
    experimentIds.push(activeExperimentId, cancelledExperimentId);

    // Seed a run linked to the active experiment
    runId = randomUUID();
    const { error: rErr } = await sb.from('evolution_runs').insert({
      id: runId,
      status: 'completed',
      strategy_id: strategyId,
      prompt_id: promptId,
      experiment_id: activeExperimentId,
      budget_cap_usd: 1.0,
      completed_at: new Date().toISOString(),
    });
    if (rErr) throw new Error(`Seed run: ${rErr.message}`);
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();
    await sb.from('evolution_runs').delete().eq('id', runId);
    await sb.from('evolution_experiments').delete().in('id', experimentIds);
    await sb.from('evolution_strategies').delete().eq('id', strategyId);
    await sb.from('evolution_prompts').delete().eq('id', promptId);
  });

  adminTest('columns+row: table renders with data and correct column headers', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/experiments');
    await adminPage.waitForLoadState('domcontentloaded');

    const listPage = adminPage.locator('[data-testid="entity-list-page"]');
    await expect(listPage).toBeVisible({ timeout: 15000 });

    // Phase 1 of use_playwright_find_bugs_ux_issues_20260422 added an
    // is_test_content column + trigger to evolution_experiments. The trigger
    // marks the test's e2e-* seed rows as is_test_content=true and "Hide test
    // content" is default-on — so the seeded rows are now correctly filtered out.
    const filter = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if (await filter.isChecked()) await filter.uncheck();

    const table = adminPage.locator('[data-testid="entity-list-table"]');
    await expect(table).toBeVisible({ timeout: 15000 });

    // Verify at least one experiment row is present (the active one)
    await expect(table.locator(`text=${testPrefix}-active-experiment`)).toBeVisible({ timeout: 10000 });

    // Verify column headers
    await expect(table.locator('th:has-text("Name")')).toBeVisible();
    await expect(table.locator('th:has-text("Status")')).toBeVisible();
    await expect(table.locator('th:has-text("Runs")')).toBeVisible();
    await expect(table.locator('th:has-text("Created")')).toBeVisible();

    // Verify title renders
    await expect(listPage.locator('h1:has-text("Experiments")')).toBeVisible();

    // Filter bar and both filter inputs should be visible
    const filterBar = adminPage.locator('[data-testid="filter-bar"]');
    await expect(filterBar).toBeVisible();
    await expect(adminPage.locator('[data-testid="filter-status"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="filter-filterTestContent"]')).toBeVisible();

    // Name search input should render
    const nameInput = adminPage.locator('input[placeholder="Search..."]').first();
    await expect(nameInput).toBeVisible({ timeout: 10000 });
  });

  adminTest('status filter: shows correct experiments by status', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/experiments');
    await adminPage.waitForLoadState('domcontentloaded');

    // Same Hide-test-content unfiltering as above (Phase 1). Wait for the filter
    // to actually render before reading isChecked — without this the read can
    // race the React hydration and skip the uncheck silently.
    const filter = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    await expect(filter).toBeVisible({ timeout: 15000 });
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if (await filter.isChecked()) await filter.uncheck();

    const table = adminPage.locator('[data-testid="entity-list-table"]');
    await expect(table).toBeVisible({ timeout: 15000 });

    // The default status filter is "Active" (empty value) which excludes cancelled
    // Verify the active experiment is shown
    await expect(table.locator(`text=${testPrefix}-active-experiment`)).toBeVisible({ timeout: 10000 });

    // Switch to "Cancelled" filter
    const statusFilter = adminPage.locator('[data-testid="filter-status"]');
    await expect(statusFilter).toBeVisible();
    await statusFilter.selectOption('cancelled');

    // The cancelled experiment should now appear
    await expect(table.locator(`text=${testPrefix}-cancelled-experiment`)).toBeVisible({ timeout: 10000 });
  });

  adminTest('breadcrumb nav: clicking experiment row navigates to detail and breadcrumb links to Evolution', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/experiments');
    await adminPage.waitForLoadState('domcontentloaded');

    // Same Hide-test-content unfiltering as above (Phase 1). Wait for the filter
    // to actually render before reading isChecked — without this the read can
    // race the React hydration and skip the uncheck silently.
    const filter = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    await expect(filter).toBeVisible({ timeout: 15000 });
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if (await filter.isChecked()) await filter.uncheck();

    const table = adminPage.locator('[data-testid="entity-list-table"]');
    await expect(table).toBeVisible({ timeout: 15000 });

    // Click the active experiment link
    const expLink = table.locator(`a[href*="/admin/evolution/experiments/${activeExperimentId}"]`).first();
    await expect(expLink).toBeVisible({ timeout: 10000 });
    await expLink.click();

    await adminPage.waitForURL(`**/admin/evolution/experiments/${activeExperimentId}`, { timeout: 10000 });
    expect(adminPage.url()).toContain(`/admin/evolution/experiments/${activeExperimentId}`);

    // Navigate back to list and verify breadcrumb
    await adminPage.goto('/admin/evolution/experiments');
    await adminPage.waitForLoadState('domcontentloaded');

    const breadcrumb = adminPage.locator('[data-testid="evolution-breadcrumb"]');
    await expect(breadcrumb).toBeVisible({ timeout: 15000 });

    // Breadcrumb should contain "Evolution" link
    const dashLink = breadcrumb.locator('a:has-text("Evolution")');
    await expect(dashLink).toBeVisible();

    // Click Dashboard breadcrumb
    await dashLink.click();
    await adminPage.waitForURL('**/admin/evolution-dashboard', { timeout: 10000 });
    expect(adminPage.url()).toContain('/admin/evolution-dashboard');
  });
});
