// E2E tests for evolution error states: failed run detail displays error message and variant warnings.
// Seeds a failed run and verifies error banners render on the detail page.

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

adminTest.describe('Evolution Error States', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  const testPrefix = `e2e-error-${Date.now()}`;
  let strategyId: string;
  let promptId: string;
  let failedRunId: string;

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

    // Seed a failed run with error_message
    failedRunId = randomUUID();
    const { error: rErr } = await sb.from('evolution_runs').insert({
      id: failedRunId,
      status: 'failed',
      strategy_id: strategyId,
      prompt_id: promptId,
      budget_cap_usd: 1.0,
      error_message: 'Pipeline budget exceeded: $1.05 > $1.00 cap',
    });
    if (rErr) throw new Error(`Seed failed run: ${rErr.message}`);
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();
    await sb.from('evolution_variants').delete().eq('run_id', failedRunId);
    await sb.from('evolution_runs').delete().eq('id', failedRunId);
    await sb.from('evolution_strategies').delete().eq('id', strategyId);
    await sb.from('evolution_prompts').delete().eq('id', promptId);
  });

  adminTest('failed run shows error message', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${failedRunId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 15000 });

    // Error banner should be visible with the seeded error message
    const errorBanner = adminPage.locator('[data-testid="run-error-banner"]');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('Pipeline budget exceeded');

    // Navigate to metrics tab — should show empty state (no metrics for failed run)
    const metricsTab = adminPage.locator('[data-testid="tab-metrics"]');
    await expect(metricsTab).toBeVisible();
    await metricsTab.click();

    // Wait for metrics tab content to load (tab-content is the correct testid from EntityDetailTabs)
    const metricsPanel = adminPage.locator('[data-testid="tab-content"]');
    await expect(metricsPanel).toBeVisible({ timeout: 10000 });
    await expect(metricsPanel).not.toHaveText('', { timeout: 15000 });
  });
});
