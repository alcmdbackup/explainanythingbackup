/**
 * @critical
 * Admin Prompt Registry E2E tests.
 * Tests create, edit, and archive flows on the prompts page.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';

adminTest.describe('Prompt Registry CRUD', () => {
  const testPromptTitle = `[E2E] Test Prompt ${Date.now()}`;

  adminTest('create, edit, and archive a prompt @critical', async ({ adminPage }) => {
    // Navigate to prompts page
    await adminPage.goto('/admin/evolution/prompts');
    await expect(adminPage.getByText('Prompt Registry')).toBeVisible();

    // Create prompt
    await adminPage.getByTestId('add-prompt-btn').click();
    await adminPage.getByRole('textbox', { name: /title/i }).first().fill(testPromptTitle);
    await adminPage.getByRole('textbox', { name: /prompt text/i }).first().fill('Explain photosynthesis to a 10-year-old');
    await adminPage.getByRole('button', { name: /save/i }).click();

    // Verify prompt appears in table
    await expect(adminPage.getByText(testPromptTitle)).toBeVisible({ timeout: 10000 });

    // Edit prompt
    const row = adminPage.getByTestId(`prompt-row-${testPromptTitle}`).or(
      adminPage.locator('tr', { hasText: testPromptTitle }),
    );
    await row.getByText('Edit').click();
    await adminPage.getByRole('textbox', { name: /title/i }).first().clear();
    await adminPage.getByRole('textbox', { name: /title/i }).first().fill(`${testPromptTitle} (edited)`);
    await adminPage.getByRole('button', { name: /save/i }).click();

    // Verify edit
    await expect(adminPage.getByText(`${testPromptTitle} (edited)`)).toBeVisible({ timeout: 10000 });

    // Archive prompt
    const editedRow = adminPage.locator('tr', { hasText: `${testPromptTitle} (edited)` });
    await editedRow.getByText('Archive').click();
    await adminPage.getByRole('button', { name: /archive/i }).last().click();

    // Verify archived (should disappear from active filter)
    await expect(adminPage.getByText(`${testPromptTitle} (edited)`)).not.toBeVisible({ timeout: 5000 });
  });
});
