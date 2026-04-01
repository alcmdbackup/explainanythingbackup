// Verify the generationGuidance field appears on the strategy creation form
// and that add/remove/percent controls work correctly.
import { test, expect } from '@playwright/test';

test.describe('Strategy creation generationGuidance UI', () => {
  test('strategy form shows generation guidance field with add/remove controls', async ({ page }) => {
    // Navigate to strategies page
    await page.goto('/admin/evolution/strategies');

    // Click "New Strategy" button
    const newBtn = page.getByRole('button', { name: /new strategy/i });
    await expect(newBtn).toBeVisible({ timeout: 10000 });
    await newBtn.click();

    // Wait for dialog to appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Verify the Generation Guidance label exists
    await expect(dialog.getByText('Generation Guidance (optional)')).toBeVisible();

    // Verify the "Add strategy" button exists
    const addBtn = dialog.getByTestId('guidance-add');
    await expect(addBtn).toBeVisible();

    // Verify total shows 0% initially
    const totalEl = dialog.getByTestId('guidance-total');
    await expect(totalEl).toContainText('Total: 0%');

    // Add first strategy entry
    await addBtn.click();

    // Verify strategy dropdown and percent input appeared
    const strategySelect = dialog.getByTestId('guidance-strategy-0');
    await expect(strategySelect).toBeVisible();
    const percentInput = dialog.getByTestId('guidance-percent-0');
    await expect(percentInput).toBeVisible();

    // Set percent to 50
    await percentInput.fill('50');
    await expect(totalEl).toContainText('Total: 50%');
    await expect(totalEl).toContainText('must equal 100%');

    // Add second strategy entry
    await addBtn.click();
    const percentInput1 = dialog.getByTestId('guidance-percent-1');
    await expect(percentInput1).toBeVisible();

    // Set second percent to 50 — total should now be 100%
    await percentInput1.fill('50');
    await expect(totalEl).toContainText('Total: 100%');

    // Verify remove button works
    const removeBtn = dialog.getByTestId('guidance-remove-1');
    await removeBtn.click();
    await expect(dialog.getByTestId('guidance-strategy-1')).not.toBeVisible();

    // Take screenshot for verification
    await page.screenshot({ path: `/tmp/strategy-guidance-form-${test.info().workerIndex}.png`, fullPage: true });
  });
});
