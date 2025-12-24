import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class UserLibraryPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async navigate() {
    await this.page.goto('/userlibrary');
  }

  async waitForLoading() {
    await this.page.locator('[data-testid="library-loading"]').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
      // Loading may be too fast to catch
    });
  }

  async waitForLoadingToFinish() {
    await this.page.locator('[data-testid="library-loading"]').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {
      // Loading may already be done
    });
  }

  async waitForContentOrError(timeout: number = 30000) {
    // Wait for either the table, error, or empty state to appear
    await Promise.race([
      this.page.locator('table').waitFor({ state: 'visible', timeout }),
      this.page.locator('[data-testid="library-error"]').waitFor({ state: 'visible', timeout }),
      this.page.locator('[data-testid="library-empty-state"]').waitFor({ state: 'visible', timeout }),
      this.page.locator('main h1').waitFor({ state: 'visible', timeout }),
    ]).catch(() => {
      // Timeout - page might still be loading
    });
  }

  async isLoading() {
    return await this.page.locator('[data-testid="library-loading"]').isVisible();
  }

  async getExplanationCount() {
    return await this.page.locator('[data-testid="explanation-row"]').count();
  }

  async getExplanationTitles() {
    const titles = await this.page.locator('[data-testid="explanation-title"]').allTextContents();
    return titles;
  }

  async getExplanationByIndex(index: number) {
    const rows = this.page.locator('[data-testid="explanation-row"]');
    const row = rows.nth(index);
    const title = await row.locator('[data-testid="explanation-title"]').textContent();
    const saveDate = await row.locator('[data-testid="save-date"]').textContent().catch(() => null);
    return { title, saveDate };
  }

  async clickViewByIndex(index: number) {
    const rows = this.page.locator('[data-testid="explanation-row"]');
    const row = rows.nth(index);
    await row.locator('a:has-text("View")').click();
  }

  async clickViewByTitle(title: string) {
    const row = this.page.locator('[data-testid="explanation-row"]').filter({ hasText: title });
    await row.locator('a:has-text("View")').click();
  }

  async isEmptyState() {
    const count = await this.getExplanationCount();
    return count === 0;
  }

  async hasError() {
    return await this.page.locator('[data-testid="library-error"]').isVisible();
  }

  async getErrorMessage() {
    return await this.page.locator('[data-testid="library-error"]').textContent();
  }

  async clickSortByTitle() {
    await this.page.locator('th:has-text("Title")').click();
  }

  async clickSortByDate() {
    await this.page.locator('th:has-text("Created")').click();
  }

  async getSortIndicator() {
    const titleHeader = this.page.locator('th:has-text("Title")');
    const dateHeader = this.page.locator('th:has-text("Created")');

    const titleHasAscending = await titleHeader.locator('svg.w-4.h-4').isVisible().catch(() => false);
    const dateHasAscending = await dateHeader.locator('svg.w-4.h-4').isVisible().catch(() => false);

    if (titleHasAscending) {
      return { column: 'title', ascending: await titleHeader.locator('svg').evaluate(el => el.classList.contains('inline')) };
    }
    if (dateHasAscending) {
      return { column: 'date', ascending: await dateHeader.locator('svg').evaluate(el => el.classList.contains('inline')) };
    }
    return null;
  }

  async getPageTitle() {
    // Get the main content h1, not the navigation h1
    return await this.page.locator('main h1').textContent();
  }

  async hasSearchBar() {
    return await this.page.locator('[data-testid="search-input"]').isVisible();
  }

  async searchFromLibrary(query: string) {
    await this.page.locator('[data-testid="search-input"]').fill(query);
    await this.page.locator('[data-testid="search-input"]').press('Enter');
  }

  async waitForTableToLoad(timeout: number = 30000): Promise<boolean> {
    await this.waitForContentOrError(timeout);
    const count = await this.getExplanationCount();
    return count > 0;
  }

  async clickViewOnRow(index: number) {
    await this.clickViewByIndex(index);
  }

  /**
   * Wait for library page to be in a stable state.
   * Returns the state type so callers can handle appropriately.
   */
  async waitForLibraryReady(timeout = 30000): Promise<'loaded' | 'empty' | 'error'> {
    const table = this.page.locator('table');
    const emptyState = this.page.locator('[data-testid="library-empty-state"]');
    const error = this.page.locator('[data-testid="library-error"]');

    const result = await Promise.race([
      table.waitFor({ state: 'visible', timeout }).then(() => 'loaded' as const),
      emptyState.waitFor({ state: 'visible', timeout }).then(() => 'empty' as const),
      error.waitFor({ state: 'visible', timeout }).then(() => 'error' as const),
    ]);

    return result;
  }
}
