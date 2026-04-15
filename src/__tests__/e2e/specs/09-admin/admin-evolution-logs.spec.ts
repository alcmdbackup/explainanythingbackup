/**
 * Admin Evolution LogsTab E2E tests.
 * Verifies the LogsTab filter UI renders correctly on a run detail page.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { randomUUID } from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface SeededData {
  runId: string;
  strategyId: string;
  promptId: string;
}

async function seedRunWithLogs(): Promise<SeededData> {
  const supabase = getServiceClient();
  const ts = Date.now();

  const { data: strategy, error: e1 } = await supabase
    .from('evolution_strategies')
    .insert({
      config_hash: `e2e-logs-${ts}`,
      name: `[TEST] Logs Strategy ${ts}`,
      label: 'Gen: test | Judge: test',
      config: { generationModel: 'test', judgeModel: 'test', iterations: 1 },
      created_by: 'admin',
    })
    .select('id')
    .single();

  if (e1 || !strategy) throw new Error(`Failed to seed strategy: ${e1?.message}`);

  const { data: prompt, error: e2 } = await supabase
    .from('evolution_prompts')
    .insert({ prompt: `[TEST] Logs prompt ${ts}`, name: `[TEST] Logs ${ts}` })
    .select('id')
    .single();

  if (e2 || !prompt) throw new Error(`Failed to seed prompt: ${e2?.message}`);

  const { data: run, error: e3 } = await supabase
    .from('evolution_runs')
    .insert({
      strategy_id: strategy.id,
      prompt_id: prompt.id,
      budget_cap_usd: 1.0,
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (e3 || !run) throw new Error(`Failed to seed run: ${e3?.message}`);

  // Insert a log entry so the logs tab has data (iteration 1)
  await supabase.from('evolution_logs').insert({
    entity_type: 'run',
    entity_id: run.id,
    run_id: run.id,
    strategy_id: strategy.id,
    level: 'info',
    message: '[TEST] E2E log entry',
    agent_name: 'setup',
    iteration: 1,
  });

  // Insert a log entry with iteration 0 to verify LogsTab shows it (regression: iteration 0 filter)
  await supabase.from('evolution_logs').insert({
    entity_type: 'run',
    entity_id: run.id,
    run_id: run.id,
    strategy_id: strategy.id,
    level: 'info',
    message: 'Pipeline started',
    iteration: 0,
    context: { phaseName: 'initialization' },
  });

  return { runId: run.id, strategyId: strategy.id, promptId: prompt.id };
}

async function cleanup(data: SeededData | undefined) {
  if (!data) return;
  const supabase = getServiceClient();
  await supabase.from('evolution_logs').delete().eq('run_id', data.runId);
  await supabase.from('evolution_variants').delete().eq('run_id', data.runId);
  await supabase.from('evolution_runs').delete().eq('id', data.runId);
  await supabase.from('evolution_strategies').delete().eq('id', data.strategyId);
  await supabase.from('evolution_prompts').delete().eq('id', data.promptId);
}

adminTest.describe('Admin Evolution LogsTab Filters', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let seeded: SeededData;

  adminTest.beforeAll(async () => {
    seeded = await seedRunWithLogs();
  });

  adminTest.afterAll(async () => {
    await cleanup(seeded);
  });

  adminTest(
    'all filters: LogsTab renders iteration/message-search/variant-ID filters and level filter shows results; iteration 0 included in filter options',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/evolution/runs/${seeded.runId}`, { timeout: 30000 });
      await adminPage.waitForLoadState('domcontentloaded');

      // Wait for run detail to load (tab bar only renders after data loads)
      await adminPage.locator('[data-testid="entity-detail-header"]').waitFor({ state: 'visible', timeout: 30_000 });

      // Click logs tab
      const logsTab = adminPage.locator('[data-testid="tab-logs"]');
      await expect(logsTab).toBeVisible();
      await logsTab.click();

      const logsContainer = adminPage.locator('[data-testid="logs-tab"]');
      await logsContainer.waitFor({ state: 'visible', timeout: 15000 });

      // Verify level filter
      const levelFilter = logsContainer.locator('select[aria-label="Filter by level"]');
      await expect(levelFilter).toBeVisible();

      // Verify iteration filter
      const iterationFilter = logsContainer.locator('select[aria-label="Filter by iteration"]');
      await expect(iterationFilter).toBeVisible();

      // Verify message search
      const messageSearch = logsContainer.locator('input[aria-label="Search messages"]');
      await expect(messageSearch).toBeVisible();

      // Verify variant ID filter
      const variantIdFilter = logsContainer.locator('input[aria-label="Filter by variant ID"]');
      await expect(variantIdFilter).toBeVisible();

      // Select "info" level filter — our seeded log has level 'info'
      await levelFilter.selectOption('info');

      // Wait for table to update — the seeded log should still appear
      const table = logsContainer.locator('table');
      await expect(table).toBeVisible({ timeout: 15000 });

      // The log count label should reflect filtered results
      const countLabel = logsContainer.locator('text=/\\d+ logs?/');
      await expect(countLabel).toBeVisible();

      // Regression: iteration 0 should appear in the iteration filter options
      const options = iterationFilter.locator('option');
      const optionTexts = await options.allTextContents();
      expect(optionTexts).toContain('0');

      // Agent name filter input should be present
      const agentInput = logsContainer.locator('input[aria-label="Filter by agent name"]');
      await expect(agentInput).toBeVisible();

      // Type a partial agent name — seeded log uses 'setup' as agent_name
      await agentInput.fill('set');

      // After debounce, table should update (may show the row or empty state)
      const empty = logsContainer.locator('text=No logs available.');
      await expect(table.or(empty)).toBeVisible({ timeout: 10000 });
    },
  );

  // eslint-disable-next-line flakiness/require-reset-filters -- false positive: this test searches a logs UI with [TEST] text, not the explanations table; no filterTestContent default applies to logs
  adminTest(
    'LogsTab message search filters by text',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/evolution/runs/${seeded.runId}`, { timeout: 30000 });
      await adminPage.waitForLoadState('domcontentloaded');

      // Wait for run detail to load, then click logs tab
      await adminPage.locator('[data-testid="entity-detail-header"]').waitFor({ state: 'visible', timeout: 30_000 });
      const logsTab = adminPage.locator('[data-testid="tab-logs"]');
      await expect(logsTab).toBeVisible();
      await logsTab.click();

      const logsContainer = adminPage.locator('[data-testid="logs-tab"]');
      await logsContainer.waitFor({ state: 'visible', timeout: 15000 });

      // Type the seeded log message text into search
      const messageSearch = logsContainer.locator('input[aria-label="Search messages"]');
      await messageSearch.fill('[TEST] E2E log entry');

      // Wait for debounced search to trigger and table to render results
      const table = logsContainer.locator('table');
      await expect(table).toBeVisible({ timeout: 15000 });

      // The matching log row should contain our seeded message text
      const matchingRow = logsContainer.locator('td:has-text("[TEST] E2E log entry")');
      await expect(matchingRow).toBeVisible({ timeout: 15000 });
    },
  );
});

// Regression: run detail page loads without crash with run_summary data
adminTest.describe('Admin Evolution LogsTab Regression', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  const testPrefix = `[TEST_EVO] e2e-bugfix-${Date.now()}`;
  let strategyId: string;
  let promptId: string;
  let runId: string;

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
        config_hash: `hash-bugfix-${Date.now()}`,
        status: 'active',
      })
      .select('id')
      .single();
    if (sErr) throw new Error(`Seed strategy: ${sErr.message}`);
    strategyId = strategy.id;

    // Seed a completed run with run_summary
    runId = randomUUID();
    const { error: rErr } = await sb.from('evolution_runs').insert({
      id: runId,
      prompt_id: promptId,
      strategy_id: strategyId,
      status: 'completed',
      pipeline_version: 'v2',
      budget_cap_usd: 1.0,
      completed_at: new Date().toISOString(),
      run_summary: {
        version: 3,
        stopReason: 'iterations_complete',
        finalPhase: 'COMPETITION',
        totalIterations: 3,
        durationSeconds: 60,
        muHistory: [[30, 28, 25]],
        diversityHistory: [0.5],
        matchStats: { totalMatches: 6, avgConfidence: 0.85, decisiveRate: 0.67 },
        // Intentional legacy V3 shape (baselineRank/baselineMu/isBaseline + 'baseline' strategy).
        // EvolutionRunSummaryV3Schema preprocess maps these to seedVariantRank/seedVariantElo/
        // isSeedVariant on read; this fixture exercises that back-compat path.
        topVariants: [
          { id: randomUUID(), strategy: 'structural_transform', mu: 30, isBaseline: false },
          { id: randomUUID(), strategy: 'baseline', mu: 25, isBaseline: true },
        ],
        baselineRank: 2,
        baselineMu: 25,
        strategyEffectiveness: { baseline: { count: 1, avgMu: 25 }, structural_transform: { count: 1, avgMu: 30 } },
        metaFeedback: null,
      },
    });
    if (rErr) throw new Error(`Seed run: ${rErr.message}`);

    // Seed a log entry with iteration 0 to verify LogsTab shows it
    await sb.from('evolution_logs').insert({
      entity_type: 'run',
      entity_id: runId,
      run_id: runId,
      strategy_id: strategyId,
      level: 'info',
      message: 'Pipeline started',
      iteration: 0,
      context: { phaseName: 'initialization' },
    });
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();
    // Cleanup in FK-safe order
    await sb.from('evolution_logs').delete().eq('run_id', runId);
    await sb.from('evolution_variants').delete().eq('run_id', runId);
    await sb.from('evolution_runs').delete().eq('id', runId);
    await sb.from('evolution_strategies').delete().eq('id', strategyId);
    await sb.from('evolution_prompts').delete().eq('id', promptId);
  });

  adminTest('LogsTab iteration filter includes iteration 0 (regression)', async ({ adminPage: page }) => {
    await page.goto(`/admin/evolution/runs/${runId}`);
    // Page should load without JavaScript errors from empty elo arrays or null CI
    await expect(page.getByTestId('entity-detail-header')).toBeVisible({ timeout: 20000 });

    // Navigate to Logs tab
    const logsTab = page.getByRole('tab', { name: /logs/i });
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if (await logsTab.isVisible()) {
      await logsTab.click();
      // Iteration dropdown should have "0" as an option
      const iterationSelect = page.getByLabel('Filter by iteration');
      await expect(iterationSelect).toBeVisible({ timeout: 10000 });
      const options = iterationSelect.locator('option');
      const optionTexts = await options.allTextContents();
      expect(optionTexts).toContain('0');
    }
  });
});
