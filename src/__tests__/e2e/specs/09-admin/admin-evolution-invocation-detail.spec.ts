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

  // ─── Reflection wrapper invocation (develop_reflection_and_generateFromParentArticle_agent_evolution_20260430) ───
  // Phase 9: wrapper agent's invocation detail page renders 5 tabs (Reflection Overview,
  // Generation Overview, Metrics, Timeline, Logs) instead of the legacy single Overview.
  // Phase 10: timeline-reflection-bar renders alongside generation/ranking bars.

  let reflectInvocationId: string;

  adminTest.beforeAll(async () => {
    const sb = getServiceClient();
    reflectInvocationId = randomUUID();
    await sb.from('evolution_agent_invocations').insert({
      id: reflectInvocationId,
      run_id: runId,
      agent_name: 'reflect_and_generate_from_previous_article',
      iteration: 1,
      execution_order: 2,
      success: true,
      cost_usd: 0.0312,
      duration_ms: 14200,
      execution_detail: {
        detailType: 'reflect_and_generate_from_previous_article',
        tactic: 'lexical_simplify',
        surfaced: true,
        reflection: {
          candidatesPresented: ['structural_transform', 'lexical_simplify', 'grounding_enhance'],
          tacticRanking: [
            { tactic: 'lexical_simplify', reasoning: 'Article uses dense vocabulary.' },
            { tactic: 'structural_transform', reasoning: 'Sections out of order.' },
            { tactic: 'grounding_enhance', reasoning: 'Could use concrete examples.' },
          ],
          tacticChosen: 'lexical_simplify',
          durationMs: 1800,
          cost: 0.0008,
        },
        generation: {
          cost: 0.0214,
          promptLength: 6232,
          textLength: 5891,
          formatValid: true,
          durationMs: 8400,
        },
        ranking: {
          cost: 0.0090,
          localPoolSize: 5,
          initialTop15Cutoff: 1200,
          comparisons: [],
          stopReason: 'converged',
          totalComparisons: 7,
          finalLocalElo: 1247,
          finalLocalUncertainty: 38,
          durationMs: 4000,
        },
        totalCost: 0.0312,
      },
    });
    invocationIds.push(reflectInvocationId);
  });

  adminTest('wrapper invocation: 5 tabs render (Reflection Overview, Generation Overview, Metrics, Timeline, Logs)', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${reflectInvocationId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    // All 5 tabs visible.
    await expect(adminPage.locator('[data-testid="tab-overview-reflection"]')).toBeVisible({ timeout: 15000 });
    await expect(adminPage.locator('[data-testid="tab-overview-gfpa"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="tab-metrics"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="tab-timeline"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="tab-logs"]')).toBeVisible();

    // No single "Overview" tab (the wrapper splits it into two).
    await expect(adminPage.locator('[data-testid="tab-overview"]')).not.toBeVisible();
  });

  adminTest('wrapper invocation: Reflection Overview tab renders tactic chosen + ranking', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${reflectInvocationId}`);
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.locator('[data-testid="tab-overview-reflection"]')).toBeVisible({ timeout: 15000 });

    // Reflection Overview tab is active by default (first in the wrapper's tab list).
    const reflectionTab = adminPage.locator('[data-testid="reflection-overview-tab"]');
    await expect(reflectionTab).toBeVisible();

    // The chosen tactic shows in the metric grid.
    await expect(reflectionTab).toContainText('lexical_simplify');
  });

  adminTest('wrapper invocation: Generation Overview tab renders generation/ranking detail', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${reflectInvocationId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    // Click Generation Overview tab.
    const gfpaTab = adminPage.locator('[data-testid="tab-overview-gfpa"]');
    await expect(gfpaTab).toBeVisible({ timeout: 15000 });
    await gfpaTab.click();

    // The Generation Overview content is visible.
    const gfpaPanel = adminPage.locator('[data-testid="generation-overview-tab"]');
    await expect(gfpaPanel).toBeVisible();
  });

  adminTest('wrapper invocation: Timeline tab renders 3-phase bar (reflection + generation + ranking)', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${reflectInvocationId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const timelineTab = adminPage.locator('[data-testid="tab-timeline"]');
    await expect(timelineTab).toBeVisible({ timeout: 15000 });
    await timelineTab.click();

    // All 3 phase bars present (per Phase 10 — reflection bar is the new addition).
    await expect(adminPage.locator('[data-testid="timeline-reflection-bar"]')).toBeVisible({ timeout: 10000 });
    await expect(adminPage.locator('[data-testid="timeline-generation-bar"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="timeline-ranking-bar"]')).toBeVisible();
  });
});
