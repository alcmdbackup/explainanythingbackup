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
    await this.page.fill(this.searchInput, query);
    await this.page.click(this.searchButton);
  }

  async fillQuery(query: string) {
    await this.page.fill(this.searchInput, query);
  }

  async clickSearch() {
    await this.page.click(this.searchButton);
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
