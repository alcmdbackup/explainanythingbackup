/**
 * E2E Tests for AI Suggestions Editor Integration
 *
 * Tests the full flow from prompt submission to editor change:
 * - Diff visualization in the editor (insertions, deletions, updates)
 * - Accept/reject interactions affecting editor content
 * - Error recovery maintaining editor state
 *
 * Uses test-data-factory for reliable, isolated test data.
 * Requires NEXT_PUBLIC_USE_AI_API_ROUTE=true for mockable API route.
 */

import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import {
  mockAISuggestionsPipelineAPI,
  mockPromptSpecificContent,
  mockDiffContent,
} from '../../helpers/api-mocks';
import {
  submitAISuggestionPrompt,
  waitForSuggestionsSuccess,
  waitForSuggestionsError,
  waitForDiffNodes,
  getDiffCounts,
  clickAcceptOnFirstDiff,
  clickRejectOnFirstDiff,
  waitForEditMode,
  getEditorTextContent,
  enterEditMode,
} from '../../helpers/suggestions-test-helpers';
import {
  createTestExplanationInLibrary,
  type TestExplanation,
} from '../../helpers/test-data-factory';

test.describe('AI Suggestions Editor Integration', { tag: '@skip-prod' }, () => {
  // Enable retries for reliability
  test.describe.configure({ retries: 2 });

  let testExplanation: TestExplanation;

  test.beforeAll(async () => {
    // Create isolated test data for this test file
    testExplanation = await createTestExplanationInLibrary({
      title: 'Editor Integration Test',
      content: '<h2>Quantum Physics</h2><p>This introductory sentence explains the topic. Quantum mechanics describes behavior at atomic scales. It is fundamental to modern physics.</p>',
      status: 'published',
    });
  });

  test.afterAll(async () => {
    await testExplanation.cleanup();
  });

  // ============= Deletion Diff Tests =============

  test.describe('Delete First Sentence', () => {
    test('should show deletion diff in editor', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.removeFirstSentence,
      });

      // Navigate directly to test explanation
      await page.goto(`/results?explanation_id=${testExplanation.id}`);
      await resultsPage.waitForAnyContent(60000);

      // Enter edit mode before submitting AI suggestions (required for editor to be editable)
      await enterEditMode(page);

      // Submit via the panel UI
      await submitAISuggestionPrompt(page, 'Remove the first sentence');

      // Wait for success and diff nodes
      await waitForSuggestionsSuccess(page);
      await waitForEditMode(page);
      await waitForDiffNodes(page);

      // Verify deletion diff is present
      const counts = await getDiffCounts(page);
      expect(counts.deletions).toBeGreaterThan(0);
      expect(counts.total).toBeGreaterThanOrEqual(1);
    });

    test('accept removes sentence from editor', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.removeFirstSentence,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
      await resultsPage.waitForAnyContent(60000);

      // Enter edit mode before submitting AI suggestions
      await enterEditMode(page);

      await submitAISuggestionPrompt(page, 'Remove the first sentence');
      await waitForSuggestionsSuccess(page);
      await waitForEditMode(page);
      await waitForDiffNodes(page);

      // Get initial diff count
      const initialCounts = await getDiffCounts(page);
      expect(initialCounts.deletions).toBeGreaterThan(0);

      // Accept the deletion
      await clickAcceptOnFirstDiff(page);

      // Verify diff was removed
      const afterCounts = await getDiffCounts(page);
      expect(afterCounts.total).toBeLessThan(initialCounts.total);
    });

    test('reject keeps original sentence in editor', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.removeFirstSentence,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
      await resultsPage.waitForAnyContent(60000);

      // Enter edit mode before submitting AI suggestions
      await enterEditMode(page);

      await submitAISuggestionPrompt(page, 'Remove the first sentence');
      await waitForSuggestionsSuccess(page);
      await waitForEditMode(page);
      await waitForDiffNodes(page);

      // Get content before reject
      const initialCounts = await getDiffCounts(page);
      expect(initialCounts.deletions).toBeGreaterThan(0);

      // Reject the deletion
      await clickRejectOnFirstDiff(page);

      // Verify diff was removed but content was kept
      const afterCounts = await getDiffCounts(page);
      expect(afterCounts.total).toBeLessThan(initialCounts.total);

      // The text should still contain "This introductory sentence"
      const editorContent = await getEditorTextContent(page);
      expect(editorContent).toContain('Quantum');
    });
  });

  // ============= Mixed Diff Tests =============

  test.describe('Shorten Paragraph', () => {
    test('should show both deletion and insertion diffs', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.shortenFirstParagraph,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
      await resultsPage.waitForAnyContent(60000);

      // Enter edit mode before submitting AI suggestions
      await enterEditMode(page);

      await submitAISuggestionPrompt(page, 'Shorten the first paragraph');
      await waitForSuggestionsSuccess(page);
      await waitForEditMode(page);
      await waitForDiffNodes(page);

      // Verify both insertion and deletion diffs are present
      const counts = await getDiffCounts(page);
      expect(counts.insertions).toBeGreaterThan(0);
      expect(counts.deletions).toBeGreaterThan(0);
    });
  });

  // ============= Insertion Diff Tests =============

  test.describe('Add Content', () => {
    test('should show insertion diff for added content', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
      await resultsPage.waitForAnyContent(60000);

      // Enter edit mode before submitting AI suggestions
      await enterEditMode(page);

      await submitAISuggestionPrompt(page, 'Add more details');
      await waitForSuggestionsSuccess(page);
      await waitForEditMode(page);
      await waitForDiffNodes(page);

      // Verify insertion diff is present
      const counts = await getDiffCounts(page);
      expect(counts.insertions).toBeGreaterThan(0);
    });
  });

  // ============= Error Recovery Tests =============

  test.describe('Error Recovery', () => {
    test('should show error in panel and keep editor unchanged', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);

      // Get editor content before error
      await page.goto(`/results?explanation_id=${testExplanation.id}`);
      await resultsPage.waitForAnyContent(60000);

      const contentBefore = await getEditorTextContent(page);

      // Enter edit mode before submitting AI suggestions
      await enterEditMode(page);

      // Mock error response
      await mockAISuggestionsPipelineAPI(page, {
        success: false,
        error: 'AI service temporarily unavailable',
      });

      await submitAISuggestionPrompt(page, 'Make some changes');

      // Wait for error state
      await waitForSuggestionsError(page);
      expect(await page.locator('[data-testid="suggestions-error"]').isVisible()).toBe(true);

      // Verify no diff nodes appeared
      const counts = await getDiffCounts(page);
      expect(counts.total).toBe(0);

      // Verify content unchanged
      const contentAfter = await getEditorTextContent(page);
      expect(contentAfter).toBe(contentBefore);
    });
  });
});
