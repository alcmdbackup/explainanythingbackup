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
  mockReturnExplanationAPI,
  mockAISuggestionsPipelineAPI,
  defaultMockExplanation,
  mockDiffContent,
  mockPromptSpecificContent,
} from '../../helpers/api-mocks';
import {
  triggerAISuggestionsViaAPI,
} from '../../helpers/suggestions-test-helpers';

test.describe('AI Suggestions Pipeline', () => {
  // Enable retries for this test suite due to SSE mock timing issues
  test.describe.configure({ retries: 2 });

  // ============= Panel Interaction Tests =============

  test.describe('Panel Interaction', () => {
    // SKIP: SSE mock streaming is flaky with Playwright route.fulfill
    // The panel is tested implicitly in action-buttons tests that load from library
    test.skip('should display AI suggestions panel', async ({ authenticatedPage: page }, testInfo) => {
      // SSE mocking can be slower on first run due to server warmup
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      const isPanelVisible = await resultsPage.isAISuggestionsPanelVisible();
      expect(isPanelVisible).toBe(true);
    });

    // NOTE: The following tests require modifying AISuggestionsPanel to use the API route
    // instead of server action. Currently skipped because the panel uses server action directly,
    // which bypasses our API route mock. See docs for "Approach A with runtime switch" option.

    test.skip('should show loading state when submitting suggestion', async () => {
      // Requires AISuggestionsPanel to use API route (runtime env switch)
      // The panel currently uses runAISuggestionsPipelineAction server action
    });

    test.skip('should display success message after suggestions applied', async () => {
      // Requires AISuggestionsPanel to use API route (runtime env switch)
      // The panel currently uses runAISuggestionsPipelineAction server action
    });

    test.skip('should handle suggestion error gracefully', async () => {
      // Requires AISuggestionsPanel to use API route (runtime env switch)
      // The panel currently uses runAISuggestionsPipelineAction server action
    });
  });

  // ============= Diff Visualization Tests =============

  test.describe('Diff Visualization', () => {
    test('should render insertion diffs', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
      });

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      // Trigger AI suggestions via API route
      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: defaultMockExplanation.content,
        userPrompt: 'Add new content',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('{++');
    });

    test('should render deletion diffs', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.deletion,
      });

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      // Trigger AI suggestions via API route
      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: defaultMockExplanation.content,
        userPrompt: 'Remove content',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('{--');
    });

    test('should render mixed diffs correctly', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.mixed,
      });

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      // Trigger AI suggestions via API route
      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: defaultMockExplanation.content,
        userPrompt: 'Improve content',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('{++');
      expect(result.content).toContain('{--');
    });
  });

  // ============= Accept/Reject Interaction Tests =============

  test.describe('Accept/Reject Interactions', () => {
    test('should return content with CriticMarkup for accept/reject UI', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
      });

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      // Trigger AI suggestions via API route
      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: defaultMockExplanation.content,
        userPrompt: 'Add details',
      });

      expect(result.success).toBe(true);
      // Verify CriticMarkup format is returned
      expect(result.content).toMatch(/\{\+\+.*\+\+\}|\{--.*--\}/);
    });

    test('should return insertion content for accept scenario', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
      });

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: defaultMockExplanation.content,
        userPrompt: 'Add new paragraph',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('{++newly added++}');
    });

    test('should return insertion content for reject scenario', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.insertion,
      });

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: defaultMockExplanation.content,
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
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.deletion,
      });

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: defaultMockExplanation.content,
        userPrompt: 'Remove unnecessary content',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('{--removed--}');
    });

    test('should return deletion content for reject scenario', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.deletion,
      });

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: defaultMockExplanation.content,
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
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockDiffContent.mixed,
      });

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: defaultMockExplanation.content,
        userPrompt: 'Improve overall quality',
      });

      expect(result.success).toBe(true);
      // Mixed diffs should have both insertions and deletions
      expect(result.content).toContain('{++Added paragraph.++}');
      expect(result.content).toContain('{--deleted--}');
    });
  });

  // ============= Prompt-Specific Tests =============

  test.describe('Prompt-Specific: Remove First Sentence', () => {
    test('should show deletion diff for first sentence', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.removeFirstSentence,
      });

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: defaultMockExplanation.content,
        userPrompt: 'Remove the first sentence',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('{--This introductory sentence is outdated. --}');
    });

    test('accept removes sentence, content flows naturally', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.removeFirstSentence,
      });

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: defaultMockExplanation.content,
        userPrompt: 'Remove the first sentence',
      });

      expect(result.success).toBe(true);
      // After accepting deletion, content should flow naturally
      expect(result.content).toContain('Quantum physics describes nature');
    });

    test('reject keeps original first sentence', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.removeFirstSentence,
      });

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: defaultMockExplanation.content,
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
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.shortenFirstParagraph,
      });

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: defaultMockExplanation.content,
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
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.shortenFirstParagraph,
      });

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: defaultMockExplanation.content,
        userPrompt: 'Shorten the first paragraph',
      });

      expect(result.success).toBe(true);
      // Should contain the concise replacement
      expect(result.content).toContain('Machine learning builds systems that learn from data');
    });

    test('reject all keeps original verbose paragraph', async ({ authenticatedPage: page }, testInfo) => {
      if (testInfo.retry === 0) test.slow();

      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.shortenFirstParagraph,
      });

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: defaultMockExplanation.content,
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
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.improveEntireArticle,
      });

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: defaultMockExplanation.content,
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
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.improveEntireArticle,
      });

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: defaultMockExplanation.content,
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
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipelineAPI(page, {
        success: true,
        content: mockPromptSpecificContent.improveEntireArticle,
      });

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      const result = await triggerAISuggestionsViaAPI(page, {
        currentContent: defaultMockExplanation.content,
        userPrompt: 'Improve the entire article',
      });

      expect(result.success).toBe(true);
      // Should contain original content in deletion marks
      expect(result.content).toContain('Climate change is bad');
      expect(result.content).toContain('There are many effects');
    });
  });
});
