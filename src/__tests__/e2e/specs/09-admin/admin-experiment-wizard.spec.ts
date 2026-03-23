// E2E test for the experiment creation wizard flow: fill name, select prompt/strategy, submit, verify success.
// Structurally correct but requires a full environment with seeded prompts/strategies to pass.

import { adminTest, expect } from '../../fixtures/admin-auth';

adminTest.describe('Experiment Creation Wizard', { tag: '@evolution' }, () => {
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
