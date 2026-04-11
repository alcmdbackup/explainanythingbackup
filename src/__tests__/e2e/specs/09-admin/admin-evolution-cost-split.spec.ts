// E2E test for the per-purpose cost split UI surfacing.
//
// Verifies the new "Generation Cost" / "Ranking Cost" columns and metric tab rows
// surface correctly on the run, strategy, and experiment list/detail pages after
// the per-LLM-call cost attribution fix. Seeds a strategy + experiment + run with
// known per-purpose cost metric rows in evolution_metrics, then visits each surface
// and asserts the column headers and formatted dollar values are visible.
//
// LOCAL SETUP: Run `supabase db reset` (or `supabase migration up --local`) before
//              `npx playwright test` to ensure the upsert_metric_max RPC migration
//              is applied so the metrics rows we seed match production schema.

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

adminTest.describe('Evolution per-purpose cost split (T-cost-split)', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  const testPrefix = `e2e-cost-split-${Date.now()}`;
  const strategyId = randomUUID();
  const experimentId = randomUUID();
  const runId = randomUUID();
  let promptId: string;

  // Known per-purpose cost values we seed and assert against.
  // Values are chosen so each renders to a distinct 2-decimal string via formatCost
  // (which is the catalog formatter for the cost / generation_cost / ranking_cost metrics).
  const RUN_COST = 0.79; // → $0.79
  const RUN_GEN_COST = 0.43; // → $0.43
  const RUN_RANK_COST = 0.36; // → $0.36

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
    const { error: sErr } = await sb
      .from('evolution_strategies')
      .insert({
        id: strategyId,
        name: `${testPrefix}-strategy`,
        config: { maxIterations: 1 },
        config_hash: `hash-${testPrefix}`,
        status: 'active',
      });
    if (sErr) throw new Error(`Seed strategy: ${sErr.message}`);

    // Seed experiment
    const { error: eErr } = await sb
      .from('evolution_experiments')
      .insert({
        id: experimentId,
        name: `${testPrefix} experiment`,
        prompt_id: promptId,
        status: 'completed',
      });
    if (eErr) throw new Error(`Seed experiment: ${eErr.message}`);

    // Seed run
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

    // Seed metric rows directly. In production createLLMClient writes these via
    // writeMetricMax during execution; for E2E we insert them so the UI has data
    // to render without needing a real LLM round-trip.
    const metricRows = [
      // Run-level (during_execution)
      { entity_type: 'run', entity_id: runId, metric_name: 'cost', value: RUN_COST, source: 'during_execution', stale: false },
      { entity_type: 'run', entity_id: runId, metric_name: 'generation_cost', value: RUN_GEN_COST, source: 'during_execution', stale: false },
      { entity_type: 'run', entity_id: runId, metric_name: 'ranking_cost', value: RUN_RANK_COST, source: 'during_execution', stale: false },
      // Strategy-level (at_propagation, sourced from the single child run)
      { entity_type: 'strategy', entity_id: strategyId, metric_name: 'total_cost', value: RUN_COST, source: 'at_propagation', stale: false },
      { entity_type: 'strategy', entity_id: strategyId, metric_name: 'total_generation_cost', value: RUN_GEN_COST, source: 'at_propagation', stale: false },
      { entity_type: 'strategy', entity_id: strategyId, metric_name: 'total_ranking_cost', value: RUN_RANK_COST, source: 'at_propagation', stale: false },
      { entity_type: 'strategy', entity_id: strategyId, metric_name: 'run_count', value: 1, source: 'at_propagation', stale: false },
      // Experiment-level (mirrors strategy)
      { entity_type: 'experiment', entity_id: experimentId, metric_name: 'total_cost', value: RUN_COST, source: 'at_propagation', stale: false },
      { entity_type: 'experiment', entity_id: experimentId, metric_name: 'total_generation_cost', value: RUN_GEN_COST, source: 'at_propagation', stale: false },
      { entity_type: 'experiment', entity_id: experimentId, metric_name: 'total_ranking_cost', value: RUN_RANK_COST, source: 'at_propagation', stale: false },
      { entity_type: 'experiment', entity_id: experimentId, metric_name: 'run_count', value: 1, source: 'at_propagation', stale: false },
    ];
    const { error: mErr } = await sb.from('evolution_metrics').upsert(metricRows, {
      onConflict: 'entity_type,entity_id,metric_name',
    });
    if (mErr) throw new Error(`Seed metrics: ${mErr.message}`);
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();
    await sb.from('evolution_metrics').delete().in('entity_id', [runId, strategyId, experimentId]);
    await sb.from('evolution_runs').delete().eq('id', runId);
    await sb.from('evolution_experiments').delete().eq('id', experimentId);
    await sb.from('evolution_strategies').delete().eq('id', strategyId);
    await sb.from('evolution_prompts').delete().eq('id', promptId);
  });

  adminTest('run list shows Generation Cost and Ranking Cost columns', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/runs', { timeout: 30000 });
    await adminPage.waitForLoadState('domcontentloaded');

    const table = adminPage.locator('[data-testid="runs-list-table"]');
    await expect(table).toBeVisible({ timeout: 30000 });

    // Uncheck "Hide test content" so seeded test data is visible
    const hideTestCheckbox = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if (await hideTestCheckbox.isChecked()) {
      await hideTestCheckbox.click();
      await table.waitFor({ state: 'visible' });
    }

    // Column headers exist
    await expect(table.locator('th', { hasText: 'Generation Cost' }).first()).toBeVisible();
    await expect(table.locator('th', { hasText: 'Ranking Cost' }).first()).toBeVisible();

    // Our seeded run row exists with formatted dollar values
    const runRow = adminPage.locator(`[data-testid="run-row-${runId}"]`);
    await expect(runRow).toBeVisible({ timeout: 15000 });
    // formatCost() shows $X.XX (2 decimals)
    await expect(runRow).toContainText('$0.43'); // generation cost
    await expect(runRow).toContainText('$0.36'); // ranking cost
  });

  adminTest('strategy list shows Total Generation Cost and Total Ranking Cost columns', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies', { timeout: 30000 });
    await adminPage.waitForLoadState('domcontentloaded');

    // Strategies page uses EntityListPage with createMetricColumns. Wait for the
    // table to render before searching for column headers.
    const heading = adminPage.locator('h1', { hasText: 'Strategies' }).first();
    await expect(heading).toBeVisible({ timeout: 30000 });

    // Uncheck "Hide test content" if present
    const hideTestCheckbox = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if (await hideTestCheckbox.count() > 0 && await hideTestCheckbox.isChecked()) {
      await hideTestCheckbox.click();
    }

    // Column headers from the propagated metric defs
    await expect(adminPage.locator('th', { hasText: 'Total Generation Cost' }).first()).toBeVisible({ timeout: 15000 });
    await expect(adminPage.locator('th', { hasText: 'Total Ranking Cost' }).first()).toBeVisible();
  });

  adminTest('experiment list shows Total Generation Cost and Total Ranking Cost columns', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/experiments', { timeout: 30000 });
    await adminPage.waitForLoadState('domcontentloaded');

    const heading = adminPage.locator('h1', { hasText: 'Experiments' }).first();
    await expect(heading).toBeVisible({ timeout: 30000 });

    // Uncheck "Hide test content" so seeded experiment is visible
    const hideTestCheckbox = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if (await hideTestCheckbox.count() > 0 && await hideTestCheckbox.isChecked()) {
      await hideTestCheckbox.click();
    }

    // After the experiments page refactor (Phase 6c), the page uses createMetricColumns
    // and renders the propagated metric columns automatically.
    await expect(adminPage.locator('th', { hasText: 'Total Generation Cost' }).first()).toBeVisible({ timeout: 15000 });
    await expect(adminPage.locator('th', { hasText: 'Total Ranking Cost' }).first()).toBeVisible();
  });

  adminTest('run detail metrics tab shows Generation Cost and Ranking Cost rows', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${runId}`, { timeout: 30000 });
    await adminPage.waitForLoadState('domcontentloaded');

    // Click the Metrics tab
    const metricsTab = adminPage.locator('[data-testid="tab-metrics"]');
    await expect(metricsTab).toBeVisible({ timeout: 30000 });
    await metricsTab.click();

    // EntityMetricsTab groups by category — both per-purpose cost metrics should
    // appear under the Cost group with formatted dollar values
    const tabContent = adminPage.locator('[data-testid="entity-metrics-tab"]');
    await expect(tabContent).toBeVisible({ timeout: 15000 });
    await expect(tabContent).toContainText('Generation Cost');
    await expect(tabContent).toContainText('Ranking Cost');
    await expect(tabContent).toContainText('$0.43');
    await expect(tabContent).toContainText('$0.36');
  });
});
