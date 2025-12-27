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
  private rewriteWithFeedback = '[data-testid="rewrite-with-feedback"]';
  private editWithFeedback = '[data-testid="edit-with-feedback"]';
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
    await this.page.locator(this.explanationTitle).waitFor({ state: 'visible', timeout });
  }

  async waitForStreamingComplete(timeout = 60000) {
    // Wait for URL redirect first - this happens after streaming completes
    // The redirect is the reliable signal (stream-complete indicator may race with router.push)
    await this.page.waitForURL(/\/results\?.*explanation_id=/, { timeout });

    // Wait for page to fully load after redirect
    // The data-user-saved-loaded attribute is set when loadExplanation completes
    try {
      await this.page.waitForSelector('[data-testid="save-to-library"][data-user-saved-loaded="true"]', {
        timeout: 30000
      });
    } catch {
      // Fallback: wait for title or content to appear
      await Promise.race([
        this.page.locator(this.explanationTitle).waitFor({ state: 'visible', timeout: 10000 }),
        this.page.locator(this.explanationContent).waitFor({ state: 'visible', timeout: 10000 }),
      ]).catch(() => {
        // If both fail, just wait a bit and continue
      });
      await this.page.waitForTimeout(1000);
    }

    // Optionally verify stream-complete indicator is attached (should be present after redirect)
    try {
      await this.page.locator(this.streamCompleteIndicator).waitFor({ state: 'attached', timeout: 5000 });
    } catch {
      // Indicator might not be present on page reload - URL is the authoritative signal
    }
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
    // Wait for tags to appear, return empty array if none exist
    try {
      await this.page.locator(this.tagItem).first().waitFor({ state: 'visible', timeout: 10000 });
    } catch {
      // No tags visible - return empty array
      return [];
    }
    const tags = this.page.locator(this.tagItem);
    const count = await tags.count();
    const tagTexts: string[] = [];
    for (let i = 0; i < count; i++) {
      tagTexts.push(await tags.nth(i).innerText());
    }
    return tagTexts;
  }

  async getTagCount() {
    // Wait for tags to appear, return 0 if none exist
    try {
      await this.page.locator(this.tagItem).first().waitFor({ state: 'visible', timeout: 10000 });
    } catch {
      // No tags visible
      return 0;
    }
    return await this.page.locator(this.tagItem).count();
  }

  async hasTags() {
    const count = await this.getTagCount();
    return count > 0;
  }

  // Tag management methods
  async addTag(tagName: string) {
    const input = this.page.locator(this.tagAddInput);
    await input.waitFor({ state: 'visible' });

    // Clear and fill with verification to handle React controlled input race conditions
    await input.clear();
    await input.fill(tagName);
    await input.blur();

    // Verify value stuck (React controlled input race condition)
    const value = await input.inputValue();
    if (value !== tagName) {
      await input.click();
      await input.pressSequentially(tagName, { delay: 50 });
    }

    await this.page.locator(this.tagAddButton).click();
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
    await this.page.locator(this.loadingIndicator).waitFor({ state: 'hidden', timeout }).catch(() => null);
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
      this.page.locator(this.explanationTitle).waitFor({ state: 'visible', timeout }),
      this.page.locator(this.explanationContent).waitFor({ state: 'visible', timeout }),
    ]);
  }

  // Wait for any content to render (handles both streaming and DB load scenarios)
  async waitForAnyContent(timeout = 60000) {
    // Wait directly for title OR content to be visible
    // This is more robust than checking loading indicator first, since the title
    // only renders when BOTH the data is loaded AND isPageLoading is false in React state
    await Promise.race([
      this.page.locator(this.explanationTitle).waitFor({ state: 'visible', timeout }),
      this.page.locator(this.explanationContent).waitFor({ state: 'visible', timeout }),
    ]).catch(async (error) => {
      // If page was closed, just re-throw the original error
      if (error.message?.includes('closed') || error.message?.includes('Target')) {
        throw error;
      }
      // If neither appears, check if there's an error state or empty state
      try {
        const hasError = await this.page.locator('[data-testid="error-message"]').count() > 0;
        if (hasError) {
          throw new Error('Page loaded with error state instead of content');
        }
      } catch {
        // Page might be closed, just throw timeout error
      }
      throw new Error('Timeout waiting for explanation content to appear');
    });
  }

  // Wait for lifecycle phase to be 'viewing' (state machine ready for edit mode)
  async waitForViewingPhase(timeout = 30000) {
    await this.page.waitForSelector('[data-lifecycle-phase="viewing"]', { timeout });
  }

  // Wait for userSaved state to be determined (async check completes)
  async waitForUserSavedState(timeout = 30000) {
    await this.page.waitForSelector('[data-testid="save-to-library"][data-user-saved-loaded="true"]', { timeout });
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
    await this.page.locator(this.errorMessage).waitFor({ state: 'visible', timeout });
  }

  async isErrorVisible(): Promise<boolean> {
    return await this.page.isVisible(this.errorMessage);
  }

  // Rewrite/Regeneration methods
  async clickRewriteButton() {
    const button = this.page.locator(this.rewriteButton);
    await button.waitFor({ state: 'visible' });
    await button.click();
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
    const button = this.page.locator(this.rewriteDropdownToggle);
    await button.waitFor({ state: 'visible' });
    await button.click();
  }

  async isRewriteDropdownVisible(): Promise<boolean> {
    return await this.page.isVisible(this.rewriteWithFeedback);
  }

  async clickRewriteWithFeedback() {
    const button = this.page.locator(this.rewriteWithFeedback);
    await button.waitFor({ state: 'visible' });
    await button.click();
  }

  async clickEditWithFeedback() {
    const button = this.page.locator(this.editWithFeedback);
    await button.waitFor({ state: 'visible' });
    await button.click();
  }

  // ============= AI Suggestions Panel Methods =============

  async isAISuggestionsPanelVisible(): Promise<boolean> {
    return await this.page.isVisible(this.aiSuggestionsPanel);
  }

  async submitAISuggestion(prompt: string) {
    const input = this.page.locator(this.aiPromptInput);
    await input.waitFor({ state: 'visible' });

    // Clear and fill with verification to handle React controlled input race conditions
    await input.clear();
    await input.fill(prompt);
    await input.blur();

    // Verify value stuck
    const value = await input.inputValue();
    if (value !== prompt) {
      await input.click();
      await input.pressSequentially(prompt, { delay: 50 });
    }

    const button = this.page.locator(this.getSuggestionsButton);
    await button.waitFor({ state: 'visible' });
    await button.click();
  }

  async waitForSuggestionsLoading(timeout = 5000) {
    await this.page.locator(this.suggestionsLoading).waitFor({ state: 'visible', timeout });
  }

  async waitForSuggestionsComplete(timeout = 30000) {
    await this.page.locator(this.suggestionsSuccess).waitFor({ state: 'visible', timeout });
  }

  async waitForSuggestionsError(timeout = 10000) {
    await this.page.locator(this.suggestionsError).waitFor({ state: 'visible', timeout });
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
    // Wait for button to appear after hover (CSS transition)
    const button = diff.locator(this.acceptButton);
    await button.waitFor({ state: 'visible', timeout: 5000 });
    await button.click();
  }

  async rejectDiff(index: number = 0) {
    const diff = this.page.locator(this.diffNodes).nth(index);
    await diff.hover();
    // Wait for button to appear after hover (CSS transition)
    const button = diff.locator(this.rejectButton);
    await button.waitFor({ state: 'visible', timeout: 5000 });
    await button.click();
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
    // Wait briefly for CSS transition after hover
    const button = diff.locator(this.acceptButton);
    try {
      await button.waitFor({ state: 'visible', timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  }

  async isDiffRejectButtonVisible(index: number = 0): Promise<boolean> {
    const diff = this.page.locator(this.diffNodes).nth(index);
    await diff.hover();
    // Wait briefly for CSS transition after hover
    const button = diff.locator(this.rejectButton);
    try {
      await button.waitFor({ state: 'visible', timeout: 2000 });
      return true;
    } catch {
      return false;
    }
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
    // Wait for element to be visible before clicking (it's conditionally rendered)
    await this.page.locator('[data-testid="add-tag-trigger"]').waitFor({ state: 'visible', timeout: 5000 });
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
    const input = this.page.locator('[data-testid="tag-add-input"]');
    await input.waitFor({ state: 'visible' });
    await input.clear();
    await input.fill(text);
    await input.blur();
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
