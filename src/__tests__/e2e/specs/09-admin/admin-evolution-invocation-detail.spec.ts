// E2E tests for the evolution invocations list and invocation detail pages.
// Covers table rendering, row navigation, detail fields (agent, cost, duration), and breadcrumbs.

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

adminTest.describe('Evolution Invocation Detail', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

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

    // Seed finalization metrics for the success invocation
    const metricRows = [
      { entity_type: 'invocation', entity_id: successInvocationId, metric_name: 'best_variant_elo', value: 1420, sigma: 38, ci_lower: 1382, ci_upper: 1458 },
      { entity_type: 'invocation', entity_id: successInvocationId, metric_name: 'avg_variant_elo', value: 1280, sigma: 45, ci_lower: 1235, ci_upper: 1325 },
      { entity_type: 'invocation', entity_id: successInvocationId, metric_name: 'variant_count', value: 4 },
    ];
    const { error: mErr } = await sb.from('evolution_metrics').insert(metricRows);
    if (mErr) throw new Error(`Seed invocation metrics: ${mErr.message}`);
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();
    await sb.from('evolution_metrics').delete().in('entity_id', invocationIds);
    await sb.from('evolution_agent_invocations').delete().in('id', invocationIds);
    await sb.from('evolution_runs').delete().eq('id', runId);
    await sb.from('evolution_strategies').delete().eq('id', strategyId);
    await sb.from('evolution_prompts').delete().eq('id', promptId);
  });

  adminTest('page+columns: invocations page renders table with correct column headers', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/invocations');
    await adminPage.waitForLoadState('domcontentloaded');

    const table = adminPage.locator('[data-testid="entity-list-table"]');
    await expect(table).toBeVisible({ timeout: 15000 });

    // Verify column headers
    await expect(table.locator('th:has-text("Agent")')).toBeVisible();
    await expect(table.locator('th:has-text("Cost")')).toBeVisible();
    await expect(table.locator('th:has-text("Duration")')).toBeVisible();
    await expect(table.locator('th:has-text("Status")')).toBeVisible();
  });

  adminTest('row nav: clicking invocation row navigates to detail page', async ({ adminPage }) => {
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

  adminTest('detail fields: invocation detail shows agent, cost, duration, breadcrumb, and metrics', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${successInvocationId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    // Wait for detail header to render
    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 15000 });

    // The MetricGrid should show the agent name
    const metricGrid = adminPage.locator('[data-testid="metric-grid"]');
    await expect(metricGrid).toBeVisible({ timeout: 10000 });
    await expect(metricGrid.locator(`text=${testPrefix}-generation`)).toBeVisible();

    // The cost metric label should be present
    const costMetric = adminPage.locator('[data-testid="metric-cost"]');
    await expect(costMetric).toBeVisible();

    // The duration metric label should be present
    const durationMetric = adminPage.locator('[data-testid="metric-duration"]');
    await expect(durationMetric).toBeVisible();

    // Breadcrumb should contain "Invocations" link
    const breadcrumb = adminPage.locator('[data-testid="evolution-breadcrumb"]');
    await expect(breadcrumb).toBeVisible({ timeout: 15000 });
    const invocationsLink = breadcrumb.locator('a:has-text("Invocations")');
    await expect(invocationsLink).toBeVisible();

    // Switch to the Metrics tab
    const metricsTab = adminPage.locator('[data-testid="tab-metrics"]');
    await metricsTab.click();

    const metricsContainer = adminPage.locator('[data-testid="entity-metrics-tab"]');
    await expect(metricsContainer).toBeVisible({ timeout: 10000 });

    // best_variant_elo (label: "Best Variant Elo")
    const bestElo = adminPage.locator('[data-testid="metric-best-variant-elo"]');
    await expect(bestElo).toBeVisible();
    await expect(bestElo).not.toContainText('—');
    // Should show CI range
    await expect(bestElo).toContainText('[');

    // avg_variant_elo (label: "Avg Variant Elo")
    const avgElo = adminPage.locator('[data-testid="metric-avg-variant-elo"]');
    await expect(avgElo).toBeVisible();
    await expect(avgElo).not.toContainText('—');
    await expect(avgElo).toContainText('[');

    // variant_count (label overridden to "Variants Produced" in InvocationEntity)
    const variantCount = adminPage.locator('[data-testid="metric-variants-produced"]');
    await expect(variantCount).toBeVisible();
    await expect(variantCount).toContainText('4');

    // Click the "Invocations" breadcrumb link to navigate back
    await invocationsLink.click();
    await adminPage.waitForURL('**/admin/evolution/invocations', { timeout: 10000 });
    expect(adminPage.url()).toContain('/admin/evolution/invocations');
  });
});
