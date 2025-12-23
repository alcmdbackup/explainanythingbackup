import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for Import Articles feature
 * Handles both ImportModal and ImportPreview components
 */
export class ImportPage extends BasePage {
    // ImportModal selectors
    private importButton = '[data-testid="import-button"]';
    private contentTextarea = '[data-testid="import-content"]';
    private sourceSelect = '[data-testid="import-source"]';
    private processButton = '[data-testid="import-process-btn"]';
    private cancelButton = '[data-testid="import-cancel-btn"]';
    private importError = '[data-testid="import-error"]';
    private detectingIndicator = '[data-testid="import-detecting"]';

    // ImportPreview selectors
    private previewTitle = '[data-testid="preview-title"]';
    private previewContent = '[data-testid="preview-content"]';
    private previewSource = '[data-testid="preview-source"]';
    private publishButton = '[data-testid="publish-btn"]';
    private backButton = '[data-testid="back-btn"]';
    private previewError = '[data-testid="preview-error"]';
    private previewSuccess = '[data-testid="preview-success"]';

    constructor(page: Page) {
        super(page);
    }

    /**
     * Opens the import modal by clicking the import button in nav
     */
    async openModal() {
        await this.page.locator(this.importButton).waitFor({ state: 'visible' });
        await this.page.locator(this.importButton).click();
        // Wait for modal to appear
        await this.page.locator(this.contentTextarea).waitFor({ state: 'visible' });
    }

    /**
     * Pastes content into the textarea
     */
    async pasteContent(text: string) {
        const textarea = this.page.locator(this.contentTextarea);
        await textarea.waitFor({ state: 'visible' });
        await textarea.fill(text);
    }

    /**
     * Selects a source from the dropdown
     */
    async selectSource(source: 'chatgpt' | 'claude' | 'gemini' | 'other') {
        const select = this.page.locator(this.sourceSelect);
        await select.click();
        await this.page.locator(`[data-value="${source}"]`).click();
    }

    /**
     * Gets the currently selected source text
     */
    async getSelectedSource(): Promise<string | null> {
        return this.page.locator(this.sourceSelect).textContent();
    }

    /**
     * Clicks the Process button
     */
    async clickProcess() {
        await this.page.locator(this.processButton).click();
    }

    /**
     * Clicks the Cancel button
     */
    async clickCancel() {
        await this.page.locator(this.cancelButton).click();
    }

    /**
     * Clicks the Publish button
     */
    async clickPublish() {
        await this.page.locator(this.publishButton).click();
    }

    /**
     * Clicks the Back button
     */
    async clickBack() {
        await this.page.locator(this.backButton).click();
    }

    /**
     * Gets the error message from import modal
     */
    async getImportError(): Promise<string | null> {
        const error = this.page.locator(this.importError);
        if (await error.isVisible()) {
            return error.textContent();
        }
        return null;
    }

    /**
     * Gets the error message from preview modal
     */
    async getPreviewError(): Promise<string | null> {
        const error = this.page.locator(this.previewError);
        if (await error.isVisible()) {
            return error.textContent();
        }
        return null;
    }

    /**
     * Checks if the detecting indicator is visible
     */
    async isDetecting(): Promise<boolean> {
        return this.page.locator(this.detectingIndicator).isVisible();
    }

    /**
     * Checks if processing is in progress (Process button shows "Processing...")
     */
    async isProcessing(): Promise<boolean> {
        const button = this.page.locator(this.processButton);
        const text = await button.textContent();
        return text?.includes('Processing') ?? false;
    }

    /**
     * Checks if publishing is in progress
     */
    async isPublishing(): Promise<boolean> {
        const button = this.page.locator(this.publishButton);
        const text = await button.textContent();
        return text?.includes('Publishing') ?? false;
    }

    /**
     * Checks if the Process button is disabled
     */
    async isProcessButtonDisabled(): Promise<boolean> {
        return this.page.locator(this.processButton).isDisabled();
    }

    /**
     * Gets the preview title
     */
    async getPreviewTitle(): Promise<string | null> {
        return this.page.locator(this.previewTitle).textContent();
    }

    /**
     * Gets the preview content text
     */
    async getPreviewContent(): Promise<string | null> {
        return this.page.locator(this.previewContent).textContent();
    }

    /**
     * Gets the source badge text from preview
     */
    async getPreviewSourceBadge(): Promise<string | null> {
        return this.page.locator(this.previewSource).textContent();
    }

    /**
     * Checks if the success message is visible
     */
    async isSuccessVisible(): Promise<boolean> {
        return this.page.locator(this.previewSuccess).isVisible();
    }

    /**
     * Waits for auto-detection to complete
     */
    async waitForDetectionComplete() {
        // Wait for detecting to appear then disappear
        await this.page.locator(this.detectingIndicator).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await this.page.locator(this.detectingIndicator).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }

    /**
     * Waits for the preview modal to appear
     */
    async waitForPreview() {
        await this.page.locator(this.previewTitle).waitFor({ state: 'visible', timeout: 30000 });
    }

    /**
     * Waits for publish success
     */
    async waitForPublishSuccess() {
        await this.page.locator(this.previewSuccess).waitFor({ state: 'visible', timeout: 30000 });
    }

    /**
     * Full import flow helper
     */
    async importContent(content: string, source?: 'chatgpt' | 'claude' | 'gemini' | 'other') {
        await this.openModal();
        await this.pasteContent(content);

        if (content.trim().length > 100) {
            await this.waitForDetectionComplete();
        }

        if (source) {
            await this.selectSource(source);
        }

        await this.clickProcess();
        await this.waitForPreview();
        await this.clickPublish();
        await this.waitForPublishSuccess();
    }
}
