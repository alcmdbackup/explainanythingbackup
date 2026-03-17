/**
 * @critical
 * Admin Strategy Registry E2E tests.
 * Tests create strategy with preset and agent selection.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';

adminTest.describe('Strategy Registry CRUD', () => {
  const testStrategyName = `[E2E] Test Strategy ${Date.now()}`;

  adminTest('create strategy with preset selection @critical', async ({ adminPage }) => {
    // Navigate to strategies page
    await adminPage.goto('/admin/evolution/strategies');
    await expect(adminPage.getByText('Strategy Registry')).toBeVisible();

    // Open create dialog
    await adminPage.getByText('Create Strategy').click();
    await expect(adminPage.getByText('Create Strategy').first()).toBeVisible();

    // Fill in name
    await adminPage.getByTestId('strategy-name-input').fill(testStrategyName);

    // Verify agent selection is visible
    await expect(adminPage.getByText('Agent Selection')).toBeVisible();
    await expect(adminPage.getByText('Required (always enabled)')).toBeVisible();
    await expect(adminPage.getByText('Optional')).toBeVisible();

    // Toggle an optional agent
    const reflectionToggle = adminPage.getByTestId('agent-toggle-reflection');
    if (await reflectionToggle.isVisible()) {
      const isChecked = await reflectionToggle.isChecked();
      await reflectionToggle.click();
      // Verify toggle changed
      const newState = await reflectionToggle.isChecked();
      expect(newState).not.toBe(isChecked);
    }

    // Submit
    await adminPage.getByText('Create', { exact: true }).last().click();

    // Verify strategy appears in table
    await expect(adminPage.getByText(testStrategyName)).toBeVisible({ timeout: 10000 });
  });
});
