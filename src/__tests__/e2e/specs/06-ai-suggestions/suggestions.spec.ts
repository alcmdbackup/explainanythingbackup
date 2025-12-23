/**
 * E2E Tests for AI Suggestions Pipeline
 *
 * Tests the full user workflow:
 * - Opening AI suggestions panel
 * - Submitting prompts
 * - Viewing diff visualizations
 * - Accepting/rejecting changes
 *
 * 23 test cases organized by feature area.
 */

import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import {
  mockReturnExplanationAPI,
  mockAISuggestionsPipeline,
  defaultMockExplanation,
  mockDiffContent,
  mockPromptSpecificContent,
} from '../../helpers/api-mocks';

test.describe('AI Suggestions Pipeline', () => {
  // ============= Panel Interaction Tests (4 tests) =============

  test.describe('Panel Interaction', () => {
    test('should display AI suggestions panel', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();

      const isPanelVisible = await resultsPage.isAISuggestionsPanelVisible();
      expect(isPanelVisible).toBe(true);
    });

    test('should show loading state when submitting suggestion', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      // Order matters: register server action mock first, then API mock
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.insertion, delay: 2000 });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();

      await resultsPage.submitAISuggestion('Add more detail');

      // Check for loading state
      await resultsPage.waitForSuggestionsLoading();
    });

    // TODO: This test requires proper RSC (React Server Components) wire format mocking
    // for Next.js server actions. Plain JSON responses cause "Connection closed" errors.
    // See: https://github.com/vercel/next.js/discussions/49383
    test.skip('should display success message after suggestions applied', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      // Order matters: register server action mock first, then API mock
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.insertion });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Add examples');

      await resultsPage.waitForSuggestionsComplete();
    });

    test('should handle suggestion error gracefully', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      // Order matters: register server action mock first, then API mock
      await mockAISuggestionsPipeline(page, { success: false, error: 'Pipeline failed' });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Break it');

      await resultsPage.waitForSuggestionsError();
    });
  });

  // ============= Diff Visualization Tests (3 tests) =============
  // NOTE: These tests are skipped because they require proper RSC wire format mocking.
  // The server action mock returns plain JSON, but Next.js expects RSC format.

  test.describe('Diff Visualization', () => {
    test.skip('should render insertion diffs', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.insertion });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Add content');
      await resultsPage.waitForSuggestionsComplete();

      const insertionCount = await resultsPage.getInsertionCount();
      expect(insertionCount).toBeGreaterThanOrEqual(1);
    });

    test.skip('should render deletion diffs', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.deletion });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Remove content');
      await resultsPage.waitForSuggestionsComplete();

      const deletionCount = await resultsPage.getDeletionCount();
      expect(deletionCount).toBeGreaterThanOrEqual(1);
    });

    test.skip('should render mixed diffs correctly', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.mixed });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Edit content');
      await resultsPage.waitForSuggestionsComplete();

      const totalDiffs = await resultsPage.getDiffCount();
      expect(totalDiffs).toBeGreaterThan(1);
    });
  });

  // ============= Accept/Reject Interaction Tests (7 tests) =============
  // NOTE: These tests are skipped because they require proper RSC wire format mocking.

  test.describe('Accept/Reject Interactions', () => {
    test.skip('should show accept/reject buttons on hover', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.insertion });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Add content');
      await resultsPage.waitForSuggestionsComplete();

      const acceptVisible = await resultsPage.isDiffAcceptButtonVisible(0);
      const rejectVisible = await resultsPage.isDiffRejectButtonVisible(0);

      expect(acceptVisible).toBe(true);
      expect(rejectVisible).toBe(true);
    });

    test.skip('should accept insertion and keep content', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.insertion });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Add content');
      await resultsPage.waitForSuggestionsComplete();

      const beforeCount = await resultsPage.getDiffCount();
      expect(beforeCount).toBeGreaterThanOrEqual(1);

      await resultsPage.acceptDiff(0);

      const afterCount = await resultsPage.getDiffCount();
      expect(afterCount).toBeLessThan(beforeCount);

      const content = await resultsPage.getContent();
      expect(content).toContain('newly added');
    });

    test.skip('should reject insertion and remove content', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.insertion });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Add content');
      await resultsPage.waitForSuggestionsComplete();

      await resultsPage.rejectDiff(0);

      const afterCount = await resultsPage.getDiffCount();
      expect(afterCount).toBe(0);

      const content = await resultsPage.getContent();
      expect(content).not.toContain('newly added');
    });

    test.skip('should accept deletion and remove content', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.deletion });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Remove content');
      await resultsPage.waitForSuggestionsComplete();

      await resultsPage.acceptDiff(0);

      const content = await resultsPage.getContent();
      expect(content).not.toContain('removed');
    });

    test.skip('should reject deletion and keep content', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.deletion });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Remove content');
      await resultsPage.waitForSuggestionsComplete();

      await resultsPage.rejectDiff(0);

      const content = await resultsPage.getContent();
      expect(content).toContain('removed');
    });

    test.skip('should handle accept all diffs', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.mixed });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Edit content');
      await resultsPage.waitForSuggestionsComplete();

      const beforeCount = await resultsPage.getDiffCount();
      expect(beforeCount).toBeGreaterThan(1);

      await resultsPage.acceptAllDiffs();

      const afterCount = await resultsPage.getDiffCount();
      expect(afterCount).toBe(0);
    });

    test.skip('should handle reject all diffs', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.mixed });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Edit content');
      await resultsPage.waitForSuggestionsComplete();

      const beforeCount = await resultsPage.getDiffCount();
      expect(beforeCount).toBeGreaterThan(1);

      await resultsPage.rejectAllDiffs();

      const afterCount = await resultsPage.getDiffCount();
      expect(afterCount).toBe(0);
    });
  });

  // ============= Prompt-Specific: Remove First Sentence (3 tests) =============
  // NOTE: These tests are skipped because they require proper RSC wire format mocking.

  test.describe('Prompt-Specific: Remove First Sentence', () => {
    test.skip('should show deletion diff for first sentence', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockPromptSpecificContent.removeFirstSentence });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Remove the first sentence');
      await resultsPage.waitForSuggestionsComplete();

      const deletionCount = await resultsPage.getDeletionCount();
      expect(deletionCount).toBeGreaterThanOrEqual(1);

      const diffText = await resultsPage.getDiffText(0);
      expect(diffText).toContain('introductory sentence is outdated');
    });

    test.skip('accept removes sentence, content flows naturally', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockPromptSpecificContent.removeFirstSentence });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Remove the first sentence');
      await resultsPage.waitForSuggestionsComplete();

      await resultsPage.acceptAllDiffs();

      const content = await resultsPage.getContent();
      expect(content).not.toContain('introductory sentence is outdated');
      expect(content).toContain('Quantum physics describes nature');
    });

    test.skip('reject keeps original first sentence', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockPromptSpecificContent.removeFirstSentence });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Remove the first sentence');
      await resultsPage.waitForSuggestionsComplete();

      await resultsPage.rejectAllDiffs();

      const content = await resultsPage.getContent();
      expect(content).toContain('introductory sentence is outdated');
    });
  });

  // ============= Prompt-Specific: Shorten First Paragraph (3 tests) =============
  // NOTE: These tests are skipped because they require proper RSC wire format mocking.

  test.describe('Prompt-Specific: Shorten First Paragraph', () => {
    test.skip('should show deletion and insertion diffs for paragraph condensation', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockPromptSpecificContent.shortenFirstParagraph });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Shorten the first paragraph');
      await resultsPage.waitForSuggestionsComplete();

      const deletionCount = await resultsPage.getDeletionCount();
      const insertionCount = await resultsPage.getInsertionCount();
      expect(deletionCount).toBeGreaterThanOrEqual(1);
      expect(insertionCount).toBeGreaterThanOrEqual(1);
    });

    test.skip('accept all replaces verbose with concise paragraph', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockPromptSpecificContent.shortenFirstParagraph });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Shorten the first paragraph');
      await resultsPage.waitForSuggestionsComplete();

      await resultsPage.acceptAllDiffs();

      const content = await resultsPage.getContent();
      expect(content).not.toContain('subset of artificial intelligence');
      expect(content).toContain('Machine learning builds systems');
    });

    test.skip('reject all keeps original verbose paragraph', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockPromptSpecificContent.shortenFirstParagraph });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Shorten the first paragraph');
      await resultsPage.waitForSuggestionsComplete();

      await resultsPage.rejectAllDiffs();

      const content = await resultsPage.getContent();
      expect(content).toContain('subset of artificial intelligence');
    });
  });

  // ============= Prompt-Specific: Improve Entire Article (3 tests) =============
  // NOTE: These tests are skipped because they require proper RSC wire format mocking.

  test.describe('Prompt-Specific: Improve Entire Article', () => {
    test.skip('should show multiple diffs across entire article', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockPromptSpecificContent.improveEntireArticle });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Improve the entire article');
      await resultsPage.waitForSuggestionsComplete();

      const totalDiffs = await resultsPage.getDiffCount();
      expect(totalDiffs).toBeGreaterThan(4); // Multiple sections changed
    });

    test.skip('accept all transforms to improved version', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockPromptSpecificContent.improveEntireArticle });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Improve the entire article');
      await resultsPage.waitForSuggestionsComplete();

      await resultsPage.acceptAllDiffs();

      const content = await resultsPage.getContent();
      expect(content).toContain('Understanding Climate Change');
      expect(content).toContain('long-term shifts in global temperatures');
      expect(content).not.toContain('Climate change is bad');
    });

    test.skip('reject all keeps original poor quality article', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockAISuggestionsPipeline(page, { content: mockPromptSpecificContent.improveEntireArticle });
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.submitAISuggestion('Improve the entire article');
      await resultsPage.waitForSuggestionsComplete();

      await resultsPage.rejectAllDiffs();

      const content = await resultsPage.getContent();
      expect(content).toContain('Climate change is bad');
      expect(content).not.toContain('Understanding Climate Change');
    });
  });
});
