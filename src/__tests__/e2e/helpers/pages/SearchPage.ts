import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class SearchPage extends BasePage {
  private searchInput = '[data-testid="search-input"]';
  private searchButton = '[data-testid="search-submit"]';

  constructor(page: Page) {
    super(page);
  }

  async navigate() {
    await this.page.goto('/');
    // Wait for DOM content instead of networkidle (which can hang in CI)
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.locator(this.searchInput).waitFor({ state: 'visible' });

    // Wait for Next.js/React hydration to complete
    // React attaches __reactFiber properties to DOM elements after hydration
    await this.page.waitForFunction(
      (selector) => {
        const input = document.querySelector(selector);
        if (!input) return false;
        return Object.keys(input).some((key) => key.startsWith('__react'));
      },
      this.searchInput,
      { timeout: 10000 }
    );
  }

  async search(query: string) {
    // Wait for React hydration before interacting
    const input = this.page.locator(this.searchInput);
    await input.waitFor({ state: 'visible' });
    await input.click();
    await input.fill(query);

    const button = this.page.locator(this.searchButton);
    await button.waitFor({ state: 'visible' });
    await button.click();
  }

  async fillQuery(query: string) {
    // Wait for React hydration before interacting
    const input = this.page.locator(this.searchInput);
    await input.waitFor({ state: 'visible' });
    await input.click();
    await input.fill(query);
  }

  async clickSearch() {
    // Check if submit button exists (home variant has it, nav variant doesn't)
    const button = this.page.locator(this.searchButton);
    const buttonExists = await button.isVisible().catch(() => false);
    if (buttonExists) {
      await button.click();
    } else {
      // Nav variant uses Enter key to submit
      await this.page.locator(this.searchInput).press('Enter');
    }
  }

  async getQueryValue() {
    return await this.page.inputValue(this.searchInput);
  }

  async isSearchButtonEnabled() {
    return !(await this.page.isDisabled(this.searchButton));
  }

  async isSearchButtonDisabled() {
    return await this.page.isDisabled(this.searchButton);
  }
}
