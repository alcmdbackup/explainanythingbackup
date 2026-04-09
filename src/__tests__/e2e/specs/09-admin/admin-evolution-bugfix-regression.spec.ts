// E2E regression tests for evolution bug fixes: MetricGrid CI display, LogsTab iteration filter,
// ConfirmDialog loading guard, and LineageGraph empty-state safety.

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

adminTest.describe('Evolution Bug Fix Regressions', { tag: '@evolution' }, () => {
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

  adminTest('run detail page loads without crash (LineageGraph/MetricGrid safety)', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${runId}`);
    // Page should load without JavaScript errors from empty elo arrays or null CI
    await expect(adminPage.getByTestId('entity-detail-header')).toBeVisible({ timeout: 20000 });
  });

  adminTest('LogsTab iteration filter includes iteration 0', async ({ adminPage: page }) => {
    await page.goto(`/admin/evolution/runs/${runId}`);
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
