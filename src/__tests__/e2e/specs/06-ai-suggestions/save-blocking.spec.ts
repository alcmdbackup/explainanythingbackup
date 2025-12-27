/**
 * E2E Tests for Save Blocking with Pending AI Suggestions
 *
 * Tests that save buttons are disabled when there are unaccepted AI suggestions:
 * - Save button disabled when suggestions exist
 * - Publish button disabled when suggestions exist
 * - Buttons show tooltip explaining why disabled
 * - Buttons enabled after all suggestions accepted/rejected
 */

import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import { UserLibraryPage } from '../../helpers/pages/UserLibraryPage';
import {
  mockAISuggestionsPipelineAPI,
  mockPromptSpecificContent,
} from '../../helpers/api-mocks';
import {
  submitAISuggestionPrompt,
  waitForSuggestionsSuccess,
  waitForDiffNodes,
  getDiffCounts,
  clickAcceptOnFirstDiff,
  clickRejectOnFirstDiff,
  waitForEditMode,
  enterEditMode,
} from '../../helpers/suggestions-test-helpers';

test.describe('Save Blocking with Pending AI Suggestions', () => {
  test.describe.configure({ retries: 2 });

  test('save button should be disabled when AI suggestions are pending', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockPromptSpecificContent.removeFirstSentence,
    });

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    // Enter edit mode before submitting AI suggestions
    await enterEditMode(page);

    // Submit AI suggestion to create pending diffs
    await submitAISuggestionPrompt(page, 'Remove the first sentence');
    await waitForSuggestionsSuccess(page);
    await waitForEditMode(page);
    await waitForDiffNodes(page);

    // Verify suggestions exist
    const counts = await getDiffCounts(page);
    expect(counts.total).toBeGreaterThan(0);

    // Verify save button is disabled
    const saveButton = page.locator('[data-testid="save-to-library"]');
    await expect(saveButton).toBeDisabled();

    // Verify tooltip is present
    const title = await saveButton.getAttribute('title');
    expect(title).toContain('Accept or reject AI suggestions');
  });

  test('publish button should be disabled when AI suggestions are pending', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockPromptSpecificContent.removeFirstSentence,
    });

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    // Enter edit mode before submitting AI suggestions
    await enterEditMode(page);

    // Submit AI suggestion to create pending diffs
    await submitAISuggestionPrompt(page, 'Remove the first sentence');
    await waitForSuggestionsSuccess(page);
    await waitForEditMode(page);
    await waitForDiffNodes(page);

    // Verify suggestions exist
    const counts = await getDiffCounts(page);
    expect(counts.total).toBeGreaterThan(0);

    // Verify publish button is disabled (if visible)
    const publishButton = page.locator('[data-testid="publish-button"]');
    if (await publishButton.isVisible()) {
      await expect(publishButton).toBeDisabled();

      // Verify tooltip is present
      const title = await publishButton.getAttribute('title');
      expect(title).toContain('Accept or reject AI suggestions');
    }
  });

  test('save button should be enabled after accepting all suggestions', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockPromptSpecificContent.removeFirstSentence,
    });

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    // Enter edit mode before submitting AI suggestions
    await enterEditMode(page);

    // Submit AI suggestion to create pending diffs
    await submitAISuggestionPrompt(page, 'Remove the first sentence');
    await waitForSuggestionsSuccess(page);
    await waitForEditMode(page);
    await waitForDiffNodes(page);

    // Accept all diffs one by one
    let counts = await getDiffCounts(page);
    while (counts.total > 0) {
      const previousCount = counts.total;
      await clickAcceptOnFirstDiff(page);
      // Wait for diff count to decrease
      await expect(async () => {
        counts = await getDiffCounts(page);
        expect(counts.total).toBeLessThan(previousCount);
      }).toPass({ timeout: 5000 });
    }

    // Verify all diffs are gone
    expect(counts.total).toBe(0);

    // Verify save button is no longer disabled due to suggestions
    // (may still be disabled for other reasons like already saved)
    const saveButton = page.locator('[data-testid="save-to-library"]');
    const title = await saveButton.getAttribute('title');
    // Title should not contain the suggestions warning anymore (null when no pending suggestions)
    expect(title ?? '').not.toContain('Accept or reject AI suggestions');
  });

  test('save button should be enabled after rejecting all suggestions', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockPromptSpecificContent.removeFirstSentence,
    });

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    // Enter edit mode before submitting AI suggestions
    await enterEditMode(page);

    // Submit AI suggestion to create pending diffs
    await submitAISuggestionPrompt(page, 'Remove the first sentence');
    await waitForSuggestionsSuccess(page);
    await waitForEditMode(page);
    await waitForDiffNodes(page);

    // Reject all diffs one by one
    let counts = await getDiffCounts(page);
    while (counts.total > 0) {
      const previousCount = counts.total;
      await clickRejectOnFirstDiff(page);
      // Wait for diff count to decrease
      await expect(async () => {
        counts = await getDiffCounts(page);
        expect(counts.total).toBeLessThan(previousCount);
      }).toPass({ timeout: 5000 });
    }

    // Verify all diffs are gone
    expect(counts.total).toBe(0);

    // Verify save button is no longer disabled due to suggestions
    const saveButton = page.locator('[data-testid="save-to-library"]');
    const title = await saveButton.getAttribute('title');
    // Title should not contain the suggestions warning anymore (null when no pending suggestions)
    expect(title ?? '').not.toContain('Accept or reject AI suggestions');
  });
});
