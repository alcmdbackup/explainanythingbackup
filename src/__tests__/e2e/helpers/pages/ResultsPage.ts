import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class ResultsPage extends BasePage {
  // Selectors
  private explanationTitle = '[data-testid="explanation-title"]';
  private explanationContent = '[data-testid="explanation-content"]';
  private streamCompleteIndicator = '[data-testid="stream-complete"]';
  private saveToLibraryButton = '[data-testid="save-to-library"]';
  private tagItem = '[data-testid="tag-item"]';
  private loadingIndicator = '[data-testid="loading-indicator"]';

  constructor(page: Page) {
    super(page);
  }

  async navigate(query?: string) {
    if (query) {
      await super.navigate(`/results?q=${encodeURIComponent(query)}`);
    } else {
      await super.navigate('/results');
    }
  }

  // Streaming state methods
  async waitForStreamingStart(timeout = 30000) {
    // Wait for title to appear (indicates streaming has started)
    await this.page.waitForSelector(this.explanationTitle, { timeout });
  }

  async waitForStreamingComplete(timeout = 60000) {
    // Wait for element to be attached (not visible, since it has hidden class)
    await this.page.waitForSelector(this.streamCompleteIndicator, { timeout, state: 'attached' });
  }

  async isStreamComplete() {
    // Check if element exists in DOM (not visible, since it has hidden class)
    return await this.page.locator(this.streamCompleteIndicator).count() > 0;
  }

  // Content methods
  async getTitle() {
    const element = this.page.locator(this.explanationTitle);
    await element.waitFor({ state: 'visible' });
    return await element.innerText();
  }

  async getContent() {
    const element = this.page.locator(this.explanationContent);
    await element.waitFor({ state: 'visible' });
    return await element.innerText();
  }

  async getContentLength() {
    const content = await this.getContent();
    return content.length;
  }

  async hasContent() {
    return await this.page.isVisible(this.explanationContent);
  }

  // Tag methods
  async getTags() {
    await this.page.waitForSelector(this.tagItem, { timeout: 10000 }).catch(() => null);
    const tags = this.page.locator(this.tagItem);
    const count = await tags.count();
    const tagTexts: string[] = [];
    for (let i = 0; i < count; i++) {
      tagTexts.push(await tags.nth(i).innerText());
    }
    return tagTexts;
  }

  async getTagCount() {
    await this.page.waitForSelector(this.tagItem, { timeout: 10000 }).catch(() => null);
    return await this.page.locator(this.tagItem).count();
  }

  async hasTags() {
    const count = await this.getTagCount();
    return count > 0;
  }

  // Save to library methods
  async clickSaveToLibrary() {
    await this.page.click(this.saveToLibraryButton);
  }

  async isSaveToLibraryEnabled() {
    return !(await this.page.isDisabled(this.saveToLibraryButton));
  }

  async isSaveToLibraryVisible() {
    return await this.page.isVisible(this.saveToLibraryButton);
  }

  // Loading state methods
  async isLoading() {
    return await this.page.isVisible(this.loadingIndicator).catch(() => false);
  }

  async waitForLoadingToFinish(timeout = 30000) {
    await this.page.waitForSelector(this.loadingIndicator, { state: 'hidden', timeout }).catch(() => null);
  }

  // URL parameter helpers
  async getQueryFromUrl() {
    const url = new URL(this.page.url());
    return url.searchParams.get('q') || '';
  }

  async getExplanationIdFromUrl() {
    const url = new URL(this.page.url());
    return url.searchParams.get('explanation_id') || '';
  }

  async hasExplanationIdInUrl() {
    const id = await this.getExplanationIdFromUrl();
    return id.length > 0;
  }

  // Wait for complete generation
  async waitForCompleteGeneration(timeout = 60000) {
    await this.waitForStreamingStart(timeout);
    await this.waitForStreamingComplete(timeout);
  }
}
