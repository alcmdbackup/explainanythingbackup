/**
 * E2E Page helper for the User Library page.
 * Updated to use FeedCard-based layout instead of table.
 */
import { Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { safeTextContent, safeIsVisible } from '../error-utils';

export class UserLibraryPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async navigate() {
    await this.page.goto('/userlibrary');
    await this.page.waitForLoadState('domcontentloaded');
  }

  /** Wait for FeedCard components to appear */
  async waitForCards(timeout = 30000): Promise<void> {
    await this.page.waitForSelector('[data-testid="feed-card"]', {
      state: 'attached',
      timeout,
    });
  }

  /** Get count of displayed cards */
  async getCardCount(): Promise<number> {
    return this.page.locator('[data-testid="feed-card"]').count();
  }

  /** Wait for library page to be ready (cards, empty, or error) */
  async waitForLibraryReady(timeout = 30000): Promise<'cards' | 'empty' | 'error'> {
    const result = await Promise.race([
      this.page.waitForSelector('[data-testid="feed-card"]', { timeout })
        .then(() => 'cards' as const),
      this.page.waitForSelector('[data-testid="library-empty-state"]', { timeout })
        .then(() => 'empty' as const),
      this.page.waitForSelector('[data-testid="library-error"]', { timeout })
        .then(() => 'error' as const),
    ]);
    return result;
  }

  /** Click on a card by index to navigate to results */
  async clickCardByIndex(index: number): Promise<void> {
    const cards = this.page.locator('[data-testid="feed-card"]');
    await cards.nth(index).click();
    // Wait for navigation to begin after card click
    await this.page.waitForURL(/\/results\?explanation_id=/, { timeout: 15000 });
  }

  /** Wait for content or error state - legacy compatibility wrapper */
  async waitForContentOrError(timeout: number = 30000): Promise<'cards' | 'error' | 'empty' | 'title' | 'timeout'> {
    try {
      const result = await Promise.race([
        this.page.locator('[data-testid="feed-card"]').waitFor({ state: 'visible', timeout }).then(() => 'cards' as const),
        this.page.locator('[data-testid="library-error"]').waitFor({ state: 'visible', timeout }).then(() => 'error' as const),
        this.page.locator('[data-testid="library-empty-state"]').waitFor({ state: 'visible', timeout }).then(() => 'empty' as const),
        this.page.locator('main h1').waitFor({ state: 'visible', timeout }).then(() => 'title' as const),
      ]);
      return result;
    } catch {
      return 'timeout';
    }
  }

  async getExplanationCount() {
    return await this.getCardCount();
  }

  async getExplanationTitles() {
    const cards = this.page.locator('[data-testid="feed-card"] h2');
    return await cards.allTextContents();
  }

  async getExplanationByIndex(index: number) {
    const cards = this.page.locator('[data-testid="feed-card"]');
    const card = cards.nth(index);
    const title = await card.locator('h2').textContent();
    const saveDate = await safeTextContent(
      card.locator('[data-testid="saved-date"]'),
      'UserLibraryPage.getExplanationByIndex (saveDate)'
    );
    return { title, saveDate };
  }

  async clickViewByIndex(index: number) {
    await this.clickCardByIndex(index);
  }

  async clickViewByTitle(title: string) {
    const card = this.page.locator('[data-testid="feed-card"]').filter({ hasText: title });
    await card.click();
    await this.page.waitForURL(/\/results\?explanation_id=/, { timeout: 15000 });
  }

  async isEmptyState() {
    return await safeIsVisible(
      this.page.locator('[data-testid="library-empty-state"]'),
      'UserLibraryPage.isEmptyState'
    );
  }

  async hasError() {
    return await this.page.locator('[data-testid="library-error"]').isVisible();
  }

  async getErrorMessage() {
    return await this.page.locator('[data-testid="library-error"]').textContent();
  }

  async getPageTitle() {
    return await this.page.getByRole('heading', { name: 'My Library' }).textContent();
  }

  async hasSearchBar() {
    return await this.page.locator('[data-testid="search-input"]').isVisible();
  }

  async searchFromLibrary(query: string) {
    const input = this.page.locator('[data-testid="search-input"]');
    await input.waitFor({ state: 'visible' });
    await input.clear();
    await input.fill(query);
    await input.blur();
    // Verify the input value took before submitting
    await expect(input).toHaveValue(query, { timeout: 3000 });
    await input.press('Enter');
    // Wait for navigation to results page
    await this.page.waitForURL(/\/results\?q=/, { timeout: 15000 });
  }

  async waitForTableToLoad(timeout: number = 30000): Promise<boolean> {
    await this.waitForContentOrError(timeout);
    const count = await this.getCardCount();
    return count > 0;
  }

  async clickViewOnRow(index: number) {
    await this.clickCardByIndex(index);
  }
}
