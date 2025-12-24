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
  private formatToggleButton = '[data-testid="format-toggle-button"]';
  private editButton = '[data-testid="edit-button"]';
  private publishButton = '[data-testid="publish-button"]';
  private modeSelect = '[data-testid="mode-select"]';

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
      // Wait for diff count to actually change
      const previousCount = count;
      await this.page.waitForFunction(
        (prev) => document.querySelectorAll('[data-diff-key]').length < prev,
        previousCount,
        { timeout: 5000 }
      ).catch(() => {});
      count = await this.getDiffCount();
    }
  }

  async rejectAllDiffs() {
    let count = await this.getDiffCount();
    while (count > 0) {
      await this.rejectDiff(0);
      // Wait for diff count to actually change
      const previousCount = count;
      await this.page.waitForFunction(
        (prev) => document.querySelectorAll('[data-diff-key]').length < prev,
        previousCount,
        { timeout: 5000 }
      ).catch(() => {});
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

  // Format toggle methods
  async clickFormatToggle() {
    await this.page.click(this.formatToggleButton);
  }

  async isFormatToggleVisible(): Promise<boolean> {
    return await this.page.isVisible(this.formatToggleButton);
  }

  async getFormatToggleText(): Promise<string> {
    const button = this.page.locator(this.formatToggleButton);
    return await button.innerText();
  }

  async isMarkdownMode(): Promise<boolean> {
    const text = await this.getFormatToggleText();
    return text === 'Plain Text'; // Shows "Plain Text" when in markdown mode
  }

  async isPlainTextMode(): Promise<boolean> {
    const text = await this.getFormatToggleText();
    return text === 'Formatted'; // Shows "Formatted" when in plain text mode
  }

  // Edit mode methods
  async clickEditButton() {
    await this.page.click(this.editButton);
  }

  async isEditButtonVisible(): Promise<boolean> {
    return await this.page.isVisible(this.editButton);
  }

  async getEditButtonText(): Promise<string> {
    const button = this.page.locator(this.editButton);
    return await button.innerText();
  }

  async isInEditMode(): Promise<boolean> {
    const text = await this.getEditButtonText();
    return text === 'Done'; // Shows "Done" when in edit mode
  }

  // Publish button methods
  async clickPublishButton() {
    await this.page.click(this.publishButton);
  }

  async isPublishButtonVisible(): Promise<boolean> {
    return await this.page.isVisible(this.publishButton);
  }

  async isPublishButtonEnabled(): Promise<boolean> {
    const button = this.page.locator(this.publishButton);
    if (!(await button.isVisible())) return false;
    return !(await button.isDisabled());
  }

  async getPublishButtonText(): Promise<string> {
    const button = this.page.locator(this.publishButton);
    return await button.innerText();
  }

  // Mode dropdown methods
  async selectMode(mode: 'Normal' | 'Skip Match' | 'Force Match') {
    await this.page.selectOption(this.modeSelect, { label: mode });
  }

  async getSelectedMode(): Promise<string> {
    const select = this.page.locator(this.modeSelect);
    return await select.inputValue();
  }

  async isModeSelectVisible(): Promise<boolean> {
    return await this.page.isVisible(this.modeSelect);
  }

  async isModeSelectEnabled(): Promise<boolean> {
    const select = this.page.locator(this.modeSelect);
    if (!(await select.isVisible())) return false;
    return !(await select.isDisabled());
  }

  // Save button text getter
  async getSaveButtonText(): Promise<string> {
    const button = this.page.locator(this.saveToLibraryButton);
    return await button.innerText();
  }

  // Wait for save to complete
  async waitForSaveComplete(timeout = 10000) {
    // Wait for button text to change to "Saved ✓"
    await this.page.waitForFunction(
      (selector) => {
        const button = document.querySelector(selector);
        return button?.textContent?.includes('Saved');
      },
      this.saveToLibraryButton,
      { timeout }
    );
  }

  // Tag addition methods
  async clickAddTagTrigger() {
    await this.page.click('[data-testid="add-tag-trigger"]');
  }

  async isAddTagInputVisible(): Promise<boolean> {
    return await this.page.isVisible('[data-testid="tag-add-input"]');
  }

  async isTagDropdownVisible(): Promise<boolean> {
    return await this.page.isVisible('[data-testid="tag-dropdown"]');
  }

  async getTagDropdownOptions(): Promise<string[]> {
    const options = this.page.locator('[data-testid="tag-dropdown-option"]');
    const count = await options.count();
    const texts: string[] = [];
    for (let i = 0; i < count; i++) {
      texts.push(await options.nth(i).innerText());
    }
    return texts;
  }

  async filterTagDropdown(text: string) {
    await this.page.fill('[data-testid="tag-add-input"]', text);
  }

  async selectTagFromDropdown(index: number) {
    await this.page.locator('[data-testid="tag-dropdown-option"]').nth(index).click();
  }

  async clickCancelAddTag() {
    await this.page.click('[data-testid="tag-cancel-button"]');
  }

  // Changes panel methods
  async clickChangesPanelToggle() {
    await this.page.click('[data-testid="changes-panel-toggle"]');
  }

  async isChangesPanelVisible(): Promise<boolean> {
    return await this.page.isVisible('[data-testid="changes-panel"]');
  }

  async getAddedTags(): Promise<string[]> {
    const items = this.page.locator('[data-testid="change-added"]');
    const count = await items.count();
    const texts: string[] = [];
    for (let i = 0; i < count; i++) {
      texts.push(await items.nth(i).innerText());
    }
    return texts;
  }

  async getRemovedTags(): Promise<string[]> {
    const items = this.page.locator('[data-testid="change-removed"]');
    const count = await items.count();
    const texts: string[] = [];
    for (let i = 0; i < count; i++) {
      texts.push(await items.nth(i).innerText());
    }
    return texts;
  }

  async getSwitchedTags(): Promise<string[]> {
    const items = this.page.locator('[data-testid="change-switched"]');
    const count = await items.count();
    const texts: string[] = [];
    for (let i = 0; i < count; i++) {
      texts.push(await items.nth(i).innerText());
    }
    return texts;
  }
}
