// E2E tests for admin confirmation dialogs — verifies destructive actions require confirmation.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { safeIsVisible } from '../../helpers/error-utils';

adminTest.describe('Admin Confirmation Dialogs', { tag: '@critical' }, () => {
  adminTest.describe.configure({ retries: 1, mode: 'serial' });
  adminTest.setTimeout(30000);

  adminTest('feature flag toggle shows confirmation dialog', async ({ adminPage }) => {
    await adminPage.goto('/admin/settings');
    await adminPage.waitForLoadState('domcontentloaded');

    const flagToggle = adminPage.locator('button[class*="rounded-full"]').first();
    const isVisible = await safeIsVisible(flagToggle, 'feature-flag-toggle', 10000);

    if (!isVisible) {
      // eslint-disable-next-line flakiness/no-test-skip -- No feature flags in test environment
      adminTest.skip(true, 'No feature flags found on settings page');
      return;
    }

    await flagToggle.click();

    const dialog = adminPage.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const cancelBtn = dialog.getByText('Cancel');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });

  adminTest('whitelist delete shows confirmation dialog', async ({ adminPage }) => {
    await adminPage.goto('/admin/whitelist');
    await adminPage.waitForLoadState('domcontentloaded');

    const deleteBtn = adminPage.getByRole('button', { name: /delete/i }).first();
    const isVisible = await safeIsVisible(deleteBtn, 'whitelist-delete-btn', 10000);

    if (!isVisible) {
      // eslint-disable-next-line flakiness/no-test-skip -- No whitelist terms in test environment
      adminTest.skip(true, 'No whitelist terms with delete buttons found');
      return;
    }

    await deleteBtn.click();

    const dialog = adminPage.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText(/delete/i)).toBeVisible();

    await dialog.getByText('Cancel').click();
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });

  adminTest('content modal hide shows confirmation dialog', async ({ adminPage }) => {
    await adminPage.goto('/admin/content');
    await adminPage.waitForLoadState('domcontentloaded');

    const viewBtn = adminPage.getByRole('button', { name: /view|detail/i }).first();
    const viewVisible = await safeIsVisible(viewBtn, 'content-view-btn', 10000);

    if (!viewVisible) {
      // eslint-disable-next-line flakiness/no-test-skip -- No content rows in test environment
      adminTest.skip(true, 'No view button found in content table');
      return;
    }

    await viewBtn.click();

    const modal = adminPage.locator('[data-testid="admin-content-detail-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const hideBtn = modal.getByRole('button', { name: /hide/i });
    const hideVisible = await safeIsVisible(hideBtn, 'modal-hide-btn', 3000);

    if (hideVisible) {
      await hideBtn.click();
      const confirmDialog = adminPage.getByRole('dialog').last();
      await expect(confirmDialog).toBeVisible({ timeout: 5000 });
      await confirmDialog.getByText('Cancel').click();
    }
  });
});
