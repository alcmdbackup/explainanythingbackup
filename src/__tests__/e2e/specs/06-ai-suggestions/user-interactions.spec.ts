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
  enterEditMode,
} from '../../helpers/suggestions-test-helpers';
import {
  createTestExplanationInLibrary,
  type TestExplanation,
} from '../../helpers/test-data-factory';

test.describe('AI Suggestions User Interactions', () => {
  test.describe.configure({ retries: 2 });

  let testExplanation: TestExplanation;

  test.beforeAll(async () => {
    // Create isolated test data for this test file
    testExplanation = await createTestExplanationInLibrary({
      title: 'User Interactions Test',
      content: '<p>Test content for user interaction tests. This has multiple sentences for AI suggestions.</p>',
      status: 'published',
    });
  });

  test.afterAll(async () => {
    await testExplanation.cleanup();
  });

  // Real production AI test - validates diff buttons appear after real AI response
  // Skipped in prod due to AI unreliability - mocked equivalent in save-blocking.spec.ts
  test('should show accept/reject buttons after AI response', { tag: ['@prod-ai', '@skip-prod'] }, async ({ authenticatedPage: page }) => {
    // Use test.slow() to allow for real AI latency (triples default timeout)
    test.slow();

    const resultsPage = new ResultsPage(page);

    await page.goto(`/results?explanation_id=${testExplanation.id}`);
    await resultsPage.waitForAnyContent(60000);

    await enterEditMode(page);
    await submitAISuggestionPrompt(page, 'Add more details');

    // Wait for AI success and diff nodes - real AI may take longer
    await waitForSuggestionsSuccess(page, 120000); // 2 minute timeout for real AI
    await waitForDiffNodes(page);

    // Check that accept/reject buttons exist (using button text since that's the pattern in this codebase)
    const acceptButton = page.locator('button:has-text("✓")').first();
    const rejectButton = page.locator('button:has-text("✕")').first();
    await expect(acceptButton).toBeVisible({ timeout: 5000 });
    await expect(rejectButton).toBeVisible({ timeout: 5000 });
  });

  test('should disable submit button during loading', { tag: '@skip-prod' }, async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);

    // Add delay to observe loading state
    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockDiffContent.insertion,
      delay: 2000,
    });

    // Navigate directly to test explanation
    await page.goto(`/results?explanation_id=${testExplanation.id}`);
    await resultsPage.waitForAnyContent(60000);

    // Enter edit mode before submitting AI suggestions
    await enterEditMode(page);

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

  test('should prevent rapid double-submit', { tag: '@skip-prod' }, async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);

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

    // Navigate directly to test explanation
    await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

  test('should handle submit after accepting some diffs', { tag: '@skip-prod' }, async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);

    // First suggestion
    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockDiffContent.insertion,
    });

    // Navigate directly to test explanation
    await page.goto(`/results?explanation_id=${testExplanation.id}`);
    await resultsPage.waitForAnyContent(60000);

    // Enter edit mode before submitting AI suggestions
    await enterEditMode(page);

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

  test('should disable prompt input while loading', { tag: '@skip-prod' }, async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);

    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockDiffContent.insertion,
      delay: 1500,
    });

    // Navigate directly to test explanation
    await page.goto(`/results?explanation_id=${testExplanation.id}`);
    await resultsPage.waitForAnyContent(60000);

    // Enter edit mode before submitting AI suggestions
    await enterEditMode(page);

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

  test('should show loading progress during pipeline execution', { tag: '@skip-prod' }, async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);

    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockDiffContent.insertion,
      delay: 1000,
    });

    // Navigate directly to test explanation
    await page.goto(`/results?explanation_id=${testExplanation.id}`);
    await resultsPage.waitForAnyContent(60000);

    // Enter edit mode before submitting AI suggestions
    await enterEditMode(page);

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
