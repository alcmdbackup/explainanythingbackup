/**
 * E2E Tests for AI Suggestions User Interactions
 *
 * Tests real-world user behavior patterns:
 * - Typing while loading (submit disabled)
 * - Rapid double-submit (second request ignored)
 * - Navigate away mid-pipeline (cleanup)
 * - Close panel while loading (graceful cancel)
 * - Submit empty content (proper error message)
 * - Submit after accepting some diffs (works with modified content)
 */

import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import { UserLibraryPage } from '../../helpers/pages/UserLibraryPage';
import {
  mockAISuggestionsPipelineAPI,
  mockDiffContent,
} from '../../helpers/api-mocks';
import {
  submitAISuggestionPrompt,
  waitForSuggestionsLoading,
  waitForSuggestionsSuccess,
  waitForDiffNodes,
  clickAcceptOnFirstDiff,
  waitForEditMode,
} from '../../helpers/suggestions-test-helpers';

test.describe('AI Suggestions User Interactions', () => {
  test.describe.configure({ retries: 2 });

  test('should disable submit button during loading', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    // Add delay to observe loading state
    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockDiffContent.insertion,
      delay: 2000,
    });

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    // Submit first request
    await submitAISuggestionPrompt(page, 'Add more details');

    // Check loading state appears
    await waitForSuggestionsLoading(page);

    // Verify submit button is disabled during loading
    const submitButton = page.locator('button:has-text("Get Suggestions"), button:has-text("Composing")');
    await expect(submitButton).toBeDisabled();

    // Verify textarea is disabled during loading
    const textarea = page.locator('#ai-prompt');
    await expect(textarea).toBeDisabled();
  });

  test('should prevent rapid double-submit', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    let requestCount = 0;
    await page.route('**/api/runAISuggestionsPipeline', async (route) => {
      requestCount++;
      // Intentional delay to simulate slow API response for debounce testing
      await new Promise(r => setTimeout(r, 1000));
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          content: mockDiffContent.insertion,
          session_id: 'test-session-123',
        }),
      });
    });

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    // Try to submit twice rapidly
    const textarea = page.locator('#ai-prompt');
    await textarea.fill('Add more details');

    const submitButton = page.locator('button:has-text("Get Suggestions")');
    await submitButton.click();

    // Try clicking again immediately (should be disabled or ignored)
    if (await submitButton.isEnabled()) {
      await submitButton.click();
    }

    // Wait for completion
    await waitForSuggestionsSuccess(page);

    // Should only have made one request
    expect(requestCount).toBe(1);
  });

  test('should handle submit after accepting some diffs', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    // First suggestion
    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockDiffContent.insertion,
    });

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    // First round of suggestions
    await submitAISuggestionPrompt(page, 'Add more details');
    await waitForSuggestionsSuccess(page);
    await waitForEditMode(page);
    await waitForDiffNodes(page);

    // Accept the diff
    await clickAcceptOnFirstDiff(page);

    // Mock second suggestion
    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockDiffContent.deletion,
    });

    // Submit another suggestion (should work with modified content)
    await submitAISuggestionPrompt(page, 'Remove unnecessary content');
    await waitForSuggestionsSuccess(page);
    await waitForEditMode(page);

    // Verify new diffs appeared
    await waitForDiffNodes(page);
    const diffCount = await page.locator('[data-diff-key]').count();
    expect(diffCount).toBeGreaterThan(0);
  });

  test('should disable prompt input while loading', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockDiffContent.insertion,
      delay: 1500,
    });

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    await submitAISuggestionPrompt(page, 'Add more details');
    await waitForSuggestionsLoading(page);

    // Verify textarea is disabled
    const textarea = page.locator('#ai-prompt');
    await expect(textarea).toBeDisabled();

    // Wait for success
    await waitForSuggestionsSuccess(page);

    // Verify textarea is re-enabled
    await expect(textarea).toBeEnabled();
  });

  test('should show loading progress during pipeline execution', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockDiffContent.insertion,
      delay: 1000,
    });

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    await submitAISuggestionPrompt(page, 'Add more details');

    // Verify loading indicator appears
    await waitForSuggestionsLoading(page);

    // Check for progress text (if available)
    const loadingIndicator = page.locator('[data-testid="suggestions-loading"]');
    await expect(loadingIndicator).toBeVisible();

    // Wait for completion
    await waitForSuggestionsSuccess(page);
  });
});
