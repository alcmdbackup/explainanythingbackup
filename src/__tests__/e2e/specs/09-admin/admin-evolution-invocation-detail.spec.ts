// E2E tests for the evolution invocations list and invocation detail pages.
// Covers table rendering, row navigation, detail fields (agent, cost, duration), and breadcrumbs.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

adminTest.describe('Evolution Invocation Detail', { tag: '@evolution' }, () => {
  const testPrefix = `e2e-invocations-${Date.now()}`;
  let strategyId: string;
  let promptId: string;
  let runId: string;
  const invocationIds: string[] = [];
  let successInvocationId: string;
  let failedInvocationId: string;

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

    // Seed run
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

    // Seed invocations
    successInvocationId = randomUUID();
    failedInvocationId = randomUUID();
    const invocationInserts = [
      {
        id: successInvocationId,
        run_id: runId,
        agent_name: `${testPrefix}-generation`,
        iteration: 1,
        execution_order: 0,
        success: true,
        cost_usd: 0.0042,
        duration_ms: 2500,
        execution_detail: { model: 'gpt-4.1-mini', tokens: 150 },
      },
      {
        id: failedInvocationId,
        run_id: runId,
        agent_name: `${testPrefix}-ranking`,
        iteration: 1,
        execution_order: 1,
        success: false,
        cost_usd: 0.0018,
        duration_ms: 1200,
        error_message: 'Test error for E2E',
        execution_detail: { model: 'gpt-4.1-nano', tokens: 80 },
      },
    ];
    const { error: iErr } = await sb.from('evolution_agent_invocations').insert(invocationInserts);
    if (iErr) throw new Error(`Seed invocations: ${iErr.message}`);
    invocationIds.push(successInvocationId, failedInvocationId);
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();
    await sb.from('evolution_agent_invocations').delete().in('id', invocationIds);
    await sb.from('evolution_runs').delete().eq('id', runId);
    await sb.from('evolution_strategies').delete().eq('id', strategyId);
    await sb.from('evolution_prompts').delete().eq('id', promptId);
  });

  adminTest('invocations page renders table', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/invocations');
    await adminPage.waitForLoadState('domcontentloaded');

    const table = adminPage.locator('[data-testid="entity-list-table"]');
    await expect(table).toBeVisible({ timeout: 15000 });
  });

  adminTest('invocation table shows seeded data', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/invocations');
    await adminPage.waitForLoadState('domcontentloaded');

    const table = adminPage.locator('[data-testid="entity-list-table"]');
    await expect(table).toBeVisible({ timeout: 15000 });

    // Verify column headers
    await expect(table.locator('th:has-text("Agent")')).toBeVisible();
    await expect(table.locator('th:has-text("Cost")')).toBeVisible();
    await expect(table.locator('th:has-text("Duration")')).toBeVisible();
    await expect(table.locator('th:has-text("Success")')).toBeVisible();
  });

  adminTest('clicking invocation row navigates to detail', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/invocations');
    await adminPage.waitForLoadState('domcontentloaded');

    const table = adminPage.locator('[data-testid="entity-list-table"]');
    await expect(table).toBeVisible({ timeout: 15000 });

    // Click the success invocation link
    const invLink = table.locator(`a[href*="/admin/evolution/invocations/${successInvocationId}"]`).first();
    await expect(invLink).toBeVisible({ timeout: 10000 });
    await invLink.click();

    await adminPage.waitForURL(`**/admin/evolution/invocations/${successInvocationId}`, { timeout: 10000 });
    expect(adminPage.url()).toContain(`/admin/evolution/invocations/${successInvocationId}`);
  });

  adminTest('invocation detail shows agent name', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${successInvocationId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    // Wait for detail header to render
    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 15000 });

    // The MetricGrid should show the agent name
    const metricGrid = adminPage.locator('[data-testid="metric-grid"]');
    await expect(metricGrid).toBeVisible({ timeout: 10000 });
    await expect(metricGrid.locator(`text=${testPrefix}-generation`)).toBeVisible();
  });

  adminTest('invocation detail shows cost', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${successInvocationId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const metricGrid = adminPage.locator('[data-testid="metric-grid"]');
    await expect(metricGrid).toBeVisible({ timeout: 15000 });

    // The cost metric label should be present
    const costMetric = adminPage.locator('[data-testid="metric-cost"]');
    await expect(costMetric).toBeVisible();
  });

  adminTest('invocation detail shows duration', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${successInvocationId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const metricGrid = adminPage.locator('[data-testid="metric-grid"]');
    await expect(metricGrid).toBeVisible({ timeout: 15000 });

    // The duration metric label should be present
    const durationMetric = adminPage.locator('[data-testid="metric-duration"]');
    await expect(durationMetric).toBeVisible();
  });

  adminTest('invocation detail breadcrumb shows Invocations link', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${successInvocationId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const breadcrumb = adminPage.locator('[data-testid="evolution-breadcrumb"]');
    await expect(breadcrumb).toBeVisible({ timeout: 15000 });

    // Breadcrumb should contain "Invocations" link
    const invocationsLink = breadcrumb.locator('a:has-text("Invocations")');
    await expect(invocationsLink).toBeVisible();
  });

  adminTest('back navigation from detail to list via breadcrumb', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${successInvocationId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const breadcrumb = adminPage.locator('[data-testid="evolution-breadcrumb"]');
    await expect(breadcrumb).toBeVisible({ timeout: 15000 });

    // Click the "Invocations" breadcrumb link
    const invocationsLink = breadcrumb.locator('a:has-text("Invocations")');
    await expect(invocationsLink).toBeVisible();
    await invocationsLink.click();

    // Verify navigation back to invocations list
    await adminPage.waitForURL('**/admin/evolution/invocations', { timeout: 10000 });
    expect(adminPage.url()).toContain('/admin/evolution/invocations');
  });
});
