/**
 * Page object for admin content management page.
 * Provides locators and actions for explanation table and detail modal.
 */

import { Page, Locator, expect } from '@playwright/test';
import { AdminBasePage } from './AdminBasePage';

export class AdminContentPage extends AdminBasePage {
  // Table elements
  readonly searchInput: Locator;
  readonly statusFilter: Locator;
  readonly showHiddenCheckbox: Locator;
  readonly bulkHideButton: Locator;
  readonly table: Locator;
  readonly selectAllCheckbox: Locator;
  readonly pagination: Locator;
  readonly prevPageButton: Locator;
  readonly nextPageButton: Locator;

  // Modal elements
  readonly detailModal: Locator;
  readonly modalCloseButton: Locator;
  readonly modalCloseFooter: Locator;
  readonly modalViewPublic: Locator;
  readonly modalHideButton: Locator;
  readonly modalRestoreButton: Locator;

  constructor(page: Page) {
    super(page);

    // Table elements
    this.searchInput = page.getByTestId('admin-content-search');
    this.statusFilter = page.getByTestId('admin-content-status-filter');
    this.showHiddenCheckbox = page.getByTestId('admin-content-show-hidden');
    this.bulkHideButton = page.getByTestId('admin-content-bulk-hide');
    this.table = page.getByTestId('admin-content-table');
    this.selectAllCheckbox = page.getByTestId('admin-content-select-all');
    this.pagination = page.getByTestId('admin-content-pagination');
    this.prevPageButton = page.getByTestId('admin-content-prev-page');
    this.nextPageButton = page.getByTestId('admin-content-next-page');

    // Modal elements
    this.detailModal = page.getByTestId('admin-content-detail-modal');
    this.modalCloseButton = page.getByTestId('admin-content-detail-close');
    this.modalCloseFooter = page.getByTestId('admin-content-detail-close-footer');
    this.modalViewPublic = page.getByTestId('admin-content-detail-view-public');
    this.modalHideButton = page.getByTestId('admin-content-detail-hide');
    this.modalRestoreButton = page.getByTestId('admin-content-detail-restore');
  }

  /**
   * Navigate to the content management page.
   */
  async gotoContent() {
    await this.goto();
    await this.goToContent();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Verify the content page has loaded.
   */
  async expectContentPageLoaded() {
    await expect(this.table).toBeVisible();
    await expect(this.searchInput).toBeVisible();
    await expect(this.statusFilter).toBeVisible();
  }

  /**
   * Get a row locator by explanation ID.
   */
  getRow(id: number): Locator {
    return this.page.getByTestId(`admin-content-row-${id}`);
  }

  /**
   * Get a checkbox locator by explanation ID.
   */
  getCheckbox(id: number): Locator {
    return this.page.getByTestId(`admin-content-checkbox-${id}`);
  }

  /**
   * Get a title button locator by explanation ID.
   */
  getTitleButton(id: number): Locator {
    return this.page.getByTestId(`admin-content-title-${id}`);
  }

  /**
   * Get a view button locator by explanation ID.
   */
  getViewButton(id: number): Locator {
    return this.page.getByTestId(`admin-content-view-${id}`);
  }

  /**
   * Get a hide button locator by explanation ID.
   */
  getHideButton(id: number): Locator {
    return this.page.getByTestId(`admin-content-hide-${id}`);
  }

  /**
   * Get a restore button locator by explanation ID.
   */
  getRestoreButton(id: number): Locator {
    return this.page.getByTestId(`admin-content-restore-${id}`);
  }

  /**
   * Search for explanations.
   */
  async search(query: string) {
    await this.searchInput.fill(query);
    // Wait for debounced search to trigger and network to settle
    await this.page.waitForLoadState('networkidle');
    // Additional wait for table to update
    await this.table.locator('tbody').waitFor({ state: 'visible' });
  }

  /**
   * Filter by status.
   */
  async filterByStatus(status: 'draft' | 'published' | '') {
    await this.statusFilter.selectOption(status);
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Toggle show hidden checkbox.
   */
  async toggleShowHidden() {
    await this.showHiddenCheckbox.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Open explanation detail modal.
   */
  async openDetailModal(id: number) {
    await this.getTitleButton(id).click();
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
   * Hide explanation from detail modal.
   */
  async hideFromModal() {
    await this.modalHideButton.click();
    await expect(this.detailModal).not.toBeVisible();
  }

  /**
   * Restore explanation from detail modal.
   */
  async restoreFromModal() {
    await this.modalRestoreButton.click();
    await expect(this.detailModal).not.toBeVisible();
  }

  /**
   * Select multiple explanations.
   */
  async selectExplanations(ids: number[]) {
    for (const id of ids) {
      await this.getCheckbox(id).click();
    }
  }

  /**
   * Bulk hide selected explanations.
   */
  async bulkHide() {
    await this.bulkHideButton.click();
    await this.page.waitForLoadState('networkidle');
  }
}
