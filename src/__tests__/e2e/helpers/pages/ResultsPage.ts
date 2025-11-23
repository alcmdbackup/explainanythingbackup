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
  private tagAddInput = '[data-testid="tag-add-input"]';
  private tagAddButton = '[data-testid="tag-add-button"]';
  private tagApplyButton = '[data-testid="tag-apply-button"]';
  private tagResetButton = '[data-testid="tag-reset-button"]';
  private errorMessage = '[data-testid="error-message"]';
  private rewriteButton = '[data-testid="rewrite-button"]';
  private rewriteDropdownToggle = '[data-testid="rewrite-dropdown-toggle"]';
  private rewriteWithTags = '[data-testid="rewrite-with-tags"]';
  private editWithTags = '[data-testid="edit-with-tags"]';

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

  // Tag management methods
  async addTag(tagName: string) {
    // Click on the add tag input field
    await this.page.fill(this.tagAddInput, tagName);
    await this.page.click(this.tagAddButton);
  }

  async removeTag(index: number) {
    await this.page.click(`[data-testid="tag-remove-${index}"]`);
  }

  async clickApplyTags() {
    await this.page.click(this.tagApplyButton);
  }

  async clickResetTags() {
    await this.page.click(this.tagResetButton);
  }

  async isApplyButtonEnabled() {
    return !(await this.page.isDisabled(this.tagApplyButton));
  }

  async isApplyButtonVisible() {
    return await this.page.isVisible(this.tagApplyButton);
  }

  async isResetButtonVisible() {
    return await this.page.isVisible(this.tagResetButton);
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

  // Wait for existing explanation to load (not streaming, just DB fetch)
  async waitForExplanationToLoad(timeout = 60000) {
    // Wait for either title or content to appear (whichever comes first)
    await Promise.race([
      this.page.waitForSelector(this.explanationTitle, { timeout, state: 'visible' }),
      this.page.waitForSelector(this.explanationContent, { timeout, state: 'visible' }),
    ]);
  }

  // Wait for any content to render (handles both streaming and DB load scenarios)
  async waitForAnyContent(timeout = 60000) {
    // Wait directly for title OR content to be visible
    // This is more robust than checking loading indicator first, since the title
    // only renders when BOTH the data is loaded AND isPageLoading is false in React state
    await Promise.race([
      this.page.waitForSelector(this.explanationTitle, { timeout, state: 'visible' }),
      this.page.waitForSelector(this.explanationContent, { timeout, state: 'visible' }),
    ]).catch(async (error) => {
      // If page was closed, just re-throw the original error
      if (error.message?.includes('closed') || error.message?.includes('Target')) {
        throw error;
      }
      // If neither appears, check if there's an error state or empty state
      try {
        const hasError = await this.page.locator('.bg-red-100').count() > 0;
        if (hasError) {
          throw new Error('Page loaded with error state instead of content');
        }
      } catch {
        // Page might be closed, just throw timeout error
      }
      throw new Error('Timeout waiting for explanation content to appear');
    });
  }

  // Error handling methods
  async getErrorMessage(): Promise<string | null> {
    const errorElement = this.page.locator(this.errorMessage);
    if (await errorElement.isVisible()) {
      return await errorElement.innerText();
    }
    return null;
  }

  async waitForError(timeout = 30000) {
    await this.page.waitForSelector(this.errorMessage, { timeout, state: 'visible' });
  }

  async isErrorVisible(): Promise<boolean> {
    return await this.page.isVisible(this.errorMessage);
  }

  // Rewrite/Regeneration methods
  async clickRewriteButton() {
    await this.page.click(this.rewriteButton);
  }

  async isRewriteButtonVisible(): Promise<boolean> {
    return await this.page.isVisible(this.rewriteButton);
  }

  async isRewriteButtonEnabled(): Promise<boolean> {
    const button = this.page.locator(this.rewriteButton);
    if (!(await button.isVisible())) return false;
    return !(await button.isDisabled());
  }

  async openRewriteDropdown() {
    await this.page.click(this.rewriteDropdownToggle);
  }

  async isRewriteDropdownVisible(): Promise<boolean> {
    return await this.page.isVisible(this.rewriteWithTags);
  }

  async clickRewriteWithTags() {
    await this.page.click(this.rewriteWithTags);
  }

  async clickEditWithTags() {
    await this.page.click(this.editWithTags);
  }
}
