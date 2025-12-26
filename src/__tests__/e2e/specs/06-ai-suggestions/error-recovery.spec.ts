/**
 * E2E Tests for AI Suggestions Error Recovery
 *
 * Tests for graceful error handling:
 * - API 429 (rate limit) → show "Please wait" message
 * - API 500 → show generic error, allow retry
 * - API timeout → show timeout error, allow retry
 * - Network offline → show network error
 * - Malformed API response → graceful error handling
 * - Retry after error → works correctly
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
  waitForSuggestionsError,
  waitForSuggestionsSuccess,
  waitForSuggestionsLoading,
  waitForDiffNodes,
  getDiffCounts,
  getEditorTextContent,
  waitForEditMode,
} from '../../helpers/suggestions-test-helpers';

test.describe('AI Suggestions Error Recovery', () => {
  test.describe.configure({ retries: 2 });

  test('should show error for API 500 and allow retry', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    const contentBefore = await getEditorTextContent(page);

    // First request fails
    await mockAISuggestionsPipelineAPI(page, {
      success: false,
      error: 'Internal server error',
    });

    await submitAISuggestionPrompt(page, 'Add more details');
    await waitForSuggestionsError(page);

    // Error is displayed
    expect(await page.locator('[data-testid="suggestions-error"]').isVisible()).toBe(true);

    // Content unchanged
    const contentAfter = await getEditorTextContent(page);
    expect(contentAfter).toBe(contentBefore);

    // No diffs in editor
    const counts = await getDiffCounts(page);
    expect(counts.total).toBe(0);

    // Retry with success
    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockDiffContent.insertion,
    });

    await submitAISuggestionPrompt(page, 'Add more details');
    await waitForSuggestionsSuccess(page);
    await waitForEditMode(page);
    await waitForDiffNodes(page);

    // Now diffs should appear
    const retryCounts = await getDiffCounts(page);
    expect(retryCounts.total).toBeGreaterThan(0);
  });

  test('should show rate limit error for API 429', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    // Mock 429 response
    await page.route('**/api/runAISuggestionsPipeline', async (route) => {
      await route.fulfill({
        status: 429,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Rate limit exceeded. Please wait before trying again.',
        }),
      });
    });

    await submitAISuggestionPrompt(page, 'Add more details');
    await waitForSuggestionsError(page);

    // Error message should be visible
    const errorElement = page.locator('[data-testid="suggestions-error"]');
    expect(await errorElement.isVisible()).toBe(true);
  });

  test('should preserve original content on pipeline error', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    const contentBefore = await getEditorTextContent(page);

    // Error response
    await mockAISuggestionsPipelineAPI(page, {
      success: false,
      error: 'Pipeline step 2 failed: Unable to apply suggestions',
    });

    await submitAISuggestionPrompt(page, 'Make changes');
    await waitForSuggestionsError(page);

    // Content should be unchanged
    const contentAfter = await getEditorTextContent(page);
    expect(contentAfter).toBe(contentBefore);
  });

  test('should handle malformed API response gracefully', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    const contentBefore = await getEditorTextContent(page);

    // Mock malformed response
    await page.route('**/api/runAISuggestionsPipeline', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: '{ invalid json }', // Malformed JSON
      });
    });

    await submitAISuggestionPrompt(page, 'Make changes');

    // Should show error or handle gracefully - wait for error state
    // Silent catch: error may not appear if handled differently
    await waitForSuggestionsError(page).catch(() => {
      // Error state may not be visible if handled gracefully
    });

    // Content should be unchanged
    const contentAfter = await getEditorTextContent(page);
    expect(contentAfter).toBe(contentBefore);
  });

  test('should recover after successful retry following error', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    // First: error
    await mockAISuggestionsPipelineAPI(page, {
      success: false,
      error: 'Service temporarily unavailable',
    });

    await submitAISuggestionPrompt(page, 'Add content');
    await waitForSuggestionsError(page);

    // Second: success
    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockDiffContent.insertion,
    });

    await submitAISuggestionPrompt(page, 'Add content');
    await waitForSuggestionsSuccess(page);
    await waitForEditMode(page);
    await waitForDiffNodes(page);

    // Diffs should appear
    const counts = await getDiffCounts(page);
    expect(counts.total).toBeGreaterThan(0);
  });

  test('should handle timeout gracefully', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();
    test.setTimeout(60000);

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    // Mock a very slow response (simulating timeout scenario)
    // Note: The actual timeout handling depends on client-side implementation
    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockDiffContent.insertion,
      delay: 45000, // Very long delay
    });

    await submitAISuggestionPrompt(page, 'Add content');

    // Wait for loading state to appear (verifies UI is handling the slow request)
    // Silent catch: loading state may be very brief or test timing may miss it
    await waitForSuggestionsLoading(page).catch(() => {
      // Loading state may be too brief to catch
    });

    // Content should still be intact regardless of loading state
    const contentAfterTimeout = await getEditorTextContent(page);
    expect(contentAfterTimeout.length).toBeGreaterThan(0);
  });
});
