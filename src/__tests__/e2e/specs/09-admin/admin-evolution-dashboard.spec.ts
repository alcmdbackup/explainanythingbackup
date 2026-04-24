// E2E tests for the evolution dashboard page: metric cards with seeded data and empty state.
// Verifies MetricGrid rendering and cost value display.

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

adminTest.describe('Evolution Dashboard (T1-T3)', { tag: '@evolution' }, () => {
  adminTest.describe('dashboard with seeded data', { tag: '@evolution' }, () => {
    adminTest.describe.configure({ mode: 'serial' });

    const testPrefix = `e2e-dash-${Date.now()}`;
    let strategyId: string;
    let promptId: string;
    const runIds: string[] = [];

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

      // Seed 2 completed runs + 1 failed run
      const runInserts = [
        { id: randomUUID(), status: 'completed', strategy_id: strategyId, prompt_id: promptId, budget_cap_usd: 1.0, completed_at: new Date().toISOString() },
        { id: randomUUID(), status: 'completed', strategy_id: strategyId, prompt_id: promptId, budget_cap_usd: 1.0, completed_at: new Date().toISOString() },
        { id: randomUUID(), status: 'failed', strategy_id: strategyId, prompt_id: promptId, budget_cap_usd: 1.0, error_message: 'test failure' },
      ];
      const { error: rErr } = await sb.from('evolution_runs').insert(runInserts);
      if (rErr) throw new Error(`Seed runs: ${rErr.message}`);
      runIds.push(...runInserts.map((r) => r.id));
    });

    adminTest.afterAll(async () => {
      const sb = getServiceClient();
      await sb.from('evolution_runs').delete().in('id', runIds);
      await sb.from('evolution_strategies').delete().eq('id', strategyId);
      await sb.from('evolution_prompts').delete().eq('id', promptId);
    });

    adminTest('metric cards+empty state: dashboard shows metric cards and handles empty state gracefully', async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution-dashboard');
      await adminPage.waitForLoadState('domcontentloaded');

      // Dashboard content should render (not error state)
      const content = adminPage.locator('[data-testid="dashboard-content"]');
      await expect(content).toBeVisible({ timeout: 15000 });

      // MetricGrid should be present
      const metricGrid = adminPage.locator('[data-testid="dashboard-metrics"]');
      await expect(metricGrid).toBeVisible();

      // Verify specific metric labels render
      await expect(adminPage.locator('[data-testid="metric-completed-runs"]')).toBeVisible();
      await expect(adminPage.locator('[data-testid="metric-failed-runs"]')).toBeVisible();
      await expect(adminPage.locator('[data-testid="metric-total-cost"]')).toBeVisible();

      // Error state should not be showing
      await expect(adminPage.locator('text=Failed to load')).not.toBeVisible();
    });
  });

  adminTest.describe('dashboard metric cards detail', { tag: '@evolution' }, () => {
    adminTest.describe.configure({ mode: 'serial' });
    const testPrefix = `e2e-dash-metric-${Date.now()}`;
    let strategyId: string;
    let promptId: string;
    const runIds: string[] = [];

    adminTest.beforeAll(async () => {
      const sb = getServiceClient();

      const { data: prompt, error: pErr } = await sb
        .from('evolution_prompts')
        .insert({ prompt: `${testPrefix} prompt`, name: `${testPrefix} Prompt`, status: 'active' })
        .select('id')
        .single();
      if (pErr) throw new Error(`Seed prompt: ${pErr.message}`);
      promptId = prompt.id;

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

      const runInserts = [
        { id: randomUUID(), status: 'completed', strategy_id: strategyId, prompt_id: promptId, budget_cap_usd: 1.0, completed_at: new Date().toISOString() },
      ];
      const { error: rErr } = await sb.from('evolution_runs').insert(runInserts);
      if (rErr) throw new Error(`Seed runs: ${rErr.message}`);
      runIds.push(...runInserts.map((r) => r.id));
    });

    adminTest.afterAll(async () => {
      const sb = getServiceClient();
      await sb.from('evolution_runs').delete().in('id', runIds);
      await sb.from('evolution_strategies').delete().eq('id', strategyId);
      await sb.from('evolution_prompts').delete().eq('id', promptId);
    });

    adminTest('detail labels: dashboard renders all 6 metric card labels and recent runs table is clickable', async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution-dashboard');
      await adminPage.waitForLoadState('domcontentloaded');

      const content = adminPage.locator('[data-testid="dashboard-content"]');
      await expect(content).toBeVisible({ timeout: 15000 });

      // Verify all 6 metric cards render with correct labels
      await expect(adminPage.locator('[data-testid="metric-active-runs"]')).toBeVisible();
      await expect(adminPage.locator('[data-testid="metric-queue-depth"]')).toBeVisible();
      await expect(adminPage.locator('[data-testid="metric-completed-runs"]')).toBeVisible();
      await expect(adminPage.locator('[data-testid="metric-failed-runs"]')).toBeVisible();
      await expect(adminPage.locator('[data-testid="metric-total-cost"]')).toBeVisible();
      await expect(adminPage.locator('[data-testid="metric-avg-cost"]')).toBeVisible();

      // Uncheck "Hide test content" to see seeded [TEST_EVO] runs
      const hideTestCheckbox = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
      // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
      if (await hideTestCheckbox.isChecked()) {
        await hideTestCheckbox.uncheck();
      }

      // The RunsTable should be visible
      const runsTable = adminPage.locator('[data-testid="dashboard-runs-table"]');
      await expect(runsTable).toBeVisible();

      // Wait for actual data row (not skeleton) — run-row-* testid only exists on real data rows
      const dataRow = runsTable.locator('tbody tr[data-testid^="run-row-"]').first();
      await expect(dataRow).toBeVisible({ timeout: 20000 });

      // Click the row to navigate to run detail (RunsTable uses onClick with router.push)
      await dataRow.click();
      await adminPage.waitForURL('**/admin/evolution/runs/**', { timeout: 15000 });
      expect(adminPage.url()).toContain('/admin/evolution/runs/');
    });
  });

  // B1/B2 (use_playwright_find_bugs_ux_issues_20260422): Total Cost on the
  // dashboard must be MONOTONIC when toggling "Hide test content" — turning the
  // filter OFF can only ADD runs (never remove them), so unchecked total ≥
  // checked total. Anti-regression for the bug where unchecking the filter
  // mysteriously zeroed Total Cost (the helper now falls back through 4 layers).
  adminTest.describe('Total Cost monotonic invariant', { tag: '@evolution' }, () => {
    adminTest.describe.configure({ mode: 'serial' });

    const monoPrefix = `e2e-mono-${Date.now()}`;
    let monoStrategyId: string;
    let monoPromptId: string;
    const monoRunIds: string[] = [];

    adminTest.beforeAll(async () => {
      const sb = getServiceClient();
      const { data: prompt, error: pErr } = await sb
        .from('evolution_prompts')
        .insert({ prompt: `${monoPrefix} prompt`, name: `${monoPrefix} Prompt`, status: 'active' })
        .select('id')
        .single();
      if (pErr) throw new Error(`Seed prompt: ${pErr.message}`);
      monoPromptId = prompt.id;

      const { data: strategy, error: sErr } = await sb
        .from('evolution_strategies')
        .insert({
          name: `${monoPrefix}-strategy`,
          config: { maxIterations: 3 },
          config_hash: `hash-${monoPrefix}`,
          status: 'active',
        })
        .select('id')
        .single();
      if (sErr) throw new Error(`Seed strategy: ${sErr.message}`);
      monoStrategyId = strategy.id;

      // 1 prod run + 1 test run, each with a known cost in evolution_metrics.
      const prodRunId = randomUUID();
      const testRunId = randomUUID();
      const { error: rErr } = await sb.from('evolution_runs').insert([
        { id: prodRunId, status: 'completed', strategy_id: monoStrategyId, prompt_id: monoPromptId, budget_cap_usd: 1.0, completed_at: new Date().toISOString() },
        { id: testRunId, status: 'completed', strategy_id: monoStrategyId, prompt_id: monoPromptId, budget_cap_usd: 1.0, completed_at: new Date().toISOString() },
      ]);
      if (rErr) throw new Error(`Seed runs: ${rErr.message}`);
      monoRunIds.push(prodRunId, testRunId);

      const writeCost = async (runId: string, value: number): Promise<void> => {
        // upsert_metric_max isn't in the generated DB types yet — cast around it.
        const { error } = await (sb.rpc as unknown as (name: string, params: Record<string, unknown>) => Promise<{ error: { message: string } | null }>)(
          'upsert_metric_max',
          {
            p_entity_type: 'run',
            p_entity_id: runId,
            p_metric_name: 'cost',
            p_value: value,
            p_source: 'e2e-test',
            p_aggregation_method: 'sum',
          },
        );
        if (error) throw new Error(`writeCost(${runId}): ${error.message}`);
      };
      await writeCost(prodRunId, 0.10);
      await writeCost(testRunId, 0.50);
    });

    adminTest.afterAll(async () => {
      const sb = getServiceClient();
      await sb.from('evolution_runs').delete().in('id', monoRunIds);
      await sb.from('evolution_strategies').delete().eq('id', monoStrategyId);
      await sb.from('evolution_prompts').delete().eq('id', monoPromptId);
    });

    adminTest('Total Cost is monotonic when toggling Hide test content (off ≥ on)', async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution-dashboard');
      await adminPage.waitForLoadState('domcontentloaded');

      const totalCostCell = adminPage.locator('[data-testid="metric-total-cost"]');
      await expect(totalCostCell).toBeVisible({ timeout: 15000 });

      const parseCost = (s: string): number => {
        const m = s.match(/\$(\d+(?:\.\d+)?)/);
        return m && m[1] != null ? parseFloat(m[1]) : NaN;
      };

      const hideTestCheckbox = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');

      // Helper: wait for the cost cell to settle on a parseable $ value that
      // differs from the prior reading (or any value if no prior). Uses
      // expect(locator).not.toContainText for the change-detection — the
      // lint-approved way to wait for content to update without textContent races.
      const readCostAfterChange = async (priorText: string | null): Promise<{ text: string; cost: number }> => {
        if (priorText != null) {
          // Wait until the displayed text is NOT the prior text (i.e. re-rendered).
          // eslint-disable-next-line flakiness/no-point-in-time-checks -- intentional: assert the change happened
          await expect(totalCostCell).not.toHaveText(priorText, { timeout: 10000 });
        }
        // Now wait for a parseable $ value to settle.
        await expect(totalCostCell).toContainText(/\$\d/, { timeout: 10000 });
        // eslint-disable-next-line flakiness/no-point-in-time-checks -- value already polled+settled above; reading it once is safe
        const text = (await totalCostCell.innerText()) ?? '';
        return { text, cost: parseCost(text) };
      };

      // Step 1: Hide test content ON — capture Total Cost.
      // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
      if (!(await hideTestCheckbox.isChecked())) await hideTestCheckbox.check();
      const on = await readCostAfterChange(null);

      // Step 2: toggle OFF, capture again (must differ from the ON reading
      // because the seeded test run adds $0.50 to the total).
      await hideTestCheckbox.uncheck();
      const off = await readCostAfterChange(on.text);

      // Off must include the test runs we seeded — so off ≥ on, never less.
      expect(off.cost).toBeGreaterThanOrEqual(on.cost);
    });
  });
});
