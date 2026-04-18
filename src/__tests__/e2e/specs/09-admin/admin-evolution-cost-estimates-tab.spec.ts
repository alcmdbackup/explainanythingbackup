// E2E tests for the Cost Estimates tab on run + strategy detail pages
// (cost_estimate_accuracy_analysis_20260414).
//
// Seeds two runs against the same strategy:
//   - One with AgentMultiple sequential floor + cost-estimate metrics →
//     Budget Floor Sensitivity section visible.
//   - One with Fraction sequential floor → Sensitivity section hidden.
//
// Verifies tab loads + sections render + sensitivity visibility differs +
// strategy-level tab loads with summary + slice/runs sections.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

adminTest.describe('Evolution Cost Estimates tab', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  const testPrefix = `e2e-cost-est-${Date.now()}`;
  let strategyId: string;
  let promptId: string;
  let runIdAgentMultiple: string; // sensitivity visible
  let runIdFraction: string;       // sensitivity hidden

  adminTest.beforeAll(async () => {
    const sb = getServiceClient();

    const { data: prompt, error: pErr } = await sb
      .from('evolution_prompts')
      .insert({ prompt: `${testPrefix} prompt body`, name: `${testPrefix}-prompt`, status: 'active' })
      .select('id').single();
    if (pErr || !prompt) throw new Error(`Seed prompt: ${pErr?.message}`);
    promptId = prompt.id;

    const { data: strategy, error: sErr } = await sb
      .from('evolution_strategies')
      .insert({
        name: `${testPrefix}-strategy`,
        label: `${testPrefix}`,
        config: { generationModel: 'qwen-2.5-7b-instruct', judgeModel: 'qwen-2.5-7b-instruct' },
        config_hash: `hash-${testPrefix}`,
        status: 'active',
      })
      .select('id').single();
    if (sErr || !strategy) throw new Error(`Seed strategy: ${sErr?.message}`);
    strategyId = strategy.id;

    // Run 1: AgentMultiple sequential floor → Budget Floor Sensitivity should show
    const runSummaryAgentMultiple = {
      version: 3,
      stopReason: 'iterations_complete',
      finalPhase: 'COMPETITION',
      totalIterations: 3,
      durationSeconds: 120,
      eloHistory: [[1200], [1240], [1260]],
      diversityHistory: [0.5, 0.6, 0.7],
      matchStats: { totalMatches: 4, avgConfidence: 0.7, decisiveRate: 0.5 },
      topVariants: [],
      baselineRank: null,
      baselineElo: null,
      strategyEffectiveness: {},
      metaFeedback: null,
      budgetFloorConfig: {
        minBudgetAfterParallelAgentMultiple: 3,
        minBudgetAfterSequentialAgentMultiple: 1,
        numVariants: 9,
      },
    };
    const { data: r1, error: r1Err } = await sb
      .from('evolution_runs')
      .insert({
        strategy_id: strategyId, prompt_id: promptId, status: 'completed',
        budget_cap_usd: 1.0, run_summary: runSummaryAgentMultiple,
        completed_at: new Date().toISOString(),
      })
      .select('id').single();
    if (r1Err || !r1) throw new Error(`Seed AgentMultiple run: ${r1Err?.message}`);
    runIdAgentMultiple = r1.id;

    // Run 2: Fraction sequential floor → Budget Floor Sensitivity hidden
    const runSummaryFraction = {
      ...runSummaryAgentMultiple,
      budgetFloorConfig: {
        minBudgetAfterParallelFraction: 0.35,
        minBudgetAfterSequentialFraction: 0.12,
        numVariants: 9,
      },
    };
    const { data: r2, error: r2Err } = await sb
      .from('evolution_runs')
      .insert({
        strategy_id: strategyId, prompt_id: promptId, status: 'completed',
        budget_cap_usd: 1.0, run_summary: runSummaryFraction,
        completed_at: new Date().toISOString(),
      })
      .select('id').single();
    if (r2Err || !r2) throw new Error(`Seed Fraction run: ${r2Err?.message}`);
    runIdFraction = r2.id;

    // Seed minimal cost-estimation metrics on each run so the tab has data
    const baseMetrics = (entityId: string, agentCostActual: number | null) => [
      { entity_type: 'run', entity_id: entityId, metric_name: 'cost', value: 0.847 },
      { entity_type: 'run', entity_id: entityId, metric_name: 'estimated_cost', value: 0.754 },
      { entity_type: 'run', entity_id: entityId, metric_name: 'estimation_abs_error_usd', value: 0.093 },
      { entity_type: 'run', entity_id: entityId, metric_name: 'cost_estimation_error_pct', value: 12.4 },
      { entity_type: 'run', entity_id: entityId, metric_name: 'agent_cost_projected', value: 0.082 },
      ...(agentCostActual !== null
        ? [{ entity_type: 'run', entity_id: entityId, metric_name: 'agent_cost_actual', value: agentCostActual }]
        : []),
      { entity_type: 'run', entity_id: entityId, metric_name: 'parallel_dispatched', value: 7 },
      { entity_type: 'run', entity_id: entityId, metric_name: 'sequential_dispatched', value: 2 },
      { entity_type: 'run', entity_id: entityId, metric_name: 'median_sequential_gfsa_duration_ms', value: 51000 },
    ];
    // AgentMultiple run gets actual cost (sensitivity visible). Fraction run also gets one
    // but the Fraction-mode floor config means the tab still hides sensitivity.
    const allRunMetrics = [
      ...baseMetrics(runIdAgentMultiple, 0.094),
      ...baseMetrics(runIdFraction, 0.094),
    ];
    const { error: mErr } = await sb.from('evolution_metrics').insert(allRunMetrics);
    if (mErr) throw new Error(`Seed run metrics: ${mErr.message}`);

    // Seed a strategy-level propagated metric so strategy view has data
    const { error: smErr } = await sb.from('evolution_metrics').insert([
      { entity_type: 'strategy', entity_id: strategyId, metric_name: 'total_cost', value: 1.694 },
      { entity_type: 'strategy', entity_id: strategyId, metric_name: 'avg_cost_estimation_error_pct', value: 12.4, aggregation_method: 'avg', n: 2 },
    ]);
    if (smErr) throw new Error(`Seed strategy metrics: ${smErr.message}`);

    // Seed at least one GFSA invocation per run so the action's
    // hasGfsaInvocations check passes and the Budget Floor Sensitivity
    // section is rendered for the AgentMultiple run.
    const seedGfsaInvocation = (runIdLocal: string) => ({
      run_id: runIdLocal,
      agent_name: 'generate_from_previous_article',
      iteration: 1,
      execution_order: 1,
      success: true,
      cost_usd: 0.094,
      duration_ms: 51000,
      execution_detail: {
        strategy: 'grounding_enhance',
        generation: { estimatedCost: 0.060, cost: 0.072 },
        ranking:    { estimatedCost: 0.020, cost: 0.022 },
        estimatedTotalCost: 0.080,
        totalCost: 0.094,
        estimationErrorPct: 17.5,
      },
    });
    const { error: invErr } = await sb.from('evolution_agent_invocations').insert([
      seedGfsaInvocation(runIdAgentMultiple),
      seedGfsaInvocation(runIdFraction),
    ]);
    if (invErr) throw new Error(`Seed invocations: ${invErr.message}`);
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();
    await sb.from('evolution_agent_invocations').delete().in('run_id', [runIdAgentMultiple, runIdFraction]);
    await sb.from('evolution_metrics').delete().in('entity_id', [runIdAgentMultiple, runIdFraction, strategyId]);
    await sb.from('evolution_runs').delete().in('id', [runIdAgentMultiple, runIdFraction]);
    await sb.from('evolution_strategies').delete().eq('id', strategyId);
    await sb.from('evolution_prompts').delete().eq('id', promptId);
  });

  adminTest('AgentMultiple-mode run shows Budget Floor Sensitivity', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${runIdAgentMultiple}?tab=cost-estimates`);
    await adminPage.waitForLoadState('domcontentloaded');

    const tab = adminPage.locator('[data-testid="cost-estimates-tab"]');
    await expect(tab).toBeVisible({ timeout: 15000 });
    await expect(adminPage.locator('[data-testid="cost-estimates-summary"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="cost-estimates-by-agent"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="budget-floor-sensitivity"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="cost-estimates-histogram"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="cost-estimates-invocations"]')).toBeVisible();
  });

  adminTest('Fraction-mode run hides Budget Floor Sensitivity', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${runIdFraction}?tab=cost-estimates`);
    await adminPage.waitForLoadState('domcontentloaded');

    const tab = adminPage.locator('[data-testid="cost-estimates-tab"]');
    await expect(tab).toBeVisible({ timeout: 15000 });
    await expect(adminPage.locator('[data-testid="cost-estimates-summary"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="budget-floor-sensitivity"]')).toHaveCount(0);
  });

  adminTest('Strategy detail Cost Estimates tab loads with summary + slices + runs', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/strategies/${strategyId}?tab=cost-estimates`);
    await adminPage.waitForLoadState('domcontentloaded');

    const tab = adminPage.locator('[data-testid="cost-estimates-tab"]');
    await expect(tab).toBeVisible({ timeout: 15000 });
    await expect(adminPage.locator('[data-testid="cost-estimates-summary"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="cost-estimates-runs"]')).toBeVisible();
    // Strategy view never renders Budget Floor Sensitivity
    await expect(adminPage.locator('[data-testid="budget-floor-sensitivity"]')).toHaveCount(0);
  });
});
