// E2E test for the experiment creation wizard flow: fill name, select prompt/strategy, submit, verify success.
// Structurally correct but requires a full environment with seeded prompts/strategies to pass.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

adminTest.describe('Experiment Creation Wizard', { tag: '@evolution' }, () => {
  adminTest.afterAll(async () => {
    const supabase = createClient<Database>(
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
    // Navigate to start experiment page (the wizard lives at /admin/evolution/start-experiment)
    await adminPage.goto('/admin/evolution/start-experiment');
    await adminPage.waitForLoadState('domcontentloaded');

    // Page heading
    await expect(adminPage.locator('h1')).toContainText('Start Experiment');

    // Step 1 (Setup): Fill in experiment name
    const nameInput = adminPage.locator('input[placeholder*="Model comparison"]');
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    const experimentName = `[E2E] Wizard Test ${Date.now()}`;
    await nameInput.fill(experimentName);

    // Select first prompt via radio button
    const firstPromptRadio = adminPage.locator('input[type="radio"][name="prompt"]').first();
    await expect(firstPromptRadio).toBeVisible();
    await firstPromptRadio.check();

    // Click "Next: Select Strategies"
    await adminPage.locator('button:has-text("Next: Select Strategies")').click();

    // Step 2 (Strategies): Select first strategy via checkbox
    const firstStrategyCheck = adminPage.locator('input[type="checkbox"][data-testid^="strategy-check-"]').first();
    await expect(firstStrategyCheck).toBeVisible({ timeout: 10000 });
    await firstStrategyCheck.check();

    // Click "Review"
    await adminPage.locator('button:has-text("Review")').click();

    // Step 3 (Review): Submit
    await adminPage.locator('[data-testid="experiment-submit-btn"]').click();

    // Verify success toast appears
    const toast = adminPage.locator('[data-sonner-toast] [data-title], [role="status"]');
    await expect(toast.first()).toBeVisible({ timeout: 15000 });
  });

  adminTest('validation errors hidden until first Next click', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/start-experiment');
    await adminPage.waitForLoadState('domcontentloaded');

    await expect(adminPage.locator('h1')).toContainText('Start Experiment');

    // Before clicking Next, validation error list items should not be visible
    const validationError = adminPage.locator('ul.text-xs li');
    await expect(validationError).not.toBeVisible();

    // Click Next without filling in required fields (name and prompt are required)
    const nextButton = adminPage.locator('button:has-text("Next: Select Strategies")');
    await expect(nextButton).toBeVisible({ timeout: 10000 });
    await nextButton.click();

    // Now validation errors should appear (ExperimentForm shows inline error text)
    await expect(adminPage.locator('p:has-text("Enter an experiment name")')).toBeVisible({ timeout: 5000 });
  });

  adminTest('runs-per-strategy spinner works', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/start-experiment');
    await adminPage.waitForLoadState('domcontentloaded');

    await expect(adminPage.locator('h1')).toContainText('Start Experiment');

    // Step 1 (Setup): Fill experiment name
    const nameInput = adminPage.locator('input[placeholder*="Model comparison"]');
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill(`[E2E] Wizard Test ${Date.now()}`);

    // Select first prompt
    const firstPromptRadio = adminPage.locator('input[type="radio"][name="prompt"]').first();
    await expect(firstPromptRadio).toBeVisible();
    await firstPromptRadio.check();

    // Click Next to go to strategies step
    await adminPage.locator('button:has-text("Next: Select Strategies")').click();

    // Step 2 (Strategies): Select first strategy
    const firstStrategyCheck = adminPage.locator('input[type="checkbox"][data-testid^="strategy-check-"]').first();
    await expect(firstStrategyCheck).toBeVisible({ timeout: 10000 });
    await firstStrategyCheck.check();

    // Find the runs count input (appears after selecting a strategy, testid is runs-count-${id})
    const runsInput = adminPage.locator('input[data-testid^="runs-count-"]').first();
    await expect(runsInput).toBeVisible({ timeout: 5000 });
    await runsInput.fill('3');

    // Verify the total runs counter text updates (shown in the header as "X total runs")
    await expect(adminPage.locator('text=3 total runs')).toBeVisible({ timeout: 5000 });
  });

  adminTest('form shows all required sections', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/start-experiment');
    await adminPage.waitForLoadState('domcontentloaded');

    await expect(adminPage.locator('h1')).toContainText('Start Experiment');

    // ExperimentForm renders as a single-page form with required sections
    await expect(adminPage.getByText('Experiment Name', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(adminPage.getByText('Prompt', { exact: true })).toBeVisible();
    await expect(adminPage.getByText('Budget per Run ($)', { exact: true })).toBeVisible();
  });
});
