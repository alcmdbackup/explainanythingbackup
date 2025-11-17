import { test, expect } from '../../fixtures/auth';
import { SearchPage } from '../../helpers/pages/SearchPage';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import {
  mockReturnExplanationAPI,
  mockReturnExplanationAPIError,
  defaultMockExplanation,
  shortMockExplanation,
} from '../../helpers/api-mocks';

test.describe('Search and Generate Flow', () => {
  test.describe('Search Navigation', () => {
    test('should submit query from home page and redirect to results', async ({ authenticatedPage: page }) => {
      const searchPage = new SearchPage(page);
      const resultsPage = new ResultsPage(page);

      // Mock the API to avoid real calls
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await searchPage.navigate();
      await searchPage.search('quantum entanglement');

      // Verify redirect to results page with query param
      await page.waitForURL(/\/results\?q=/, { timeout: 10000 });
      const query = await resultsPage.getQueryFromUrl();
      expect(query).toContain('quantum entanglement');
    });

    test('should not submit empty query', async ({ authenticatedPage: page }) => {
      const searchPage = new SearchPage(page);

      await searchPage.navigate();
      await searchPage.fillQuery('');

      // Button should be disabled or search should not proceed
      const isDisabled = await searchPage.isSearchButtonDisabled();
      expect(isDisabled).toBe(true);

      // Verify we're still on home page
      expect(page.url()).not.toContain('/results');
    });

    test('should allow search from results page', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      const searchPage = new SearchPage(page);

      // Mock the API
      await mockReturnExplanationAPI(page, shortMockExplanation);

      // Navigate to results with initial query
      await resultsPage.navigate('initial query');
      await resultsPage.waitForCompleteGeneration();

      // Perform new search from results page
      await searchPage.fillQuery('new query');
      await searchPage.clickSearch();

      // Verify new query in URL
      await page.waitForURL(/q=new/, { timeout: 10000 });
    });
  });

  test.describe('Explanation Generation', () => {
    test('should show title during streaming', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingStart();

      const title = await resultsPage.getTitle();
      expect(title).toContain('Understanding Quantum Entanglement');
    });

    test('should display full content after streaming completes', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForCompleteGeneration();

      const content = await resultsPage.getContent();
      expect(content.length).toBeGreaterThan(100);
      expect(content).toContain('Quantum entanglement');
    });

    test('should show stream-complete indicator when generation finishes', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      await mockReturnExplanationAPI(page, shortMockExplanation);

      await resultsPage.navigate('brief explanation');
      await resultsPage.waitForCompleteGeneration();

      const isComplete = await resultsPage.isStreamComplete();
      expect(isComplete).toBe(true);
    });

    test('should automatically assign tags after generation', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForCompleteGeneration();

      const tags = await resultsPage.getTags();
      expect(tags.length).toBeGreaterThan(0);
      // Check for expected tag names
      const tagTexts = tags.join(' ').toLowerCase();
      expect(tagTexts).toMatch(/physics|quantum|advanced/);
    });

    test('should enable save-to-library button after generation', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForCompleteGeneration();

      const isEnabled = await resultsPage.isSaveToLibraryEnabled();
      expect(isEnabled).toBe(true);
    });
  });

  test.describe('Error Handling', () => {
    test('should handle API error gracefully', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      await mockReturnExplanationAPIError(page, 'Generation failed');

      await resultsPage.navigate('error query');

      // Wait for error state - page should show some error indicator
      // The exact error handling depends on the app's implementation
      await page.waitForTimeout(3000);

      // Verify no content is displayed
      const hasContent = await resultsPage.hasContent().catch(() => false);
      expect(hasContent).toBe(false);
    });

    test('should not crash with very long query', async ({ authenticatedPage: page }) => {
      const searchPage = new SearchPage(page);
      const resultsPage = new ResultsPage(page);

      await mockReturnExplanationAPI(page, shortMockExplanation);

      const longQuery = 'explain '.repeat(50) + 'quantum physics';

      await searchPage.navigate();
      await searchPage.fillQuery(longQuery);
      await searchPage.clickSearch();

      // Should still navigate to results
      await page.waitForURL(/\/results/, { timeout: 10000 });
      const currentUrl = await resultsPage.getCurrentUrl();
      expect(currentUrl).toContain('/results');
    });
  });

  test.describe('URL State', () => {
    test('should preserve query in URL after generation', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      await mockReturnExplanationAPI(page, defaultMockExplanation);

      const query = 'test query preservation';
      await resultsPage.navigate(query);
      await resultsPage.waitForCompleteGeneration();

      const urlQuery = await resultsPage.getQueryFromUrl();
      expect(urlQuery).toBe(query);
    });
  });
});
