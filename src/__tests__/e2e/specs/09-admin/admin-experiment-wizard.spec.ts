// E2E test for the experiment creation wizard flow: fill name, select prompt/strategy, submit, verify success.
// Structurally correct but requires a full environment with seeded prompts/strategies to pass.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

adminTest.describe('Experiment Creation Wizard', { tag: '@evolution' }, () => {
  adminTest.afterAll(async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    // Find and cascade-delete wizard test experiments
    const { data: experiments } = await supabase
      .from('evolution_experiments')
      .select('id')
      .ilike('name', '[E2E] Wizard Test%');
    if (experiments && experiments.length > 0) {
      const expIds = experiments.map(e => e.id as string);
      // Find runs for these experiments
      const { data: runs } = await supabase.from('evolution_runs').select('id').in('experiment_id', expIds);
      const runIds = (runs ?? []).map(r => r.id as string);
      if (runIds.length > 0) {
        await supabase.from('evolution_arena_comparisons').delete().in('run_id', runIds);
        await supabase.from('evolution_logs').delete().in('run_id', runIds);
        await supabase.from('evolution_agent_invocations').delete().in('run_id', runIds);
        await supabase.from('evolution_variants').delete().in('run_id', runIds);
        await supabase.from('evolution_runs').delete().in('id', runIds);
      }
      await supabase.from('evolution_experiments').delete().in('id', expIds);
    }
  });

  adminTest('creates experiment via wizard flow', async ({ adminPage }) => {
    // Navigate to experiment creation page
    await adminPage.goto('/admin/evolution/experiments/new');
    await adminPage.waitForLoadState('domcontentloaded');

    // Wizard form should render
    await expect(adminPage.locator('h1')).toContainText('Create Experiment');

    // Step 1: Fill in experiment name
    const nameInput = adminPage.getByTestId('experiment-name-input');
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    const experimentName = `[E2E] Wizard Test ${Date.now()}`;
    await nameInput.fill(experimentName);

    // Step 2: Select a prompt from the dropdown
    const promptSelect = adminPage.getByTestId('prompt-select');
    await expect(promptSelect).toBeVisible();
    await promptSelect.click();
    // Pick the first available prompt option
    const firstPromptOption = adminPage.getByTestId('prompt-option').first();
    await firstPromptOption.click();

    // Step 3: Select a strategy
    const strategySelect = adminPage.getByTestId('strategy-select');
    await expect(strategySelect).toBeVisible();
    await strategySelect.click();
    const firstStrategyOption = adminPage.getByTestId('strategy-option').first();
    await firstStrategyOption.click();

    // Submit the form
    await adminPage.getByTestId('create-experiment-submit').click();

    // Verify success toast appears
    const toast = adminPage.locator('[data-testid="toast-success"], [role="status"]');
    await expect(toast).toBeVisible({ timeout: 15000 });
    await expect(toast).toContainText(/created|success/i);
  });
});
