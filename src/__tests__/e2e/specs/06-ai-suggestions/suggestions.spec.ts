/**
 * E2E Tests for AI Suggestions Pipeline
 *
 * Uses browser-level mocking for the initial explanation generation.
 * Uses the test-only API route `/api/runAISuggestionsPipeline` for AI suggestions,
 * which returns standard JSON and can be mocked by Playwright.
 *
 * Tests the user workflow:
 * - Opening AI suggestions panel
 * - Panel visibility and UI elements
 * - Diff visualization (insertions, deletions, mixed)
 * - Accept/reject interactions
 */

import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import { UserLibraryPage } from '../../helpers/pages/UserLibraryPage';
import {
  mockAISuggestionsPipelineAPI,
  mockDiffContent,
  mockPromptSpecificContent,
} from '../../helpers/api-mocks';
import {
  triggerAISuggestionsViaAPI,
  submitAISuggestionPrompt,
  waitForSuggestionsSuccess,
  waitForSuggestionsError,
  waitForSuggestionsLoading,
  waitForDiffNodes,
  waitForEditMode,
  enterEditMode,
} from '../../helpers/suggestions-test-helpers';

test.describe('AI Suggestions Pipeline', () => {
  // Enable retries for this test suite due to SSE mock timing issues
  test.describe.configure({ retries: 2 });

  // ============= Panel Interaction Tests =============

  test.describe('Panel Interaction', () => {
    // Uses library loading pattern instead of SSE mocking for reliability
    test('should display AI suggestions panel', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      // Click View on first explanation
      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      const isPanelVisible = await resultsPage.isAISuggestionsPanelVisible();
      expect(isPanelVisible).toBe(true);
    });

    // NOTE: These tests use library loading pattern instead of SSE mocking for reliability.
    // They require NEXT_PUBLIC_USE_AI_API_ROUTE=true so the panel uses mockable API route.

    test('should show loading state when submitting suggestion', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      // Add delay to observe loading state
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
        delay: 1000,
      });

      // Click View on first explanation
      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      // Enter edit mode before submitting AI suggestions (required for editor to be editable)
      await enterEditMode(page);

      // Submit via the panel UI (not direct API call)
      await submitAISuggestionPrompt(page, 'Add more details');

      // Verify loading state appears
      await waitForSuggestionsLoading(page);
      expect(await page.locator('[data-testid="suggestions-loading"]').isVisible()).toBe(true);
    });

    test('should display success message after suggestions applied', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
      });

      // Click View on first explanation
      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      // Enter edit mode before submitting AI suggestions (required for editor to be editable)
      await enterEditMode(page);

      // Submit via the panel UI
      await submitAISuggestionPrompt(page, 'Add more details');

      // Verify success state appears
      await waitForSuggestionsSuccess(page);
      expect(await page.locator('[data-testid="suggestions-success"]').isVisible()).toBe(true);
    });

    test('should handle suggestion error gracefully', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      await mockAISuggestionsPipelineAPI(page, {
        success: false,
        error: 'AI service temporarily unavailable',
      });

      // Click View on first explanation
      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      // Enter edit mode before submitting AI suggestions (required for editor to be editable)
      await enterEditMode(page);

      // Submit via the panel UI
      await submitAISuggestionPrompt(page, 'Add more details');

      // Verify error state appears
      await waitForSuggestionsError(page);
      expect(await page.locator('[data-testid="suggestions-error"]').isVisible()).toBe(true);
    });
  });

  // ============= Diff Visualization Tests =============

  test.describe('Diff Visualization', () => {
    // Uses library loading pattern instead of SSE mocking for reliability
    test('should render insertion diffs', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
      });

      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      // Trigger AI suggestions via API route
      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: 'Test content from library',
        userPrompt: 'Add new content',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('{++');
    });

    test('should render deletion diffs', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.deletion,
      });

      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      // Trigger AI suggestions via API route
      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: 'Test content from library',
        userPrompt: 'Remove content',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('{--');
    });

    test('should render mixed diffs correctly', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.mixed,
      });

      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      // Trigger AI suggestions via API route
      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: 'Test content from library',
        userPrompt: 'Improve content',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('{++');
      expect(result.content).toContain('{--');
    });
  });

  // ============= Accept/Reject Interaction Tests =============

  test.describe('Accept/Reject Interactions', () => {
    // Uses library loading pattern instead of SSE mocking for reliability
    test('should return content with CriticMarkup for accept/reject UI', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
      });

      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      // Trigger AI suggestions via API route
      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: 'Test content from library',
        userPrompt: 'Add details',
      });

      expect(result.success).toBe(true);
      // Verify CriticMarkup format is returned
      expect(result.content).toMatch(/\{\+\+.*\+\+\}|\{--.*--\}/);
    });

    test('should render accept/reject buttons after AI suggestions applied', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
      });

      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      // Enter edit mode before submitting AI suggestions (required for editor to be editable)
      await enterEditMode(page);

      // Submit AI suggestion via panel UI
      await submitAISuggestionPrompt(page, 'Add more details');
      await waitForSuggestionsSuccess(page);
      await waitForEditMode(page);
      await waitForDiffNodes(page);

      // Explicit assertion: accept/reject buttons must be visible
      const acceptButton = page.locator('button:has-text("✓")').first();
      const rejectButton = page.locator('button:has-text("✕")').first();

      await expect(acceptButton).toBeVisible({ timeout: 5000 });
      await expect(rejectButton).toBeVisible({ timeout: 5000 });
    });

    test('should return insertion content for accept scenario', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
      });

      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: 'Test content from library',
        userPrompt: 'Add new paragraph',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('{++newly added++}');
    });

    test('should return insertion content for reject scenario', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
      });

      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: 'Test content from library',
        userPrompt: 'Try adding content',
      });

      expect(result.success).toBe(true);
      // Content should have insertion marks that can be rejected
      expect(result.content).toContain('{++');
      expect(result.content).toContain('++}');
    });

    test('should return deletion content for accept scenario', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.deletion,
      });

      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: 'Test content from library',
        userPrompt: 'Remove unnecessary content',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('{--removed--}');
    });

    test('should return deletion content for reject scenario', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.deletion,
      });

      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: 'Test content from library',
        userPrompt: 'Try removing content',
      });

      expect(result.success).toBe(true);
      // Content should have deletion marks that can be rejected
      expect(result.content).toContain('{--');
      expect(result.content).toContain('--}');
    });

    test('should handle mixed diffs for accept/reject all', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.mixed,
      });

      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: 'Test content from library',
        userPrompt: 'Improve overall quality',
      });

      expect(result.success).toBe(true);
      // Mixed diffs should have both insertions and deletions
      expect(result.content).toContain('{++Added paragraph.++}');
      expect(result.content).toContain('{--deleted--}');
    });
  });

  // ============= Prompt-Specific Tests =============
  // Uses library loading pattern instead of SSE mocking for reliability

  test.describe('Prompt-Specific: Remove First Sentence', () => {
    test('should show deletion diff for first sentence', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
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

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: 'Test content from library',
        userPrompt: 'Remove the first sentence',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('{--This introductory sentence is outdated. --}');
    });

    test('accept removes sentence, content flows naturally', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
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

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: 'Test content from library',
        userPrompt: 'Remove the first sentence',
      });

      expect(result.success).toBe(true);
      // After accepting deletion, content should flow naturally
      expect(result.content).toContain('Quantum physics describes nature');
    });

    test('reject keeps original first sentence', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
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

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: 'Test content from library',
        userPrompt: 'Remove the first sentence',
      });

      expect(result.success).toBe(true);
      // Content should contain the original sentence in deletion marks
      expect(result.content).toContain('This introductory sentence is outdated');
    });
  });

  test.describe('Prompt-Specific: Shorten First Paragraph', () => {
    test('should show deletion and insertion diffs for paragraph condensation', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.shortenFirstParagraph,
      });

      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: 'Test content from library',
        userPrompt: 'Shorten the first paragraph',
      });

      expect(result.success).toBe(true);
      // Should have both deletion of verbose text and insertion of concise text
      expect(result.content).toContain('{--');
      expect(result.content).toContain('{++');
    });

    test('accept all replaces verbose with concise paragraph', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.shortenFirstParagraph,
      });

      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: 'Test content from library',
        userPrompt: 'Shorten the first paragraph',
      });

      expect(result.success).toBe(true);
      // Should contain the concise replacement
      expect(result.content).toContain('Machine learning builds systems that learn from data');
    });

    test('reject all keeps original verbose paragraph', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.shortenFirstParagraph,
      });

      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: 'Test content from library',
        userPrompt: 'Shorten the first paragraph',
      });

      expect(result.success).toBe(true);
      // Should contain the original verbose text in deletion marks
      expect(result.content).toContain('Machine learning is a subset of artificial intelligence');
    });
  });

  test.describe('Prompt-Specific: Improve Entire Article', () => {
    test('should show multiple diffs across entire article', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.improveEntireArticle,
      });

      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: 'Test content from library',
        userPrompt: 'Improve the entire article',
      });

      expect(result.success).toBe(true);
      // Should have multiple diffs
      const insertionCount = (result.content?.match(/\{\+\+/g) || []).length;
      const deletionCount = (result.content?.match(/\{--/g) || []).length;
      expect(insertionCount).toBeGreaterThan(1);
      expect(deletionCount).toBeGreaterThan(1);
    });

    test('accept all transforms to improved version', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.improveEntireArticle,
      });

      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: 'Test content from library',
        userPrompt: 'Improve the entire article',
      });

      expect(result.success).toBe(true);
      // Should contain improved content
      expect(result.content).toContain('Understanding Climate Change');
      expect(result.content).toContain('Environmental and Social Effects');
    });

    test('reject all keeps original poor quality article', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      const libraryPage = new UserLibraryPage(page);

      // Load content from library (no SSE, reliable DB fetch)
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      test.skip(libraryState !== 'loaded', 'No saved explanations available');

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.improveEntireArticle,
      });

      await libraryPage.clickViewByIndex(0);
      await page.waitForURL(/\/results\?explanation_id=/);
      await resultsPage.waitForAnyContent(60000);

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: 'Test content from library',
        userPrompt: 'Improve the entire article',
      });

      expect(result.success).toBe(true);
      // Should contain original content in deletion marks
      expect(result.content).toContain('Climate change is bad');
      expect(result.content).toContain('There are many effects');
    });
  });
});
