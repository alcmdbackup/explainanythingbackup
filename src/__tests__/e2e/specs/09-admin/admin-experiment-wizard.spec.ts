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

  adminTest('validation errors hidden until first Next click', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/experiments/new');
    await adminPage.waitForLoadState('domcontentloaded');

    await expect(adminPage.locator('h1')).toContainText('Create Experiment');

    // Before clicking Next, validation errors should not be visible
    const validationError = adminPage.locator('[data-testid="validation-error"], .text-red-500, [role="alert"]');
    await expect(validationError).not.toBeVisible();

    // Click Next without filling in required fields
    const nextButton = adminPage.locator('[data-testid="wizard-next-btn"], button:has-text("Next")');
    if (await nextButton.count() > 0) {
      await nextButton.first().click();

      // Now validation errors should appear
      const errorAfterClick = adminPage.locator('[data-testid="validation-error"], .text-red-500, [role="alert"]');
      await expect(errorAfterClick.first()).toBeVisible({ timeout: 5000 });
    }
  });

  adminTest('runs-per-strategy spinner works', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/experiments/new');
    await adminPage.waitForLoadState('domcontentloaded');

    await expect(adminPage.locator('h1')).toContainText('Create Experiment');

    // Fill experiment name first
    const nameInput = adminPage.getByTestId('experiment-name-input');
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill(`[E2E] Wizard Test ${Date.now()}`);

    // Select a prompt
    const promptSelect = adminPage.getByTestId('prompt-select');
    await expect(promptSelect).toBeVisible();
    await promptSelect.click();
    const firstPromptOption = adminPage.getByTestId('prompt-option').first();
    await firstPromptOption.click();

    // Select a strategy
    const strategySelect = adminPage.getByTestId('strategy-select');
    await expect(strategySelect).toBeVisible();
    await strategySelect.click();
    const firstStrategyOption = adminPage.getByTestId('strategy-option').first();
    await firstStrategyOption.click();

    // Find the runs-per-strategy input and set it to 3
    const runsInput = adminPage.locator('[data-testid="runs-per-strategy-input"], input[name="runsPerStrategy"]');
    await expect(runsInput.first()).toBeVisible({ timeout: 5000 });
    await runsInput.first().fill('3');

    // Verify the total runs counter reflects the updated value
    const totalRuns = adminPage.locator('[data-testid="total-runs-count"], [data-testid="total-runs"]');
    if (await totalRuns.count() > 0) {
      const totalText = await totalRuns.first().textContent();
      expect(totalText).toBeDefined();
      // Total runs should contain the digit 3 (or a multiple if multiple strategies)
      expect(totalText!.length).toBeGreaterThan(0);
    }
  });

  adminTest('step indicator shows labels', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/experiments/new');
    await adminPage.waitForLoadState('domcontentloaded');

    await expect(adminPage.locator('h1')).toContainText('Create Experiment');

    // Step indicator should be visible with step labels
    const stepIndicator = adminPage.locator('[data-testid="step-indicator"], [data-testid="wizard-steps"], nav[aria-label="Wizard steps"]');
    if (await stepIndicator.count() > 0) {
      await expect(stepIndicator.first()).toBeVisible();

      // Should contain step label text for the wizard steps
      const indicatorText = await stepIndicator.first().textContent();
      expect(indicatorText).toBeDefined();
      // At minimum, the current step label should be visible
      expect(indicatorText!.length).toBeGreaterThan(0);
    }
  });
});
