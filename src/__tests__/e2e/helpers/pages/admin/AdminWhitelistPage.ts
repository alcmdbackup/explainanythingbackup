/**
 * Page object for admin whitelist management page.
 * Provides locators and actions for whitelist table and modal.
 */

import { Page, Locator, expect } from '@playwright/test';
import { AdminBasePage } from './AdminBasePage';

export class AdminWhitelistPage extends AdminBasePage {
  // Tab elements
  readonly whitelistTab: Locator;
  readonly candidatesTab: Locator;

  // Table elements
  readonly addTermButton: Locator;
  readonly table: Locator;

  // Modal elements
  readonly modal: Locator;
  readonly modalCloseButton: Locator;
  readonly canonicalTermInput: Locator;
  readonly standaloneTitleInput: Locator;
  readonly descriptionInput: Locator;
  readonly isActiveCheckbox: Locator;
  readonly cancelButton: Locator;
  readonly submitButton: Locator;

  // Alias modal elements
  readonly aliasInput: Locator;
  readonly addAliasButton: Locator;
  readonly aliasList: Locator;
  readonly noAliasesMessage: Locator;
  readonly closeAliasesButton: Locator;

  constructor(page: Page) {
    super(page);

    // Tab elements
    this.whitelistTab = page.getByTestId('admin-whitelist-tab-whitelist');
    this.candidatesTab = page.getByTestId('admin-whitelist-tab-candidates');

    // Table elements
    this.addTermButton = page.getByTestId('admin-whitelist-add-term');
    this.table = page.getByTestId('admin-whitelist-table');

    // Modal elements
    this.modal = page.getByTestId('admin-whitelist-modal');
    this.modalCloseButton = page.getByTestId('admin-whitelist-modal-close');
    this.canonicalTermInput = page.getByTestId('admin-whitelist-canonical-term');
    this.standaloneTitleInput = page.getByTestId('admin-whitelist-standalone-title');
    this.descriptionInput = page.getByTestId('admin-whitelist-description');
    this.isActiveCheckbox = page.getByTestId('admin-whitelist-is-active');
    this.cancelButton = page.getByTestId('admin-whitelist-cancel');
    this.submitButton = page.getByTestId('admin-whitelist-submit');

    // Alias modal elements
    this.aliasInput = page.getByTestId('admin-whitelist-alias-input');
    this.addAliasButton = page.getByTestId('admin-whitelist-add-alias');
    this.aliasList = page.getByTestId('admin-whitelist-alias-list');
    this.noAliasesMessage = page.getByTestId('admin-whitelist-no-aliases');
    this.closeAliasesButton = page.getByTestId('admin-whitelist-close-aliases');
  }

  /**
   * Navigate to the whitelist page.
   */
  async gotoWhitelist() {
    await this.goto();
    await this.goToWhitelist();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Verify the whitelist page has loaded.
   */
  async expectWhitelistPageLoaded() {
    await expect(this.table).toBeVisible();
    await expect(this.addTermButton).toBeVisible();
  }

  /**
   * Get a row locator by term ID.
   */
  getRow(termId: number): Locator {
    return this.page.getByTestId(`admin-whitelist-row-${termId}`);
  }

  /**
   * Get edit button by term ID.
   */
  getEditButton(termId: number): Locator {
    return this.page.getByTestId(`admin-whitelist-edit-${termId}`);
  }

  /**
   * Get delete button by term ID.
   */
  getDeleteButton(termId: number): Locator {
    return this.page.getByTestId(`admin-whitelist-delete-${termId}`);
  }

  /**
   * Get aliases button by term ID.
   */
  getAliasesButton(termId: number): Locator {
    return this.page.getByTestId(`admin-whitelist-aliases-${termId}`);
  }

  /**
   * Open the create term modal.
   */
  async openCreateModal() {
    await this.addTermButton.click();
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
   * Fill and submit the term form.
   */
  async fillTermForm(data: {
    canonicalTerm: string;
    standaloneTitle: string;
    description?: string;
    isActive?: boolean;
  }) {
    await this.canonicalTermInput.fill(data.canonicalTerm);
    await this.standaloneTitleInput.fill(data.standaloneTitle);
    if (data.description) {
      await this.descriptionInput.fill(data.description);
    }
    if (data.isActive === false) {
      await this.isActiveCheckbox.uncheck();
    }
    await this.submitButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Open aliases modal for a term.
   */
  async openAliasesModal(termId: number) {
    await this.getAliasesButton(termId).click();
    await expect(this.modal).toBeVisible();
  }

  /**
   * Add an alias in the aliases modal.
   */
  async addAlias(alias: string) {
    await this.aliasInput.fill(alias);
    await this.addAliasButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Remove an alias by ID.
   */
  async removeAlias(aliasId: number) {
    await this.page.getByTestId(`admin-whitelist-remove-alias-${aliasId}`).click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Close the aliases modal.
   */
  async closeAliasesModal() {
    await this.closeAliasesButton.click();
    await expect(this.modal).not.toBeVisible();
  }

  /**
   * Switch to the candidates tab.
   */
  async switchToCandidates() {
    await this.candidatesTab.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Switch to the whitelist tab.
   */
  async switchToWhitelist() {
    await this.whitelistTab.click();
    await this.page.waitForLoadState('networkidle');
  }
}
