// E2E tests for evolution page navigation: list-to-detail links and breadcrumb consistency.
// Verifies that experiment/strategy rows link to detail pages and breadcrumbs display correctly.

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

adminTest.describe('Evolution Navigation', { tag: ['@evolution', '@critical'] }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  const testPrefix = `e2e-nav-${Date.now()}`;
  let promptId: string;
  let strategyId: string;
  let experimentId: string;
  let runId: string;

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
        label: `${testPrefix} Strategy`,
        config: { maxIterations: 3 },
        config_hash: `hash-${testPrefix}`,
        status: 'active',
      })
      .select('id')
      .single();
    if (sErr) throw new Error(`Seed strategy: ${sErr.message}`);
    strategyId = strategy.id;

    // Seed experiment
    const { data: experiment, error: eErr } = await sb
      .from('evolution_experiments')
      .insert({ name: `${testPrefix}-experiment`, prompt_id: promptId, status: 'completed' })
      .select('id')
      .single();
    if (eErr) throw new Error(`Seed experiment: ${eErr.message}`);
    experimentId = experiment.id;

    // Seed run linked to experiment and strategy
    runId = randomUUID();
    const { error: rErr } = await sb.from('evolution_runs').insert({
      id: runId,
      status: 'completed',
      strategy_id: strategyId,
      experiment_id: experimentId,
      prompt_id: promptId,
      budget_cap_usd: 1.0,
      completed_at: new Date().toISOString(),
    });
    if (rErr) throw new Error(`Seed run: ${rErr.message}`);
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();
    await sb.from('evolution_runs').delete().eq('id', runId);
    await sb.from('evolution_experiments').delete().eq('id', experimentId);
    await sb.from('evolution_strategies').delete().eq('id', strategyId);
    await sb.from('evolution_prompts').delete().eq('id', promptId);
  });

  adminTest('list→detail nav: experiment and strategy list rows link to their detail pages', async ({ adminPage }) => {
    // Experiment list → detail
    await adminPage.goto('/admin/evolution/experiments', { timeout: 30000 });
    await adminPage.waitForLoadState('domcontentloaded');

    await expect(adminPage.locator('h1')).toContainText(/experiment/i, { timeout: 15000 });

    // Uncheck "Hide test content" so the `e2e-nav-*`-named seeded experiment is
    // visible. Required after Phase 1 of use_playwright_find_bugs_ux_issues_20260422
    // — `evolution_experiments` got an `is_test_content` column + trigger that
    // marks `e2e-*` names as test content; the filter is default-on.
    const expFilter = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    await expect(expFilter).toBeVisible({ timeout: 15000 });
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if (await expFilter.isChecked()) await expFilter.uncheck();

    // Wait for skeleton to finish loading
    await expect(adminPage.locator('[data-testid="entity-list-table"]')).toBeVisible({ timeout: 30000 });

    // Click the seeded experiment row (EntityTable renders rows as tr>td links)
    const experimentRow = adminPage.locator(`a[href*="/admin/evolution/experiments/${experimentId}"]`).first();
    await expect(experimentRow).toBeVisible({ timeout: 15000 });
    await experimentRow.click();

    // Should navigate to experiment detail
    await adminPage.waitForURL(`**/admin/evolution/experiments/${experimentId}`, { timeout: 30000 });
    expect(adminPage.url()).toContain(`/admin/evolution/experiments/${experimentId}`);

    // Strategy list → detail
    await adminPage.goto('/admin/evolution/strategies', { timeout: 30000 });
    await adminPage.waitForLoadState('domcontentloaded');

    await expect(adminPage.locator('h1')).toContainText(/strateg/i, { timeout: 15000 });

    // Same Hide-test-content default applies on the strategies list (was always
    // backed by `is_test_content` since 20260415000001).
    const strategyFilter = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    await expect(strategyFilter).toBeVisible({ timeout: 15000 });
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if (await strategyFilter.isChecked()) await strategyFilter.uncheck();

    // Wait for table data to load
    await expect(adminPage.locator('[data-testid="entity-list-table"]')).toBeVisible({ timeout: 15000 });

    // Click the seeded strategy row (EntityTable renders rows as tr>td links)
    const strategyRow = adminPage.locator(`a[href*="/admin/evolution/strategies/${strategyId}"]`).first();
    await expect(strategyRow).toBeVisible({ timeout: 15000 });
    await strategyRow.click();

    // Should navigate to strategy detail
    await adminPage.waitForURL(`**/admin/evolution/strategies/${strategyId}`, { timeout: 30000 });
    expect(adminPage.url()).toContain(`/admin/evolution/strategies/${strategyId}`);
  });

  adminTest('cross-links+breadcrumb: run detail shows cross-links to strategy/experiment and breadcrumb says "Evolution"', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${runId}`, { timeout: 30000 });
    await adminPage.waitForLoadState('domcontentloaded');

    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 30000 });

    // Verify cross-link to strategy exists
    const strategyLink = adminPage.locator(`a[href*="/admin/evolution/strategies/${strategyId}"]`);
    await expect(strategyLink).toBeVisible();

    // Verify cross-link to experiment exists
    const experimentLink = adminPage.locator(`a[href*="/admin/evolution/experiments/${experimentId}"]`);
    await expect(experimentLink).toBeVisible();

    // Root breadcrumb segment should contain "Evolution"
    const breadcrumb = adminPage.locator('[data-testid="evolution-breadcrumb"]');
    await expect(breadcrumb).toBeVisible({ timeout: 15000 });
    const rootLink = breadcrumb.locator('a').first();
    await expect(rootLink).toContainText('Evolution');

    // 404 within evolution area shows Next.js 404 page
    await adminPage.goto('/admin/evolution/nonexistent-page-xyz', { timeout: 30000 });
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.getByText('404')).toBeVisible({ timeout: 30000 });
  });
});
