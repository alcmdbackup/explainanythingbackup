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

    // Uncheck "Hide test content" FIRST so the seeded invocation (its run has a
    // timestamp-named, test-flagged strategy) is visible. Without this the seeded
    // row is hidden and the link assertion below times out on prod.
    const testContentFilter = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if (await testContentFilter.isChecked()) {
      await testContentFilter.uncheck();
      // Wait for table to re-render after filter change
      await table.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 10000 });
    }

    // Click the success invocation link (wait for the seeded row to appear first)
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

    // rename_agents_subagents_evolution_20260508 Phase 2 made Subagents the default
    // tab; the Overview tab (which renders the MetricGrid) must be clicked explicitly.
    const overviewTab = adminPage.locator('[role="tab"]').filter({ hasText: /^Overview$/ }).first();
    await expect(overviewTab).toBeVisible({ timeout: 15000 });
    await overviewTab.click();

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
    const reflectionOverviewTab = adminPage.locator('[data-testid="tab-overview-reflection"]');
    await expect(reflectionOverviewTab).toBeVisible({ timeout: 15000 });

    // rename_agents_subagents_evolution_20260508 Phase 2 made Subagents the
    // default tab; click into Reflection Overview to render its pane.
    await reflectionOverviewTab.click();

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

  // ─── evaluate_criteria_then_generate Eval & Suggest tab ───────────────
  // fixes_to_evolution_admin_dashboard__20260503 Issue 4: Eval & Suggest tab
  // renders Suggestions table including Example/Issue/Fix columns; long
  // passages wrap (cellClassName); empty parser fields render as em-dash.

  let evalCriteriaInvocationId: string;

  adminTest.beforeAll(async () => {
    const sb = getServiceClient();
    evalCriteriaInvocationId = randomUUID();
    await sb.from('evolution_agent_invocations').insert({
      id: evalCriteriaInvocationId,
      run_id: runId,
      agent_name: 'evaluate_criteria_then_generate_from_previous_article',
      iteration: 2,
      execution_order: 0,
      success: true,
      cost_usd: 0.045,
      duration_ms: 18000,
      execution_detail: {
        detailType: 'evaluate_criteria_then_generate_from_previous_article',
        tactic: 'criteria_driven',
        surfaced: true,
        weakestCriteriaIds: ['c1-uuid', 'c2-uuid'],
        weakestCriteriaNames: ['clarity', 'depth'],
        evaluateAndSuggest: {
          cost: 0.012,
          durationMs: 4800,
          criteriaScored: [
            { criteriaName: 'clarity', score: 2, minRating: 1, maxRating: 5 },
            { criteriaName: 'depth', score: 3, minRating: 1, maxRating: 5 },
            { criteriaName: 'engagement', score: 4, minRating: 1, maxRating: 5 },
          ],
          suggestions: [
            {
              criteriaName: 'clarity',
              examplePassage: 'The widget thingamajig wibbles when poked, sometimes producing notable effects.',
              whatNeedsAddressing: 'The sentence uses vague terms (widget, thingamajig, wibbles) without grounding them.',
              suggestedFix: 'Replace abstract terms with concrete nouns and explain the mechanism.',
            },
            {
              // Issue 4 regression case: empty Example field — must still render with em-dash.
              criteriaName: 'depth',
              examplePassage: '',
              whatNeedsAddressing: 'The depth criterion was scored low but no example passage was extracted.',
              suggestedFix: 'Add detail about underlying mechanisms.',
            },
          ],
          droppedSuggestions: [],
        },
        generation: { cost: 0.022, promptLength: 7400, textLength: 6200, formatValid: true, durationMs: 9200 },
        ranking: { cost: 0.011, localPoolSize: 4, initialTop15Cutoff: 1200, comparisons: [], stopReason: 'converged', totalComparisons: 5, finalLocalElo: 1265, finalLocalUncertainty: 32, durationMs: 4000 },
        totalCost: 0.045,
      },
    });
    invocationIds.push(evalCriteriaInvocationId);
  });

  // Helper: navigate to the seeded invocation, confirm Eval & Suggest tab is
  // the default active tab, expand the InvocationExecutionDetail (collapsed by
  // default), and return a locator for the suggestions field.
  async function openSuggestionsField(adminPage: import('@playwright/test').Page) {
    await adminPage.goto(`/admin/evolution/invocations/${evalCriteriaInvocationId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    // rename_agents_subagents_evolution_20260508 Phase 2 made Subagents the
    // default tab; click into Eval & Suggest to render its pane (also catches
    // the regression that would silently fall back to a single Overview layout).
    const evalTab = adminPage.getByRole('tab', { name: 'Eval & Suggest' });
    await expect(evalTab).toBeVisible({ timeout: 15000 });
    await evalTab.click();

    // Execution detail is collapsed by default — click Expand to render fields.
    const toggle = adminPage.locator('[data-testid="toggle-detail"]');
    await expect(toggle).toBeVisible({ timeout: 10000 });
    await toggle.click();

    return adminPage.locator('[data-testid="field-evaluateAndSuggest.suggestions"]');
  }

  adminTest('Issue 4: Eval & Suggest tab renders suggestions table with all 4 columns', async ({ adminPage }) => {
    const suggestionsField = await openSuggestionsField(adminPage);
    await expect(suggestionsField).toBeVisible({ timeout: 10000 });

    // All four columns headers visible.
    await expect(suggestionsField).toContainText('Criterion');
    await expect(suggestionsField).toContainText('Example');
    await expect(suggestionsField).toContainText('Issue');
    await expect(suggestionsField).toContainText('Fix');

    // Suggestion 1 with full text visible.
    await expect(suggestionsField).toContainText('clarity');
    await expect(suggestionsField).toContainText('widget thingamajig');
    await expect(suggestionsField).toContainText('Replace abstract terms');
  });

  adminTest('Issue 4: empty examplePassage renders as em-dash (parser permissive-mode output)', async ({ adminPage }) => {
    const suggestionsField = await openSuggestionsField(adminPage);
    await expect(suggestionsField).toBeVisible({ timeout: 10000 });

    // The "depth" suggestion has examplePassage='' — should render as em-dash.
    // Auto-retrying assertion via Locator.filter handles hydration timing.
    const depthRow = suggestionsField.locator('tr').filter({ hasText: 'depth' }).first();
    await expect(depthRow).toContainText('—');
    await expect(depthRow).toContainText('depth criterion was scored low');
  });

  adminTest('Issue 4: suggestions table cells use cellClassName (max-w-md break-words)', async ({ adminPage }) => {
    const suggestionsField = await openSuggestionsField(adminPage);
    await expect(suggestionsField).toBeVisible({ timeout: 10000 });

    // Inspect the first body cell to confirm the wrapping classes are applied.
    const firstCell = suggestionsField.locator('tbody td').first();
    // Use toHaveClass with a regex so Playwright auto-retries through hydration.
    await expect(firstCell).toHaveClass(/max-w-md/);
    await expect(firstCell).toHaveClass(/break-words/);
  });

  // ─── paragraph_recombine invocation Cost Estimates tab ─────────────
  // investigate_paragraph_rewrite_cost_undershoot_evolution_20260529 — Phase 7 (K5/K6):
  // an invocation with the new G4/G5 execution_detail fields (estimatedTotalCost,
  // paragraph_rewrite/.paragraph_rank with estimatedCost+cost) should render in the
  // Cost Estimates surface mapping paragraph_rewrite → Gen column and
  // paragraph_rank → Rank column.

  let paragraphRecombineInvocationId: string;

  adminTest.beforeAll(async () => {
    const sb = getServiceClient();
    paragraphRecombineInvocationId = randomUUID();
    await sb.from('evolution_agent_invocations').insert({
      id: paragraphRecombineInvocationId,
      run_id: runId,
      agent_name: 'paragraph_recombine',
      iteration: 3,
      execution_order: 0,
      success: true,
      cost_usd: 0.0055,
      duration_ms: 22500,
      execution_detail: {
        detailType: 'paragraph_recombine',
        parentVariantId: randomUUID(),
        slots: [],
        recombined: {
          text: 'A short recombined article body for the E2E test.',
          formatValid: true,
        },
        totalCost: 0.0055,
        // G4/G5 (new) — projector outputs + per-phase split.
        estimatedTotalCost: 0.0093,
        estimatedTotalCostUpperBound: 0.0120,
        estimationErrorPct: -40.86,
        paragraph_rewrite: {
          estimatedCost: 0.0050,
          cost: 0.0036,
          estimationErrorPct: -28,
        },
        paragraph_rank: {
          estimatedCost: 0.0043,
          cost: 0.0013,
          estimationErrorPct: -69.77,
        },
      },
    });
    invocationIds.push(paragraphRecombineInvocationId);
  });

  adminTest('paragraph_recombine invocation: detail page renders without errors and surfaces totalCost', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${paragraphRecombineInvocationId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    // Page renders without falling into the error boundary.
    await expect(adminPage.locator('h1, h2').first()).toBeVisible({ timeout: 15000 });
    // Agent name surfaces in the page (the breadcrumb / header).
    await expect(adminPage.getByText('paragraph_recombine').first()).toBeVisible({ timeout: 15000 });
  });
});
