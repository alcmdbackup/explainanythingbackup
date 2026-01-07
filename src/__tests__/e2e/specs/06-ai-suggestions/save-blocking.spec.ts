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
import {
  createTestExplanationInLibrary,
  type TestExplanation,
} from '../../helpers/test-data-factory';

test.describe('Save Blocking with Pending AI Suggestions', { tag: '@skip-prod' }, () => {
  test.describe.configure({ retries: 2 });

  let testExplanation: TestExplanation;

  test.beforeAll(async () => {
    // Create test data using the factory - no fixtures needed
    testExplanation = await createTestExplanationInLibrary({
      title: 'Save Blocking Test Explanation',
      content: '<p>This is test content for save blocking tests. It has multiple sentences.</p>',
      status: 'draft', // Use draft status so publish button is visible
    });
  });

  test.afterAll(async () => {
    // Clean up test data
    await testExplanation.cleanup();
  });

  test('save button should be disabled when AI suggestions are pending', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);

    // Mock AI suggestions API before navigation
    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockPromptSpecificContent.removeFirstSentence,
    });

    // Navigate directly to the test explanation
    await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockPromptSpecificContent.removeFirstSentence,
    });

    // Navigate directly to the test explanation
    await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockPromptSpecificContent.removeFirstSentence,
    });

    // Navigate directly to the test explanation
    await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockPromptSpecificContent.removeFirstSentence,
    });

    // Navigate directly to the test explanation
    await page.goto(`/results?explanation_id=${testExplanation.id}`);
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
