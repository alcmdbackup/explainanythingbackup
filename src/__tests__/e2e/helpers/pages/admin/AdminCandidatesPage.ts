/**
 * Page object for admin candidates management page (tab on whitelist page).
 * Provides locators and actions for candidates table and approval modal.
 */

import { Page, Locator, expect } from '@playwright/test';
import { AdminBasePage } from './AdminBasePage';

export class AdminCandidatesPage extends AdminBasePage {
  // Tab elements
  readonly whitelistTab: Locator;
  readonly candidatesTab: Locator;

  // Table elements
  readonly statusFilter: Locator;
  readonly table: Locator;

  // Modal elements
  readonly modal: Locator;
  readonly modalCloseButton: Locator;
  readonly standaloneTitleInput: Locator;
  readonly cancelButton: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    super(page);

    // Tab elements
    this.whitelistTab = page.getByTestId('admin-whitelist-tab-whitelist');
    this.candidatesTab = page.getByTestId('admin-whitelist-tab-candidates');

    // Table elements
    this.statusFilter = page.getByTestId('admin-candidates-status-filter');
    this.table = page.getByTestId('admin-candidates-table');

    // Modal elements
    this.modal = page.getByTestId('admin-candidates-modal');
    this.modalCloseButton = page.getByTestId('admin-candidates-modal-close');
    this.standaloneTitleInput = page.getByTestId('admin-candidates-standalone-title');
    this.cancelButton = page.getByTestId('admin-candidates-cancel');
    this.submitButton = page.getByTestId('admin-candidates-submit');
  }

  /**
   * Navigate to the candidates page (whitelist page + candidates tab).
   */
  async gotoCandidates() {
    await this.goto();
    await this.goToWhitelist();
    await this.page.waitForLoadState('networkidle');
    await this.candidatesTab.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Verify the candidates tab has loaded.
   */
  async expectCandidatesPageLoaded() {
    await expect(this.table).toBeVisible();
    await expect(this.statusFilter).toBeVisible();
  }

  /**
   * Get a row locator by candidate ID.
   */
  getRow(candidateId: number): Locator {
    return this.page.getByTestId(`admin-candidates-row-${candidateId}`);
  }

  /**
   * Get approve button by candidate ID.
   */
  getApproveButton(candidateId: number): Locator {
    return this.page.getByTestId(`admin-candidates-approve-${candidateId}`);
  }

  /**
   * Get reject button by candidate ID.
   */
  getRejectButton(candidateId: number): Locator {
    return this.page.getByTestId(`admin-candidates-reject-${candidateId}`);
  }

  /**
   * Get delete button by candidate ID.
   */
  getDeleteButton(candidateId: number): Locator {
    return this.page.getByTestId(`admin-candidates-delete-${candidateId}`);
  }

  /**
   * Filter by status.
   */
  async filterByStatus(status: 'pending' | 'approved' | 'rejected' | 'all') {
    await this.statusFilter.selectOption(status);
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Open approve modal for a candidate.
   */
  async openApproveModal(candidateId: number) {
    await this.getApproveButton(candidateId).click();
    await expect(this.modal).toBeVisible();
  }

  /**
   * Close the modal.
   */
  async closeModal() {
    await this.modalCloseButton.click();
    await expect(this.modal).not.toBeVisible();
  }

  /**
   * Fill and submit the approve form.
   */
  async approveCandidate(standaloneTitle: string) {
    await this.standaloneTitleInput.fill(standaloneTitle);
    await this.submitButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Reject a candidate.
   */
  async rejectCandidate(candidateId: number) {
    await this.getRejectButton(candidateId).click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Delete a candidate (handles confirmation dialog).
   */
  async deleteCandidate(candidateId: number) {
    this.page.once('dialog', dialog => dialog.accept());
    await this.getDeleteButton(candidateId).click();
    await this.page.waitForLoadState('networkidle');
  }
}
