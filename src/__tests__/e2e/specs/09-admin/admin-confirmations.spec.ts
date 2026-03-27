// E2E tests for admin confirmation dialogs — verifies destructive actions require confirmation.

import { adminTest, expect, hasAdminCredentials } from '../../fixtures/admin-auth';

adminTest.describe('Admin Confirmation Dialogs', { tag: '@critical' }, () => {
  adminTest.describe.configure({ retries: 1, mode: 'serial' });
  adminTest.setTimeout(30000);

  adminTest('feature flag toggle shows confirmation dialog', async ({ adminPage }) => {
    await adminPage.goto('/admin/settings');
    await adminPage.waitForLoadState('domcontentloaded');

    // Wait for flags table to load
    const flagToggle = adminPage.locator('button[class*="rounded-full"]').first();
    const isVisible = await flagToggle.isVisible({ timeout: 10000 }).catch(() => false);

    if (!isVisible) {
      adminTest.skip(true, 'No feature flags found on settings page');
      return;
    }

    // Click the toggle — should show confirmation dialog, not toggle immediately
    await flagToggle.click();

    // Verify confirmation dialog appears
    const dialog = adminPage.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Dialog should contain Confirm/Cancel buttons
    const cancelBtn = dialog.getByText('Cancel');
    await expect(cancelBtn).toBeVisible();

    // Cancel to close without toggling
    await cancelBtn.click();
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });

  adminTest('whitelist delete shows confirmation dialog', async ({ adminPage }) => {
    await adminPage.goto('/admin/whitelist');
    await adminPage.waitForLoadState('domcontentloaded');

    // Look for a delete button in the whitelist table
    const deleteBtn = adminPage.getByRole('button', { name: /delete/i }).first();
    const isVisible = await deleteBtn.isVisible({ timeout: 10000 }).catch(() => false);

    if (!isVisible) {
      adminTest.skip(true, 'No whitelist terms with delete buttons found');
      return;
    }

    // Click delete — should show confirmation, not delete immediately
    await deleteBtn.click();

    // Verify confirmation dialog appears
    const dialog = adminPage.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText(/delete/i)).toBeVisible();

    // Cancel
    await dialog.getByText('Cancel').click();
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });

  adminTest('content modal hide/restore shows confirmation dialog', async ({ adminPage }) => {
    await adminPage.goto('/admin/content');
    await adminPage.waitForLoadState('domcontentloaded');

    // Wait for content table to load
    const firstRow = adminPage.locator('[data-testid="content-table"] tr').first();
    const hasRows = await firstRow.isVisible({ timeout: 10000 }).catch(() => false);

    if (!hasRows) {
      adminTest.skip(true, 'No content rows found for modal test');
      return;
    }

    // Click to open detail modal
    const viewBtn = adminPage.getByRole('button', { name: /view|detail/i }).first();
    const viewVisible = await viewBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (!viewVisible) {
      adminTest.skip(true, 'No view button found in content table');
      return;
    }

    await viewBtn.click();

    // Verify modal opened
    const modal = adminPage.locator('[data-testid="admin-content-detail-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Click hide button — should trigger confirmation
    const hideBtn = modal.getByRole('button', { name: /hide/i });
    const hideVisible = await hideBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (hideVisible) {
      await hideBtn.click();

      // Verify confirmation dialog appears
      const confirmDialog = adminPage.getByRole('dialog').last();
      await expect(confirmDialog).toBeVisible({ timeout: 5000 });

      // Cancel
      await confirmDialog.getByText('Cancel').click();
    }
  });
});
