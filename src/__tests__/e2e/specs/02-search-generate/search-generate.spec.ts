import { test, expect } from '../../fixtures/auth';
import { SearchPage } from '../../helpers/pages/SearchPage';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import {
  mockReturnExplanationAPI,
  mockReturnExplanationAPIError,
  defaultMockExplanation,
  shortMockExplanation,
  loadProductionTestData,
  isProductionEnvironment,
} from '../../helpers/api-mocks';
import { waitForState } from '../../helpers/wait-utils';

// Production tests use seeded explanation data instead of mocks
const isProduction = isProductionEnvironment();

test.describe('Search and Generate Flow', () => {
  test.describe('Search Navigation', () => {
    test('should submit query from home page and redirect to results', { tag: '@critical' }, async ({ authenticatedPage: page }) => {
      const searchPage = new SearchPage(page);
      const resultsPage = new ResultsPage(page);

      // Mock the API to avoid real calls
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await searchPage.navigate();

      // Use Promise.all to wait for navigation during search action
      // This ensures we catch the redirect even if there's timing variation
      await Promise.all([
        page.waitForURL(/\/results\?q=/, { timeout: 30000 }),
        searchPage.search('quantum entanglement'),
      ]);

      // Verify query param is correct
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

      // Navigate directly to results page (simulating already having content)
      await resultsPage.navigate('initial query');

      // Wait for streaming to complete (content received)
      await resultsPage.waitForStreamingComplete();

      // Perform new search from results page - this will trigger a new query
      await searchPage.fillQuery('new query');
      await searchPage.clickSearch();

      // After clicking search, page should redirect with new query OR new explanation
      // Since the mock is set up, it will generate and redirect with explanation_id
      await page.waitForURL(/userQueryId|q=new/, { timeout: 10000 });
    });
  });

  test.describe('Explanation Generation', () => {
    // Note: SSE streaming is now handled via E2E_TEST_MODE in the API route,
    // which provides real incremental streaming instead of buffered route.fulfill().

    test('should show title during streaming', async ({ authenticatedPage: page }, testInfo) => {
      // Firefox is slower with SSE streaming
      if (testInfo.project.name === 'firefox') test.slow();

      const resultsPage = new ResultsPage(page);

      if (isProduction) {
        // In production, use seeded explanation from global-setup
        const prodData = loadProductionTestData();
        expect(prodData, 'Production test data not found - global-setup may have failed').not.toBeNull();

        // Navigate directly to the seeded explanation
        await page.goto(`${process.env.BASE_URL}/results?explanation_id=${prodData!.explanationId}`);
        await resultsPage.waitForAnyContent();
        const title = await resultsPage.getTitle();
        expect(title.length).toBeGreaterThan(0);
        expect(title).toContain('Quantum Entanglement');
        return;
      }

      // Local/CI: use mocks for speed and determinism
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingStart();

      const title = await resultsPage.getTitle();
      expect(title).toContain('Understanding Quantum Entanglement');
    });

    test('should display full content after streaming completes', { tag: '@critical' }, async ({ authenticatedPage: page }, testInfo) => {
      // Firefox is slower with SSE streaming
      if (testInfo.project.name === 'firefox') test.slow();

      const resultsPage = new ResultsPage(page);

      if (isProduction) {
        // In production, use seeded explanation from global-setup
        const prodData = loadProductionTestData();
        expect(prodData, 'Production test data not found - global-setup may have failed').not.toBeNull();

        await page.goto(`${process.env.BASE_URL}/results?explanation_id=${prodData!.explanationId}`);
        await resultsPage.waitForAnyContent();
        const hasContent = await resultsPage.hasContent();
        expect(hasContent).toBe(true);
        return;
      }

      // Local/CI: use mocks for speed and determinism
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await resultsPage.navigate('quantum entanglement');

      // Wait for streaming to complete (before redirect happens)
      await resultsPage.waitForStreamingComplete();

      // Content is rendered via LexicalEditor which takes time to initialize
      // Just verify the content area exists and is visible
      const hasContent = await resultsPage.hasContent();
      expect(hasContent).toBe(true);
    });

    test('should show stream-complete indicator when generation finishes', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      if (isProduction) {
        // In production, use seeded explanation - no streaming indicator for DB loads
        const prodData = loadProductionTestData();
        expect(prodData, 'Production test data not found - global-setup may have failed').not.toBeNull();

        await page.goto(`${process.env.BASE_URL}/results?explanation_id=${prodData!.explanationId}`);
        await resultsPage.waitForAnyContent();
        // For loaded explanations, just verify content is present (no streaming indicator)
        const hasContent = await resultsPage.hasContent();
        expect(hasContent).toBe(true);
        return;
      }

      // Local/CI: use mocks for speed and determinism
      await mockReturnExplanationAPI(page, shortMockExplanation);

      await resultsPage.navigate('brief explanation');
      await resultsPage.waitForStreamingComplete();

      const isComplete = await resultsPage.isStreamComplete();
      expect(isComplete).toBe(true);
    });

    // eslint-disable-next-line flakiness/no-test-skip -- Requires real DB, not mockable
    test.skip('should automatically assign tags after generation', async ({ authenticatedPage: page }) => {
      // SKIP: Requires real database to load tags after redirect
      // Tags are not stored in SSE stream, they're loaded from DB after redirect
      const resultsPage = new ResultsPage(page);

      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      const tags = await resultsPage.getTags();
      expect(tags.length).toBeGreaterThan(0);
      // Check for expected tag names
      const tagTexts = tags.join(' ').toLowerCase();
      expect(tagTexts).toMatch(/physics|quantum|advanced/);
    });

    // eslint-disable-next-line flakiness/no-test-skip -- Requires real DB, not mockable
    test.skip('should enable save-to-library button after generation', async ({ authenticatedPage: page }) => {
      // SKIP: Requires real database to populate content after redirect
      // Button state depends on explanation data loaded from DB
      const resultsPage = new ResultsPage(page);

      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await resultsPage.navigate('quantum entanglement');
      await resultsPage.waitForStreamingComplete();

      const isEnabled = await resultsPage.isSaveToLibraryEnabled();
      expect(isEnabled).toBe(true);
    });
  });

  test.describe('Error Handling', () => {
    test('should handle API error gracefully', { tag: '@critical' }, async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      await mockReturnExplanationAPIError(page, 'Generation failed');

      await resultsPage.navigate('error query');

      // Wait for error or content state to appear
      const state = await waitForState(page, {
        error: async () => await page.locator('[data-testid="error-message"]').isVisible(),
        content: async () => await resultsPage.hasContent(),
      }, { timeout: 10000 });

      // Verify no content is displayed (error expected)
      const hasContent = state === 'content';
      expect(hasContent).toBe(false);
    });

    test('should not crash with very long query', async ({ authenticatedPage: page }) => {
      const searchPage = new SearchPage(page);
      const resultsPage = new ResultsPage(page);

      await mockReturnExplanationAPI(page, shortMockExplanation);

      // SearchBar has maxLength=150, so use a query that fills it completely
      // 'explain ' is 8 chars, repeat 18 times = 144, plus 'quantum' = 151 (truncated to 150)
      const longQuery = 'explain '.repeat(18) + 'quantum';

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
    test('should preserve query in URL after generation', async ({ authenticatedPage: page }, testInfo) => {
      // Firefox is slower with SSE streaming
      if (testInfo.project.name === 'firefox') test.slow();

      const resultsPage = new ResultsPage(page);

      if (isProduction) {
        // In production, verify explanation_id is preserved in URL
        const prodData = loadProductionTestData();
        expect(prodData, 'Production test data not found - global-setup may have failed').not.toBeNull();

        await page.goto(`${process.env.BASE_URL}/results?explanation_id=${prodData!.explanationId}`);
        await resultsPage.waitForAnyContent();
        // Verify the explanation_id is in the URL
        const explanationId = await resultsPage.getExplanationIdFromUrl();
        expect(explanationId).toBe(String(prodData!.explanationId));
        return;
      }

      // Local/CI: use mocks for speed and determinism
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      const query = 'test query preservation';
      await resultsPage.navigate(query);

      // Check URL immediately after navigation - query should be in URL from the start
      // Use retry pattern to handle timing variations in URL updates
      await expect(async () => {
        const urlQuery = await resultsPage.getQueryFromUrl();
        expect(urlQuery).toBe(query);
      }).toPass({ timeout: 10000 });

      // Then verify generation completes successfully
      await resultsPage.waitForCompleteGeneration();
    });
  });
});
