// E2E accessibility tests for evolution admin pages: table headers and ARIA roles.
// Uses Playwright accessibility snapshots to verify semantic structure.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

adminTest.describe('Evolution Accessibility', { tag: '@evolution' }, () => {
  const testPrefix = `e2e-a11y-${Date.now()}`;
  let strategyId: string;
  let promptId: string;
  let runId: string;

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

    // Wait for the table to render
    const table = adminPage.locator('table');
    await expect(table.first()).toBeVisible({ timeout: 15000 });

    // Get all <th> elements
    const headers = table.first().locator('thead th');
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

    const table = adminPage.locator('table');
    await expect(table.first()).toBeVisible({ timeout: 15000 });

    const headers = table.first().locator('thead th');
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

    const table = adminPage.locator('table');
    await expect(table.first()).toBeVisible({ timeout: 15000 });

    const headers = table.first().locator('thead th');
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
