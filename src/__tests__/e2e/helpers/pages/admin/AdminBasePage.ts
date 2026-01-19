/**
 * Base page object for admin panel pages.
 * Provides common navigation and sidebar interactions.
 */

import { Page, Locator, expect } from '@playwright/test';

export class AdminBasePage {
  readonly page: Page;
  readonly sidebar: Locator;
  readonly navDashboard: Locator;
  readonly navContent: Locator;
  readonly navUsers: Locator;
  readonly navCosts: Locator;
  readonly navWhitelist: Locator;
  readonly navAudit: Locator;
  readonly navSettings: Locator;
  readonly navDevTools: Locator;
  readonly backToApp: Locator;

  constructor(page: Page) {
    this.page = page;
    this.sidebar = page.locator('aside');
    this.navDashboard = page.getByTestId('admin-sidebar-nav-dashboard');
    this.navContent = page.getByTestId('admin-sidebar-nav-content');
    this.navUsers = page.getByTestId('admin-sidebar-nav-users');
    this.navCosts = page.getByTestId('admin-sidebar-nav-costs');
    this.navWhitelist = page.getByTestId('admin-sidebar-nav-whitelist');
    this.navAudit = page.getByTestId('admin-sidebar-nav-audit');
    this.navSettings = page.getByTestId('admin-sidebar-nav-settings');
    this.navDevTools = page.getByTestId('admin-sidebar-nav-dev-tools');
    this.backToApp = page.getByTestId('admin-sidebar-back-to-app');
  }

  /**
   * Navigate to the admin dashboard.
   */
  async goto() {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3008';
    await this.page.goto(`${baseUrl}/admin`);
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Verify the admin dashboard has loaded successfully.
   */
  async expectDashboardLoaded() {
    await expect(this.sidebar).toBeVisible();
    await expect(this.navDashboard).toBeVisible();
    await expect(this.page.getByText('Admin Dashboard')).toBeVisible();
  }

  /**
   * Navigate to the Content page.
   */
  async goToContent() {
    await this.navContent.click();
    await this.page.waitForURL('**/admin/content');
  }

  /**
   * Navigate to the Users page.
   */
  async goToUsers() {
    await this.navUsers.click();
    await this.page.waitForURL('**/admin/users');
  }

  /**
   * Navigate to the Costs page.
   */
  async goToCosts() {
    await this.navCosts.click();
    await this.page.waitForURL('**/admin/costs');
  }

  /**
   * Navigate to the Whitelist page.
   */
  async goToWhitelist() {
    await this.navWhitelist.click();
    await this.page.waitForURL('**/admin/whitelist');
  }

  /**
   * Navigate to the Audit page.
   */
  async goToAudit() {
    await this.navAudit.click();
    await this.page.waitForURL('**/admin/audit');
  }

  /**
   * Navigate to the Settings page.
   */
  async goToSettings() {
    await this.navSettings.click();
    await this.page.waitForURL('**/admin/settings');
  }

  /**
   * Navigate back to the main app.
   */
  async goBackToApp() {
    await this.backToApp.click();
    await this.page.waitForURL('**/');
  }
}
