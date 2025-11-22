/**
 * Phase 6: Error Handling E2E Tests
 *
 * Tests error scenarios and edge cases for the results page.
 * Note: The app handles errors via SSE stream 'error' events, not HTTP status codes.
 */
import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import {
  mockReturnExplanationAPIError,
  mockReturnExplanationStreamError,
  mockReturnExplanationAPI,
  defaultMockExplanation,
} from '../../helpers/api-mocks';

test.describe('Error Handling', () => {
  test.describe('API Errors', () => {
    test('should not display content when API returns 500', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      // Mock API to return 500 error
      await mockReturnExplanationAPIError(page, 'Internal server error');

      // Navigate to results with a query
      await resultsPage.navigate('test query');

      // Wait for page to process response
      await page.waitForTimeout(3000);

      // Verify no content is displayed (app doesn't show error banner for HTTP errors)
      const hasContent = await resultsPage.hasContent().catch(() => false);
      expect(hasContent).toBe(false);
    });

    test('should display error message for stream errors', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      // Mock API to return error during streaming (proper SSE error event)
      await mockReturnExplanationStreamError(page, 'Stream interrupted');

      await resultsPage.navigate('test query');

      // Wait for error to appear
      await resultsPage.waitForError(15000);

      // Verify error is displayed
      const isErrorVisible = await resultsPage.isErrorVisible();
      expect(isErrorVisible).toBe(true);

      // Verify error message content
      const errorMessage = await resultsPage.getErrorMessage();
      expect(errorMessage).toContain('Stream interrupted');
    });
  });

  test.describe('Invalid URL Parameters', () => {
    test('should handle invalid explanation_id in URL gracefully', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      // Navigate with an invalid explanation_id
      await page.goto('/results?explanation_id=invalid-uuid-12345');

      // Wait for page to settle
      await page.waitForTimeout(3000);

      // Page should either show error or empty state (not crash)
      const hasError = await resultsPage.isErrorVisible().catch(() => false);
      const hasContent = await resultsPage.hasContent().catch(() => false);

      // Either error is shown or no content - but page shouldn't crash
      expect(hasError || !hasContent).toBe(true);
    });

    test('should handle missing query parameter', async ({ authenticatedPage: page }) => {
      // Navigate without query or explanation_id
      await page.goto('/results');

      // Wait for page to settle
      await page.waitForTimeout(2000);

      // Page should not crash - verify we're still on results page
      const url = page.url();
      expect(url).toContain('/results');
    });
  });

  test.describe('Error Recovery', () => {
    test('should recover from error state on new query', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      // First, trigger a stream error
      await mockReturnExplanationStreamError(page, 'First request failed');
      await resultsPage.navigate('failing query');
      await resultsPage.waitForError(15000);

      // Verify error is displayed
      expect(await resultsPage.isErrorVisible()).toBe(true);

      // Clear route and set up success mock
      await page.unrouteAll();
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      // Submit new query using the search bar
      await page.fill('[data-testid="search-input"]', 'successful query');
      await page.click('[data-testid="search-submit"]');

      // Wait for content to load
      await resultsPage.waitForAnyContent(30000);

      // Verify error is gone and content is displayed
      const hasContent = await resultsPage.hasContent();
      expect(hasContent).toBe(true);
    });
  });
});
