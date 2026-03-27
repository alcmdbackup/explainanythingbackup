// E2E test for experiment creation wizard: seeds own prompt/strategy, creates experiment via UI, verifies.
// Self-contained replacement for the fragile admin-experiment-wizard.spec.ts.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import { trackEvolutionId } from '../../helpers/evolution-test-data-factory';

// Prefix avoids [TEST] substring so seeded data isn't filtered by the wizard's filterTestContent
const TEST_PREFIX = 'E2E-Wizard';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

adminTest.describe('Experiment Wizard E2E', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let promptId: string;
  let strategyId: string;
  let experimentId: string;

  adminTest.beforeAll(async () => {
    const sb = getServiceClient();

    // Seed prompt visible to wizard (no [TEST] in name)
    const { data: prompt, error: promptErr } = await sb
      .from('evolution_prompts')
      .insert({
        prompt: 'E2E wizard test: explain photosynthesis',
        name: `${TEST_PREFIX} Prompt ${Date.now()}`,
        status: 'active',
      })
      .select('id')
      .single();
    if (promptErr) throw new Error(`Seed prompt failed: ${promptErr.message}`);
    promptId = prompt.id;
    trackEvolutionId('prompt', promptId);

    // Seed strategy visible to wizard
    const { data: strategy, error: stratErr } = await sb
      .from('evolution_strategies')
      .insert({
        name: `${TEST_PREFIX} Strategy ${Date.now()}`,
        config: { generationModel: 'gpt-4.1-nano', judgeModel: 'gpt-4.1-nano', iterations: 1 },
        config_hash: `e2e-wizard-${Date.now()}`,
        status: 'active',
      })
      .select('id')
      .single();
    if (stratErr) throw new Error(`Seed strategy failed: ${stratErr.message}`);
    strategyId = strategy.id;
    trackEvolutionId('strategy', strategyId);
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();

    // Find runs created by the experiment
    if (experimentId) {
      const { data: runs } = await sb
        .from('evolution_runs')
        .select('id')
        .eq('experiment_id', experimentId);
      const runIds = (runs ?? []).map(r => r.id as string);

      if (runIds.length > 0) {
        await sb.from('evolution_agent_invocations').delete().in('run_id', runIds);
        await sb.from('evolution_logs').delete().in('run_id', runIds);
        await sb.from('evolution_metrics').delete().in('entity_id', runIds);
        await sb.from('evolution_variants').delete().in('run_id', runIds);
        await sb.from('evolution_runs').delete().in('id', runIds);
      }

      await sb.from('evolution_metrics').delete().eq('entity_id', experimentId);
      await sb.from('evolution_experiments').delete().eq('id', experimentId);
    }

    await sb.from('evolution_metrics').delete().eq('entity_id', strategyId);
    await sb.from('evolution_strategies').delete().eq('id', strategyId);
    await sb.from('evolution_prompts').delete().eq('id', promptId);
  });

  adminTest('wizard page loads', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/start-experiment');
    await adminPage.waitForLoadState('domcontentloaded');

    await expect(adminPage.locator('h1')).toContainText('Start Experiment');
    // Wait for form to finish loading
    await expect(adminPage.locator('text=Experiment Name')).toBeVisible({ timeout: 15000 });
  });

  adminTest('create experiment via wizard', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/start-experiment');
    await adminPage.waitForLoadState('domcontentloaded');

    // Wait for form to load (loading spinner disappears)
    await expect(adminPage.locator('text=Experiment Name')).toBeVisible({ timeout: 15000 });

    // Step 1: Fill name
    const experimentName = `${TEST_PREFIX} Experiment ${Date.now()}`;
    const nameInput = adminPage.locator('input[type="text"][placeholder*="Model comparison"]');
    await nameInput.fill(experimentName);

    // Select the seeded prompt by finding its name text
    const promptLabel = adminPage.locator('label').filter({ hasText: TEST_PREFIX }).filter({ hasText: 'Prompt' });
    await promptLabel.click();

    // Click "Next: Select Strategies"
    await adminPage.locator('button', { hasText: 'Next: Select Strategies' }).click();

    // Step 2: Select the seeded strategy
    const strategyCheck = adminPage.locator(`[data-testid="strategy-check-${strategyId}"]`);
    await expect(strategyCheck).toBeVisible({ timeout: 10000 });
    await strategyCheck.click();

    // Click Review
    await adminPage.locator('button', { hasText: 'Review' }).click();

    // Step 3: Submit
    const submitBtn = adminPage.locator('[data-testid="experiment-submit-btn"]');
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // Wait for success toast
    const toast = adminPage.locator('[data-sonner-toast]').filter({ hasText: /created|experiment/i });
    await expect(toast).toBeVisible({ timeout: 15000 });

    // Capture experiment ID from toast text (format: "...experimentId")
    const toastText = await toast.textContent();
    const uuidMatch = toastText?.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (uuidMatch) {
      experimentId = uuidMatch[1]!;
      trackEvolutionId('experiment', experimentId);
    } else {
      // Fallback: query DB for the experiment we just created
      const sb = getServiceClient();
      const { data } = await sb
        .from('evolution_experiments')
        .select('id')
        .ilike('name', `${experimentName}%`)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (data) {
        experimentId = data.id;
        trackEvolutionId('experiment', experimentId);
      }
    }

    expect(experimentId).toBeTruthy();
  });

  adminTest('experiment appears in list', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/experiments');
    await adminPage.waitForLoadState('domcontentloaded');

    await expect(adminPage.locator('body')).toContainText(TEST_PREFIX, { timeout: 15000 });
  });

  adminTest('experiment detail page loads', async ({ adminPage }) => {
    expect(experimentId).toBeTruthy();

    await adminPage.goto(`/admin/evolution/experiments/${experimentId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const header = adminPage.locator('[data-testid="entity-detail-header"]');
    await expect(header).toBeVisible({ timeout: 15000 });

    await expect(adminPage.locator('body')).toContainText(TEST_PREFIX);
  });
});
