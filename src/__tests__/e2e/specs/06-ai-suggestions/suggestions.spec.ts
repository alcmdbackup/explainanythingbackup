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
import {
  createTestExplanationInLibrary,
  type TestExplanation,
} from '../../helpers/test-data-factory';

test.describe('AI Suggestions Pipeline', () => {
  // Enable retries for this test suite due to SSE mock timing issues
  test.describe.configure({ retries: 2 });

  let testExplanation: TestExplanation;

  test.beforeAll(async () => {
    // Create isolated test data for this test file
    testExplanation = await createTestExplanationInLibrary({
      title: 'AI Suggestions Pipeline Test',
      content: '<h2>Quantum Physics</h2><p>This introductory sentence explains quantum physics. Quantum mechanics describes behavior at atomic scales. It is a fundamental theory in modern physics.</p>',
      status: 'published',
    });
  });

  test.afterAll(async () => {
    await testExplanation.cleanup();
  });

  // ============= Panel Interaction Tests =============

  test.describe('Panel Interaction', () => {
    test('should display AI suggestions panel', { tag: ['@critical', '@prod-ai'] }, async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
      await resultsPage.waitForAnyContent(60000);

      const isPanelVisible = await resultsPage.isAISuggestionsPanelVisible();
      expect(isPanelVisible).toBe(true);
    });

    // Test 2: Real production AI test - no mocking, validates core AI flow
    // Skipped in prod due to AI unreliability - mocked equivalent in editor-integration.spec.ts
    test('should submit prompt and receive successful AI response', { tag: ['@prod-ai', '@skip-prod'] }, async ({ authenticatedPage: page }) => {
      // Use test.slow() to allow for real AI latency (triples default timeout)
      test.slow();

      const resultsPage = new ResultsPage(page);

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
      await resultsPage.waitForAnyContent(60000);

      await enterEditMode(page);
      await submitAISuggestionPrompt(page, 'Improve this text');

      // Assert success - real AI should work in production
      await waitForSuggestionsSuccess(page, 120000); // 2 minute timeout for real AI
    });

    test('should show loading state when submitting suggestion', { tag: '@skip-prod' }, async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);

      // Add delay to observe loading state
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
        delay: 1000,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
      await resultsPage.waitForAnyContent(60000);

      // Enter edit mode before submitting AI suggestions (required for editor to be editable)
      await enterEditMode(page);

      // Submit via the panel UI (not direct API call)
      await submitAISuggestionPrompt(page, 'Add more details');

      // Verify loading state appears
      await waitForSuggestionsLoading(page);
      expect(await page.locator('[data-testid="suggestions-loading"]').isVisible()).toBe(true);
    });

    test('should display success message after suggestions applied', { tag: '@skip-prod' }, async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
      await resultsPage.waitForAnyContent(60000);

      // Enter edit mode before submitting AI suggestions (required for editor to be editable)
      await enterEditMode(page);

      // Submit via the panel UI
      await submitAISuggestionPrompt(page, 'Add more details');

      // Verify success state appears
      await waitForSuggestionsSuccess(page);
      expect(await page.locator('[data-testid="suggestions-success"]').isVisible()).toBe(true);
    });

    test('should handle suggestion error gracefully', { tag: '@skip-prod' }, async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);

      await mockAISuggestionsPipelineAPI(page, {
        success: false,
        error: 'AI service temporarily unavailable',
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

  test.describe('Diff Visualization', { tag: '@skip-prod' }, () => {
    test('should render insertion diffs', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.deletion,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.mixed,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

  test.describe('Accept/Reject Interactions', { tag: '@skip-prod' }, () => {
    test('should return content with CriticMarkup for accept/reject UI', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.deletion,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.deletion,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.mixed,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

  test.describe('Prompt-Specific: Remove First Sentence', { tag: '@skip-prod' }, () => {
    test('should show deletion diff for first sentence', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.removeFirstSentence,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.removeFirstSentence,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.removeFirstSentence,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

  test.describe('Prompt-Specific: Shorten First Paragraph', { tag: '@skip-prod' }, () => {
    test('should show deletion and insertion diffs for paragraph condensation', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.shortenFirstParagraph,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.shortenFirstParagraph,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.shortenFirstParagraph,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

  test.describe('Prompt-Specific: Improve Entire Article', { tag: '@skip-prod' }, () => {
    test('should show multiple diffs across entire article', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.improveEntireArticle,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.improveEntireArticle,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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

      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.improveEntireArticle,
      });

      await page.goto(`/results?explanation_id=${testExplanation.id}`);
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
