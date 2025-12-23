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

  // AI Suggestions Panel selectors
  private aiSuggestionsPanel = '[data-testid="ai-suggestions-panel"]';
  private aiPromptInput = '#ai-prompt';
  private getSuggestionsButton = 'button:has-text("Get Suggestions")';
  private suggestionsLoading = 'button:has-text("Composing...")';
  private suggestionsSuccess = '[data-testid="suggestions-success"]';
  private suggestionsError = '[data-testid="suggestions-error"]';

  // Diff node selectors
  private diffNodes = '[data-diff-key]';
  private insertionNodes = '[data-diff-type="ins"]';
  private deletionNodes = '[data-diff-type="del"]';
  private acceptButton = '.diff-accept-btn';
  private rejectButton = '.diff-reject-btn';

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
    try {
      // Wait briefly for element to be stable before reading text
      // This prevents race conditions between visibility check and text extraction
      await errorElement.waitFor({ state: 'visible', timeout: 2000 });
      return await errorElement.innerText();
    } catch {
      return null;
    }
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

  // ============= AI Suggestions Panel Methods =============

  async isAISuggestionsPanelVisible(): Promise<boolean> {
    return await this.page.isVisible(this.aiSuggestionsPanel);
  }

  async submitAISuggestion(prompt: string) {
    await this.page.fill(this.aiPromptInput, prompt);
    await this.page.click(this.getSuggestionsButton);
  }

  async waitForSuggestionsLoading(timeout = 5000) {
    await this.page.waitForSelector(this.suggestionsLoading, { timeout, state: 'visible' });
  }

  async waitForSuggestionsComplete(timeout = 30000) {
    await this.page.waitForSelector(this.suggestionsSuccess, { timeout, state: 'visible' });
  }

  async waitForSuggestionsError(timeout = 10000) {
    await this.page.waitForSelector(this.suggestionsError, { timeout, state: 'visible' });
  }

  async getSuggestionsErrorText(): Promise<string | null> {
    try {
      const errorElement = this.page.locator(this.suggestionsError);
      await errorElement.waitFor({ state: 'visible', timeout: 2000 });
      return await errorElement.innerText();
    } catch {
      return null;
    }
  }

  // ============= Diff Interaction Methods =============

  async getDiffCount(): Promise<number> {
    return await this.page.locator(this.diffNodes).count();
  }

  async getInsertionCount(): Promise<number> {
    return await this.page.locator(this.insertionNodes).count();
  }

  async getDeletionCount(): Promise<number> {
    return await this.page.locator(this.deletionNodes).count();
  }

  async acceptDiff(index: number = 0) {
    const diff = this.page.locator(this.diffNodes).nth(index);
    await diff.hover();
    await diff.locator(this.acceptButton).click();
  }

  async rejectDiff(index: number = 0) {
    const diff = this.page.locator(this.diffNodes).nth(index);
    await diff.hover();
    await diff.locator(this.rejectButton).click();
  }

  async acceptAllDiffs() {
    let count = await this.getDiffCount();
    while (count > 0) {
      await this.acceptDiff(0);
      // Small delay for DOM to update
      await this.page.waitForTimeout(100);
      count = await this.getDiffCount();
    }
  }

  async rejectAllDiffs() {
    let count = await this.getDiffCount();
    while (count > 0) {
      await this.rejectDiff(0);
      // Small delay for DOM to update
      await this.page.waitForTimeout(100);
      count = await this.getDiffCount();
    }
  }

  async getDiffText(index: number = 0): Promise<string> {
    return await this.page.locator(this.diffNodes).nth(index).innerText();
  }

  async isDiffAcceptButtonVisible(index: number = 0): Promise<boolean> {
    const diff = this.page.locator(this.diffNodes).nth(index);
    await diff.hover();
    return await diff.locator(this.acceptButton).isVisible();
  }

  async isDiffRejectButtonVisible(index: number = 0): Promise<boolean> {
    const diff = this.page.locator(this.diffNodes).nth(index);
    await diff.hover();
    return await diff.locator(this.rejectButton).isVisible();
  }
}
