import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class SearchPage extends BasePage {
  private searchInput = '[data-testid="search-input"]';
  private searchButton = '[data-testid="search-submit"]';

  constructor(page: Page) {
    super(page);
  }

  async navigate() {
    await super.navigate('/');
  }

  async search(query: string) {
    // Clear and type to properly trigger React state updates
    await this.page.click(this.searchInput);
    await this.page.fill(this.searchInput, '');
    await this.page.type(this.searchInput, query);
    await this.page.click(this.searchButton);
  }

  async fillQuery(query: string) {
    // Clear and type to properly trigger React state updates
    await this.page.click(this.searchInput);
    await this.page.fill(this.searchInput, '');
    if (query) {
      await this.page.type(this.searchInput, query);
    }
  }

  async clickSearch() {
    // Check if submit button exists (home variant has it, nav variant doesn't)
    const buttonExists = await this.page.locator(this.searchButton).isVisible().catch(() => false);
    if (buttonExists) {
      await this.page.click(this.searchButton);
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
