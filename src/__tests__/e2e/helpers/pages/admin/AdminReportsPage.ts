/**
 * Page object for admin content reports page.
 * Provides locators and actions for reports table and detail modal.
 */

import { Page, Locator, expect } from '@playwright/test';
import { AdminBasePage } from './AdminBasePage';

export class AdminReportsPage extends AdminBasePage {
  // Table elements
  readonly statusFilter: Locator;
  readonly table: Locator;
  readonly pagination: Locator;
  readonly prevPageButton: Locator;
  readonly nextPageButton: Locator;

  // Modal elements
  readonly detailModal: Locator;
  readonly modalCloseButton: Locator;
  readonly modalCloseFooter: Locator;

  constructor(page: Page) {
    super(page);

    // Table elements
    this.statusFilter = page.getByTestId('admin-reports-status-filter');
    this.table = page.getByTestId('admin-reports-table');
    this.pagination = page.getByTestId('admin-reports-pagination');
    this.prevPageButton = page.getByTestId('admin-reports-prev-page');
    this.nextPageButton = page.getByTestId('admin-reports-next-page');

    // Modal elements
    this.detailModal = page.getByTestId('admin-reports-detail-modal');
    this.modalCloseButton = page.getByTestId('admin-reports-modal-close');
    this.modalCloseFooter = page.getByTestId('admin-reports-modal-close-footer');
  }

  /**
   * Navigate to the content reports page.
   */
  async gotoReports() {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3008';
    await this.page.goto(`${baseUrl}/admin/content/reports`);
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Verify the reports page has loaded.
   */
  async expectReportsPageLoaded() {
    await expect(this.table).toBeVisible();
    await expect(this.statusFilter).toBeVisible();
  }

  /**
   * Get a row locator by report ID.
   */
  getRow(id: number): Locator {
    return this.page.getByTestId(`admin-reports-row-${id}`);
  }

  /**
   * Get explanation link by report ID.
   */
  getExplanationLink(id: number): Locator {
    return this.page.getByTestId(`admin-reports-explanation-${id}`);
  }

  /**
   * Get details button by report ID.
   */
  getDetailsButton(id: number): Locator {
    return this.page.getByTestId(`admin-reports-details-${id}`);
  }

  /**
   * Get dismiss button by report ID.
   */
  getDismissButton(id: number): Locator {
    return this.page.getByTestId(`admin-reports-dismiss-${id}`);
  }

  /**
   * Get review button by report ID.
   */
  getReviewButton(id: number): Locator {
    return this.page.getByTestId(`admin-reports-review-${id}`);
  }

  /**
   * Get action (hide content) button by report ID.
   */
  getActionButton(id: number): Locator {
    return this.page.getByTestId(`admin-reports-action-${id}`);
  }

  /**
   * Filter reports by status.
   */
  async filterByStatus(status: 'pending' | 'reviewed' | 'dismissed' | 'actioned' | '') {
    await this.statusFilter.selectOption(status);
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Dismiss a report.
   */
  async dismissReport(id: number) {
    await this.getDismissButton(id).click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Mark a report as reviewed.
   */
  async reviewReport(id: number) {
    await this.getReviewButton(id).click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Action a report (hide content).
   */
  async actionReport(id: number) {
    await this.getActionButton(id).click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Open report details modal.
   */
  async openDetailsModal(id: number) {
    await this.getDetailsButton(id).click();
    await expect(this.detailModal).toBeVisible();
  }

  /**
   * Close the details modal.
   */
  async closeDetailsModal() {
    await this.modalCloseButton.click();
    await expect(this.detailModal).not.toBeVisible();
  }
}
