/**
 * Page object for admin users management page.
 * Provides locators and actions for users table and detail modal.
 */

import { Page, Locator, expect } from '@playwright/test';
import { AdminBasePage } from './AdminBasePage';

export class AdminUsersPage extends AdminBasePage {
  // Table elements
  readonly searchInput: Locator;
  readonly searchButton: Locator;
  readonly showDisabledCheckbox: Locator;
  readonly table: Locator;
  readonly pagination: Locator;
  readonly prevPageButton: Locator;
  readonly nextPageButton: Locator;

  // Modal elements
  readonly detailModal: Locator;
  readonly modalCloseButton: Locator;
  readonly modalCloseFooter: Locator;
  readonly notesTextarea: Locator;
  readonly saveNotesButton: Locator;
  readonly disableButton: Locator;
  readonly enableButton: Locator;
  readonly disableConfirm: Locator;
  readonly disableReasonInput: Locator;
  readonly confirmDisableButton: Locator;
  readonly cancelDisableButton: Locator;

  constructor(page: Page) {
    super(page);

    // Table elements
    this.searchInput = page.getByTestId('admin-users-search');
    this.searchButton = page.getByTestId('admin-users-search-btn');
    this.showDisabledCheckbox = page.getByTestId('admin-users-show-disabled');
    this.table = page.getByTestId('admin-users-table');
    this.pagination = page.getByTestId('admin-users-pagination');
    this.prevPageButton = page.getByTestId('admin-users-prev-page');
    this.nextPageButton = page.getByTestId('admin-users-next-page');

    // Modal elements
    this.detailModal = page.getByTestId('admin-user-detail-modal');
    this.modalCloseButton = page.getByTestId('admin-user-detail-close');
    this.modalCloseFooter = page.getByTestId('admin-user-detail-close-footer');
    this.notesTextarea = page.getByTestId('admin-user-detail-notes');
    this.saveNotesButton = page.getByTestId('admin-user-detail-save-notes');
    this.disableButton = page.getByTestId('admin-user-detail-disable');
    this.enableButton = page.getByTestId('admin-user-detail-enable');
    this.disableConfirm = page.getByTestId('admin-user-detail-disable-confirm');
    this.disableReasonInput = page.getByTestId('admin-user-detail-disable-reason');
    this.confirmDisableButton = page.getByTestId('admin-user-detail-confirm-disable');
    this.cancelDisableButton = page.getByTestId('admin-user-detail-cancel-disable');
  }

  /**
   * Navigate to the users page.
   */
  async gotoUsers() {
    await this.goto();
    await this.goToUsers();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Verify the users page has loaded.
   */
  async expectUsersPageLoaded() {
    await expect(this.table).toBeVisible();
    await expect(this.searchInput).toBeVisible();
  }

  /**
   * Get a row locator by user ID.
   */
  getRow(userId: string): Locator {
    return this.page.getByTestId(`admin-users-row-${userId}`);
  }

  /**
   * Get view details button by user ID.
   */
  getViewButton(userId: string): Locator {
    return this.page.getByTestId(`admin-users-view-${userId}`);
  }

  /**
   * Search for users.
   */
  async search(query: string) {
    await this.searchInput.fill(query);
    await this.searchButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Toggle show disabled checkbox.
   */
  async toggleShowDisabled() {
    await this.showDisabledCheckbox.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Open user detail modal by user ID.
   */
  async openUserDetailModal(userId: string) {
    await this.getViewButton(userId).click();
    await expect(this.detailModal).toBeVisible();
  }

  /**
   * Close the detail modal.
   */
  async closeDetailModal() {
    await this.modalCloseButton.click();
    await expect(this.detailModal).not.toBeVisible();
  }

  /**
   * Save admin notes.
   */
  async saveNotes(notes: string) {
    await this.notesTextarea.fill(notes);
    await this.saveNotesButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Disable user from modal.
   */
  async disableUser(reason?: string) {
    await this.disableButton.click();
    await expect(this.disableConfirm).toBeVisible();
    if (reason) {
      await this.disableReasonInput.fill(reason);
    }
    await this.confirmDisableButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Enable user from modal.
   */
  async enableUser() {
    await this.enableButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Cancel disable action.
   */
  async cancelDisable() {
    await this.cancelDisableButton.click();
    await expect(this.disableConfirm).not.toBeVisible();
  }
}
