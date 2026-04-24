// E2E accessibility tests for evolution admin pages: table headers and ARIA roles.
// Uses Playwright accessibility snapshots to verify semantic structure.

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

adminTest.describe('Evolution Accessibility', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  const testPrefix = `e2e-a11y-${Date.now()}`;
  let strategyId: string;
  let promptId: string;
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
        config: { maxIterations: 3 },
        config_hash: `hash-${testPrefix}`,
        status: 'active',
      })
      .select('id')
      .single();
    if (sErr) throw new Error(`Seed strategy: ${sErr.message}`);
    strategyId = strategy.id;

    // Seed run for tab ARIA tests
    runId = randomUUID();
    const { error: rErr } = await sb.from('evolution_runs').insert({
      id: runId,
      status: 'completed',
      strategy_id: strategyId,
      prompt_id: promptId,
      budget_cap_usd: 1.0,
      completed_at: new Date().toISOString(),
    });
    if (rErr) throw new Error(`Seed run: ${rErr.message}`);
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();
    await sb.from('evolution_runs').delete().eq('id', runId);
    await sb.from('evolution_strategies').delete().eq('id', strategyId);
    await sb.from('evolution_prompts').delete().eq('id', promptId);
  });

  adminTest('strategies page table column headers have text content', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies');
    await adminPage.waitForLoadState('domcontentloaded');

    // Wait for EntityListPage table to render with data (entity-list-table testid)
    const table = adminPage.locator('[data-testid="entity-list-table"] table');
    await expect(table).toBeVisible({ timeout: 20000 });

    // Get all <th> elements
    const headers = table.locator('thead th');
    const headerCount = await headers.count();
    expect(headerCount).toBeGreaterThan(0);

    // Each header should have non-empty text content
    for (let i = 0; i < headerCount; i++) {
      const headerText = await headers.nth(i).textContent();
      expect(headerText?.trim().length).toBeGreaterThan(0);
    }
  });

  adminTest('table columnheaders on Prompts page have text content', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/prompts');
    await adminPage.waitForLoadState('domcontentloaded');

    // Phase 1 of use_playwright_find_bugs_ux_issues_20260422 added is_test_content
    // columns to evolution_prompts/experiments/strategies. The seeded `e2e-*` data
    // is now correctly marked as test content; "Hide test content" is default-on
    // so the seeded rows are filtered out and the table renders an empty state
    // (no <table> element). Uncheck the filter so seeded rows are visible.
    const filter = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    // Wait briefly for the checkbox to render before reading its state — without
    // this, isChecked can race the React hydration and silently skip the uncheck.
    if ((await filter.count()) > 0) await expect(filter).toBeVisible({ timeout: 15000 });
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if ((await filter.count()) > 0 && (await filter.isChecked())) await filter.uncheck();

    // Wait for EntityListPage table to render with data
    const table = adminPage.locator('[data-testid="entity-list-table"] table');
    await expect(table).toBeVisible({ timeout: 20000 });

    const headers = table.locator('thead th');
    const headerCount = await headers.count();
    expect(headerCount).toBeGreaterThan(0);

    for (let i = 0; i < headerCount; i++) {
      const headerText = await headers.nth(i).textContent();
      expect(headerText?.trim().length).toBeGreaterThan(0);
    }
  });

  adminTest('table columnheaders on Arena page have text content', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/arena');
    await adminPage.waitForLoadState('domcontentloaded');

    // Phase 1 of use_playwright_find_bugs_ux_issues_20260422 added is_test_content
    // columns to evolution_prompts/experiments/strategies. The seeded `e2e-*` data
    // is now correctly marked as test content; "Hide test content" is default-on
    // so the seeded rows are filtered out and the table renders an empty state
    // (no <table> element). Uncheck the filter so seeded rows are visible.
    const filter = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    // Wait briefly for the checkbox to render before reading its state — without
    // this, isChecked can race the React hydration and silently skip the uncheck.
    if ((await filter.count()) > 0) await expect(filter).toBeVisible({ timeout: 15000 });
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if ((await filter.count()) > 0 && (await filter.isChecked())) await filter.uncheck();

    // U16: "Hide empty topics" is now also default-on on the arena topics list.
    const hideEmptyFilter = adminPage.locator('[data-testid="filter-hideEmpty"] input[type="checkbox"]');
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if ((await hideEmptyFilter.count()) > 0 && (await hideEmptyFilter.isChecked())) await hideEmptyFilter.uncheck();

    // Wait for EntityListPage table to render with data
    const table = adminPage.locator('[data-testid="entity-list-table"] table');
    await expect(table).toBeVisible({ timeout: 20000 });

    const headers = table.locator('thead th');
    const headerCount = await headers.count();
    expect(headerCount).toBeGreaterThan(0);

    for (let i = 0; i < headerCount; i++) {
      const headerText = await headers.nth(i).textContent();
      expect(headerText?.trim().length).toBeGreaterThan(0);
    }
  });

  adminTest('run detail tabs have role="tablist" with role="tab" children', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${runId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 15000 });

    // Verify tablist role exists
    const tablist = adminPage.locator('[role="tablist"]');
    await expect(tablist.first()).toBeVisible();

    // Verify tab children exist within the tablist
    const tabs = tablist.first().locator('[role="tab"]');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThan(0);

    // Each tab should have accessible text content
    for (let i = 0; i < tabCount; i++) {
      const tabText = await tabs.nth(i).textContent();
      expect(tabText?.trim().length).toBeGreaterThan(0);
    }
  });
});
